use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const MAX_CHANGE_FILES: usize = 200;
const MAX_DIFF_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskFileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    pub kind: String,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskChangesSnapshot {
    pub baseline_tree: String,
    pub final_tree: String,
    pub changes: Vec<TaskFileChange>,
}

struct TempIndex(PathBuf);

impl Drop for TempIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
        let lock = PathBuf::from(format!("{}.lock", self.0.display()));
        let _ = std::fs::remove_file(lock);
    }
}

pub fn capture_workspace_tree(workdir: &Path) -> Result<String> {
    let repo_root = git_text(workdir, &["rev-parse", "--show-toplevel"], None)?;
    let repo_root = PathBuf::from(repo_root.trim());
    let index_path = std::env::temp_dir().join(format!(
        "sacode-task-index-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let _cleanup = TempIndex(index_path.clone());

    git_ok(&repo_root, &["read-tree", "--empty"], Some(&index_path))?;
    git_ok(workdir, &["add", "-A", "--", "."], Some(&index_path))?;
    Ok(git_text(&repo_root, &["write-tree"], Some(&index_path))?
        .trim()
        .to_string())
}

pub fn diff_workspace_trees(
    workdir: &Path,
    baseline_tree: &str,
    final_tree: &str,
) -> Result<TaskChangesSnapshot> {
    let repo_root = git_text(workdir, &["rev-parse", "--show-toplevel"], None)?;
    let repo_root = PathBuf::from(repo_root.trim());
    let output = git_bytes(
        &repo_root,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            baseline_tree,
            final_tree,
        ],
        None,
    )?;
    let entries = parse_name_status(&output)?;
    let mut changes = Vec::new();

    for (kind, previous_path, path) in entries.into_iter().take(MAX_CHANGE_FILES) {
        let mut args = vec![
            "diff".to_string(),
            "--no-ext-diff".to_string(),
            "--binary".to_string(),
            "--find-renames".to_string(),
            baseline_tree.to_string(),
            final_tree.to_string(),
            "--".to_string(),
        ];
        if let Some(previous) = previous_path.as_ref() {
            args.push(previous.clone());
        }
        args.push(path.clone());
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let patch = git_bytes(&repo_root, &refs, None)?;
        let mut diff = String::from_utf8_lossy(&patch).to_string();
        if diff.len() > MAX_DIFF_BYTES {
            diff.truncate(MAX_DIFF_BYTES);
            diff.push_str("\n... diff truncated by SaCode ...\n");
        }
        let binary = diff.contains("GIT binary patch") || diff.contains("Binary files ");
        let (additions, deletions) = if binary {
            (0, 0)
        } else {
            count_changed_lines(&diff)
        };
        changes.push(TaskFileChange {
            path,
            previous_path,
            kind,
            additions,
            deletions,
            binary,
            diff,
        });
    }

    Ok(TaskChangesSnapshot {
        baseline_tree: baseline_tree.to_string(),
        final_tree: final_tree.to_string(),
        changes,
    })
}

fn parse_name_status(bytes: &[u8]) -> Result<Vec<(String, Option<String>, String)>> {
    let fields: Vec<&[u8]> = bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .collect();
    let mut entries = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = String::from_utf8_lossy(fields[index]).to_string();
        index += 1;
        let code = status.chars().next().unwrap_or('M');
        if matches!(code, 'R' | 'C') {
            let old = fields
                .get(index)
                .context("git diff rename missing old path")?;
            let new = fields
                .get(index + 1)
                .context("git diff rename missing new path")?;
            index += 2;
            entries.push((
                if code == 'R' { "renamed" } else { "copied" }.to_string(),
                Some(String::from_utf8_lossy(old).to_string()),
                String::from_utf8_lossy(new).to_string(),
            ));
        } else {
            let path = fields.get(index).context("git diff entry missing path")?;
            index += 1;
            let kind = match code {
                'A' => "added",
                'D' => "deleted",
                'T' => "type_changed",
                _ => "modified",
            };
            entries.push((
                kind.to_string(),
                None,
                String::from_utf8_lossy(path).to_string(),
            ));
        }
    }
    Ok(entries)
}

fn count_changed_lines(diff: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;
    for line in diff.lines() {
        if line.starts_with('+') && !line.starts_with("+++") {
            additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            deletions += 1;
        }
    }
    (additions, deletions)
}

fn git_ok(workdir: &Path, args: &[&str], index: Option<&Path>) -> Result<()> {
    git_bytes(workdir, args, index).map(|_| ())
}

fn git_text(workdir: &Path, args: &[&str], index: Option<&Path>) -> Result<String> {
    let output = git_bytes(workdir, args, index)?;
    String::from_utf8(output).context("git output was not UTF-8")
}

fn git_bytes(workdir: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>> {
    let mut command = Command::new("git");
    command.current_dir(workdir).args(args);
    if let Some(index_path) = index {
        command.env("GIT_INDEX_FILE", index_path);
    }
    let output = command
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;
    if !output.status.success() {
        anyhow::bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_and_diffs_workspace_without_touching_real_index() {
        let temp = tempfile::tempdir().expect("temp repo");
        assert!(Command::new("git")
            .current_dir(temp.path())
            .args(["init", "--quiet"])
            .status()
            .expect("git available")
            .success());
        std::fs::write(temp.path().join("demo.txt"), "before\n").unwrap();
        let baseline = capture_workspace_tree(temp.path()).expect("baseline tree");
        std::fs::write(temp.path().join("demo.txt"), "after\nsecond\n").unwrap();
        let final_tree = capture_workspace_tree(temp.path()).expect("final tree");
        let snapshot = diff_workspace_trees(temp.path(), &baseline, &final_tree).unwrap();

        assert_eq!(snapshot.changes.len(), 1);
        assert_eq!(snapshot.changes[0].path, "demo.txt");
        assert_eq!(snapshot.changes[0].kind, "modified");
        assert_eq!(snapshot.changes[0].additions, 2);
        assert_eq!(snapshot.changes[0].deletions, 1);
        assert!(snapshot.changes[0].diff.contains("+after"));
        assert!(!temp.path().join(".git/index").exists());
    }
}
