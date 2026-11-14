// Desktop shell. It starts the same Node server the container runs, then opens the monitor UI.
// Settings: plain values come from settings.env, secrets from the OS keychain. Both are edited in the
// Settings window (menu: Settings…). Every change restarts only the server with the new environment,
// and the monitor window reloads. If the server cannot start, the Settings window shows the error.
// Sign-in happens inside the window: the server checks for an existing session first and sends
// the user to Microsoft only when there is none. The server stops when the app quits.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod secrets;
mod store;

use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use config::Values;
use serde::Serialize;
use store::{Setting, Store};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{App, AppHandle, Emitter, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindowBuilder};

/// Must match a redirect URI registered for the Entra app (http://localhost:47831/auth/callback).
const DEFAULT_PORT: u16 = 47831;
const SETTINGS_WINDOW: &str = "settings";
const SETTINGS_MENU_ID: &str = "settings";
/// Settings saved within this window are applied together, so several edits cause one restart.
const APPLY_DELAY: Duration = Duration::from_millis(800);

struct Server(Mutex<Option<Child>>);

struct Shell {
    store: Store,
    data_dir: PathBuf,
    runtime: PathBuf,
    /// The last start-up or reload error, shown in the Settings window.
    startup_error: Mutex<Option<String>>,
    /// Counts saves, so only the latest one in a burst applies.
    saves: AtomicU64,
    /// Held while the server is stopped and started again.
    applying: Mutex<()>,
}

#[derive(Serialize, Clone)]
struct ServerStatus {
    ok: bool,
    message: String,
}

fn start_server(runtime: &Path, data_dir: &Path, env: &Values, port: u16) -> std::io::Result<Child> {
    let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
    let app_dir = runtime.join("app");
    Command::new(node)
        .arg("dist/main/serve.js")
        .arg("integrations")
        .current_dir(&app_dir)
        // Defaults first, so the settings can override them (for example AUTH_MODE=local for development).
        .env("AUTH_MODE", "entra")
        .envs(env)
        .env("NODE_ENV", "production")
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("DB_PATH", data_dir.join("monitor.db"))
        // The server exits when this pipe closes, which happens when the app exits for any reason.
        .env("EXIT_WITH_PARENT", "1")
        .stdin(Stdio::piped())
        .spawn()
}

/// Waits until the server accepts connections. Returns early if the server has already exited.
fn wait_for_server(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("the server stopped at start-up ({status}); check the settings"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("the server did not start listening in time".to_string())
}

/// Starts the server with the current settings and returns the address of the monitor UI.
fn launch(handle: &AppHandle) -> Result<Url, String> {
    let shell = handle.state::<Shell>();
    let env = shell.store.env()?;
    let port = env
        .get("PORT")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let base_url = env
        .get("PUBLIC_BASE_URL")
        .cloned()
        .unwrap_or_else(|| format!("http://localhost:{port}"));
    let url = Url::parse(&format!("{base_url}/")).map_err(|_| "PUBLIC_BASE_URL is not a valid address".to_string())?;

    let mut child = start_server(&shell.runtime, &shell.data_dir, &env, port)
        .map_err(|err| format!("could not start the server: {err}"))?;
    if let Err(message) = wait_for_server(&mut child, port, Duration::from_secs(30)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(message);
    }
    *handle.state::<Server>().0.lock().unwrap() = Some(child);
    Ok(url)
}

/// Stops the running server and waits for it to exit, so its port is free for the next start.
fn stop_server(handle: &AppHandle) {
    if let Some(mut child) = handle.state::<Server>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, SETTINGS_WINDOW, WebviewUrl::App("settings.html".into()))
        .title("Settings")
        .inner_size(720.0, 640.0)
        .build();
}

/// Shows the monitor UI, or reloads it at the new address if it is already open.
fn show_monitor(handle: &AppHandle, url: Url) {
    let main_handle = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        match main_handle.get_webview_window("main") {
            Some(window) => {
                let _ = window.navigate(url);
            }
            None => {
                let _ = WebviewWindowBuilder::new(&main_handle, "main", WebviewUrl::External(url))
                    .title("Integration Monitor")
                    .inner_size(1280.0, 860.0)
                    .build();
            }
        }
        if let Some(splash) = main_handle.get_webview_window("splash") {
            let _ = splash.close();
        }
    });
}

