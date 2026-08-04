use anyhow::Result;
use sacode_kernel::schema::{Checkpoint, Task};
use std::path::{Path, PathBuf};

const CHECKPOINT_DIR: &str = ".sacode/checkpoints";

pub struct CheckpointStorage {
    base_path: PathBuf,
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
        let path = self.base_path.join(filename);

        let json = serde_json::to_string_pretty(checkpoint)?;
        std::fs::write(&path, json)?;

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
    /// 遍历所有 checkpoint 文件，反序列化后按 task_id 过滤。
    /// 返回匹配的文件名列表（按时间排序），空表示无匹配。
    /// 适用于跨进程按 task_id 恢复场景。
    pub fn list_by_task_id(&self, task_id: &str) -> Result<Vec<String>> {
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
