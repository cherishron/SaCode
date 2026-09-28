//! P2-1：工作区附件上传
//!
//! POST /api/workspace/uploads
//! body: { filename, content_base64, kind? }
//! → 写入 `<workdir>/.sacode/uploads/<safe-name>`，返回相对路径供 context_paths 引用

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

use super::DaemonState;

fn safe_filename(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.bin");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "upload.bin".to_string()
    } else {
        cleaned
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct UploadRequest {
    pub filename: String,
    /// base64 编码的文件内容
    pub content_base64: String,
    #[serde(default)]
    pub kind: String,
}

pub async fn upload_attachment(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<UploadRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(workdir) = state.workdir.clone() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "status": "error", "message": "workdir unavailable" })),
        );
    };
    let filename = safe_filename(&req.filename);
    if filename != req.filename {
        // 允许：已清洗；继续
    }
    let bytes = match base64_decode(&req.content_base64) {
        Ok(b) => b,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "status": "error", "message": err })),
            );
        }
    };
    // 限制 20MB
    if bytes.len() > 20 * 1024 * 1024 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({ "status": "error", "message": "file exceeds 20MB" })),
        );
    }

    let uploads = workdir.join(".sacode").join("uploads");
    if let Err(err) = std::fs::create_dir_all(&uploads) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
        );
    }
    // 避免覆盖：追加序号
    let mut dest = uploads.join(&filename);
    if dest.exists() {
        let stem = std::path::Path::new(&filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("upload")
            .to_string();
        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        for i in 1..100 {
            let candidate = if ext.is_empty() {
                format!("{stem}-{i}")
            } else {
                format!("{stem}-{i}.{ext}")
            };
            dest = uploads.join(candidate);
            if !dest.exists() {
                break;
            }
        }
    }
    if let Err(err) = std::fs::write(&dest, &bytes) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
        );
    }
    let rel = format!(
        ".sacode/uploads/{}",
        dest.file_name().and_then(|s| s.to_str()).unwrap_or("upload")
    );
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "path": rel,
            "size": bytes.len(),
            "kind": req.kind,
        })),
    )
}

/// 最小 base64 解码（标准字母表，忽略空白与 padding）
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    fn val(c: u8) -> Option<u8> {
        TABLE.iter().position(|&t| t == c).map(|v| v as u8)
    }
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for c in input.bytes() {
        if c == b'=' || c == b'\n' || c == b'\r' || c == b' ' || c == b'\t' {
            continue;
        }
        let v = val(c).ok_or_else(|| "invalid base64".to_string())?;
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(out)
}
