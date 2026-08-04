//! WASM 插件工具桥 — 把 WASM 插件函数包装成 [`ToolSpec`] + [`ToolExecutor`]
//!
//! 设计意图：
//! - 每个 WASM 插件函数对外表现为一个独立工具，工具名为 `wasm.<plugin>.<function>`
//! - 工具 input_schema 取自 manifest 中 PluginFunction 的声明
//! - 执行时通过共享的 [`PluginHost`] 调用对应插件函数
//! - WASM 工具统一归为 Extended 层（动态注册，不计入 26 个 builtin）

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::plugin::{discover_wasm_plugins, load_wasm_plugin_dir, PluginCall, PluginHost, PluginSpec};
use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::tools::{ToolExecutor, ToolRegistry};

/// WASM 工具名前缀，所有 WASM 工具均以 `wasm.<plugin>.<function>` 形式注册
pub const WASM_TOOL_PREFIX: &str = "wasm.";

/// 工具名分隔符（用于拆分 plugin / function 名）
const TOOL_NAME_SEPARATOR: &str = ".";

/// 构造 WASM 工具名：`wasm.<plugin>.<function>`
pub fn build_tool_name(plugin_name: &str, function_name: &str) -> String {
    format!("{WASM_TOOL_PREFIX}{plugin_name}{TOOL_NAME_SEPARATOR}{function_name}")
}

/// 拆分 `wasm.<plugin>.<function>` 为 (plugin, function)
pub fn split_tool_name(tool_name: &str) -> Option<(&str, &str)> {
    let rest = tool_name.strip_prefix(WASM_TOOL_PREFIX)?;
    let sep = rest.find(TOOL_NAME_SEPARATOR)?;
    Some((&rest[..sep], &rest[sep + TOOL_NAME_SEPARATOR.len()..]))
}

/// 将单个 [`PluginSpec`] 的所有函数注册为 [`ToolSpec`]
///
/// 返回 `(spec, executor)` 对的列表，由调用方注入 [`ToolRegistry`]。
/// `host` 共享同一份，避免对同一插件重复加载。
///
/// 副作用级别：取自 manifest 中 `PluginFunction.side_effect_level`，
/// 未声明时回退到 `ReadOnly`（保持向后兼容）。
pub fn build_tool_specs_from_plugin(
    spec: &PluginSpec,
    host: Arc<Mutex<PluginHost>>,
) -> Vec<(ToolSpec, Arc<dyn ToolExecutor>)> {
    let plugin_name = spec.name.clone();
    spec.functions
        .iter()
        .map(|function| {
            let tool_name = build_tool_name(&plugin_name, &function.name);
            let side_effect_level = function.effective_side_effect_level();
            let tool_spec = ToolSpec {
                name: tool_name,
                description: function.description.clone(),
                input_schema: function.input_schema.clone(),
                output_schema: function.output_schema.clone(),
                // 灵枢 · 沙箱审计：副作用级别由 manifest 声明，未声明回退 ReadOnly
                side_effect_level,
                // Modify/Execute 级 WASM 工具需用户审批；ReadOnly 也保留审批以遵守沙箱审计
                approval_required: true,
                timeout_ms: Some(15_000),
                tags: vec!["wasm".to_string(), plugin_name.clone()],
            };
            let executor: Arc<dyn ToolExecutor> = Arc::new(WasmToolExecutor {
                host: host.clone(),
                plugin_name: plugin_name.clone(),
                function_name: function.name.clone(),
            });
            (tool_spec, executor)
        })
        .collect()
}

/// 扫描 `<workdir>/.sacode/plugins/` 下的所有 WASM 插件，加载到 [`PluginHost`]
/// 并返回所有 (ToolSpec, executor) 对
///
/// 错误处理：单个插件加载失败不阻断整体，错误记录到 stderr。
pub fn collect_wasm_tools(
    workdir: &Path,
) -> anyhow::Result<(Vec<(ToolSpec, Arc<dyn ToolExecutor>)>, Arc<Mutex<PluginHost>>)> {
    let mut host = PluginHost::new();
    let mut specs: Vec<PluginSpec> = Vec::new();

    // 复用 discovery 的目录扫描逻辑，保证 manifest 解析路径一致
    let plugins_root = workdir.join(".sacode").join("plugins");
    if plugins_root.exists() {
        for entry in std::fs::read_dir(&plugins_root)? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match load_wasm_plugin_dir(&path) {
                Ok(spec) => {
                    if let Err(error) = host.load(spec.clone()) {
                        eprintln!(
                            "wasm tool load skipped {} ({}): {error}",
                            spec.name,
                            spec.wasm_path
                        );
                    } else {
                        specs.push(spec);
                    }
                }
                Err(error) => {
                    eprintln!(
                        "wasm tool discovery skipped {}: {error}",
                        path.display()
                    );
                }
            }
        }
    }

    let host = Arc::new(Mutex::new(host));
    let mut tools = Vec::new();
    for spec in &specs {
        tools.extend(build_tool_specs_from_plugin(spec, host.clone()));
    }
    Ok((tools, host))
}

