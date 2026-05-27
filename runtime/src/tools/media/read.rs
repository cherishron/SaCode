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

    let file_path = resolve_allowed_path(path)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    let bytes = fs::read(&file_path)?;
    let mime_type = detect_mime_type(path);
    let (width, height) = detect_dimensions(path, &bytes);
    let data = match mode {
        "base64" => encode_base64(&bytes),
        "ocr" => format_ocr_placeholder(&file_path.display().to_string(), mime_type, width, height),
        "describe" => format_describe_placeholder(&file_path.display().to_string(), mime_type, width, height, bytes.len()),
        _ => return Ok(ToolOutput::failure("mode must be one of: base64, ocr, describe")),
    };
    let summary = format_summary(mime_type, bytes.len(), width, height);

    Ok(ToolOutput::success(serde_json::json!({
        "path": file_path.display().to_string(),
        "mime_type": mime_type,
        "data": data,
        "size_bytes": bytes.len(),
        "width": width,
        "height": height,
        "summary": summary
    })))
}

fn detect_mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ppm" => "image/x-portable-pixmap",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn detect_dimensions(path: &str, bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    match path.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => parse_png_dimensions(bytes),
        "ppm" => parse_ppm_dimensions(bytes),
        _ => (None, None),
    }
}

fn parse_png_dimensions(bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return (None, None);
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    (Some(width), Some(height))
}

fn parse_ppm_dimensions(bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    let text = String::from_utf8_lossy(bytes);
    let mut parts = text.split_whitespace();
    let magic = parts.next();
    let width = parts.next().and_then(|value| value.parse::<u32>().ok());
    let height = parts.next().and_then(|value| value.parse::<u32>().ok());
    if magic == Some("P6") {
        (width, height)
    } else {
        (None, None)
    }
}

fn format_summary(mime_type: &str, size_bytes: usize, width: Option<u32>, height: Option<u32>) -> String {
    match (width, height) {
        (Some(width), Some(height)) => format!("{}，{} bytes，{}x{}", mime_type, size_bytes, width, height),
        _ => format!("{}，{} bytes", mime_type, size_bytes),
    }
}

fn format_describe_placeholder(path: &str, mime_type: &str, width: Option<u32>, height: Option<u32>, size_bytes: usize) -> String {
    match (width, height) {
        (Some(width), Some(height)) => format!(
            "图片描述能力暂未接入。文件: {}，类型: {}，尺寸: {}x{}，大小: {} bytes。可先读取 base64，或接入视觉模型后在此返回结构化描述。",
            path, mime_type, width, height, size_bytes
        ),
        _ => format!(
            "图片描述能力暂未接入。文件: {}，类型: {}，大小: {} bytes。可先读取 base64，或接入视觉模型后在此返回结构化描述。",
            path, mime_type, size_bytes
        ),
    }
}

fn format_ocr_placeholder(path: &str, mime_type: &str, width: Option<u32>, height: Option<u32>) -> String {
    match (width, height) {
        (Some(width), Some(height)) => format!(
            "OCR 能力暂未接入。文件: {}，类型: {}，尺寸: {}x{}。后续可在这里返回识别文本和位置信息。",
            path, mime_type, width, height
        ),
        _ => format!(
            "OCR 能力暂未接入。文件: {}，类型: {}。后续可在这里返回识别文本和位置信息。",
            path, mime_type
        ),
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
