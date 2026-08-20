//! 命名运行 Profile（§3.4 Profile/Bundle 配置组合 — 第一步）
//!
//! 借鉴 deepseek-harness 的 Profile 概念（见
//! `docs/reference/comparison-with-deepseek-harness.md` §3.4）：用命名运行组合
//! 管理部署差异，而非手动改多个配置文件。
//!
//! 设计取舍（与 SaCode 现状对齐）：
//! - SaCode 已有 `profile.json`，但那是**任务画像**（TaskProfile，用于 `for_prompt`
//!   工具筛选），语义与 DSH 的"命名运行组合"完全不同。本模块用 **`profiles/`**
//!   子目录承载命名 Profile，避免与现有 `profile.json` 冲突。
//! - 本模块**只读增强**：不破坏现有 `config.json`/`sandbox.json`/`mcp.json` 加载链，
//!   仅作为"可选覆盖层"叠加在基线配置之上（见 `Profile::apply_overrides`）。
//! - 支持 `extends` 继承（单一父链，循环检测），命名组合可层级复用。
//!
//! 文件格式：`.sacode/profiles/<name>.toml`（或 `.json` 兜底）。
//! 本期落地：Profile 解析 + `extends` 继承 + 生效配置 `--dump-config` 雏形。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

/// 命名 Profile 的磁盘表示（TOML/JSON 兼容）
///
/// 仅声明"相对基线要覆盖的部分"，未声明的字段回退到基线或父 Profile。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileManifest {
    /// Profile 名称（与文件名一致）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// 继承的父 Profile 名（单一父链）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub extends: String,

    /// 模型 provider 覆盖（如 `"deepseek-chat"`）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    /// 执行模式覆盖：`plan` / `build` / `yolo`
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub execution_mode: String,

    /// 启用的工具名 glob 列表（如 `["fs.*", "shell.exec", "web.*"]`）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_tools: Vec<String>,
    /// 禁用的工具名（从基线/父链中剔除）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_tools: Vec<String>,

    /// 启用的 MCP 服务器名
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<String>,

    /// 任意扩展字段（Bundle/Patch 阶段可扩展，如角色、拦截器组合）
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl ProfileManifest {
    /// 从文件加载（JSON 格式，与 `.sacode/` 既有配置风格一致）
    pub fn load_from(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("read profile file: {}", path.display()))?;
        let manifest = serde_json::from_str(&content)?;
        Ok(manifest)
    }

    /// 序列化为 JSON（用于 `--dump-config` 输出）
    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(self)?)
    }
}

/// 解析后的命名 Profile（已应用 `extends` 继承合并）
#[derive(Debug, Clone)]
pub struct Profile {
    pub name: String,
    /// 继承链（从直接父到最远祖先，不含自身）
    pub inheritance_chain: Vec<String>,
    /// 合并后的最终覆盖项
    pub manifest: ProfileManifest,
}

impl Profile {
    /// 在 `profiles_dir` 下按名称解析 Profile（含 `extends` 继承与循环检测）
    pub fn resolve(profiles_dir: &Path, name: &str) -> Result<Self> {
        let mut chain: Vec<String> = Vec::new();
        let mut current = name.to_string();
        let mut merged = ProfileManifest {
            name: name.to_string(),
            ..Default::default()
        };

        // 沿 extends 向上遍历，父链覆盖顺序：祖先 → ... → 父 → 自身（自身最后，优先级最高）
        let mut visited = std::collections::HashSet::new();
        let mut layers: Vec<ProfileManifest> = Vec::new();

        loop {
            if !visited.insert(current.clone()) {
                return Err(anyhow!(
                    "profile inheritance cycle detected at '{}'",
                    current
                ));
            }
            let path = profile_path(profiles_dir, &current);
            if !path.exists() {
                if current == name {
                    return Err(anyhow!(
                        "profile '{}' not found in {}",
                        name,
                        profiles_dir.display()
                    ));
                }
                // 父 Profile 不存在：停止继承（允许 extends 到不存在的基线，退化为默认）
                break;
            }
            let manifest = ProfileManifest::load_from(&path)?;
            layers.push(manifest.clone());
            chain.push(current.clone());

            if manifest.extends.is_empty() {
                break;
            }
            current = manifest.extends.clone();
        }

        // 逆序合并：祖先优先，自身最后覆盖
        layers.reverse();
        for layer in layers {
            merge_manifest(&mut merged, layer);
        }

        Ok(Profile {
            name: name.to_string(),
            inheritance_chain: chain,
            manifest: merged,
        })
    }

