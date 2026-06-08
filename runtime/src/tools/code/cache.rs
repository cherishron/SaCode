use std::collections::HashMap;
use std::sync::RwLock;
use std::time::SystemTime;

use super::ast::AstSummary;

#[derive(Debug, Clone)]
struct CachedAst {
    summary: AstSummary,
    cached_at: SystemTime,
}

pub struct AstCache {
    entries: RwLock<HashMap<String, CachedAst>>,
    max_entries: usize,
}

impl AstCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            max_entries,
        }
    }

    pub fn get_or_compute(
        &self,
        path: &std::path::Path,
        language: &str,
        source: &str,
    ) -> anyhow::Result<AstSummary> {
        let metadata = std::fs::metadata(path).ok();
        let modified = metadata.and_then(|m| m.modified().ok());

        let cache_key = format!(
            "{}:{}:{}",
            path.display(),
            language,
            modified.map(|t| format!("{:?}", t)).unwrap_or_default()
        );

        let entries = self.entries.read().unwrap();
        if let Some(cached) = entries.get(&cache_key) {
            return Ok(cached.summary.clone());
        }
        drop(entries);

        let summary = super::ast::AstEditor::summarize(language, source)?;

        {
            let mut entries = self.entries.write().unwrap();
            if entries.len() >= self.max_entries {
                let oldest = entries
                    .iter()
                    .min_by_key(|(_, v)| v.cached_at)
                    .map(|(k, _)| k.clone());
                if let Some(key) = oldest {
                    entries.remove(&key);
                }
            }
            entries.insert(
                cache_key,
                CachedAst {
                    summary: summary.clone(),
                    cached_at: SystemTime::now(),
                },
            );
        }

        Ok(summary)
    }

    pub fn invalidate(&self, path: &std::path::Path) {
        let mut entries = self.entries.write().unwrap();
        let prefix = format!("{}:", path.display());
        entries.retain(|key, _| !key.starts_with(&prefix));
    }
}

#[derive(Debug, Clone)]
struct DirFileListCache {
    files: Vec<std::path::PathBuf>,
    dir_modified: Option<SystemTime>,
}

pub struct FileListCache {
    entries: RwLock<HashMap<std::path::PathBuf, DirFileListCache>>,
}

impl FileListCache {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    pub fn get_or_collect<F>(
        &self,
        dir: &std::path::Path,
        language: Option<&str>,
        collect_fn: F,
    ) -> anyhow::Result<Vec<std::path::PathBuf>>
    where
        F: FnOnce(
            &std::path::Path,
            Option<&str>,
            &mut Vec<std::path::PathBuf>,
        ) -> anyhow::Result<()>,
    {
        let dir_modified = std::fs::metadata(dir).ok().and_then(|m| m.modified().ok());

        {
            let entries = self.entries.read().unwrap();
            if let Some(cached) = entries.get(dir) {
                if cached.dir_modified == dir_modified {
                    return Ok(cached.files.clone());
                }
            }
        }

        let mut files = Vec::new();
        collect_fn(dir, language, &mut files)?;

        {
            let mut entries = self.entries.write().unwrap();
            entries.insert(
                dir.to_path_buf(),
                DirFileListCache {
                    files: files.clone(),
                    dir_modified,
                },
            );
        }

        Ok(files)
    }

    pub fn invalidate(&self, path: &std::path::Path) {
        let mut entries = self.entries.write().unwrap();
        if path.is_file() {
            if let Some(parent) = path.parent() {
                entries.remove(parent);
            }
        } else if path.is_dir() {
            entries.remove(path);
        }
    }
}

pub static AST_CACHE: std::sync::LazyLock<AstCache> =
    std::sync::LazyLock::new(|| AstCache::new(512));

pub static FILE_LIST_CACHE: std::sync::LazyLock<FileListCache> =
    std::sync::LazyLock::new(FileListCache::new);
