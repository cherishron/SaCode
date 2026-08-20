use std::fs;

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::tools::context::current_context;

use super::vision::{
    build_visual_prompt, detect_dimensions, detect_mime_type, encode_base64, fallback_visual_text,
    format_summary, try_visual_read,
};

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "media.read".to_string(),
        description: "读取图片、PDF 等非文本文件".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径" },
                "mode": { "type": "string", "enum": ["base64", "ocr", "describe"], "default": "base64" },
                "model": { "type": "string", "description": "可选，显式指定 provider/model 或 model" },
                "base_url": { "type": "string", "description": "可选，显式指定 provider base url" },
                "api_key": { "type": "string", "description": "可选，显式指定 provider api key" }
            },
            "required": ["path"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "mime_type": { "type": "string" },
                "data": { "type": "string" },
                "source": { "type": "string" },
                "size_bytes": { "type": "integer" },
                "width": { "type": ["integer", "null"] },
                "height": { "type": ["integer", "null"] },
                "summary": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(10_000),
        tags: vec!["media".to_string(), "read".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("");
    let mode = input["mode"].as_str().unwrap_or("base64");
    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }

    let file_path = current_context().resolve_path(path, FsAccess::Read)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    let bytes = fs::read(&file_path)?;
    let mime_type = detect_mime_type(path);
    let (width, height) = detect_dimensions(path, &bytes);
    let (data, source) = match mode {
        "base64" => (encode_base64(&bytes), "base64".to_string()),
        "ocr" | "describe" => {
            let prompt = build_visual_prompt(mode, &file_path.display().to_string());
            // 超时遵守 media.read 的 timeout_ms（默认 10s）
            let timeout =
                std::time::Duration::from_millis(spec().timeout_ms.unwrap_or(10_000) as u64);
            try_visual_read(&input, &file_path, &bytes, mime_type, &prompt, timeout).unwrap_or_else(
                |_| {
                    (
                        fallback_visual_text(
                            mode,
                            &file_path.display().to_string(),
                            mime_type,
                            width,
                            height,
                            bytes.len(),
                        ),
                        "fallback".to_string(),
                    )
                },
            )
        }
        _ => {
            return Ok(ToolOutput::failure(
                "mode must be one of: base64, ocr, describe",
            ))
        }
    };
    let summary = format_summary(mime_type, bytes.len(), width, height);

    Ok(ToolOutput::success(serde_json::json!({
        "path": file_path.display().to_string(),
        "mime_type": mime_type,
        "data": data,
        "source": source,
        "size_bytes": bytes.len(),
        "width": width,
        "height": height,
        "summary": summary
    })))
}
