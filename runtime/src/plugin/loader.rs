use crate::tools::ToolSpec;

use super::{PluginDescriptor, PluginKind};

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
