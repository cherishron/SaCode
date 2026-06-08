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

    pub fn create_from_task(&self, task: Task) -> Checkpoint {
        Checkpoint::new(task)
    }

    pub fn path(&self) -> &Path {
        &self.base_path
    }
}
