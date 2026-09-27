//! Read-only viewer for user-level hooks declared in `~/.sacode/settings.json`.
//!
//! This module never executes hooks. It only reflects what is currently on
//! disk so the Desktop settings center can show the configured commands and
//! warn that loading/execution is a CLI concern.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const USER_SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HookConfig {
    pub name: String,
    pub event: String,
    pub command: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HookSettings {
    #[serde(default)]
    pub hooks: Vec<HookConfig>,
}

/// Path of the user settings file, without requiring the directory to exist.
pub fn user_settings_path(user_root: Option<&Path>) -> PathBuf {
    user_root
        .map(Path::to_path_buf)
        .unwrap_or_else(default_user_root)
        .join(USER_SETTINGS_FILE)
}

fn default_user_root() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sacode")
}

/// Read `hooks` from a user settings file.
///
/// Fail-safe semantics: a missing file, unreadable file or malformed JSON
/// yields an empty list instead of an error, so a half-configured machine can
/// still open the settings view. Entries missing required string fields are
/// skipped rather than failing the whole list.
pub fn load_user_hooks(user_root: Option<&Path>) -> Vec<HookConfig> {
    let path = user_settings_path(user_root);
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(list) = value.get("hooks").and_then(|hooks| hooks.as_array()) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|entry| serde_json::from_value::<HookConfig>(entry.clone()).ok())
        .filter(|hook| !hook.name.trim().is_empty() && !hook.command.trim().is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &std::path::Path, body: &str) {
        let root = dir.join(".sacode");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("settings.json"), body).unwrap();
    }

    #[test]
    fn missing_file_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_user_hooks(Some(&dir.path().join(".sacode"))).is_empty());
    }

    #[test]
    fn malformed_json_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "{ not json");
        assert!(load_user_hooks(Some(&dir.path().join(".sacode"))).is_empty());
    }

    #[test]
    fn reads_hooks_and_skips_incomplete_entries() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            r#"{
              "hooks": [
                {"name":"before-run","event":"pre_task","command":"echo hi","enabled":true},
                {"name":"missing-command","event":"pre_task"},
                {"command":"echo anonymous","event":"pre_task"},
                {"name":"after-run","event":"post_task","command":"echo bye","enabled":false}
              ],
              "unrelated": 1
            }"#,
        );
        let hooks = load_user_hooks(Some(&dir.path().join(".sacode")));
        assert_eq!(hooks.len(), 2);
        assert_eq!(hooks[0].name, "before-run");
        assert_eq!(hooks[0].event, "pre_task");
        assert!(hooks[0].enabled);
        assert_eq!(hooks[1].name, "after-run");
        assert!(!hooks[1].enabled);
    }

    #[test]
    fn empty_hooks_array_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), r#"{"hooks": []}"#);
        assert!(load_user_hooks(Some(&dir.path().join(".sacode"))).is_empty());
    }

    #[test]
    fn disabled_flag_defaults_to_enabled() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            r#"{"hooks":[{"name":"h","event":"e","command":"c"}]}"#,
        );
        let hooks = load_user_hooks(Some(&dir.path().join(".sacode")));
        assert_eq!(hooks.len(), 1);
        assert!(hooks[0].enabled);
    }
}
