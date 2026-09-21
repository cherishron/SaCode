//! CLI: `sacode design` — TD 示例库 + AI 设计变体。

use anyhow::Result;
use std::future::Future;
use std::path::{Path, PathBuf};

use sacode_kernel::model::ModelProvider;
use sacode_runtime::ai_design::{
    apply_design_example_out, apply_design_variant_out, generate_design_variants,
    list_design_examples,
};

pub fn run(sub_args: Vec<String>) -> Result<()> {
    let first = sub_args.first().map(|s| s.as_str()).unwrap_or("list");
    match first {
        "list" => {
            for ex in list_design_examples() {
                println!("{}  {}\n    {}", ex.id, ex.title, ex.summary);
            }
            println!(
                "\nApply   : sacode design apply <id> [--variant N] [--project <name>] [--out <dir>]"
            );
            println!("Variants: sacode design variants <id> [--project <name>] [--count N]");
            Ok(())
        }
        "show" => {
            let id = sub_args
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("design show <id>"))?;
            let ex = sacode_runtime::ai_design::design_example(id)
                .ok_or_else(|| anyhow::anyhow!("unknown id {id}"))?;
            println!("{}", ex.render_brief("预览"));
            Ok(())
        }
        "variants" => {
            let (id, project, count) = parse_variants_args(&sub_args);
            if id.is_empty() {
                anyhow::bail!("用法: sacode design variants <id> [--project <name>] [--count N]");
            }
            let root = PathBuf::from(".");
            let provider = current_model_provider(&root);
            let summary = block_on_design(generate_design_variants(
                &root,
                &id,
                project.as_deref(),
                provider.as_ref(),
                count,
            ))?;
            println!("{summary}");
            Ok(())
        }
        "apply" => {
            let (id, variant, project, out) = parse_apply_args(&sub_args);
            if id.is_empty() {
                anyhow::bail!(
                    "用法: sacode design apply <id> [--variant N] [--project <name>] [--out <dir>]"
                );
            }
            let root = PathBuf::from(".");
            let out_ref = out.as_deref().map(Path::new);
            let dir = match variant.as_deref() {
                Some(v) => apply_design_variant_out(&root, &id, v, project.as_deref(), out_ref)?,
                None => apply_design_example_out(&root, &id, project.as_deref(), out_ref)?,
            };
            println!("design applied: {}", dir.display());
            println!("  brief : {}", dir.join("brief.md").display());
            println!("  prompt: {}", dir.join("prompt.md").display());
            println!(
                "Next: sacode \"$(cat {})\"",
                dir.join("prompt.md").display()
            );
            Ok(())
        }
        _ => {
            println!(
                "sacode design [list|show <id>|variants <id> [--project <name>] [--count N]|apply <id> [--variant N] [--project <name>] [--out <dir>]]"
            );
            Ok(())
        }
    }
}

/// Parse `variants <id> [--project <name>] [--count N]`.
/// Returns `(id, project, count)`; count defaults to 3 and is clamped 1–3 later in runtime.
pub(crate) fn parse_variants_args(args: &[String]) -> (String, Option<String>, usize) {
    let id = args.get(1).cloned().unwrap_or_default();
    let mut project = None;
    let mut count = 3usize;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--project" => {
                i += 1;
                project = args.get(i).cloned().filter(|s| !s.starts_with("--"));
            }
            "--count" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    if let Ok(n) = v.parse::<usize>() {
                        count = n.clamp(1, 3);
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    (id, project, count)
}

/// Parse `apply <id> [--variant N] [--project <name>] [--out <dir>]`.
/// Returns `(id, variant, project, out)`.
pub(crate) fn parse_apply_args(
    args: &[String],
) -> (String, Option<String>, Option<String>, Option<String>) {
    let id = args.get(1).cloned().unwrap_or_default();
    let mut variant = None;
    let mut project = None;
    let mut out = None;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--variant" => {
                i += 1;
                variant = args.get(i).cloned().filter(|s| !s.starts_with("--"));
            }
            "--project" => {
                i += 1;
                project = args.get(i).cloned().filter(|s| !s.starts_with("--"));
            }
            "--out" => {
                i += 1;
                out = args.get(i).cloned().filter(|s| !s.starts_with("--"));
            }
            // positional variant: apply <id> [variant]
            other if !other.starts_with("--") && variant.is_none() => {
                variant = Some(other.to_string());
            }
            _ => {}
        }
        i += 1;
    }
    (id, variant, project, out)
}

fn current_model_provider(root: &Path) -> Option<ModelProvider> {
    use crate::provider_runtime::resolve_provider;
    sacode_runtime::code_audit::ensure_audit_provider(resolve_provider(root))
}

fn block_on_design<F, T>(future: F) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        tokio::task::block_in_place(|| handle.block_on(future))
    } else {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(future)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_runtime::ai_design::list_design_examples;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn list_has_five_examples() {
        let list = list_design_examples();
        assert_eq!(list.len(), 5, "expected 5 built-in TD examples");
        let ids: Vec<&str> = list.iter().map(|e| e.id).collect();
        for id in [
            "td-dashboard",
            "td-list-table",
            "td-form-settings",
            "td-landing",
            "td-empty",
        ] {
            assert!(ids.contains(&id), "missing example {id}");
        }
    }

    #[test]
    fn parse_variants_args_defaults() {
        let (id, project, count) = parse_variants_args(&args(&["variants", "td-dashboard"]));
        assert_eq!(id, "td-dashboard");
        assert!(project.is_none());
        assert_eq!(count, 3);

        let (id, project, count) = parse_variants_args(&args(&[
            "variants",
            "td-landing",
            "--project",
            "MyApp",
            "--count",
            "2",
        ]));
        assert_eq!(id, "td-landing");
        assert_eq!(project.as_deref(), Some("MyApp"));
        assert_eq!(count, 2);

        let (_, _, count) = parse_variants_args(&args(&["variants", "td-empty", "--count", "99"]));
        assert_eq!(count, 3, "clamped to max 3");
    }

    #[test]
    fn parse_apply_args_variant_and_project() {
        let (id, variant, project, out) = parse_apply_args(&args(&["apply", "td-dashboard"]));
        assert_eq!(id, "td-dashboard");
        assert!(variant.is_none());
        assert!(project.is_none());
        assert!(out.is_none());

        let (id, variant, project, out) = parse_apply_args(&args(&[
            "apply",
            "td-dashboard",
            "--variant",
            "2",
            "--project",
            "X",
            "--out",
            "custom/design",
        ]));
        assert_eq!(id, "td-dashboard");
        assert_eq!(variant.as_deref(), Some("2"));
        assert_eq!(project.as_deref(), Some("X"));
        assert_eq!(out.as_deref(), Some("custom/design"));

        let (_, variant, _, _) = parse_apply_args(&args(&["apply", "td-landing", "variant-1"]));
        assert_eq!(variant.as_deref(), Some("variant-1"));
    }

    #[test]
    fn apply_cli_writes_brief_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = apply_design_example_out(tmp.path(), "td-empty", Some("Demo"), None).unwrap();
        assert!(dir.join("brief.md").is_file());
        assert!(dir.join("prompt.md").is_file());
        let brief = std::fs::read_to_string(dir.join("brief.md")).unwrap();
        assert!(brief.contains("td-empty") || brief.contains("空状态"));

        let out_root = tmp.path().join("custom-out");
        let dir2 = apply_design_example_out(tmp.path(), "td-empty", Some("Demo"), Some(&out_root))
            .unwrap();
        assert_eq!(dir2, out_root.join("td-empty"));
        assert!(dir2.join("prompt.md").is_file());
    }
}