    /// 把 Profile 的覆盖项应用到基线工具名集合上，返回最终启用的工具名
    pub fn resolve_tools(&self, baseline: &[String]) -> Vec<String> {
        let mut tools: Vec<String> = baseline.to_vec();

        // 先应用 enabled_tools（glob 匹配）
        if !self.manifest.enabled_tools.is_empty() {
            tools.retain(|t| {
                self.manifest
                    .enabled_tools
                    .iter()
                    .any(|pat| glob_match(pat, t))
            });
        }

        // 再剔除 disabled_tools
        if !self.manifest.disabled_tools.is_empty() {
            tools.retain(|t| {
                !self
                    .manifest
                    .disabled_tools
                    .iter()
                    .any(|pat| glob_match(pat, t))
            });
        }

        tools
    }
}

/// 合并单个 layer 到 merged（layer 覆盖 merged 的非空字段）
fn merge_manifest(merged: &mut ProfileManifest, layer: ProfileManifest) {
    if !layer.model.is_empty() {
        merged.model = layer.model;
    }
    if !layer.execution_mode.is_empty() {
        merged.execution_mode = layer.execution_mode;
    }
    if !layer.enabled_tools.is_empty() {
        merged.enabled_tools = layer.enabled_tools;
    }
    if !layer.disabled_tools.is_empty() {
        merged.disabled_tools = layer.disabled_tools;
    }
    if !layer.mcp_servers.is_empty() {
        merged.mcp_servers = layer.mcp_servers;
    }
    for (k, v) in layer.extra {
        merged.extra.insert(k, v);
    }
    // extends 不跨层合并（仅用于遍历，最终 merged.extends 取自身）
}

/// 计算 Profile 目录下的文件路径（JSON 格式）
fn profile_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.json"))
}

/// 简易 glob 匹配：仅支持 `*` 通配（如 `fs.*` 匹配 `fs.read`/`fs.write`）
///
/// 供 `ToolRegistry::for_prompt_with_profile` 复用，故为 `pub`。
pub fn glob_match(pattern: &str, value: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == value;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() != 2 {
        // 多段通配退化为包含匹配
        return value.contains(&pattern.replace('*', ""));
    }
    let (prefix, suffix) = (parts[0], parts[1]);
    value.starts_with(prefix) && value.ends_with(suffix)
}

/// 返回 SaCodeConfig 下的 profiles 目录
pub fn profiles_dir_of(project_dir: &Path) -> PathBuf {
    project_dir.join("profiles")
}

// ─────────────────────────────────────────────────────────────
// 第三步：Patch 叠加机制（§3.4 深化）
// ─────────────────────────────────────────────────────────────
//
// Patch 是"在基线配置之上做局部覆盖"的轻量单元，用于团队共享基线 + 个人
// 覆盖的组合。多个 Patch 按 `priority` 升序叠加（数值越小越先应用，
// 后应用者覆盖先应用者），最终再叠加到命名 Profile 之上。
//
// 文件格式：`.sacode/patches/<name>.patch.json`
// ```json
// {
//   "name": "team-base",
//   "priority": 10,
//   "enabled_tools": ["fs.*", "web.*"],
//   "disabled_tools": ["git.push"],
//   "model": "deepseek-chat",
//   "extra": {}
// }
// ```

/// Patch 磁盘表示（与 ProfileManifest 字段对齐，叠加语义）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatchManifest {
    /// Patch 名称（与文件名一致）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// 叠加优先级：数值越小越先应用（被更高 priority 覆盖）
    #[serde(default)]
    pub priority: i32,
    /// 模型覆盖
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    /// 执行模式覆盖
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub execution_mode: String,
    /// 启用的工具名 glob 列表（叠加层启用）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_tools: Vec<String>,
    /// 禁用的工具名（叠加层剔除）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_tools: Vec<String>,
    /// 启用的 MCP 服务器名
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<String>,
    /// 任意扩展字段
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl PatchManifest {
    /// 从文件加载（JSON 格式）
    pub fn load_from(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("read patch file: {}", path.display()))?;
        let manifest = serde_json::from_str(&content)?;
        Ok(manifest)
    }
}

