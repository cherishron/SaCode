use serde::{Deserialize, Serialize};

/// 工具分层标签
///
/// 灵枢 · 上下文优化机制按工具分层决定是否注入 system prompt：
/// - [`ToolLayer::Core`]：核心层工具，体量小、普适性强，始终注入 prompt
/// - [`ToolLayer::Extended`]：扩展层工具，按角色与任务画像按需注入
///
/// 设计意图：在保持灵枢自组织能力的前提下，压缩 system prompt 的 token 占用。
///
/// 注意：`layer` 不直接存于 [`ToolSpec`]，而是在 [`crate::tools::ToolRegistry`]
/// 注册时按 [`crate::tools::ToolRegistry::apply_default_layers`] 标注，
/// 避免修改全部 29 个 `spec()` 函数。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ToolLayer {
    /// 扩展层：默认层级，仅在角色或任务画像命中时注入
    #[default]
    Extended,
    /// 核心层：fs.read / fs.write / fs.edit / shell.exec 等
    /// 体量小、几乎所有任务都需要，始终注入 prompt
    Core,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub side_effect_level: SideEffectLevel,
    pub approval_required: bool,
    pub timeout_ms: Option<u64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectLevel {
    ReadOnly,
    Modify,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub success: bool,
    pub data: serde_json::Value,
    pub message: Option<String>,
}

impl ToolOutput {
    pub fn success(data: serde_json::Value) -> Self {
        Self {
            success: true,
            data,
            message: None,
        }
    }

    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: serde_json::json!(null),
            message: Some(message.into()),
        }
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

impl ToolSpec {
    pub fn is_read_only(&self) -> bool {
        self.side_effect_level == SideEffectLevel::ReadOnly
    }

    pub fn needs_approval(&self) -> bool {
        self.approval_required || !self.is_read_only()
    }

    pub fn to_tool_definition(&self) -> sacode_kernel::model::ToolDefinition {
        sacode_kernel::model::ToolDefinition::function(
            &self.name,
            &self.description,
            self.input_schema.clone(),
        )
    }
}
