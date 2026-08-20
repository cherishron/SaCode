use anyhow::Result;
use sacode_kernel::schema::{Checkpoint, Task};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const CHECKPOINT_DIR: &str = ".sacode/checkpoints";
/// task_id → [filenames] 索引文件名
const INDEX_FILENAME: &str = "index.json";

pub struct CheckpointStorage {
    base_path: PathBuf,
}

/// task_id → 文件名列表的内存索引结构
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct CheckpointIndex {
    /// task_id → checkpoint 文件名列表（按时间排序）
    entries: HashMap<String, Vec<String>>,
}

impl CheckpointIndex {
    /// 从磁盘加载索引文件，不存在时返回空索引
    fn load(base_path: &Path) -> Result<Self> {
        let path = base_path.join(INDEX_FILENAME);
        if !path.exists() {
            return Ok(Self::default());
        }
        let json = std::fs::read_to_string(&path)?;
        let index: Self = serde_json::from_str(&json).unwrap_or_default();
        Ok(index)
    }

    /// 持久化索引到磁盘
    fn save(&self, base_path: &Path) -> Result<()> {
        std::fs::create_dir_all(base_path)?;
        let path = base_path.join(INDEX_FILENAME);
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;
        Ok(())
    }

    /// 添加 task_id → filename 映射（去重，保持有序）
    fn add(&mut self, task_id: &str, filename: &str) {
        let entry = self.entries.entry(task_id.to_string()).or_default();
        if !entry.contains(&filename.to_string()) {
            entry.push(filename.to_string());
            entry.sort();
        }
    }

    /// 按 task_id 查询文件名列表（已排序）
    fn get(&self, task_id: &str) -> Option<&Vec<String>> {
        self.entries.get(task_id)
    }
}

impl CheckpointStorage {
    pub fn new(workdir: &Path) -> Self {
        Self {
            base_path: workdir.join(CHECKPOINT_DIR),
        }
    }

    pub fn save(&self, checkpoint: &Checkpoint) -> Result<PathBuf> {
        std::fs::create_dir_all(&self.base_path)?;

        let filename = format!("checkpoint-{}.json", checkpoint.created_at);
        let path = self.base_path.join(&filename);

        let json = serde_json::to_string_pretty(checkpoint)?;
        std::fs::write(&path, json)?;

        // 更新 task_id 索引（如果有 task_id）
        if let Some(task_id) = checkpoint.task_id.as_ref() {
            let mut index = CheckpointIndex::load(&self.base_path)?;
            index.add(task_id, &filename);
            index.save(&self.base_path)?;
        }

        Ok(path)
    }

    pub fn load(&self, filename: &str) -> Result<Checkpoint> {
        let path = self.base_path.join(filename);
        let json = std::fs::read_to_string(&path)?;
        let checkpoint: Checkpoint = serde_json::from_str(&json)?;
        Ok(checkpoint)
    }

    pub fn list(&self) -> Result<Vec<String>> {
        if !self.base_path.exists() {
            return Ok(Vec::new());
        }

        let mut checkpoints = Vec::new();
        for entry in std::fs::read_dir(&self.base_path)? {
            let entry = entry?;
            if let Some(name) = entry.file_name().to_str() {
                // 跳过 index.json 索引文件
                if name == INDEX_FILENAME {
                    continue;
                }
                if name.starts_with("checkpoint-") && name.ends_with(".json") {
                    checkpoints.push(name.to_string());
                }
            }
        }

        checkpoints.sort();
        Ok(checkpoints)
    }

    pub fn latest(&self) -> Result<Option<Checkpoint>> {
        let checkpoints = self.list()?;
        if checkpoints.is_empty() {
            return Ok(None);
        }

        let latest = checkpoints.last().unwrap();
        self.load(latest).map(Some)
    }

    /// 按 task_id 查找 checkpoint 文件名列表
    ///
    /// 优先走索引文件（O(1) 查询），索引缺失时回退到遍历所有文件。
    /// 返回匹配的文件名列表（按时间排序），空表示无匹配。
    /// 适用于跨进程按 task_id 恢复场景。
    pub fn list_by_task_id(&self, task_id: &str) -> Result<Vec<String>> {
        // 优先走索引
        if let Ok(index) = CheckpointIndex::load(&self.base_path) {
            if let Some(files) = index.get(task_id) {
                // 校验索引中的文件是否真实存在（可能被外部清理）
                let existing: Vec<String> = files
                    .iter()
                    .filter(|name| self.base_path.join(name).exists())
                    .cloned()
                    .collect();
                if !existing.is_empty() {
                    return Ok(existing);
                }
            }
        }

        // 回退：遍历所有文件（索引缺失或文件被清理后的兜底）
        let all = self.list()?;
        let mut matched = Vec::new();
        for name in all {
            match self.load(&name) {
                Ok(cp) if cp.task_id.as_deref() == Some(task_id) => matched.push(name),
                _ => continue,
            }
        }
        Ok(matched)
    }