/// 已按 priority 排序的 Patch 集合，可叠加到基线/Profile
#[derive(Debug, Clone, Default)]
pub struct PatchSet {
    /// 按 priority 升序（数值小 → 大），同 priority 按名称稳定排序
    pub ordered: Vec<PatchManifest>,
}

impl PatchSet {
    /// 扫描 `patches_dir`，加载全部 `.patch.json` 并按 priority 排序
    pub fn load_all(patches_dir: &Path) -> Result<Self> {
        let mut patches: Vec<PatchManifest> = Vec::new();
        if patches_dir.is_dir() {
            let entries = std::fs::read_dir(patches_dir)
                .with_context(|| format!("read patches dir: {}", patches_dir.display()))?;
            for entry in entries {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                // 仅匹配 `.patch.json` 后缀，避免误读其他 json
                if !path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.ends_with(".patch.json"))
                    .unwrap_or(false)
                {
                    continue;
                }
                match PatchManifest::load_from(&path) {
                    Ok(mut patch) => {
                        if patch.name.is_empty() {
                            patch.name = path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("")
                                .trim_end_matches(".patch")
                                .to_string();
                        }
                        patches.push(patch);
                    }
                    Err(e) => eprintln!("skip invalid patch {}: {e}", path.display()),
                }
            }
        }
        patches.sort_by(|a, b| a.priority.cmp(&b.priority).then(a.name.cmp(&b.name)));
        Ok(PatchSet { ordered: patches })
    }

    /// 把 Patch 集合叠加到给定的 ProfileManifest（Patch 覆盖 Profile 非空字段）
    pub fn apply_onto(&self, base: &mut ProfileManifest) {
        for patch in &self.ordered {
            if !patch.model.is_empty() {
                base.model = patch.model.clone();
            }
            if !patch.execution_mode.is_empty() {
                base.execution_mode = patch.execution_mode.clone();
            }
            if !patch.enabled_tools.is_empty() {
                base.enabled_tools = patch.enabled_tools.clone();
            }
            if !patch.disabled_tools.is_empty() {
                base.disabled_tools = patch.disabled_tools.clone();
            }
            if !patch.mcp_servers.is_empty() {
                base.mcp_servers = patch.mcp_servers.clone();
            }
            for (k, v) in patch.extra.clone() {
                base.extra.insert(k, v);
            }
        }
    }

    /// 返回所有 Patch 名称（按应用顺序），用于 `--dump-config` 来源标注
    pub fn names(&self) -> Vec<String> {
        self.ordered.iter().map(|p| p.name.clone()).collect()
    }
}

/// 返回 SaCodeConfig 下的 patches 目录
pub fn patches_dir_of(project_dir: &Path) -> PathBuf {
    project_dir.join("patches")
}

// ─────────────────────────────────────────────────────────────
// 第二步：Bundle 可分发单元（§3.4 深化，pilot 闭环）
// ─────────────────────────────────────────────────────────────
//
// Bundle 把"工具集 + 角色 + 模型路由 + MCP 服务器 + 拦截器组合"打包为一个
// 可分发单元。本 pilot 实现 Bundle 的数据结构与导出/导入闭环（不强制重排
// 现有模型路由加载链，以 JSON 文件形式落盘即可分发）。
//
// 文件格式：`.sacode/bundles/<name>.bundle.json`
// ```json
// {
//   "name": "team-web",
//   "description": "Web 开发团队工具组合",
//   "extends_profile": "web",
//   "enabled_tools": ["fs.*", "web.*"],
//   "disabled_tools": [],
//   "roles": ["frontend-engineer", "test-engineer"],
//   "mcp_servers": ["web-search"],
//   "extra": {}
// }
// ```

/// Bundle 磁盘表示：可分发的能力组合单元
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BundleManifest {
    /// Bundle 名称（与文件名一致）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// 描述
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    /// 复用的命名 Profile（若存在，Bundle 在其上叠加）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub extends_profile: String,
    /// 启用的工具名 glob
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_tools: Vec<String>,
    /// 禁用的工具名
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_tools: Vec<String>,
    /// 启用的角色名
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<String>,
    /// 启用的 MCP 服务器名
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<String>,
    /// 任意扩展字段（如拦截器组合、模型路由覆盖）
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl BundleManifest {
    /// 从文件加载（JSON 格式）
    pub fn load_from(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("read bundle file: {}", path.display()))?;
        let manifest = serde_json::from_str(&content)?;
        Ok(manifest)
    }

    /// 序列化为 JSON（用于导出落盘）
    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(self)?)
    }

    /// 把 Bundle 的覆盖项合并进基线 ProfileManifest（Bundle 覆盖非空字段）
    pub fn merge_into(&self, base: &mut ProfileManifest) {
        if !self.enabled_tools.is_empty() {
            base.enabled_tools = self.enabled_tools.clone();
        }
        if !self.disabled_tools.is_empty() {
            base.disabled_tools = self.disabled_tools.clone();
        }
        if !self.mcp_servers.is_empty() {
            base.mcp_servers = self.mcp_servers.clone();
        }
        for (k, v) in self.extra.clone() {
            base.extra.insert(k, v);
        }
    }
}

