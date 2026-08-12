use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::provider::client::ProviderClient;
use crate::tools::fs::access::resolve_allowed_path;

use sacode_kernel::model::{
    ChatMessage, ImageUrlPart, MessagePart, ModelProvider, ProviderKind, ProviderSpec, SaCodeConfig,
};

/// 灵枢 · 多模态（M4）：视觉请求错误分类
///
/// 超时 / 配额 / 模型不支持等错误需向调用方显式传递，而非静默回退到占位文本，
/// 以便上层决定重试、降级或上报。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VisionError {
    /// 视觉模型请求超时（遵守 ToolSpec.timeout_ms）
    Timeout,
    /// 配额耗尽（429 / quota exceeded）
    QuotaExceeded,
    /// 当前模型未声明 image 输入能力
    ModelNotSupported,
    /// 图片文件损坏或无法解码
    FileCorrupted,
    /// 网络或上游服务错误
    NetworkError(String),
}

impl std::fmt::Display for VisionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VisionError::Timeout => write!(f, "视觉模型请求超时"),
            VisionError::QuotaExceeded => write!(f, "视觉模型配额耗尽"),
            VisionError::ModelNotSupported => write!(f, "当前模型不支持图像输入"),
            VisionError::FileCorrupted => write!(f, "图片文件损坏或无法解码"),
            VisionError::NetworkError(msg) => write!(f, "视觉模型网络错误: {}", msg),
        }
    }
}

impl std::error::Error for VisionError {}

impl From<anyhow::Error> for VisionError {
    fn from(err: anyhow::Error) -> Self {
        let msg = err.to_string().to_lowercase();
        if msg.contains("timeout") || msg.contains("timed out") || msg.contains("elapsed") {
            VisionError::Timeout
        } else if msg.contains("429") || msg.contains("quota") || msg.contains("rate limit") {
            VisionError::QuotaExceeded
        } else if msg.contains("image") && msg.contains("能力") {
            VisionError::ModelNotSupported
        } else {
            VisionError::NetworkError(err.to_string())
        }
    }
}

/// 灵枢 · 多模态（M4）：视觉结果缓存
///
/// 基于 文件路径 + mtime + 文件大小 + 模型名 的 LRU 缓存（512 条），
/// 避免对相同图片重复调用视觉模型，降低 token 消耗与延迟。
/// 命中条件：路径、mtime、size、model 全部一致。
pub struct VisionCache {
    capacity: usize,
    entries: Mutex<HashMap<String, CachedVision>>,
    /// 插入顺序（FIFO 近似 LRU）
    order: Mutex<Vec<String>>,
}

struct CachedVision {
    text: String,
    source: String,
}

impl VisionCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            entries: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
        }
    }

    fn cache_key(path: &str, mtime_ms: u64, size: u64, model: &str) -> String {
        format!("{}|{}|{}|{}", path, mtime_ms, size, model)
    }

    /// 查询缓存；未命中或任一维度变化返回 None
    pub fn get(&self, path: &str, mtime_ms: u64, size: u64, model: &str) -> Option<(String, String)> {
        let key = Self::cache_key(path, mtime_ms, size, model);
        let entries = self.entries.lock().ok()?;
        entries
            .get(&key)
            .map(|cached| (cached.text.clone(), cached.source.clone()))
    }

    /// 写入缓存（超出容量时淘汰最旧条目）
    pub fn put(&self, path: &str, mtime_ms: u64, size: u64, model: &str, text: &str, source: &str) {
        let key = Self::cache_key(path, mtime_ms, size, model);
        {
            let mut entries = match self.entries.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            entries.insert(
                key.clone(),
                CachedVision {
                    text: text.to_string(),
                    source: source.to_string(),
                },
            );
        }
        {
            let mut order = match self.order.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if !order.contains(&key) {
                order.push(key.clone());
            }
            while order.len() > self.capacity {
                let oldest = order.remove(0);
                if let Ok(mut entries) = self.entries.lock() {
                    entries.remove(&oldest);
                }
            }
        }
    }
}

/// 进程级共享缓存（512 条）
pub static VISION_CACHE: std::sync::LazyLock<Arc<VisionCache>> =
    std::sync::LazyLock::new(|| Arc::new(VisionCache::new(512)));