    /// 按 task_id 加载最新的 checkpoint
    ///
    /// 返回 None 表示无匹配或目录为空。多个匹配时取最后一个（最新）。
    pub fn load_by_task_id(&self, task_id: &str) -> Result<Option<Checkpoint>> {
        let mut matched = self.list_by_task_id(task_id)?;
        if matched.is_empty() {
            return Ok(None);
        }
        let latest = matched.pop().unwrap();
        self.load(&latest).map(Some)
    }

    pub fn create_from_task(&self, task: Task) -> Checkpoint {
        Checkpoint::new(task)
    }

    pub fn path(&self) -> &Path {
        &self.base_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::ExecutionMode;
    use tempfile::tempdir;

    fn make_checkpoint(task_id: &str, created_at: &str) -> Checkpoint {
        let mut cp = Checkpoint::new(Task::new("test prompt", ExecutionMode::Build, None));
        cp.task_id = Some(task_id.to_string());
        cp.created_at = created_at.to_string();
        cp.updated_at = created_at.to_string();
        cp
    }

    #[test]
    fn saves_and_loads_checkpoint_with_index() {
        let temp = tempdir().expect("tempdir");
        let storage = CheckpointStorage::new(temp.path());

        let checkpoint = make_checkpoint("task-1", "20260101T000000");
        let path = storage.save(&checkpoint).expect("save");
        assert!(path.exists());

        // 索引文件应存在
        let index_path = temp.path().join(CHECKPOINT_DIR).join(INDEX_FILENAME);
        assert!(index_path.exists(), "index.json 应被创建");

        // 按 task_id 查询应命中索引
        let files = storage.list_by_task_id("task-1").expect("list by task_id");
        assert_eq!(files.len(), 1);
        assert!(files[0].contains("checkpoint-"));

        // 加载最新
        let loaded = storage
            .load_by_task_id("task-1")
            .expect("load by task_id")
            .expect("应找到 checkpoint");
        assert_eq!(loaded.task_id.as_deref(), Some("task-1"));
    }

    #[test]
    fn falls_back_to_scan_when_index_missing() {
        let temp = tempdir().expect("tempdir");
        let storage = CheckpointStorage::new(temp.path());

        // 直接写 checkpoint 文件，不经过 save（跳过索引创建）
        let checkpoint_path = temp
            .path()
            .join(CHECKPOINT_DIR)
            .join("checkpoint-20260101T000000.json");
        std::fs::create_dir_all(checkpoint_path.parent().unwrap()).unwrap();
        let checkpoint = make_checkpoint("task-2", "20260101T000000");
        std::fs::write(
            &checkpoint_path,
            serde_json::to_string_pretty(&checkpoint).unwrap(),
        )
        .unwrap();

        // 索引不存在，应回退到遍历
        let files = storage.list_by_task_id("task-2").expect("list by task_id");
        assert_eq!(files.len(), 1, "索引缺失时应回退到遍历");

        let loaded = storage
            .load_by_task_id("task-2")
            .expect("load")
            .expect("应找到");
        assert_eq!(loaded.task_id.as_deref(), Some("task-2"));
    }

    #[test]
    fn index_skips_cleaned_files() {
        let temp = tempdir().expect("tempdir");
        let storage = CheckpointStorage::new(temp.path());

        let checkpoint = make_checkpoint("task-3", "20260101T000000");
        let saved_path = storage.save(&checkpoint).expect("save");

        // 删除 checkpoint 文件，但保留索引
        std::fs::remove_file(&saved_path).unwrap();

        // 索引仍指向被删的文件，应返回空（校验文件存在性）
        let files = storage.list_by_task_id("task-3").expect("list");
        assert!(files.is_empty(), "索引中的文件被清理后应返回空");
    }

    #[test]
    fn list_excludes_index_file() {
        let temp = tempdir().expect("tempdir");
        let storage = CheckpointStorage::new(temp.path());

        let checkpoint = make_checkpoint("task-4", "20260101T000000");
        storage.save(&checkpoint).expect("save");

        let all = storage.list().expect("list");
        // list 不应包含 index.json
        assert!(!all.contains(&INDEX_FILENAME.to_string()));
        assert_eq!(all.len(), 1);
    }
}
