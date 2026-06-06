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
        version: Option<String>,
        enabled: bool,
        source_label: impl Into<String>,
    ) -> PluginDescriptor {
        PluginDescriptor {
            name: name.into(),
            description: "Configured plugin entry".to_string(),
            kind: PluginKind::Configured,
            version,
            enabled,
            source_label: source_label.into(),
            side_effect_level: None,
            approval_required: None,
            input_schema: None,
            tags: vec![match enabled {
                true => "enabled".to_string(),
                false => "disabled".to_string(),
            }],
        }
    }
}
