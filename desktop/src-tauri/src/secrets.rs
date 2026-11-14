// Secret values live in the operating system's keychain, one item per setting name.
// Nothing here logs or returns a value unless the caller asks for it.
use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "com.integrations.monitor";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|err| format!("the keychain is not available: {err}"))
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("could not read {name} from the keychain: {err}")),
    }
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    entry(name)?
        .set_password(value)
        .map_err(|err| format!("could not save {name} to the keychain: {err}"))
}

pub fn delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!("could not remove {name} from the keychain: {err}")),
    }
}
