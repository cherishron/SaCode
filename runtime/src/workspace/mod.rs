use std::path::{Path, PathBuf};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub language: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub root: String,
    pub files: Vec<FileInfo>,
    pub languages: HashMap<String, usize>,
    pub total_files: usize,
    pub total_size: u64,
}

#[derive(Debug, Clone)]
pub struct WorkspaceScanner {
    max_files: usize,
    max_depth: usize,
    ignore_dirs: Vec<String>,
    ignore_extensions: Vec<String>,
}

impl WorkspaceScanner {
    pub fn new() -> Self {
        Self {
            max_files: 1000,
            max_depth: 5,
            ignore_dirs: vec![
                "node_modules".to_string(), "target".to_string(), "build".to_string(), 
                "dist".to_string(), ".git".to_string(),
                "__pycache__".to_string(), "vendor".to_string(), ".cargo".to_string(), 
                "coverage".to_string(),
            ],
            ignore_extensions: vec![
                ".lock".to_string(), ".log".to_string(), ".tmp".to_string(), 
                ".cache".to_string(), ".bak".to_string(),
            ],
        }
    }

    pub fn scan(&self, root: &Path) -> WorkspaceInfo {
        let mut files = Vec::new();
        let mut languages = HashMap::new();

        self.scan_dir(root, &mut files, &mut languages, 0);

        let total_files = files.len();
        let total_size = files.iter().map(|f| f.size).sum();

        WorkspaceInfo {
            root: root.to_string_lossy().to_string(),
            files,
            languages,
            total_files,
            total_size,
        }
    }

    fn scan_dir(
        &self,
        dir: &Path,
        files: &mut Vec<FileInfo>,
        languages: &mut HashMap<String, usize>,
        depth: usize,
    ) {
        if depth > self.max_depth || files.len() >= self.max_files {
            return;
        }

        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if self.ignore_dirs.contains(&name.to_string()) {
                return;
            }
        }

if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if self.ignore_dirs.contains(&name.to_string()) {
                        continue;
                    }
                }

                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if self.ignore_extensions.contains(&format!(".{}", ext)) {
                        continue;
                    }
                }

                let metadata = entry.metadata().ok();

                if metadata.is_none() {
                    continue;
                }

                let metadata = metadata.unwrap();
                let is_dir = metadata.is_dir();

                if is_dir {
                    self.scan_dir(&path, files, languages, depth + 1);
                } else {
                    let language = self.detect_language(&path);
                    languages.entry(language.clone()).or_insert(0);
                    *languages.get_mut(&language).unwrap() += 1;

                    files.push(FileInfo {
                        path: path.to_string_lossy().to_string(),
                        size: metadata.len(),
                        language,
                        is_dir: false,
                    });
                }
            }
        }
    }

    fn detect_language(&self, path: &Path) -> String {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match ext {
            "rs" => "Rust",
            "js" | "jsx" => "JavaScript",
            "ts" | "tsx" => "TypeScript",
            "py" => "Python",
            "go" => "Go",
            "java" => "Java",
            "c" | "h" => "C",
            "cpp" | "hpp" => "C++",
            "rb" => "Ruby",
            "php" => "PHP",
            "swift" => "Swift",
            "kt" => "Kotlin",
            "scala" => "Scala",
            "vue" => "Vue",
            "svelte" => "Svelte",
            "html" => "HTML",
            "css" | "scss" | "sass" => "CSS",
            "json" | "yaml" | "yml" | "toml" => "Config",
            "md" => "Markdown",
            "sh" | "bash" => "Shell",
            "sql" => "SQL",
            "dockerfile" => "Docker",
            _ => "Other",
        }.to_string()
    }

    pub fn summary(&self) -> String {
        let root = std::env::current_dir().unwrap_or_default();
        let info = self.scan(&root);
        format!(
            "{} files, {} languages, {}KB",
            info.total_files,
            info.languages.len(),
            info.total_size / 1024
        )
    }

    pub fn find_files(&self, root: &Path, pattern: &str) -> Vec<PathBuf> {
        let info = self.scan(root);
        info.files
            .iter()
            .filter(|f| f.path.contains(pattern))
            .map(|f| PathBuf::from(&f.path))
            .collect()
    }

    pub fn by_language(&self, root: &Path, language: &str) -> Vec<FileInfo> {
        let info = self.scan(root);
        info.files
            .iter()
            .filter(|f| f.language == language)
            .cloned()
            .collect()
    }
}

impl Default for WorkspaceScanner {
    fn default() -> Self {
        Self::new()
    }
}