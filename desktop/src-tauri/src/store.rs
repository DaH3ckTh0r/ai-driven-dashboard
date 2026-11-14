// Reads and writes the desktop settings. Plain settings live in settings.env; secret values live in
// the OS keychain, and their names are listed in secret-names.txt so the settings screen can show them.
use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::config::{self, Values};
use crate::secrets;

/// One setting as the settings screen shows it. A secret's value is never included.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Setting {
    pub name: String,
    pub value: Option<String>,
    pub secret: bool,
    pub stored: bool,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.env")
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join("secret-names.txt")
    }

    fn plain(&self) -> Values {
        fs::read_to_string(self.settings_path())
            .map(|text| config::parse(&text))
            .unwrap_or_default()
    }

    fn secret_names(&self) -> Vec<String> {
        fs::read_to_string(self.index_path())
            .map(|text| config::parse_secret_names(&text))
            .unwrap_or_default()
    }

    /// Writes through a temporary file, so a crash never leaves a half-written settings file.
    fn write_atomic(path: PathBuf, text: String) -> Result<(), String> {
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, text).map_err(|err| format!("could not write {}: {err}", path.display()))?;
        fs::rename(&tmp, &path).map_err(|err| format!("could not save {}: {err}", path.display()))
    }

    fn write_plain(&self, values: &Values) -> Result<(), String> {
        Self::write_atomic(self.settings_path(), config::serialize(values))
    }

    fn write_secret_names(&self, names: &[String]) -> Result<(), String> {
        Self::write_atomic(self.index_path(), config::serialize_secret_names(names))
    }

    /// The environment for the server: plain settings, with keychain secrets on top.
    pub fn env(&self) -> Result<Values, String> {
        let mut secret_values = Values::new();
        for name in self.secret_names() {
            if let Some(value) = secrets::get(&name)? {
                secret_values.insert(name, value);
            }
        }
        Ok(config::child_env(self.plain(), secret_values))
    }

    pub fn list(&self) -> Result<Vec<Setting>, String> {
        let mut settings: Vec<Setting> = self
            .plain()
            .into_iter()
            .map(|(name, value)| Setting { name, value: Some(value), secret: false, stored: true })
            .collect();
        for name in self.secret_names() {
            let stored = secrets::get(&name)?.is_some();
            settings.push(Setting { name, value: None, secret: true, stored });
        }
        settings.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(settings)
    }

    /// Adds or updates a setting. For a secret, an empty value keeps the stored one.
    /// Saving a name in one store removes it from the other, so a name is never in both.
    pub fn save(&self, name: &str, value: Option<String>, secret: bool) -> Result<(), String> {
        if !config::valid_name(name) {
            return Err(format!(
                "\"{name}\" is not a valid name: use capital letters, digits and underscores, e.g. APIM_CHAT_URL"
            ));
        }
        let mut plain = self.plain();
        let mut names = self.secret_names();
        if secret {
            match value.filter(|v| !v.is_empty()) {
                Some(value) => {
                    config::valid_value(&value)?;
                    secrets::set(name, &value)?;
                }
                None if secrets::get(name)?.is_none() => {
                    return Err(format!("enter a value for {name}"));
                }
                None => {}
            }
            if !names.iter().any(|n| n == name) {
                names.push(name.to_string());
                names.sort();
            }
            plain.remove(name);
            self.write_plain(&plain)?;
            self.write_secret_names(&names)
        } else {
            let value = value.unwrap_or_default();
            config::valid_value(&value)?;
            if names.iter().any(|n| n == name) {
                secrets::delete(name)?;
                names.retain(|n| n != name);
                self.write_secret_names(&names)?;
            }
            plain.insert(name.to_string(), value);
            self.write_plain(&plain)
        }
    }

    pub fn remove(&self, name: &str) -> Result<(), String> {
        let mut plain = self.plain();
        plain.remove(name);
        self.write_plain(&plain)?;
        let mut names = self.secret_names();
        if names.iter().any(|n| n == name) {
            secrets::delete(name)?;
            names.retain(|n| n != name);
            self.write_secret_names(&names)?;
        }
        Ok(())
    }
}
