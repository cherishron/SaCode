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

/// P2-5：按目录一层懒加载（path 空串 = 根）
pub async fn list_dir(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<FileQuery>,
) -> Result<Json<Value>, ApiError> {
    let root: PathBuf = state
        .workdir
        .clone()
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "工作区不可用"))?;
    list_dir_inner(&root, &query.path).map(Json)
}

fn list_dir_inner(root: &Path, relative: &str) -> Result<Value, ApiError> {
    if relative.len() > 4096 {
        return Err(error(StatusCode::BAD_REQUEST, "路径过长"));
    }
    let rel_path = Path::new(relative);
    if rel_path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        && !relative.is_empty()
    {
        return Err(error(StatusCode::BAD_REQUEST, "路径必须位于工作区内"));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "工作区不可用"))?;
    let dir = if relative.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_path)
    };
    let canonical_dir = dir
        .canonicalize()
        .map_err(|_| error(StatusCode::NOT_FOUND, "目录不存在"))?;
    if !canonical_dir.starts_with(&canonical_root) || !canonical_dir.is_dir() {
        return Err(error(StatusCode::FORBIDDEN, "路径越界或不是目录"));
    }

    let mut entries = Vec::new();
    let read = std::fs::read_dir(&canonical_dir)
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "目录读取失败"))?;
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".sacode" {
            // 跳过隐藏项（保留 .sacode 以便看 uploads）
            if name != ".sacode" {
                continue;
            }
        }
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let child_rel = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        entries.push(json!({
            "path": child_rel,
            "name": name,
            "is_dir": is_dir,
            "size": size,
            "language": "",
        }));
    }
    // 目录优先，再按名称
    entries.sort_by(|a, b| {
        let ad = a["is_dir"].as_bool().unwrap_or(false);
        let bd = b["is_dir"].as_bool().unwrap_or(false);
        bd.cmp(&ad)
            .then_with(|| {
                a["name"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(b["name"].as_str().unwrap_or(""))
            })
    });
    // 单层上限 500
    if entries.len() > 500 {
        entries.truncate(500);
    }
    Ok(json!({ "path": relative, "entries": entries }))
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
