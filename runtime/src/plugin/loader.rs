use std::path::Path;

use crate::tools::ToolSpec;

use super::{PluginDescriptor, PluginKind, PluginSpec};

#[derive(Debug, Default, Clone)]
pub struct PluginLoader;

impl PluginLoader {
    pub fn builtin_from_tool_spec(spec: &ToolSpec) -> PluginDescriptor {
        PluginDescriptor {
            name: spec.name.clone(),
            description: spec.description.clone(),
            kind: PluginKind::Builtin,
            version: None,
            enabled: true,
            source_label: "builtin".to_string(),
            side_effect_level: Some(spec.side_effect_level),
            approval_required: Some(spec.needs_approval()),
            input_schema: Some(spec.input_schema.clone()),
            tags: spec.tags.clone(),
        }
    }

    pub fn mcp_from_tool_spec(spec: &ToolSpec) -> PluginDescriptor {
        let source_label = spec
            .tags
            .iter()
            .find(|tag| tag.as_str() != "mcp")
            .cloned()
            .unwrap_or_else(|| "mcp".to_string());

        PluginDescriptor {
            name: spec.name.clone(),
            description: spec.description.clone(),
            kind: PluginKind::Mcp,
            version: None,
            enabled: true,
            source_label,
            side_effect_level: Some(spec.side_effect_level),
            approval_required: Some(spec.needs_approval()),
            input_schema: Some(spec.input_schema.clone()),
            tags: spec.tags.clone(),
        }
    }

    /// 将 WASM [`PluginSpec`]（来自 manifest.json）转换为 [`PluginDescriptor`]
    ///
    /// 设计意图：
    /// - 一个 PluginSpec 可声明多个 functions，但 PluginDescriptor 是单条目，
    ///   这里把首个函数的 input_schema 作为代表（用于 list/search 展示）
    /// - 实际执行由 [`crate::tools::wasm`] 把每个函数包装成独立 ToolSpec 注册
    /// - tags 注入 `wasm` 与插件名，便于在 search 中按插件名筛选
    pub fn wasm_from_spec(spec: &PluginSpec, _plugin_dir: &Path) -> PluginDescriptor {
        let first_function = spec.functions.first();
        let input_schema = first_function.map(|f| f.input_schema.clone());

        let mut tags = vec!["wasm".to_string()];
        tags.push(spec.name.clone());

        PluginDescriptor {
            name: spec.name.clone(),
            description: spec.description.clone(),
            kind: PluginKind::Wasm,
            version: Some(spec.version.clone()),
            enabled: true,
            source_label: "wasm".to_string(),
            // WASM 函数默认按 ReadOnly 处理；具体函数的副作用由 manifest 声明
            side_effect_level: Some(crate::tools::SideEffectLevel::ReadOnly),
            // WASM 插件在沙箱内执行，但仍需用户审批以遵守灵枢沙箱审计
            approval_required: Some(true),
            input_schema,
            tags,
        }
    }

    pub fn configured_plugin(
        name: impl Into<String>,
        description: impl Into<String>,
        kind: PluginKind,
        version: Option<String>,
        enabled: bool,
        source_label: impl Into<String>,
    ) -> PluginDescriptor {
        let enabled_tag = if enabled { "enabled" } else { "disabled" }.to_string();
        PluginDescriptor {
            name: name.into(),
            description: description.into(),
            kind,
            version,
            enabled,
            source_label: source_label.into(),
            side_effect_level: None,
            approval_required: None,
            input_schema: None,
            tags: vec![enabled_tag],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::PluginFunction;
    use std::path::PathBuf;

    fn fake_spec() -> PluginSpec {
        PluginSpec {
            name: "demo".to_string(),
            version: "1.0.0".to_string(),
            description: "demo plugin".to_string(),
            wasm_path: "plugin.wasm".to_string(),
            functions: vec![PluginFunction {
                name: "greet".to_string(),
                description: "say hi".to_string(),
                input_schema: serde_json::json!({"type": "object"}),
                output_schema: serde_json::json!({"type": "string"}),
            }],
        }
    }

    #[test]
    fn wasm_from_spec_populates_descriptor_fields() {
        let spec = fake_spec();
        let dir = PathBuf::from("/tmp/demo");
        let descriptor = PluginLoader::wasm_from_spec(&spec, &dir);

        assert_eq!(descriptor.name, "demo");
        assert_eq!(descriptor.kind, PluginKind::Wasm);
        assert_eq!(descriptor.source_label, "wasm");
        assert_eq!(descriptor.version.as_deref(), Some("1.0.0"));
        assert!(descriptor.tags.contains(&"wasm".to_string()));
        assert!(descriptor.tags.contains(&"demo".to_string()));
        assert!(descriptor.input_schema.is_some());
        assert!(descriptor.approval_required.unwrap_or(false));
        // 防止 _plugin_dir 参数被未来重构误删
        let _ = dir;
    }

    #[test]
    fn wasm_from_spec_handles_empty_functions() {
        let mut spec = fake_spec();
        spec.functions.clear();
        let dir = PathBuf::from("/tmp/demo");
        let descriptor = PluginLoader::wasm_from_spec(&spec, &dir);
        assert!(descriptor.input_schema.is_none());
    }
}
