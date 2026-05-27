use std::fs;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::tools::fs::access::resolve_allowed_path;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "media.read".to_string(),
        description: "读取图片、PDF 等非文本文件".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径" },
                "mode": { "type": "string", "enum": ["base64", "ocr", "describe"], "default": "base64" }
            },
            "required": ["path"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "mime_type": { "type": "string" },
                "data": { "type": "string" },
                "size_bytes": { "type": "integer" }
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

    let file_path = resolve_allowed_path(path)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    let bytes = fs::read(&file_path)?;
    let mime_type = detect_mime_type(path);
    let data = match mode {
        "base64" => encode_base64(&bytes),
        "ocr" => format!("OCR 暂未实现，请先使用 base64 模式。mime_type={}", mime_type),
        "describe" => format!("内容描述暂未实现，请先使用 base64 模式。mime_type={}", mime_type),
        _ => return Ok(ToolOutput::failure("mode must be one of: base64, ocr, describe")),
    };

    Ok(ToolOutput::success(serde_json::json!({
        "path": file_path.display().to_string(),
        "mime_type": mime_type,
        "data": data,
        "size_bytes": bytes.len()
    })))
}

fn detect_mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    let mut index = 0;
    while index < bytes.len() {
        let b0 = bytes[index];
        let b1 = bytes.get(index + 1).copied();
        let b2 = bytes.get(index + 2).copied();

        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1.unwrap_or(0) >> 4)) as usize] as char);

        match b1 {
            Some(value) => {
                output.push(TABLE[(((value & 0b0000_1111) << 2) | (b2.unwrap_or(0) >> 6)) as usize] as char);
            }
            None => output.push('='),
        }

        match b2 {
            Some(value) => output.push(TABLE[(value & 0b0011_1111) as usize] as char),
            None => output.push('='),
        }

        index += 3;
    }

    output
}