fn file_mtime_ms(path: &PathBuf) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 构造带 error_kind 的结构化失败输出（与 git 工具保持一致）
///
/// 契约：`data` 中携带 `error_kind` + `message` 供程序化消费，
/// `message` 仅保留人类可读汇总，二者职责分离（避免 `with_message`
/// 覆盖导致 `data` 为 null、调用方无法按 `data["error_kind"]` 区分错误）。
fn failure_with_kind(message: impl Into<String>, kind: &str) -> ToolOutput {
    let msg = message.into();
    ToolOutput {
        success: false,
        data: serde_json::json!({
            "error_kind": kind,
            "message": msg.clone(),
        }),
        message: Some(format!("{}: {}", kind, msg)),
    }
}


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
                "api_key": { "type": "string", "description": "可选，显式指定 provider api key" },
                "fallback_base_url": { "type": "string", "description": "可选，备用视觉模型 base url（多级降级链第二级）" },
                "fallback_model": { "type": "string", "description": "可选，备用视觉模型名" },
                "fallback_api_key": { "type": "string", "description": "可选，备用视觉模型 api key" }
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
    let size_bytes = bytes.len();
    let mtime_ms = file_mtime_ms(&file_path);
    let prompt = input
        .get("prompt")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| build_visual_prompt(mode, &file_path.display().to_string()));

    // 灵枢 · 多模态（M4）：超时控制取自 ToolSpec.timeout_ms（默认 20s）
    let timeout_ms = spec().timeout_ms.unwrap_or(20_000);
    let timeout = Duration::from_millis(timeout_ms as u64);

    // 灵枢 · 多模态（M4）：结果缓存（路径+mtime+size+model 命中）
    let model_hint = input
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();
    if let Some((cached_text, cached_source)) =
        VISION_CACHE.get(path, mtime_ms, size_bytes as u64, &model_hint)
    {
        let summary = format_summary(mime_type, size_bytes, width, height);
        return Ok(ToolOutput::success(serde_json::json!({
            "path": file_path.display().to_string(),
            "mime_type": mime_type,
            "text": cached_text,
            "source": cached_source,
            "size_bytes": size_bytes,
            "width": width,
            "height": height,
            "summary": summary,
            "cached": true
        })));
    }

    // 灵枢 · 多模态（M4）：多级降级链
    // 主视觉模型 → 备用视觉模型（config 中配置）→ 本地信息降级（含 MIME + 尺寸 + 占位文本）
    let result = run_vision_with_fallback(&input, &file_path, &bytes, mime_type, &prompt, timeout);
    match result {
        Ok((text, source)) => {
            VISION_CACHE.put(path, mtime_ms, size_bytes as u64, &model_hint, &text, &source);
            let summary = format_summary(mime_type, size_bytes, width, height);
            Ok(ToolOutput::success(serde_json::json!({
                "path": file_path.display().to_string(),
                "mime_type": mime_type,
                "text": text,
                "source": source,
                "size_bytes": size_bytes,
                "width": width,
                "height": height,
                "summary": summary,
                "cached": false
            })))
        }
        // 超时 / 配额 / 模型不支持：显式错误，不静默回退
        Err(VisionError::Timeout) => Ok(failure_with_kind(
            "视觉模型请求超时，请稍后重试或指定其他模型",
            "vision_timeout",
        )),
        Err(VisionError::QuotaExceeded) => Ok(failure_with_kind(
            "视觉模型配额耗尽，请稍后重试或指定其他模型",
            "vision_quota_exceeded",
        )),
        Err(VisionError::ModelNotSupported) => Ok(failure_with_kind(
            "当前模型不支持图像输入，请在配置中指定支持视觉的模型",
            "vision_model_unsupported",
        )),
        // 本地信息降级（网络/文件问题但不致命）
        Err(err) => Ok(ToolOutput::success(serde_json::json!({
            "path": file_path.display().to_string(),
            "mime_type": mime_type,
            "text": fallback_visual_text(mode, &file_path.display().to_string(), mime_type, width, height, size_bytes),
            "source": "fallback",
            "size_bytes": size_bytes,
            "width": width,
            "height": height,
            "summary": format_summary(mime_type, size_bytes, width, height),
            "note": err.to_string()
        }))),
    }
}

