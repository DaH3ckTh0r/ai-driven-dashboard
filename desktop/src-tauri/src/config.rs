// Pure rules for the desktop settings: the settings file format, names and values, and how
// plain settings and keychain secrets combine into the environment of the server.
use std::collections::BTreeMap;

pub type Values = BTreeMap<String, String>;

/// Parses KEY=VALUE lines. Blank lines and lines starting with # are ignored.
pub fn parse(text: &str) -> Values {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

/// Writes the settings file. Only plain values are ever passed here; secrets never reach the file.
pub fn serialize(values: &Values) -> String {
    let mut out = String::from("# Integration Monitor settings. Secrets are kept in the OS keychain.\n");
    for (name, value) in values {
        out.push_str(name);
        out.push('=');
        out.push_str(value);
        out.push('\n');
    }
    out
}

/// Names look like environment variables: upper case letters, digits and underscores, starting with a letter.
pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// A value must fit on one line, because the file is line based.
pub fn valid_value(value: &str) -> Result<(), String> {
    if value.contains('\n') || value.contains('\r') {
        Err("a value cannot span several lines".to_string())
    } else {
        Ok(())
    }
}

/// The keychain index: one secret name per line. Names are not secret; values are.
pub fn parse_secret_names(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn serialize_secret_names(names: &[String]) -> String {
    names.iter().map(|name| format!("{name}\n")).collect()
}

/// The environment for the server: plain settings, with keychain secrets on top.
/// A name is never both, because saving moves it from one store to the other.
pub fn child_env(plain: Values, secrets: Values) -> Values {
    let mut env = plain;
    env.extend(secrets);
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pairs_and_skips_comments_and_blank_lines() {
        let values = parse("# comment\n\nPUBLIC_BASE_URL = http://localhost:47831 \nAPPROVERS=a@b.c,d@e.f\n");
        assert_eq!(values.get("PUBLIC_BASE_URL").unwrap(), "http://localhost:47831");
        assert_eq!(values.get("APPROVERS").unwrap(), "a@b.c,d@e.f");
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn keeps_equals_signs_inside_values() {
        assert_eq!(parse("A=x=y").get("A").unwrap(), "x=y");
    }

    #[test]
    fn serialized_settings_read_back_the_same() {
        let mut values = Values::new();
        values.insert("APIM_CHAT_URL".into(), "https://apim.example.test/chat".into());
        values.insert("LA_WORKSPACE_ID".into(), "ws-1".into());
        assert_eq!(parse(&serialize(&values)), values);
    }

    #[test]
    fn names_follow_environment_variable_style() {
        assert!(valid_name("APIM_CHAT_URL"));
        assert!(valid_name("SB_NAMESPACE2"));
        assert!(!valid_name("lower"));
        assert!(!valid_name("2FA"));
        assert!(!valid_name("BAD-NAME"));
        assert!(!valid_name(""));
    }

    #[test]
    fn values_cannot_span_lines() {
        assert!(valid_value("abc").is_ok());
        assert!(valid_value("a\nKEY=b").is_err());
        assert!(valid_value("a\rb").is_err());
    }

    #[test]
    fn secret_index_round_trips() {
        let names = vec!["APIM_SUBSCRIPTION_KEY".to_string(), "ENTRA_CLIENT_SECRET".to_string()];
        assert_eq!(parse_secret_names(&serialize_secret_names(&names)), names);
        assert!(parse_secret_names("").is_empty());
    }

    #[test]
    fn secrets_override_plain_values_in_the_child_environment() {
        let mut plain = Values::new();
        plain.insert("PORT".into(), "47831".into());
        let mut secrets = Values::new();
        secrets.insert("APIM_SUBSCRIPTION_KEY".into(), "k".into());
        let env = child_env(plain, secrets);
        assert_eq!(env.get("PORT").unwrap(), "47831");
        assert_eq!(env.get("APIM_SUBSCRIPTION_KEY").unwrap(), "k");
    }
}
