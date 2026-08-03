//! WASM 插件发现 — 扫描 `.sacode/plugins/` 目录的 manifest 与 .wasm 文件
//!
//! 设计意图：
//! - 最小破坏：仅作为 PluginRegistry::discover 的扩展点，不改动 builtin / mcp 路径
//! - 容错优先：单个插件 manifest 损坏不影响其他插件的发现
//! - 约定优于配置：每个插件位于 `<workdir>/.sacode/plugins/<name>/`，
//!   manifest 文件名为 `manifest.json`，wasm 路径在 manifest 中声明（相对插件目录）

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::loader::PluginLoader;
use super::registry::PluginDescriptor;
use super::PluginSpec;

/// 扫描 `<workdir>/.sacode/plugins/` 下的所有 WASM 插件
///
/// 目录约定：
/// ```text
/// .sacode/plugins/
/// ├── my-plugin/
/// │   ├── manifest.json   # PluginSpec 序列化
/// │   └── plugin.wasm     # wasm_path 相对插件目录
/// └── other-plugin/
///     ├── manifest.json
///     └── plugin.wasm
/// ```
///
/// 单个插件目录解析失败时跳过并记录到 stderr（不返回错误，避免阻断整体发现）。
pub fn discover_wasm_plugins(workdir: &Path) -> Result<Vec<PluginDescriptor>> {
    let plugins_root = workdir.join(".sacode").join("plugins");
    if !plugins_root.exists() {
        return Ok(Vec::new());
    }

    let mut descriptors = Vec::new();
    for entry in fs::read_dir(&plugins_root)? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match load_wasm_plugin_dir(&path) {
            Ok(spec) => {
                let descriptor = PluginLoader::wasm_from_spec(&spec, &path);
                descriptors.push(descriptor);
            }
            Err(error) => {
                // 单个插件失败不阻断其他发现，记录到 stderr
                eprintln!(
                    "wasm plugin discovery skipped {}: {error}",
                    path.display()
                );
            }
        }
    }
    Ok(descriptors)
}

/// 从插件目录加载 manifest.json + 校验 wasm_path 存在
///
/// manifest.json 应为 [`PluginSpec`] 的 JSON 序列化形式，
/// `wasm_path` 字段为相对插件目录的路径（如 "plugin.wasm"）。
pub fn load_wasm_plugin_dir(plugin_dir: &Path) -> Result<PluginSpec> {
    let manifest_path = plugin_dir.join("manifest.json");
    let content = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read manifest: {}", manifest_path.display()))?;

    let mut spec: PluginSpec = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse manifest: {}", manifest_path.display()))?;

    // wasm_path 相对插件目录，解析为绝对路径，便于 PluginHost 直接加载
    let wasm_path = PathBuf::from(&spec.wasm_path);
    let resolved = if wasm_path.is_absolute() {
        wasm_path
    } else {
        plugin_dir.join(&wasm_path)
    };
    spec.wasm_path = resolved
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("wasm_path contains invalid utf-8"))?
        .to_string();

    if !resolved.exists() {
        anyhow::bail!(
            "wasm file not found: {} (declared in {})",
            resolved.display(),
            manifest_path.display()
        );
    }

    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 构造一个最小可用的 wasm 插件目录（用 0 字节 .wasm 占位，仅测试发现逻辑）
    fn make_fake_plugin(plugins_root: &Path, name: &str) -> PathBuf {
        let plugin_dir = plugins_root.join(name);
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");
        let manifest = format!(
            r#"{{"name":"{name}","version":"0.1.0","description":"fake","wasm_path":"plugin.wasm","functions":[]}}"#
        );
        fs::write(plugin_dir.join("manifest.json"), manifest).expect("write manifest");
        fs::write(plugin_dir.join("plugin.wasm"), b"\0").expect("write wasm");
        plugin_dir
    }

    #[test]
    fn discovers_empty_when_plugins_dir_missing() {
        let tmp = tempdir().expect("tempdir");
        let entries = discover_wasm_plugins(tmp.path()).expect("discover");
        assert!(entries.is_empty());
    }

    #[test]
    fn discovers_single_wasm_plugin() {
        let tmp = tempdir().expect("tempdir");
        let plugins_root = tmp.path().join(".sacode").join("plugins");
        fs::create_dir_all(&plugins_root).expect("create plugins root");
        make_fake_plugin(&plugins_root, "demo");

        let entries = discover_wasm_plugins(tmp.path()).expect("discover");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "demo");
        assert_eq!(entries[0].kind, super::super::registry::PluginKind::Wasm);
        assert_eq!(entries[0].source_label, "wasm");
    }

    #[test]
    fn skips_invalid_manifest_without_failing_others() {
        let tmp = tempdir().expect("tempdir");
        let plugins_root = tmp.path().join(".sacode").join("plugins");
        fs::create_dir_all(&plugins_root).expect("create plugins root");

        // 损坏的 manifest
        let broken_dir = plugins_root.join("broken");
        fs::create_dir_all(&broken_dir).expect("create broken dir");
        fs::write(broken_dir.join("manifest.json"), "not json").expect("write broken manifest");

        // 正常插件
        make_fake_plugin(&plugins_root, "ok");

        let entries = discover_wasm_plugins(tmp.path()).expect("discover");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "ok");
    }

    #[test]
    fn resolves_relative_wasm_path_to_absolute() {
        let tmp = tempdir().expect("tempdir");
        let plugin_dir = tmp.path().join("plugin");
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");
        fs::write(
            plugin_dir.join("manifest.json"),
            r#"{"name":"p","version":"0.1.0","description":"","wasm_path":"plugin.wasm","functions":[]}"#,
        )
        .expect("write manifest");
        fs::write(plugin_dir.join("plugin.wasm"), b"\0").expect("write wasm");

        let spec = load_wasm_plugin_dir(&plugin_dir).expect("load");
        assert!(PathBuf::from(&spec.wasm_path).is_absolute());
        assert!(PathBuf::from(&spec.wasm_path).exists());
    }

    #[test]
    fn fails_when_wasm_file_missing() {
        let tmp = tempdir().expect("tempdir");
        let plugin_dir = tmp.path().join("plugin");
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");
        fs::write(
            plugin_dir.join("manifest.json"),
            r#"{"name":"p","version":"0.1.0","description":"","wasm_path":"missing.wasm","functions":[]}"#,
        )
        .expect("write manifest");

        let result = load_wasm_plugin_dir(&plugin_dir);
        assert!(result.is_err());
    }
}
