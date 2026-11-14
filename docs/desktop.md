# Desktop app

The desktop app is the same server, packaged with the Tauri shell. The shell runs the bundled Node runtime on a fixed local port, then opens the monitor in a window. Settings are edited in their own window.

## Processes

```mermaid
flowchart LR
    subgraph app["Desktop app"]
        SHELL["Tauri shell<br/>Rust"]
        SPLASH["Splash window<br/>local page"]
        MAIN["Monitor window<br/>remote page"]
        SETW["Settings window<br/>local page"]
    end
    NODE["Node server<br/>127.0.0.1:47831"]
    SETTINGS[("settings.env")]
    KEYCHAIN[("OS keychain")]
    DB[("monitor.db")]

    SHELL --> SPLASH
    SHELL -->|"start, stop, reload"| NODE
    MAIN -->|"http://localhost:47831"| NODE
    SETW -->|"Tauri commands"| SHELL
    SHELL --> SETTINGS
    SHELL --> KEYCHAIN
    NODE --> DB
```

- The **monitor window** is a remote page. It has no access to Tauri commands, so only the server's HTTP API is reachable from it.
- The **splash** and **Settings** windows are local pages. Only they can call the settings commands.
- The Node server exits when the app quits. It reads a pipe from the app, and the pipe closes when the app exits, for any reason.

## Start-up

```mermaid
sequenceDiagram
    autonumber
    participant SH as Shell
    participant ST as Store
    participant KC as Keychain
    participant N as Node server
    participant W as Monitor window
    SH->>SH: show splash
    SH->>ST: read settings.env and secret names
    ST->>KC: read each secret
    KC-->>ST: values
    ST-->>SH: merged environment
    SH->>N: start with environment, wait for port
    alt server listens
        N-->>SH: ready
        SH->>W: open PUBLIC_BASE_URL
        SH->>SH: close splash
    else server fails or settings are invalid
        N-->>SH: exit or timeout
        SH->>SH: report error
        SH->>SH: open Settings with the error
    end
```

## Changing a setting

Every save or removal applies the change. Edits made within about 0.8 seconds of each other apply once.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant SW as Settings window
    participant SH as Shell
    participant ST as Store
    participant N as Node server
    participant W as Monitor window
    U->>SW: save a setting
    SW->>SH: save_setting(name, value, secret)
    SH->>ST: validate and write
    alt secret
        ST->>ST: keychain holds value, name in secret index
    else plain value
        ST->>ST: settings.env holds value
    end
    SH->>SH: wait 0.8 s for further saves
    SH->>N: stop, wait for exit
    SH->>N: start with merged environment
    alt ready
        SH-->>SW: server-status ok
        SH->>W: navigate to PUBLIC_BASE_URL
    else failed
        SH-->>SW: server-status error with message
    end
```

## Where each value lives

| Kind | Examples | Stored in | Shown in Settings as |
| --- | --- | --- | --- |
| Plain setting | `APIM_CHAT_URL`, `APPROVERS`, `PUBLIC_BASE_URL`, `PORT` | `settings.env` in the app data folder | its value |
| Secret | `ENTRA_CLIENT_SECRET`, `APIM_SUBSCRIPTION_KEY` | OS keychain, one item per name; names in `secret-names.txt` | "not set" or "stored in keychain", never the value |

A name lives in exactly one store. Saving it in one store removes it from the other.

## Rules for names and values

- Names use capital letters, digits and underscores, and start with a letter, like environment variables.
- Values are single-line. The settings file is line based.
- `settings.env` may be edited by hand. Secrets are never written to it.

## Limits

- Pending sign-in requests are kept in memory, so a reload asks users who are midway through sign-in to start again.
- Monitor runs in progress stop and resume after the restart.
- The keychain needs a running service on Linux: GNOME Keyring or KWallet through Secret Service.
- The desktop build needs Rust and, on Linux, WebKitGTK 4.1. See the Tauri prerequisites.
