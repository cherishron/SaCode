//! Bounded, read-only workspace text preview for the desktop file panel.
use super::DaemonState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

const MAX_PREVIEW_BYTES: u64 = 100 * 1024;

#[derive(Deserialize)]
pub struct FileQuery {
    path: String,
}

type ApiError = (StatusCode, Json<Value>);

fn error(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({ "error": message })))
}

fn preview_file(root: &Path, relative: &str) -> Result<Value, ApiError> {
    if relative.is_empty() || relative.len() > 4096 {
        return Err(error(StatusCode::BAD_REQUEST, "无效文件路径"));
    }
    let path = Path::new(relative);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(error(StatusCode::BAD_REQUEST, "文件路径必须位于工作区内"));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "工作区不可用"))?;
    let candidate = root.join(path);
    let canonical_file = candidate
        .canonicalize()
        .map_err(|_| error(StatusCode::NOT_FOUND, "文件不存在"))?;
    if !canonical_file.starts_with(&canonical_root) || !canonical_file.is_file() {
        return Err(error(StatusCode::FORBIDDEN, "文件路径越界或不是普通文件"));
    }
    // Open the resolved path, then cap the actual read as well as the metadata size.
    let mut file =
        File::open(&canonical_file).map_err(|_| error(StatusCode::NOT_FOUND, "文件无法读取"))?;
    let size = file
        .metadata()
        .map_err(|_| error(StatusCode::NOT_FOUND, "文件无法读取"))?
        .len();
    if size > MAX_PREVIEW_BYTES {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "文件超过 100 KB，无法预览",
        ));
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.by_ref()
        .take(MAX_PREVIEW_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "文件读取失败"))?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "文件超过 100 KB，无法预览",
        ));
    }
    if bytes.contains(&0) {
        return Err(error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "二进制文件无法预览",
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "非 UTF-8 文本无法预览"))?;
    Ok(json!({ "path": relative, "size": content.len(), "content": content }))
}

pub async fn get_file(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<FileQuery>,
) -> Result<Json<Value>, ApiError> {
    let root: PathBuf = state
        .workdir
        .clone()
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "工作区不可用"))?;
    // Small bounded reads are safe on this endpoint and never mutate the workspace.
    preview_file(&root, &query.path).map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_only_bounded_workspace_text() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("hello.txt"), "你好\nhello").unwrap();
        let result = preview_file(temp.path(), "hello.txt").unwrap();
        assert_eq!(result["content"], "你好\nhello");
        assert_eq!(result["path"], "hello.txt");

        assert_eq!(
            preview_file(temp.path(), "../outside.txt").unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            preview_file(temp.path(), "").unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            preview_file(temp.path(), "missing.txt").unwrap_err().0,
            StatusCode::NOT_FOUND
        );

        std::fs::write(temp.path().join("binary.dat"), [0, 1, 2]).unwrap();
        assert_eq!(
            preview_file(temp.path(), "binary.dat").unwrap_err().0,
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        std::fs::write(
            temp.path().join("large.txt"),
            vec![b'x'; MAX_PREVIEW_BYTES as usize + 1],
        )
        .unwrap();
        assert_eq!(
            preview_file(temp.path(), "large.txt").unwrap_err().0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cannot_escape_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            temp.path().join("linked.txt"),
        )
        .unwrap();
        assert_eq!(
            preview_file(temp.path(), "linked.txt").unwrap_err().0,
            StatusCode::FORBIDDEN
        );
    }
}