fn report(handle: &AppHandle, status: ServerStatus) {
    *handle.state::<Shell>().startup_error.lock().unwrap() = if status.ok { None } else { Some(status.message.clone()) };
    let _ = handle.emit("server-status", status);
}

/// Records the error, tells the Settings window, and opens it so the user can fix the problem.
fn report_failure(handle: &AppHandle, message: String) {
    eprintln!("{message}");
    report(handle, ServerStatus { ok: false, message });
    let main_handle = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(splash) = main_handle.get_webview_window("splash") {
            let _ = splash.close();
        }
        open_settings(&main_handle);
    });
}

fn start_first(handle: AppHandle) {
    match launch(&handle) {
        Ok(url) => {
            report(&handle, ServerStatus { ok: true, message: String::new() });
            show_monitor(&handle, url);
        }
        Err(message) => report_failure(&handle, message),
    }
}

/// Restarts the server with the current settings and reloads the monitor window.
fn apply_settings(handle: &AppHandle) {
    let shell = handle.state::<Shell>();
    let _applying = shell.applying.lock().unwrap();
    stop_server(handle);
    match launch(handle) {
        Ok(url) => {
            report(
                handle,
                ServerStatus { ok: true, message: "Applied. The server restarted with the new settings.".to_string() },
            );
            show_monitor(handle, url);
        }
        Err(message) => report_failure(handle, message),
    }
}

/// Applies after a short pause. Only the most recent save in a burst restarts the server.
fn schedule_apply(handle: &AppHandle) {
    let ticket = handle.state::<Shell>().saves.fetch_add(1, Ordering::SeqCst) + 1;
    let app = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(APPLY_DELAY);
        if app.state::<Shell>().saves.load(Ordering::SeqCst) == ticket {
            apply_settings(&app);
        }
    });
}

fn build_menu(app: &App) -> tauri::Result<()> {
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Integration Monitor")
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    // Replacing the default menu removes the standard Edit items, so text fields need them back.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let menu = MenuBuilder::new(app).item(&app_menu).item(&edit_menu).build()?;
    app.handle().set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().0 == SETTINGS_MENU_ID {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || open_settings(&handle));
        }
    });
    Ok(())
}

#[tauri::command]
fn list_settings(shell: State<'_, Shell>) -> Result<Vec<Setting>, String> {
    shell.store.list()
}

/// For a secret, pass value as null to keep the stored value. The server restarts with the change.
#[tauri::command]
fn save_setting(app: AppHandle, shell: State<'_, Shell>, name: String, value: Option<String>, secret: bool) -> Result<(), String> {
    shell.store.save(&name, value, secret)?;
    schedule_apply(&app);
    Ok(())
}

#[tauri::command]
fn remove_setting(app: AppHandle, shell: State<'_, Shell>, name: String) -> Result<(), String> {
    shell.store.remove(&name)?;
    schedule_apply(&app);
    Ok(())
}

#[tauri::command]
fn startup_error(shell: State<'_, Shell>) -> Option<String> {
    shell.startup_error.lock().unwrap().clone()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_settings, save_setting, remove_setting, startup_error])
        .setup(|app| {
            let data_dir: PathBuf = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let runtime = app.path().resource_dir()?.join("runtime");

            app.manage(Server(Mutex::new(None)));
            app.manage(Shell {
                store: Store::new(data_dir.clone()),
                data_dir,
                runtime,
                startup_error: Mutex::new(None),
                saves: AtomicU64::new(0),
                applying: Mutex::new(()),
            });
            build_menu(app)?;

            let handle = app.handle().clone();
            std::thread::spawn(move || start_first(handle));

            WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html".into()))
                .title("Integration Monitor")
                .inner_size(420.0, 200.0)
                .resizable(false)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the desktop app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(app);
            }
        });
}
