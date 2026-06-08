use std::{cmp::Ordering, fs, path::PathBuf, process::Command};

use anyhow::Result;
use serde::{Deserialize, Serialize};

const NPM_PACKAGE: &str = "@cherishron/sacode";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionCheckConfig {
    pub check_on_startup: bool,
    pub cache_duration_hours: i64,
    pub channel: String,
}

impl Default for VersionCheckConfig {
    fn default() -> Self {
        Self {
            check_on_startup: true,
            cache_duration_hours: 24,
            channel: "stable".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCache {
    pub last_check: String,
    pub current_version: String,
    pub remote_version: String,
    pub has_update: bool,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionStatus {
    UpToDate {
        current_version: String,
    },
    UpdateAvailable {
        current_version: String,
        remote_version: String,
    },
    Unknown,
}

#[derive(Debug, Clone)]
pub struct VersionChecker {
    cache_path: PathBuf,
    current_version: String,
    config: VersionCheckConfig,
}

impl VersionChecker {
    pub fn new() -> Self {
        Self::with_config(VersionCheckConfig::default())
    }

    pub fn with_config(config: VersionCheckConfig) -> Self {
        let home = user_home_dir();
        Self {
            cache_path: home.join(".sacode").join("version-cache.json"),
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            config,
        }
    }

    pub fn check_for_update(&self) -> Result<VersionStatus> {
        if !self.config.check_on_startup {
            return Ok(VersionStatus::Unknown);
        }
        if let Some(cache) = self.read_cache()? {
            if self.is_cache_valid(&cache) {
                return Ok(if cache.has_update {
                    VersionStatus::UpdateAvailable {
                        current_version: self.current_version.clone(),
                        remote_version: cache.remote_version,
                    }
                } else {
                    VersionStatus::UpToDate {
                        current_version: self.current_version.clone(),
                    }
                });
            }
        }

        self.check_remote()
    }

    pub fn force_check(&self) -> Result<VersionStatus> {
        self.check_remote()
    }

    fn check_remote(&self) -> Result<VersionStatus> {
        if !self.npm_available() {
            return Ok(VersionStatus::Unknown);
        }

        let package_spec = self.package_spec();
        let output = match Command::new("npm")
            .args(["view", package_spec.as_str(), "version"])
            .output()
        {
            Ok(output) => output,
            Err(_) => return Ok(VersionStatus::Unknown),
        };

        if !output.status.success() {
            let cache = VersionCache {
                last_check: chrono::Local::now().to_rfc3339(),
                current_version: self.current_version.clone(),
                remote_version: String::new(),
                has_update: false,
                source: "npm".to_string(),
                error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            };
            let _ = self.write_cache(&cache);
            return Ok(VersionStatus::Unknown);
        }

        let remote_version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let ordering = compare_versions(&remote_version, &self.current_version);
        let has_update = ordering == Ordering::Greater;
        let cache = VersionCache {
            last_check: chrono::Local::now().to_rfc3339(),
            current_version: self.current_version.clone(),
            remote_version: remote_version.clone(),
            has_update,
            source: "npm".to_string(),
            error: None,
        };
        let _ = self.write_cache(&cache);

        Ok(if has_update {
            VersionStatus::UpdateAvailable {
                current_version: self.current_version.clone(),
                remote_version,
            }
        } else {
            VersionStatus::UpToDate {
                current_version: self.current_version.clone(),
            }
        })
    }

    pub fn current_version(&self) -> &str {
        &self.current_version
    }

    fn npm_available(&self) -> bool {
        Command::new("npm")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn is_cache_valid(&self, cache: &VersionCache) -> bool {
        if cache.current_version != self.current_version {
            return false;
        }
        let Ok(last_check) = chrono::DateTime::parse_from_rfc3339(&cache.last_check) else {
            return false;
        };
        let now = chrono::Local::now();
        now.signed_duration_since(last_check).num_hours() < self.config.cache_duration_hours
    }

    pub fn package_spec(&self) -> String {
        match self.config.channel.as_str() {
            "beta" => format!("{}@beta", NPM_PACKAGE),
            _ => NPM_PACKAGE.to_string(),
        }
    }

    fn read_cache(&self) -> Result<Option<VersionCache>> {
        if !self.cache_path.exists() {
            return Ok(None);
        }
        let content = match fs::read_to_string(&self.cache_path) {
            Ok(content) => content,
            Err(_) => return Ok(None),
        };
        match serde_json::from_str::<VersionCache>(&content) {
            Ok(cache) => Ok(Some(cache)),
            Err(_) => {
                let _ = fs::remove_file(&self.cache_path);
                Ok(None)
            }
        }
    }

    fn write_cache(&self, cache: &VersionCache) -> Result<()> {
        if let Some(parent) = self.cache_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.cache_path, serde_json::to_string_pretty(cache)?)?;
        Ok(())
    }
}

impl Default for VersionChecker {
    fn default() -> Self {
        Self::new()
    }
}

pub fn user_home_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

pub fn compare_versions(remote: &str, current: &str) -> Ordering {
    let remote_parts = parse_version(remote);
    let current_parts = parse_version(current);
    if remote_parts.is_empty() || current_parts.is_empty() {
        return Ordering::Equal;
    }
    for index in 0..remote_parts.len().max(current_parts.len()) {
        let remote_value = remote_parts.get(index).copied().unwrap_or(0);
        let current_value = current_parts.get(index).copied().unwrap_or(0);
        match remote_value.cmp(&current_value) {
            Ordering::Equal => continue,
            ordering => return ordering,
        }
    }
    Ordering::Equal
}

fn parse_version(value: &str) -> Vec<u32> {
    value
        .split('.')
        .map(|segment| segment.trim().trim_start_matches('v'))
        .take_while(|segment| !segment.is_empty())
        .filter_map(|segment| segment.parse::<u32>().ok())
        .collect()
}

pub fn update_prompt(current_version: &str, remote_version: &str) -> String {
    format!(
        "新版本 {} 可用，当前版本 {}。输入 /update 或执行 `sacode update` 更新。",
        remote_version, current_version
    )
}

#[cfg(test)]
mod tests {
    use super::{
        compare_versions, update_prompt, user_home_dir, VersionCache, VersionCheckConfig,
        VersionChecker,
    };
    use std::cmp::Ordering;

    #[test]
    fn compare_versions_higher() {
        assert_eq!(compare_versions("0.2.0", "0.1.9"), Ordering::Greater);
        assert_eq!(compare_versions("1.0.0", "0.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("0.1.10", "0.1.9"), Ordering::Greater);
    }

    #[test]
    fn compare_versions_equal() {
        assert_eq!(compare_versions("0.1.9", "0.1.9"), Ordering::Equal);
    }

    #[test]
    fn compare_versions_lower() {
        assert_eq!(compare_versions("0.1.8", "0.1.9"), Ordering::Less);
    }

    #[test]
    fn compare_versions_short_segments() {
        assert_eq!(compare_versions("0.2", "0.1.9"), Ordering::Greater);
    }

    #[test]
    fn compare_versions_invalid_text() {
        assert_eq!(compare_versions("latest", "0.1.9"), Ordering::Equal);
    }

    #[test]
    fn compare_versions_handles_v_prefix() {
        assert_eq!(compare_versions("v0.2.0", "0.1.9"), Ordering::Greater);
    }

    #[test]
    fn cache_validity_checks_version_match() {
        let checker = VersionChecker::new();
        let cache = VersionCache {
            last_check: chrono::Local::now().to_rfc3339(),
            current_version: checker.current_version().to_string(),
            remote_version: "9.9.9".to_string(),
            has_update: true,
            source: "npm".to_string(),
            error: None,
        };
        assert!(checker.is_cache_valid(&cache));
    }

    #[test]
    fn cache_invalid_when_current_version_changes() {
        let checker = VersionChecker::new();
        let cache = VersionCache {
            last_check: chrono::Local::now().to_rfc3339(),
            current_version: "0.0.0".to_string(),
            remote_version: "9.9.9".to_string(),
            has_update: true,
            source: "npm".to_string(),
            error: None,
        };
        assert!(!checker.is_cache_valid(&cache));
    }

    #[test]
    fn cache_invalid_when_duration_elapsed() {
        let checker = VersionChecker::with_config(VersionCheckConfig {
            cache_duration_hours: 1,
            ..VersionCheckConfig::default()
        });
        let cache = VersionCache {
            last_check: (chrono::Local::now() - chrono::Duration::hours(2)).to_rfc3339(),
            current_version: checker.current_version().to_string(),
            remote_version: "9.9.9".to_string(),
            has_update: true,
            source: "npm".to_string(),
            error: None,
        };
        assert!(!checker.is_cache_valid(&cache));
    }

    #[test]
    fn beta_channel_uses_tagged_package_spec() {
        let checker = VersionChecker::with_config(VersionCheckConfig {
            channel: "beta".to_string(),
            ..VersionCheckConfig::default()
        });
        assert_eq!(checker.package_spec(), "@cherishron/sacode@beta");
    }

    #[test]
    fn update_prompt_contains_command() {
        let text = update_prompt("0.1.9", "0.2.0");
        assert!(text.contains("/update"));
        assert!(text.contains("sacode update"));
    }

    #[test]
    fn user_home_dir_returns_non_empty_path() {
        assert!(!user_home_dir().as_os_str().is_empty());
    }
}
