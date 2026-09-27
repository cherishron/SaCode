//! 用户与项目 Markdown 知识库。项目 docs/ 仅可读取，不作为笔记写入目标。
use super::DaemonState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn err(status: StatusCode, message: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (status, Json(json!({"error": message.to_string()})))
}
fn io_err(error: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    err(StatusCode::INTERNAL_SERVER_ERROR, error)
}

#[derive(Clone, Serialize)]
pub struct KnowledgeNote {
    id: String,
    title: String,
    scope: String,
    readonly: bool,
    created_at: Option<String>,
    updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
}
#[derive(Deserialize)]
pub struct ScopeQuery {
    scope: String,
}
#[derive(Deserialize)]
pub struct SearchQuery {
    scope: String,
    #[serde(default)]
    q: String,
}
#[derive(Deserialize)]
pub struct NoteInput {
    scope: String,
    title: String,
    content: String,
    #[serde(default)]
    updated_at: Option<String>,
}

fn scope_root(state: &DaemonState, scope: &str) -> Result<PathBuf, (StatusCode, Json<Value>)> {
    let base = match scope {
        "project" => state
            .workdir
            .clone()
            .ok_or_else(|| err(StatusCode::BAD_REQUEST, "需要项目工作目录"))?,
        "user" => std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "无法定位用户目录"))?,
        _ => return Err(err(StatusCode::BAD_REQUEST, "scope 必须是 user 或 project")),
    };
    let canonical_base = base.canonicalize().map_err(io_err)?;
    let sacode = canonical_base.join(".sacode");
    let root = sacode.join("knowledge");
    for candidate in [&sacode, &root] {
        if candidate.exists()
            && !candidate
                .canonicalize()
                .map_err(io_err)?
                .starts_with(&canonical_base)
        {
            return Err(err(StatusCode::FORBIDDEN, "知识库目录越界"));
        }
    }
    Ok(root)
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn note_path(root: &FsPath, id: &str) -> Result<PathBuf, (StatusCode, Json<Value>)> {
    if !valid_id(id) {
        return Err(err(StatusCode::BAD_REQUEST, "无效的笔记 ID"));
    }
    let path = root.join(format!("{id}.md"));
    let real_root = root.canonicalize().map_err(io_err)?;
    let real_path = path
        .canonicalize()
        .map_err(|_| err(StatusCode::NOT_FOUND, "笔记不存在"))?;
    if !real_path.starts_with(real_root) || !real_path.is_file() || path.is_symlink() {
        return Err(err(StatusCode::FORBIDDEN, "笔记路径越界或为符号链接"));
    }
    Ok(real_path)
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn encode(id: &str, title: &str, created: &str, updated: &str, content: &str) -> String {
    // 将元数据序列化为 JSON，避免标题中换行、冒号注入 frontmatter。
    format!(
        "<!-- sacode-note:{} -->\n{}",
        json!({"id":id,"title":title,"created":created,"updated":updated}),
        content
    )
}
fn decode(raw: &str, id: &str, scope: &str, readonly: bool) -> KnowledgeNote {
    let (meta, content) = raw
        .strip_prefix("<!-- sacode-note:")
        .and_then(|rest| rest.split_once(" -->\n"))
        .and_then(|(header, body)| {
            serde_json::from_str::<Value>(header)
                .ok()
                .map(|meta| (meta, body))
        })
        .unwrap_or((Value::Null, raw));
    let title = meta
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            content
                .lines()
                .find_map(|line| line.strip_prefix("# ").map(str::to_owned))
        })
        .unwrap_or_else(|| id.rsplit('/').next().unwrap_or(id).to_string());
    KnowledgeNote {
        id: id.to_string(),
        title,
        scope: scope.to_string(),
        readonly,
        created_at: meta
            .get("created")
            .and_then(Value::as_str)
            .map(str::to_owned),
        updated_at: meta
            .get("updated")
            .and_then(Value::as_str)
            .map(str::to_owned),
        content: Some(content.to_string()),
    }
}
fn read_file(
    path: &FsPath,
    id: &str,
    scope: &str,
    readonly: bool,
) -> Result<KnowledgeNote, (StatusCode, Json<Value>)> {
    let raw = fs::read_to_string(path).map_err(io_err)?;
    Ok(decode(&raw, id, scope, readonly))
}
fn walk_docs(root: &FsPath, current: &FsPath, out: &mut Vec<KnowledgeNote>) {
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_symlink() {
            continue;
        }
        let Ok(real) = path.canonicalize() else {
            continue;
        };
        if !real.starts_with(root) {
            continue;
        }
        if real.is_dir() {
            walk_docs(root, &real, out);
        } else if real
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            if let Ok(relative) = real.strip_prefix(root) {
                let id = format!("docs/{}", relative.to_string_lossy().replace('\\', "/"));
                if let Ok(note) = read_file(&real, &id, "project", true) {
                    out.push(note);
                }
            }
        }
    }
}
fn collect(
    state: &DaemonState,
    scope: &str,
) -> Result<Vec<KnowledgeNote>, (StatusCode, Json<Value>)> {
    let root = scope_root(state, scope)?;
    let mut notes = Vec::new();
    if root.exists() {
        let real_root = root.canonicalize().map_err(io_err)?;
        for entry in fs::read_dir(&real_root).map_err(io_err)?.flatten() {
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|v| v.to_str()) else {
                continue;
            };
            if path
                .extension()
                .is_none_or(|ext| !ext.eq_ignore_ascii_case("md"))
                || !valid_id(id)
            {
                continue;
            }
            if let Ok(path) = note_path(&real_root, id) {
                if let Ok(note) = read_file(&path, id, scope, false) {
                    notes.push(note);
                }
            }
        }
    }
    if scope == "project" {
        if let Some(workdir) = &state.workdir {
            let docs = workdir.join("docs");
            if let (Ok(workspace), Ok(real)) = (workdir.canonicalize(), docs.canonicalize()) {
                if real.starts_with(workspace) {
                    walk_docs(&real, &real, &mut notes);
                }
            }
        }
    }
    notes.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(notes)
}
fn doc_path(state: &DaemonState, id: &str) -> Result<PathBuf, (StatusCode, Json<Value>)> {
    let relative = id
        .strip_prefix("docs/")
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "无效的文档 ID"))?;
    if relative
        .split('/')
        .any(|segment| segment == ".." || segment.is_empty())
        || !relative.ends_with(".md")
    {
        return Err(err(StatusCode::BAD_REQUEST, "无效的文档路径"));
    }
    let docs = state
        .workdir
        .as_ref()
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "需要项目工作目录"))?
        .join("docs");
    let root = docs
        .canonicalize()
        .map_err(|_| err(StatusCode::NOT_FOUND, "文档不存在"))?;
    let mut candidate = docs.clone();
    for part in relative.split('/') {
        candidate.push(part);
        if candidate.is_symlink() {
            return Err(err(StatusCode::FORBIDDEN, "文档符号链接不可访问"));
        }
    }
    let path = candidate
        .canonicalize()
        .map_err(|_| err(StatusCode::NOT_FOUND, "文档不存在"))?;
    let workspace = state
        .workdir
        .as_ref()
        .unwrap()
        .canonicalize()
        .map_err(io_err)?;
    if !root.starts_with(workspace) || !path.starts_with(root) || !path.is_file() {
        return Err(err(StatusCode::FORBIDDEN, "文档路径越界"));
    }
    Ok(path)
}
pub async fn list_entries(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<ScopeQuery>,
) -> ApiResult {
    let notes = collect(&state, &query.scope)?;
    Ok(Json(
        json!({"entries": notes.into_iter().map(|mut n| { n.content = None; n }).collect::<Vec<_>>()}),
    ))
}
pub async fn create_note(
    State(state): State<Arc<DaemonState>>,
    Json(input): Json<NoteInput>,
) -> ApiResult {
    let root = scope_root(&state, &input.scope)?;
    if input.title.trim().is_empty() || input.title.len() > 200 || input.content.len() > 512 * 1024
    {
        return Err(err(StatusCode::BAD_REQUEST, "标题或正文长度无效"));
    }
    fs::create_dir_all(&root).map_err(io_err)?;
    let root = root.canonicalize().map_err(io_err)?;
    let id = format!("n{:032x}", rand::random::<u128>());
    if !valid_id(&id) {
        return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "无法生成笔记 ID"));
    }
    let path = root.join(format!("{id}.md"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_err)?;
    let timestamp = now();
    file.write_all(
        encode(
            &id,
            input.title.trim(),
            &timestamp,
            &timestamp,
            &input.content,
        )
        .as_bytes(),
    )
    .map_err(io_err)?;
    Ok(Json(
        json!({"note": decode(&encode(&id, input.title.trim(), &timestamp, &timestamp, &input.content), &id, &input.scope, false)}),
    ))
}
pub async fn get_note(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Query(query): Query<ScopeQuery>,
) -> ApiResult {
    let path = if query.scope == "project" && id.starts_with("docs/") {
        doc_path(&state, &id)?
    } else {
        note_path(&scope_root(&state, &query.scope)?, &id)?
    };
    let note = read_file(&path, &id, &query.scope, id.starts_with("docs/"))?;
    Ok(Json(json!({"note":note})))
}
pub async fn update_note(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Json(input): Json<NoteInput>,
) -> ApiResult {
    if input.title.trim().is_empty() || input.title.len() > 200 || input.content.len() > 512 * 1024
    {
        return Err(err(StatusCode::BAD_REQUEST, "标题或正文长度无效"));
    }
    let path = note_path(&scope_root(&state, &input.scope)?, &id)?;
    let old = read_file(&path, &id, &input.scope, false)?;
    if old.updated_at != input.updated_at {
        return Err(err(
            StatusCode::CONFLICT,
            "笔记已被其他操作修改，请刷新后重试",
        ));
    }
    let timestamp = now();
    let timestamp = if old.updated_at.as_deref() == Some(timestamp.as_str()) {
        (chrono::Utc::now() + chrono::Duration::nanoseconds(1)).to_rfc3339()
    } else {
        timestamp
    };
    let created = old.created_at.unwrap_or_else(|| timestamp.clone());
    let raw = encode(
        &id,
        input.title.trim(),
        &created,
        &timestamp,
        &input.content,
    );
    fs::write(&path, &raw).map_err(io_err)?;
    Ok(Json(json!({"note":decode(&raw, &id, &input.scope, false)})))
}
pub async fn delete_note(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Query(query): Query<ScopeQuery>,
) -> ApiResult {
    let path = note_path(&scope_root(&state, &query.scope)?, &id)?;
    fs::remove_file(path).map_err(io_err)?;
    Ok(Json(json!({"deleted":true,"id":id})))
}
fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    for ch in text.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            word.push(ch);
        } else {
            if !word.is_empty() {
                out.push(std::mem::take(&mut word));
            }
            if !ch.is_whitespace() && !ch.is_ascii_punctuation() {
                out.push(ch.to_string());
            }
        }
    }
    if !word.is_empty() {
        out.push(word);
    }
    out
}
fn search(notes: Vec<KnowledgeNote>, q: &str) -> Vec<Value> {
    let terms: HashSet<_> = tokenize(q).into_iter().collect();
    if terms.is_empty() {
        return notes.into_iter().map(|n| json!({"id":n.id,"title":n.title,"scope":n.scope,"readonly":n.readonly,"snippet":"","score":0.0})).collect();
    }
    let tokens: Vec<Vec<String>> = notes
        .iter()
        .map(|n| {
            tokenize(&format!(
                "{} {}",
                n.title,
                n.content.as_deref().unwrap_or("")
            ))
        })
        .collect();
    let avg = tokens.iter().map(Vec::len).sum::<usize>() as f64 / tokens.len().max(1) as f64;
    let mut scored = Vec::new();
    for (i, note) in notes.into_iter().enumerate() {
        let mut score = 0.0;
        for term in &terms {
            let df = tokens.iter().filter(|doc| doc.contains(term)).count() as f64;
            let tf = tokens[i].iter().filter(|token| *token == term).count() as f64;
            if tf > 0.0 {
                let idf = ((tokens.len() as f64 - df + 0.5) / (df + 0.5) + 1.0).ln();
                score += idf * tf * 2.5
                    / (tf + 1.5 * (0.25 + 0.75 * tokens[i].len() as f64 / avg.max(1.0)));
            }
        }
        if score > 0.0 {
            let body = note.content.unwrap_or_default();
            let snippet: String = body.chars().take(140).collect();
            scored.push((score, json!({"id":note.id,"title":note.title,"scope":note.scope,"readonly":note.readonly,"score":score,"snippet":snippet})));
        }
    }
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().map(|(_, hit)| hit).collect()
}
pub async fn search_notes(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<SearchQuery>,
) -> ApiResult {
    Ok(Json(
        json!({"results":search(collect(&state, &query.scope)?, &query.q),"query":query.q}),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn project_note_crud_and_docs_readonly() {
        let tmp = tempfile::tempdir().unwrap();
        let state = Arc::new(DaemonState::new_with_workdir(Some(tmp.path().to_path_buf())).await);
        fs::create_dir_all(tmp.path().join("docs")).unwrap();
        fs::write(tmp.path().join("docs/guide.md"), "# 指南\n只读正文").unwrap();
        let Json(created) = create_note(
            State(state.clone()),
            Json(NoteInput {
                scope: "project".into(),
                title: "项目笔记".into(),
                content: "正文".into(),
                updated_at: None,
            }),
        )
        .await
        .unwrap();
        let id = created["note"]["id"].as_str().unwrap().to_string();
        let version = created["note"]["updated_at"].as_str().unwrap().to_string();
        assert_eq!(created["note"]["content"], "正文");
        let Json(listed) = list_entries(
            State(state.clone()),
            Query(ScopeQuery {
                scope: "project".into(),
            }),
        )
        .await
        .unwrap();
        assert!(listed["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == id));
        assert!(listed["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "docs/guide.md" && item["readonly"] == true));
        let Json(doc) = get_note(
            State(state.clone()),
            Path("docs/guide.md".into()),
            Query(ScopeQuery {
                scope: "project".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(doc["note"]["content"], "# 指南\n只读正文");
        assert_eq!(
            get_note(
                State(state.clone()),
                Path("docs/../guide.md".into()),
                Query(ScopeQuery {
                    scope: "project".into()
                })
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::BAD_REQUEST
        );
        let changed = update_note(
            State(state.clone()),
            Path(id.clone()),
            Json(NoteInput {
                scope: "project".into(),
                title: "更新".into(),
                content: "新正文".into(),
                updated_at: Some(version.clone()),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(changed["note"]["title"], "更新");
        assert_eq!(
            update_note(
                State(state.clone()),
                Path(id.clone()),
                Json(NoteInput {
                    scope: "project".into(),
                    title: "过期".into(),
                    content: "无效".into(),
                    updated_at: Some(version),
                })
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            delete_note(
                State(state.clone()),
                Path("docs/guide.md".into()),
                Query(ScopeQuery {
                    scope: "project".into()
                })
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::BAD_REQUEST
        );
        let _ = delete_note(
            State(state),
            Path(id),
            Query(ScopeQuery {
                scope: "project".into(),
            }),
        )
        .await
        .unwrap();
        assert!(tmp.path().join("docs/guide.md").exists());
    }
    #[test]
    fn rejects_traversal() {
        assert!(!valid_id("../secret"));
        assert!(!valid_id("a\\b"));
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("outside.md"), "secret").unwrap();
        fs::create_dir(temp.path().join("notes")).unwrap();
        assert!(note_path(&temp.path().join("notes"), "outside").is_err());
    }
    #[test]
    fn roundtrip_and_search() {
        let raw = encode("abc", "并发笔记", "a", "b", "Rust 并发");
        let note = decode(&raw, "abc", "project", false);
        assert_eq!(note.updated_at.as_deref(), Some("b"));
        assert_eq!(search(vec![note], "并发").len(), 1);
    }
}