/// 返回 SaCodeConfig 下的 bundles 目录
pub fn bundles_dir_of(project_dir: &Path) -> PathBuf {
    project_dir.join("bundles")
}

/// Bundle 导出：把当前生效组合（来自命名 Profile + Patch 链）落盘为一个
/// `.bundle.json` 文件，便于分发到其他项目。
pub fn export_bundle(
    project_dir: &Path,
    name: &str,
    profile: Option<&Profile>,
    patches: &PatchSet,
) -> Result<PathBuf> {
    let mut manifest = ProfileManifest {
        name: name.to_string(),
        ..Default::default()
    };
    if let Some(profile) = profile {
        manifest.model = profile.manifest.model.clone();
        manifest.execution_mode = profile.manifest.execution_mode.clone();
        manifest.enabled_tools = profile.manifest.enabled_tools.clone();
        manifest.disabled_tools = profile.manifest.disabled_tools.clone();
        manifest.mcp_servers = profile.manifest.mcp_servers.clone();
        manifest.extra = profile.manifest.extra.clone();
    }
    patches.apply_onto(&mut manifest);

    let bundle = BundleManifest {
        name: name.to_string(),
        description: format!("exported bundle from profile+patches at {}", chrono_now()),
        extends_profile: profile.map(|p| p.name.clone()).unwrap_or_default(),
        enabled_tools: manifest.enabled_tools,
        disabled_tools: manifest.disabled_tools,
        roles: manifest
            .extra
            .get("roles")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        mcp_servers: manifest.mcp_servers,
        extra: manifest.extra,
    };

    let bundles_dir = bundles_dir_of(project_dir);
    std::fs::create_dir_all(&bundles_dir)?;
    let path = bundles_dir.join(format!("{name}.bundle.json"));
    std::fs::write(&path, bundle.to_json()?)?;
    Ok(path)
}

/// Bundle 导入：读取 `.bundle.json` 并返回其 Manifest（落盘到其他项目由调用方决定）
pub fn import_bundle(project_dir: &Path, bundle_path: &Path) -> Result<BundleManifest> {
    let bundle = BundleManifest::load_from(bundle_path)?;
    // 导入 = 复制到本地 bundles 目录，便于 `sacode --profile` 后续引用
    let bundles_dir = bundles_dir_of(project_dir);
    std::fs::create_dir_all(&bundles_dir)?;
    let dest = bundles_dir.join(format!("{}.bundle.json", bundle.name));
    std::fs::copy(bundle_path, &dest)?;
    Ok(bundle)
}

