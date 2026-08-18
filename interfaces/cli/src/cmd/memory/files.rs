use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use sacode_runtime::{
    append_candidate_memory_entry, append_memory_entry, ensure_memory_file, memory_file_path,
    migrate_legacy_memory_files, MemoryEntry, MemoryKind, MemoryScope,
};

const USER_WIKI_DIR: &str = ".sacode/wiki";

#[derive(Debug, Clone)]
pub(super) struct MemoryFile {
    pub(super) kind: MemoryKind,
    pub(super) path: PathBuf,
    pub(super) content: String,
}

pub(super) fn load_memory_files(root: &Path, scope: MemoryScope) -> Result<Vec<MemoryFile>> {
    // 自动迁移旧版记忆文件（memory.md → project.md 等），幂等安全
    migrate_legacy_memory_files(root, scope)?;
    let mut files = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();
    for kind in MemoryKind::all() {
        let path = memory_file_path(root, *kind);
        // Workflow/Decision 合并到 experience.md 后，同一文件只需加载一次
        if !seen_paths.insert(path.clone()) {
            continue;
        }
        ensure_memory_file(&path, scope, *kind)?;
        let content = fs::read_to_string(&path)?;
        files.push(MemoryFile {
            kind: *kind,
            path,
            content,
        });
    }
    Ok(files)
}

pub(super) fn user_wiki_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(USER_WIKI_DIR)
}

pub(super) fn workdir_wiki_dir(project_files: &[MemoryFile]) -> PathBuf {
    project_files
        .first()
        .and_then(|file| file.path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(super::PROJECT_WIKI_DIR))
}

pub(super) fn append_memory(path: &Path, current: &str, entry: MemoryEntry) -> Result<bool> {
    append_memory_entry(path, current, &entry)
}

pub(super) fn append_candidate_memory(
    path: &Path,
    current: &str,
    entry: MemoryEntry,
) -> Result<bool> {
    append_candidate_memory_entry(path, current, &entry)
}