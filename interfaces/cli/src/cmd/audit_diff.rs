use anyhow::{bail, Context, Result};
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    process::Command,
};

use sacode_runtime::code_audit::is_supported_code_path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiffScope {
    Worktree,
    Staged,
    Base(String),
}

impl DiffScope {
    pub fn label(&self) -> String {
        match self {
            Self::Worktree => "worktree".to_string(),
            Self::Staged => "staged".to_string(),
            Self::Base(reference) => format!("base:{reference}"),
        }
    }
}

#[derive(Debug)]
pub struct AuditDiffInput {
    pub root: PathBuf,
    pub scope: DiffScope,
    pub contents: HashMap<String, String>,
    pub changed_lines: HashMap<String, BTreeSet<u32>>,
}

pub fn collect_audit_diff(
    start: &Path,
    scope: DiffScope,
    max_files: usize,
) -> Result<AuditDiffInput> {
    let root = git_text(start, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(root.trim());
    let diff = match &scope {
        DiffScope::Worktree => git_text(&root, &["diff", "--no-ext-diff", "--unified=0", "--"])?,
        DiffScope::Staged => git_text(
            &root,
            &["diff", "--cached", "--no-ext-diff", "--unified=0", "--"],
        )?,
        DiffScope::Base(reference) => {
            verify_git_ref(&root, reference)?;
            let merge_base = git_text(&root, &["merge-base", "HEAD", reference])?;
            git_text(
                &root,
                &[
                    "diff",
                    "--no-ext-diff",
                    "--unified=0",
                    merge_base.trim(),
                    "HEAD",
                    "--",
                ],
            )?
        }
    };

    let mut changed_lines = parse_added_lines(&diff);
    let mut contents = HashMap::new();

    if matches!(scope, DiffScope::Worktree) {
        let mut paths = untracked_files(&root)?;
        paths.sort();
        for path in paths.into_iter().take(max_files) {
            if !is_supported_code_path(Path::new(&path)) {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(root.join(&path)) else {
                continue;
            };
            let lines = (1..=content.lines().count() as u32).collect::<BTreeSet<_>>();
            if !lines.is_empty() {
                changed_lines.insert(path.clone(), lines);
                contents.insert(path, content);
            }
        }
    }

    changed_lines
        .retain(|path, lines| !lines.is_empty() && is_supported_code_path(Path::new(path)));
    let mut selected_paths = changed_lines.keys().cloned().collect::<Vec<_>>();
    selected_paths.sort();
    selected_paths.truncate(max_files);
    let selected_paths = selected_paths.into_iter().collect::<BTreeSet<_>>();
    changed_lines.retain(|path, _| selected_paths.contains(path));
    contents.retain(|path, _| selected_paths.contains(path));

    for path in changed_lines.keys() {
        if contents.contains_key(path) {
            continue;
        }
        let content = match &scope {
            DiffScope::Worktree => std::fs::read_to_string(root.join(path)).ok(),
            DiffScope::Staged => git_blob(&root, &format!(":{path}"))?,
            DiffScope::Base(_) => git_blob(&root, &format!("HEAD:{path}"))?,
        };
        if let Some(content) = content {
            contents.insert(path.clone(), content);
        }
    }
    changed_lines.retain(|path, _| contents.contains_key(path));

    Ok(AuditDiffInput {
        root,
        scope,
        contents,
        changed_lines,
    })
}

fn parse_added_lines(diff: &str) -> HashMap<String, BTreeSet<u32>> {
    let mut changed = HashMap::new();
    let mut path: Option<String> = None;
    for line in diff.lines() {
        if let Some(raw) = line.strip_prefix("+++ b/") {
            path = Some(raw.to_string());
            continue;
        }
        if line == "+++ /dev/null" {
            path = None;
            continue;
        }
        if !line.starts_with("@@") {
            continue;
        }
        let Some(path) = path.as_ref() else {
            continue;
        };
        let Some(plus) = line.split_whitespace().find(|part| part.starts_with('+')) else {
            continue;
        };
        let range = plus.trim_start_matches('+');
        let mut parts = range.split(',');
        let Some(start) = parts.next().and_then(|v| v.parse::<u32>().ok()) else {
            continue;
        };
        let count = parts
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(1);
        let lines = changed.entry(path.clone()).or_insert_with(BTreeSet::new);
        lines.extend(start..start.saturating_add(count));
    }
    changed
}

fn untracked_files(root: &Path) -> Result<Vec<String>> {
    Ok(
        git_text(root, &["ls-files", "--others", "--exclude-standard"])?
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| line.replace('\\', "/"))
            .collect(),
    )
}

fn verify_git_ref(root: &Path, reference: &str) -> Result<()> {
    if reference.trim().is_empty() || reference.starts_with('-') {
        bail!("--base 需要合法的 Git ref");
    }
    git_text(root, &["rev-parse", "--verify", "--quiet", reference])?;
    Ok(())
}

fn git_blob(root: &Path, spec: &str) -> Result<Option<String>> {
    let output = Command::new("git")
        .current_dir(root)
        .args(["show", spec])
        .output()
        .with_context(|| format!("执行 git show {spec} 失败"))?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(String::from_utf8(output.stdout).ok())
}

fn git_text(root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .with_context(|| format!("执行 git {} 失败", args.join(" ")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git {} 失败: {}", args.join(" "), stderr.trim());
    }
    String::from_utf8(output.stdout).context("Git 输出不是有效 UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) {
        // Clear repository-local env vars exported by `git commit` so the
        // command targets this temp repo instead of the outer repository.
        let mut cmd = Command::new("git");
        for var in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ] {
            cmd.env_remove(var);
        }
        let status = cmd.current_dir(root).args(args).status().expect("run git");
        assert!(status.success(), "git {}", args.join(" "));
    }

    fn init_repo() -> tempfile::TempDir {
        let temp = tempfile::tempdir().unwrap();
        git(temp.path(), &["init", "--quiet"]);
        git(temp.path(), &["config", "user.name", "SaCode Test"]);
        git(temp.path(), &["config", "user.email", "test@example.com"]);
        temp
    }

    #[test]
    fn parses_added_hunk_lines() {
        let diff = "diff --git a/src/a.rs b/src/a.rs\n+++ b/src/a.rs\n@@ -1,2 +1,3 @@\n+one\n@@ -8,0 +10,2 @@\n+x\n+y\n";
        let parsed = parse_added_lines(diff);
        assert_eq!(
            parsed["src/a.rs"].iter().copied().collect::<Vec<_>>(),
            vec![1, 2, 3, 10, 11]
        );
    }

    #[test]
    fn worktree_includes_untracked_code_and_only_added_lines() {
        let temp = init_repo();
        std::fs::write(temp.path().join("app.rs"), "fn safe() {}\n").unwrap();
        git(temp.path(), &["add", "app.rs"]);
        git(temp.path(), &["commit", "--quiet", "-m", "initial"]);
        std::fs::write(
            temp.path().join("app.rs"),
            "fn safe() {}\nfn risky() { value.unwrap(); }\n",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("new.rs"),
            "fn new_risky() { other.unwrap(); }\n",
        )
        .unwrap();

        let input = collect_audit_diff(temp.path(), DiffScope::Worktree, 400).unwrap();
        assert_eq!(input.contents["app.rs"].lines().count(), 2);
        assert_eq!(input.changed_lines["app.rs"], BTreeSet::from([2]));
        assert_eq!(input.changed_lines["new.rs"], BTreeSet::from([1]));
        let findings = sacode_runtime::code_audit::scan_changed_lines(
            &input.contents,
            &input.changed_lines,
            50,
        );
        assert_eq!(findings.len(), 2);
        assert!(findings
            .iter()
            .all(|finding| finding.line == Some(1) || finding.line == Some(2)));
    }

    #[test]
    fn staged_scope_reads_index_not_later_worktree_content() {
        let temp = init_repo();
        std::fs::write(temp.path().join("app.rs"), "fn safe() {}\n").unwrap();
        git(temp.path(), &["add", "app.rs"]);
        git(temp.path(), &["commit", "--quiet", "-m", "initial"]);
        std::fs::write(
            temp.path().join("app.rs"),
            "fn safe() {}\nfn staged() { staged.unwrap(); }\n",
        )
        .unwrap();
        git(temp.path(), &["add", "app.rs"]);
        std::fs::write(
            temp.path().join("app.rs"),
            "fn safe() {}\nfn worktree() { later.unwrap(); }\n",
        )
        .unwrap();

        let input = collect_audit_diff(temp.path(), DiffScope::Staged, 400).unwrap();
        assert!(input.contents["app.rs"].contains("staged.unwrap"));
        assert!(!input.contents["app.rs"].contains("later.unwrap"));
        assert_eq!(input.changed_lines["app.rs"], BTreeSet::from([2]));
    }

    #[test]
    fn base_scope_reviews_committed_head_changes_only() {
        let temp = init_repo();
        std::fs::write(temp.path().join("app.rs"), "fn safe() {}\n").unwrap();
        git(temp.path(), &["add", "app.rs"]);
        git(temp.path(), &["commit", "--quiet", "-m", "initial"]);
        git(temp.path(), &["branch", "base"]);
        std::fs::write(
            temp.path().join("app.rs"),
            "fn safe() {}\nfn committed() { value.unwrap(); }\n",
        )
        .unwrap();
        git(temp.path(), &["add", "app.rs"]);
        git(temp.path(), &["commit", "--quiet", "-m", "change"]);
        std::fs::write(
            temp.path().join("app.rs"),
            "fn safe() {}\nfn dirty() { later.unwrap(); }\n",
        )
        .unwrap();

        let input = collect_audit_diff(temp.path(), DiffScope::Base("base".into()), 400).unwrap();
        assert!(input.contents["app.rs"].contains("value.unwrap"));
        assert!(!input.contents["app.rs"].contains("later.unwrap"));
        assert_eq!(input.changed_lines["app.rs"], BTreeSet::from([2]));
    }
}