/// WASM 工具执行器：持有共享 PluginHost，调用对应插件函数
struct WasmToolExecutor {
    host: Arc<Mutex<PluginHost>>,
    plugin_name: String,
    function_name: String,
}

impl ToolExecutor for WasmToolExecutor {
    fn execute(&self, input: serde_json::Value) -> anyhow::Result<ToolOutput> {
        let mut host = self
            .host
            .lock()
            .map_err(|e| anyhow::anyhow!("plugin host lock poisoned: {e}"))?;

        let call = PluginCall {
            function: self.function_name.clone(),
            input,
        };
        let result = host.call(&self.plugin_name, call)?;

        if result.success {
            Ok(ToolOutput::success(result.output).with_message(format!(
                "wasm plugin {} called: {}",
                self.plugin_name, self.function_name
            )))
        } else {
            Ok(ToolOutput::failure(
                result
                    .error
                    .unwrap_or_else(|| "wasm plugin call failed".to_string()),
            ))
        }
    }
}

/// 在 ToolRegistry 上注册 workdir 下发现的所有 WASM 工具
///
/// 设计意图：
/// - 提供统一的注册入口，调用方仅需传入 workdir
/// - 注册的 WASM 工具默认归为 Extended 层（不计入 26 个 builtin）
/// - 返回共享的 [`PluginHost`] Arc，便于调用方在需要时直接访问（如 unload）
pub fn register_wasm_tools(
    registry: &mut ToolRegistry,
    workdir: &Path,
) -> anyhow::Result<Arc<Mutex<PluginHost>>> {
    let (tools, host) = collect_wasm_tools(workdir)?;
    for (spec, executor) in tools {
        registry.register(spec, executor);
    }
    Ok(host)
}

