use std::{fs, path::PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::provider::client::ProviderClient;
use crate::tools::fs::access::resolve_allowed_path;

use sacode_kernel::model::{
    ChatMessage, ImageUrlPart, MessagePart, ModelProvider, ProviderKind, ProviderSpec, SaCodeConfig,
};

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "media.vision".to_string(),
        description: "理解图片内容，执行 OCR 或视觉描述".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "图片文件路径" },
                "mode": { "type": "string", "enum": ["ocr", "describe"], "default": "describe" },
                "prompt": { "type": "string", "description": "可选，自定义视觉提示词" },
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
                "text": { "type": "string" },
                "source": { "type": "string" },
                "size_bytes": { "type": "integer" },
                "width": { "type": ["integer", "null"] },
                "height": { "type": ["integer", "null"] },
                "summary": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(20_000),
        tags: vec!["media".to_string(), "vision".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("");
    let mode = input["mode"].as_str().unwrap_or("describe");
    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }
    if !matches!(mode, "ocr" | "describe") {
        return Ok(ToolOutput::failure("mode must be one of: ocr, describe"));
    }

    let file_path = resolve_allowed_path(path, FsAccess::Read)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    let bytes = fs::read(&file_path)?;
    let mime_type = detect_mime_type(path);
    let (width, height) = detect_dimensions(path, &bytes);
    let prompt = input
        .get("prompt")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| build_visual_prompt(mode, &file_path.display().to_string()));
    let (text, source) = try_visual_read(&input, &file_path, &bytes, mime_type, &prompt)
        .unwrap_or_else(|_| {
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
        });
    let summary = format_summary(mime_type, bytes.len(), width, height);

    Ok(ToolOutput::success(serde_json::json!({
        "path": file_path.display().to_string(),
        "mime_type": mime_type,
        "text": text,
        "source": source,
        "size_bytes": bytes.len(),
        "width": width,
        "height": height,
        "summary": summary
    })))
}

pub(super) fn detect_mime_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ppm" => "image/x-portable-pixmap",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub(super) fn detect_dimensions(path: &str, bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
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

pub(super) fn format_summary(
    mime_type: &str,
    size_bytes: usize,
    width: Option<u32>,
    height: Option<u32>,
) -> String {
    match (width, height) {
        (Some(width), Some(height)) => {
            format!("{}，{} bytes，{}x{}", mime_type, size_bytes, width, height)
        }
        _ => format!("{}，{} bytes", mime_type, size_bytes),
    }
}

pub(super) fn try_visual_read(
    input: &serde_json::Value,
    file_path: &PathBuf,
    bytes: &[u8],
    mime_type: &str,
    prompt: &str,
) -> anyhow::Result<(String, String)> {
    let provider = resolve_visual_provider(input)?;
    ensure_image_input_supported(&provider)?;
    let data_url = format!("data:{};base64,{}", mime_type, encode_base64(bytes));
    let client = ProviderClient::new();
    let messages = vec![ChatMessage::user_parts(vec![
        MessagePart::Text {
            text: prompt.to_string(),
        },
        MessagePart::ImageUrl {
            image_url: ImageUrlPart { url: data_url },
        },
    ])];
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let (text, _) =
        runtime.block_on(client.simple_chat_messages_with_usage(&provider, messages))?;
    let _ = file_path;
    Ok((text, "provider".to_string()))
}

pub(super) fn resolve_visual_provider(input: &serde_json::Value) -> anyhow::Result<ModelProvider> {
    if let (Some(model), Some(base_url)) = (
        input.get("model").and_then(|v| v.as_str()),
        input.get("base_url").and_then(|v| v.as_str()),
    ) {
        let kind = detect_provider_kind(base_url, model);
        return Ok(ModelProvider {
            kind,
            model: model.to_string(),
            base_url: Some(normalize_base_url(base_url)),
            api_key: input
                .get("api_key")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            rule: None,
        });
    }

    let workdir = std::env::current_dir()?;
    let config_path = workdir.join(".sacode/config.json");
    let content = fs::read_to_string(&config_path)?;
    let config: SaCodeConfig = serde_json::from_str(&content)?;
    let model_spec = input
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&config.model);
    let (provider_spec, rule, model_name) = config
        .resolve_provider_and_model(model_spec)
        .ok_or_else(|| anyhow::anyhow!("未找到可用于视觉分析的模型配置"))?;

    Ok(ModelProvider {
        kind: detect_provider_kind(&provider_spec.base_url, &model_name),
        model: model_name,
        base_url: Some(normalize_base_url(&provider_spec.base_url)),
        api_key: provider_api_key(provider_spec),
        rule: Some(rule.clone()),
    })
}

pub(super) fn ensure_image_input_supported(provider: &ModelProvider) -> anyhow::Result<()> {
    let supports_image = provider
        .rule
        .as_ref()
        .and_then(|rule| rule.modalities.as_ref())
        .map(|modalities| modalities.input.iter().any(|item| item == "image"))
        .unwrap_or(false);
    if supports_image {
        return Ok(());
    }
    anyhow::bail!("当前模型未声明 image 输入能力")
}

pub(super) fn build_visual_prompt(mode: &str, path: &str) -> String {
    match mode {
        "ocr" => format!(
            "请对图片执行 OCR，提取可见文字。保留自然阅读顺序，按段落输出。文件路径: {}",
            path
        ),
        _ => format!(
            "请描述这张图片的主要内容、布局和关键信息。文件路径: {}",
            path
        ),
    }
}

pub(super) fn fallback_visual_text(
    mode: &str,
    path: &str,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    size_bytes: usize,
) -> String {
    match mode {
        "ocr" => format_ocr_placeholder(path, mime_type, width, height),
        _ => format_describe_placeholder(path, mime_type, width, height, size_bytes),
    }
}

fn provider_api_key(spec: &ProviderSpec) -> Option<String> {
    let key = spec.api_key.trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn detect_provider_kind(base_url: &str, model: &str) -> ProviderKind {
    let lower_url = base_url.to_lowercase();
    let lower_model = model.to_lowercase();
    if lower_url.contains("xiaomimimo")
        || lower_url.contains("token-plan")
        || lower_model.starts_with("mimo")
    {
        ProviderKind::Mimo
    } else if lower_url.contains("longcat") || lower_model.contains("longcat") {
        ProviderKind::Longcat
    } else if lower_url.contains("deepseek") {
        ProviderKind::Deepseek
    } else if lower_url.contains("127.0.0.1:11434") || lower_url.contains("ollama") {
        ProviderKind::Ollama
    } else if lower_url.contains("openai") || lower_model.starts_with("gpt-") {
        ProviderKind::Openai
    } else {
        ProviderKind::Custom("openai-compatible".to_string())
    }
}

fn format_describe_placeholder(
    path: &str,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    size_bytes: usize,
) -> String {
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

fn format_ocr_placeholder(
    path: &str,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
) -> String {
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

pub(super) fn encode_base64(bytes: &[u8]) -> String {
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
                output.push(
                    TABLE[(((value & 0b0000_1111) << 2) | (b2.unwrap_or(0) >> 6)) as usize] as char,
                );
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
