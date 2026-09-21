use super::App;
use sacode_runtime::ai_design::{
    apply_design_example, apply_design_variant, design_example, generate_design_variants,
    list_design_examples,
};

impl App {
    pub(super) fn design_command(&mut self, input: &str) {
        let args: Vec<String> = input
            .split_whitespace()
            .skip(1)
            .map(|v| v.to_string())
            .collect();
        let first = args.first().map(|s| s.as_str()).unwrap_or("list");
        match first {
            "show" => {
                let id = match args.get(1) {
                    Some(id) => id.as_str(),
                    None => {
                        self.push_error_message("用法: /design show <id>");
                        return;
                    }
                };
                match design_example(id) {
                    Some(ex) => self.push_system_message(&ex.render_brief("预览")),
                    None => self.push_error_message(&format!("未知示例 id: {id}")),
                }
            }
            "variants" => {
                let id = args.get(1).cloned().unwrap_or_default();
                if id.is_empty() {
                    self.push_error_message(
                        "用法: /design variants <id> [--project <name>] [--count N]",
                    );
                    return;
                }
                let project = extract_flag(&args, "--project");
                let count = extract_flag(&args, "--count")
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(3)
                    .clamp(1, 3);
                match block_on_variants(&self.workdir, &id, project.as_deref(), count) {
                    Ok(msg) => self.push_system_message(&msg),
                    Err(e) => self.push_error_message(&format!("生成变体失败: {e}")),
                }
            }
            "apply" => {
                let id = match args.get(1) {
                    Some(id) => id.clone(),
                    None => {
                        self.push_error_message("用法: /design apply <id> [variant]");
                        return;
                    }
                };
                // positional variant or --variant N
                let variant = args
                    .get(2)
                    .map(|s| s.as_str())
                    .filter(|s| !s.starts_with("--"))
                    .map(|s| s.to_string())
                    .or_else(|| extract_flag(&args, "--variant"));
                let project = extract_flag(&args, "--project");
                match apply_design_cli(&self.workdir, &id, variant.as_deref(), project.as_deref()) {
                    Ok(msg) => self.push_system_message(&msg),
                    Err(e) => self.push_error_message(&format!("apply 失败: {e}")),
                }
            }
            _ => {
                // list — no provider required
                let mut msg = String::from("AIDesign TD 示例:\n");
                for ex in list_design_examples() {
                    msg.push_str(&format!("  {}  {} — {}\n", ex.id, ex.title, ex.summary));
                }
                msg.push_str(
                    "\n用法: /design show <id> | variants <id> [--project <name>] [--count N] | apply <id> [variant]",
                );
                self.push_system_message(&msg);
            }
        }
    }
}

fn extract_flag(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
        .filter(|s| !s.starts_with("--"))
}

fn block_on_variants(
    root: &std::path::Path,
    id: &str,
    project: Option<&str>,
    count: usize,
) -> anyhow::Result<String> {
    let provider = sacode_runtime::code_audit::ensure_audit_provider(
        crate::provider_runtime::resolve_provider(root),
    );
    super::block_on_cli_future(generate_design_variants(
        root,
        id,
        project,
        provider.as_ref(),
        count,
    ))
}

fn apply_design_cli(
    root: &std::path::Path,
    id: &str,
    variant: Option<&str>,
    project: Option<&str>,
) -> anyhow::Result<String> {
    let dir = if let Some(v) = variant {
        apply_design_variant(root, id, v, project)?
    } else {
        apply_design_example(root, id, project)?
    };
    Ok(format!(
        "design applied: {}\n  brief: {}\n  prompt: {}",
        dir.display(),
        dir.join("brief.md").display(),
        dir.join("prompt.md").display()
    ))
}