/// 仅发现 WASM 插件描述符（不加载），用于 PluginRegistry::discover 复用
///
/// 这是 discovery 模块的薄包装，便于在不需要 PluginHost 的场景下获取 spec 列表
pub fn list_wasm_plugin_specs(workdir: &Path) -> Vec<PluginSpec> {
    let mut specs = Vec::new();
    let plugins_root = workdir.join(".sacode").join("plugins");
    if !plugins_root.exists() {
        return specs;
    }
    let Ok(entries) = std::fs::read_dir(&plugins_root) else {
        return specs;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(spec) = load_wasm_plugin_dir(&path) {
            specs.push(spec);
        }
    }
    specs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::PluginFunction;
    use tempfile::tempdir;

    #[test]
    fn build_tool_name_format() {
        assert_eq!(build_tool_name("demo", "greet"), "wasm.demo.greet");
    }

    #[test]
    fn split_tool_name_roundtrip() {
        let name = build_tool_name("demo", "greet");
        let (plugin, function) = split_tool_name(&name).expect("split");
        assert_eq!(plugin, "demo");
        assert_eq!(function, "greet");
    }

    #[test]
    fn split_tool_name_rejects_non_wasm_prefix() {
        assert!(split_tool_name("fs.read").is_none());
    }

    #[test]
    fn split_tool_name_rejects_missing_function() {
        assert!(split_tool_name("wasm.demo").is_none());
    }

    #[test]
    fn build_tool_specs_creates_one_per_function() {
        let spec = PluginSpec {
            name: "demo".to_string(),
            version: "1.0.0".to_string(),
            description: "demo".to_string(),
            wasm_path: "plugin.wasm".to_string(),
            functions: vec![
                PluginFunction {
                    name: "greet".to_string(),
                    description: "say hi".to_string(),
                    input_schema: serde_json::json!({"type": "object"}),
                    output_schema: serde_json::json!({"type": "string"}),
                    side_effect_level: None,
                },
                PluginFunction {
                    name: "farewell".to_string(),
                    description: "say bye".to_string(),
                    input_schema: serde_json::json!({"type": "object"}),
                    output_schema: serde_json::json!({"type": "string"}),
                    side_effect_level: None,
                },
            ],
        };
        let host = Arc::new(Mutex::new(PluginHost::new()));
        let tools = build_tool_specs_from_plugin(&spec, host);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].0.name, "wasm.demo.greet");
        assert_eq!(tools[1].0.name, "wasm.demo.farewell");
        // 未声明 side_effect_level 时回退 ReadOnly
        assert_eq!(tools[0].0.side_effect_level, SideEffectLevel::ReadOnly);
        assert_eq!(tools[1].0.side_effect_level, SideEffectLevel::ReadOnly);
    }

    /// manifest 声明 Modify 级别时应反映到 ToolSpec
    #[test]
    fn build_tool_specs_respects_declared_modify_level() {
        let spec = PluginSpec {
            name: "demo".to_string(),
            version: "1.0.0".to_string(),
            description: "demo".to_string(),
            wasm_path: "plugin.wasm".to_string(),
            functions: vec![PluginFunction {
                name: "write_file".to_string(),
                description: "write file".to_string(),
                input_schema: serde_json::json!({"type": "object"}),
                output_schema: serde_json::json!({"type": "string"}),
                side_effect_level: Some(SideEffectLevel::Modify),
            }],
        };
        let host = Arc::new(Mutex::new(PluginHost::new()));
        let tools = build_tool_specs_from_plugin(&spec, host);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].0.side_effect_level, SideEffectLevel::Modify);
        // Modify 级工具应触发审批
        assert!(tools[0].0.needs_approval());
    }

    /// manifest 声明 Execute 级别时应反映到 ToolSpec
    #[test]
    fn build_tool_specs_respects_declared_execute_level() {
        let spec = PluginSpec {
            name: "demo".to_string(),
            version: "1.0.0".to_string(),
            description: "demo".to_string(),
            wasm_path: "plugin.wasm".to_string(),
            functions: vec![PluginFunction {
                name: "run_cmd".to_string(),
                description: "run command".to_string(),
                input_schema: serde_json::json!({"type": "object"}),
                output_schema: serde_json::json!({"type": "string"}),
                side_effect_level: Some(SideEffectLevel::Execute),
            }],
        };
        let host = Arc::new(Mutex::new(PluginHost::new()));
        let tools = build_tool_specs_from_plugin(&spec, host);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].0.side_effect_level, SideEffectLevel::Execute);
    }

    /// 同一插件的不同函数可声明不同级别
    #[test]
    fn build_tool_specs_supports_mixed_levels_per_function() {
        let spec = PluginSpec {
            name: "demo".to_string(),
            version: "1.0.0".to_string(),
            description: "demo".to_string(),
            wasm_path: "plugin.wasm".to_string(),
            functions: vec![
                PluginFunction {
                    name: "read".to_string(),
                    description: "read only".to_string(),
                    input_schema: serde_json::json!({"type": "object"}),
                    output_schema: serde_json::json!({"type": "string"}),
                    side_effect_level: Some(SideEffectLevel::ReadOnly),
                },
                PluginFunction {
                    name: "write".to_string(),
                    description: "modify".to_string(),
                    input_schema: serde_json::json!({"type": "object"}),
                    output_schema: serde_json::json!({"type": "string"}),
                    side_effect_level: Some(SideEffectLevel::Modify),
                },
            ],
        };
        let host = Arc::new(Mutex::new(PluginHost::new()));
        let tools = build_tool_specs_from_plugin(&spec, host);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].0.side_effect_level, SideEffectLevel::ReadOnly);
        assert_eq!(tools[1].0.side_effect_level, SideEffectLevel::Modify);
    }

    #[test]
    fn collect_wasm_tools_returns_empty_when_no_plugins_dir() {
        let tmp = tempdir().expect("tempdir");
        let (tools, _host) = collect_wasm_tools(tmp.path()).expect("collect");
        assert!(tools.is_empty());
    }

    #[test]
    fn list_wasm_plugin_specs_empty_for_no_dir() {
        let tmp = tempdir().expect("tempdir");
        let specs = list_wasm_plugin_specs(tmp.path());
        assert!(specs.is_empty());
    }

    #[test]
    fn list_wasm_plugin_specs_skips_invalid() {
        let tmp = tempdir().expect("tempdir");
        let plugins_root = tmp.path().join(".sacode").join("plugins");
        std::fs::create_dir_all(&plugins_root).expect("create root");

        // 无效 manifest
        let bad_dir = plugins_root.join("bad");
        std::fs::create_dir_all(&bad_dir).expect("create bad dir");
        std::fs::write(bad_dir.join("manifest.json"), "not json").expect("write bad");

        assert!(list_wasm_plugin_specs(tmp.path()).is_empty());
    }

    /// 验证 register_wasm_tools 在空 workdir 下不报错
    #[test]
    fn register_wasm_tools_no_errors_on_empty_workdir() {
        let tmp = tempdir().expect("tempdir");
        let mut registry = ToolRegistry::default();
        let host = register_wasm_tools(&mut registry, tmp.path()).expect("register");
        assert!(host.lock().is_ok());
        assert!(registry.specs().iter().all(|s| !s.name.starts_with(WASM_TOOL_PREFIX)));
    }

    /// 路径常量在模块内可用
    #[test]
    fn wasm_tool_prefix_constant() {
        assert_eq!(WASM_TOOL_PREFIX, "wasm.");
        // 防止误用：fs.read 不应被识别为 wasm 工具
        assert!(!"fs.read".starts_with(WASM_TOOL_PREFIX));
    }

    /// 仅验证 PathBuf 占位 — 防止未来重构误删 import
    #[test]
    fn path_buf_import_used() {
        let _: PathBuf = PathBuf::new();
    }

    /// 验证 discover_wasm_plugins 在缺少 .sacode/plugins 时返回空
    /// 这条用例同时覆盖 `super::discover_wasm_plugins` 的导入，防止误删
    #[test]
    fn discover_wasm_plugins_returns_empty_without_dir() {
        let tmp = tempdir().expect("tempdir");
        let descriptors = discover_wasm_plugins(tmp.path()).expect("discover");
        assert!(descriptors.is_empty());
    }
}