/// 灵枢 · 多模态（M4）：多级降级链的实际执行
///
/// 1. 主视觉模型（config 或显式指定）带超时调用
/// 2. Timeout / Quota / ModelNotSupported → 直接返回对应 VisionError（不静默回退，交由调用方决策）
/// 3. 其他错误（网络/文件）→ 尝试备用视觉模型（若配置），仍失败则返回该错误，
///    交由 `execute` 做本地信息降级（MIME + 尺寸 + 占位文本合并为一级）
fn run_vision_with_fallback(
    input: &serde_json::Value,
    file_path: &PathBuf,
    bytes: &[u8],
    mime_type: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<(String, String), VisionError> {
    match try_visual_read(input, file_path, bytes, mime_type, prompt, timeout).map_err(VisionError::from) {
        Ok(result) => Ok(result),
        // 致命错误：不降级，直接向上传递
        Err(VisionError::Timeout) => Err(VisionError::Timeout),
        Err(VisionError::QuotaExceeded) => Err(VisionError::QuotaExceeded),
        Err(VisionError::ModelNotSupported) => Err(VisionError::ModelNotSupported),
        // 其他错误：尝试备用视觉模型
        Err(other) => {
            if let Some(fallback) = resolve_fallback_visual_provider(input) {
                if let Ok(result) =
                    try_visual_read_with_provider(&fallback, file_path, bytes, mime_type, prompt, timeout)
                {
                    return Ok(result);
                }
            }
            Err(other)
        }
    }
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
    timeout: Duration,
) -> Result<(String, String), VisionError> {
    let provider = resolve_visual_provider(input)?;
    ensure_image_input_supported(&provider)?;
    try_visual_read_with_provider(&provider, file_path, bytes, mime_type, prompt, timeout)
}

/// 灵枢 · 多模态（M4）：在指定 provider 上执行视觉请求，遵守超时
pub(super) fn try_visual_read_with_provider(
    provider: &ModelProvider,
    file_path: &PathBuf,
    bytes: &[u8],
    mime_type: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<(String, String), VisionError> {
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
        .build()
        .map_err(|e| VisionError::NetworkError(e.to_string()))?;
    let call = client.simple_chat_messages_with_usage(provider, messages);
    let result = runtime.block_on(async { tokio::time::timeout(timeout, call).await });
    match result {
        Ok(Ok((text, _))) => {
            let _ = file_path;
            Ok((text, "provider".to_string()))
        }
        // 超时：显式返回 Timeout（不静默回退）
        Ok(Err(err)) => Err(VisionError::from(err)),
        Err(_elapsed) => Err(VisionError::Timeout),
    }
}

/// 灵枢 · 多模态（M4）：解析备用视觉模型（仅当显式配置了 fallback base_url 时）
fn resolve_fallback_visual_provider(input: &serde_json::Value) -> Option<ModelProvider> {
    let fallback_base = input
        .get("fallback_base_url")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())?;
    let fallback_model = input
        .get("fallback_model")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())?;
    Some(ModelProvider {
        kind: detect_provider_kind(fallback_base, fallback_model),
        model: fallback_model.to_string(),
        base_url: Some(normalize_base_url(fallback_base)),
        api_key: input
            .get("fallback_api_key")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()),
        rule: None,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vision_cache_hit_and_miss() {
        let cache = VisionCache::new(4);
        cache.put("a.png", 100, 200, "model-x", "desc A", "provider");
        // 命中：路径+mtime+size+model 全部一致
        let hit = cache.get("a.png", 100, 200, "model-x");
        assert_eq!(hit, Some(("desc A".to_string(), "provider".to_string())));
        // 未命中：model 不同
        assert!(cache.get("a.png", 100, 200, "model-y").is_none());
        // 未命中：mtime 变化
        assert!(cache.get("a.png", 101, 200, "model-x").is_none());
    }

    #[test]
    fn vision_cache_evicts_oldest_on_capacity() {
        let cache = VisionCache::new(2);
        cache.put("a", 1, 1, "m", "A", "p");
        cache.put("b", 1, 1, "m", "B", "p");
        cache.put("c", 1, 1, "m", "C", "p");
        // 容量 2，最旧 a 应被淘汰
        assert!(cache.get("a", 1, 1, "m").is_none());
        assert!(cache.get("b", 1, 1, "m").is_some());
        assert!(cache.get("c", 1, 1, "m").is_some());
    }

    #[test]
    fn vision_error_classifies_timeout_and_quota() {
        let timeout_err = VisionError::from(anyhow::anyhow!("request timed out after 20s"));
        assert_eq!(timeout_err, VisionError::Timeout);

        let quota_err = VisionError::from(anyhow::anyhow!("HTTP 429 quota exceeded"));
        assert_eq!(quota_err, VisionError::QuotaExceeded);

        let model_err = VisionError::from(anyhow::anyhow!("当前模型未声明 image 输入能力"));
        assert_eq!(model_err, VisionError::ModelNotSupported);

        let net_err = VisionError::from(anyhow::anyhow!("connection reset by peer"));
        assert!(matches!(net_err, VisionError::NetworkError(_)));
    }

    #[test]
    fn spec_declares_timeout_and_extended_layer_compatible() {
        let s = spec();
        assert_eq!(s.name, "media.vision");
        assert!(s.timeout_ms.is_some());
        assert!(s.timeout_ms.unwrap() > 0);
        assert_eq!(s.side_effect_level, SideEffectLevel::ReadOnly);
    }

    #[test]
    fn failure_with_kind_carries_error_kind_in_data() {
        // 回归：error_kind 必须落在 data 字段供程序化消费，
        // message 仅保留人类可读汇总（避免 with_message 覆盖导致 data 为 null）。
        let out = failure_with_kind("视觉模型请求超时", "vision_timeout");
        assert!(!out.success);
        assert_eq!(out.data.get("error_kind").and_then(|v| v.as_str()), Some("vision_timeout"));
        assert_eq!(
            out.data.get("message").and_then(|v| v.as_str()),
            Some("视觉模型请求超时")
        );
        let msg = out.message.expect("message 不应为 None");
        assert!(msg.contains("vision_timeout"));
        assert!(msg.contains("视觉模型请求超时"));
    }
}

