use std::path::{Component, Path, PathBuf};

use crate::ProjectAccessConfigStore;

pub fn resolve_allowed_path(path: &str) -> anyhow::Result<PathBuf> {
    let workspace_root = std::env::current_dir()?.canonicalize()?;
    let requested_path = PathBuf::from(path);
    let joined_path = if requested_path.is_absolute() {
        requested_path
    } else {
        workspace_root.join(requested_path)
    };

    let normalized = normalize_path(&joined_path)?;
    let canonical = canonicalize_existing_prefix(&normalized)?;

    if is_allowed(&canonical, &workspace_root)? {
        Ok(canonical)
    } else {
        anyhow::bail!("path is outside workspace")
    }
}

fn is_allowed_with_store(path: &Path, workspace_root: &Path, store: &ProjectAccessConfigStore) -> anyhow::Result<bool> {
    if path.starts_with(workspace_root) {
        return Ok(true);
    }

    for allowed in store.allowed_dirs()? {
        if path.starts_with(&allowed) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn is_allowed(path: &Path, workspace_root: &Path) -> anyhow::Result<bool> {
    let store = ProjectAccessConfigStore::new(&workspace_root);
    is_allowed_with_store(path, workspace_root, &store)
}

fn normalize_path(path: &Path) -> anyhow::Result<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    anyhow::bail!("path is outside workspace");
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}

fn canonicalize_existing_prefix(path: &Path) -> anyhow::Result<PathBuf> {
    let mut existing = path;
    let mut missing = Vec::new();

    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            anyhow::bail!("path is outside workspace");
        };
        missing.push(name.to_os_string());
        let Some(parent) = existing.parent() else {
            anyhow::bail!("path is outside workspace");
        };
        existing = parent;
    }

    let mut canonical = existing.canonicalize()?;
    for segment in missing.iter().rev() {
        canonical.push(segment);
    }
    Ok(canonical)
}