/// 轻量 chrono 当前时间戳（避免引入额外格式依赖，统一 ISO8601）
fn chrono_now() -> String {
    // 复用 kernel 的 chrono（runtime 已依赖 sacode_kernel → chrono）
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_profile(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(format!("{name}.json")), content).expect("write profile");
    }

    #[test]
    fn resolve_simple_profile() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_profile(
            dir.path(),
            "web",
            r#"{"name":"web","model":"deepseek-chat","enabled_tools":["fs.*","web.*","shell.exec"]}"#,
        );

        let profile = Profile::resolve(dir.path(), "web").expect("resolve");
        assert_eq!(profile.name, "web");
        assert_eq!(profile.manifest.model, "deepseek-chat");
        assert!(profile
            .manifest
            .enabled_tools
            .contains(&"shell.exec".to_string()));

        let tools = profile.resolve_tools(&[
            "fs.read".to_string(),
            "fs.write".to_string(),
            "git.commit".to_string(),
            "web.search".to_string(),
            "shell.exec".to_string(),
        ]);
        assert!(tools.contains(&"fs.read".to_string()));
        assert!(tools.contains(&"web.search".to_string()));
        assert!(tools.contains(&"shell.exec".to_string()));
        assert!(
            !tools.contains(&"git.commit".to_string()),
            "git should be filtered out by enabled_tools glob"
        );
    }

    #[test]
    fn resolve_profile_inheritance() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_profile(
            dir.path(),
            "base",
            r#"{"name":"base","model":"gpt-4","enabled_tools":["fs.*"],"mcp_servers":["core"]}"#,
        );
        write_profile(
            dir.path(),
            "web",
            r#"{"name":"web","extends":"base","model":"deepseek-chat","enabled_tools":["web.*"]}"#,
        );

        let profile = Profile::resolve(dir.path(), "web").expect("resolve");
        assert_eq!(
            profile.inheritance_chain,
            vec!["web".to_string(), "base".to_string()]
        );
        // 自身覆盖 model
        assert_eq!(profile.manifest.model, "deepseek-chat");
        // 继承 base 的 mcp_servers（自身未声明）
        assert!(profile.manifest.mcp_servers.contains(&"core".to_string()));
        // enabled_tools 自身覆盖为 ["web.*"]（覆盖语义，非追加）
        assert_eq!(profile.manifest.enabled_tools, vec!["web.*".to_string()]);
    }

    #[test]
    fn detect_inheritance_cycle() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_profile(dir.path(), "a", "extends = \"b\"\n");
        write_profile(dir.path(), "b", "extends = \"a\"\n");

        let result = Profile::resolve(dir.path(), "a");
        assert!(result.is_err(), "cycle must be detected");
    }

    // ── 第三步 Patch 叠加测试 ──

    #[test]
    fn patch_set_sorts_by_priority_and_applies() {
        let dir = tempfile::tempdir().expect("tempdir");
        // 写入两个 patch：team-base(priority 10) 与 personal(priority 20)
        std::fs::write(
            dir.path().join("personal.patch.json"),
            r#"{"name":"personal","priority":20,"model":"gpt-4o","disabled_tools":["git.push"]}"#,
        )
        .expect("write patch");
        std::fs::write(
            dir.path().join("team-base.patch.json"),
            r#"{"name":"team-base","priority":10,"enabled_tools":["fs.*","web.*"],"model":"deepseek-chat"}"#,
        )
        .expect("write patch");

        let patch_set = PatchSet::load_all(dir.path()).expect("load patches");
        assert_eq!(
            patch_set.names(),
            vec!["team-base".to_string(), "personal".to_string()]
        );

        // 先 team-base 后 personal：personal 的 model 覆盖 team-base
        let mut base = ProfileManifest::default();
        patch_set.apply_onto(&mut base);
        assert_eq!(
            base.model, "gpt-4o",
            "higher priority patch overrides model"
        );
        assert_eq!(
            base.enabled_tools,
            vec!["fs.*".to_string(), "web.*".to_string()]
        );
        assert_eq!(base.disabled_tools, vec!["git.push".to_string()]);
    }

    #[test]
    fn bundle_export_import_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let project_dir = dir.path().join(".sacode");
        std::fs::create_dir_all(&project_dir).expect("create project dir");

        let profiles_dir = project_dir.join("profiles");
        std::fs::create_dir_all(&profiles_dir).expect("create profiles dir");
        write_profile(
            &profiles_dir,
            "web",
            r#"{"name":"web","model":"deepseek-chat","enabled_tools":["fs.*","web.*"]}"#,
        );
        let profile = Profile::resolve(&profiles_dir_of(&project_dir), "web").expect("resolve");

        let exported = export_bundle(
            &project_dir,
            "team-web",
            Some(&profile),
            &PatchSet::default(),
        )
        .expect("export bundle");
        assert!(exported.exists());
        let bundle = BundleManifest::load_from(&exported).expect("load bundle");
        assert_eq!(bundle.name, "team-web");
        assert_eq!(bundle.extends_profile, "web");
        assert_eq!(
            bundle.enabled_tools,
            vec!["fs.*".to_string(), "web.*".to_string()]
        );

        // 导入到另一个项目目录，应复制到其 bundles 目录
        let other_dir = tempfile::tempdir().expect("tempdir");
        let other_project = other_dir.path().join(".sacode");
        let imported = import_bundle(&other_project, &exported).expect("import bundle");
        assert_eq!(imported.name, "team-web");
        assert!(other_project
            .join("bundles")
            .join("team-web.bundle.json")
            .exists());
    }
}
