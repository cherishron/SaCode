use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "interaction.ask".to_string(),
        description: "向用户提问并返回待确认问题".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "question": { "type": "string", "description": "问题内容" },
                "options": { "type": "array", "items": { "type": "object" } },
                "allow_multiple": { "type": "boolean", "default": false }
            },
            "required": ["question"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "answer": { "type": "string" },
                "answers": { "type": "array", "items": { "type": "string" } },
                "cancelled": { "type": "boolean" },
                "pending": { "type": "boolean" },
                "question": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::Execute,
        approval_required: false,
        timeout_ms: Some(1_000),
        tags: vec!["interaction".to_string(), "ask".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let question = input["question"].as_str().unwrap_or("");
    if question.is_empty() {
        return Ok(ToolOutput::failure("question is required"));
    }

    Ok(ToolOutput::success(serde_json::json!({
        "answer": "",
        "answers": [],
        "cancelled": false,
        "pending": true,
        "question": question,
        "options": input["options"].clone(),
        "allow_multiple": input["allow_multiple"].as_bool().unwrap_or(false)
    }))
    .with_message("interactive answer required"))
}
