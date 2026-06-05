use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Result;
use serde::{Deserialize, Serialize};

const MISTAKE_BOOK_FILE: &str = ".sacode/mistakes.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MistakeEntry {
    pub timestamp: String,
    pub scope: String,
    pub summary: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MistakeBook {
    #[serde(default)]
    pub entries: Vec<MistakeEntry>,
}

#[derive(Debug, Clone)]
pub struct MistakeBookStore {
    path: PathBuf,
}

impl MistakeBookStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(MISTAKE_BOOK_FILE),
        }
    }

    pub fn load(&self) -> Result<MistakeBook> {
        if !self.path.exists() {
            return Ok(MistakeBook::default());
        }

        let content = fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self, book: &MistakeBook) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&self.path, serde_json::to_string_pretty(book)?)?;
        Ok(())
    }

    pub fn ensure_exists(&self) -> Result<()> {
        let book = self.load()?;
        self.save(&book)
    }

    pub fn append(
        &self,
        scope: impl Into<String>,
        summary: impl Into<String>,
        details: impl Into<String>,
    ) -> Result<()> {
        let mut book = self.load()?;
        book.entries.push(MistakeEntry {
            timestamp: unix_timestamp_string(),
            scope: scope.into(),
            summary: summary.into(),
            details: details.into(),
        });
        self.save(&book)
    }
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::MistakeBookStore;

    #[test]
    fn mistake_book_store_appends_entries() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let workdir = std::env::temp_dir().join(format!("sacode-mistakes-{unique}"));
        fs::create_dir_all(&workdir).expect("create temp workdir");

        let store = MistakeBookStore::new(&workdir);
        store
            .append("tool:web.search", "failed", "network timeout")
            .expect("append entry");

        let book = store.load().expect("load book");
        assert_eq!(book.entries.len(), 1);
        assert_eq!(book.entries[0].scope, "tool:web.search");
    }
}
