use super::{block_on_cli_future, App};
use crate::provider_runtime::resolve_provider;
use sacode_runtime::code_audit::{
    ensure_audit_provider, fix_prompt_from_report, load_report, run_audit, AuditScanOptions,
};

impl App {
    pub(super) fn audit_command(&mut self, input: &str) {
        let args: Vec<String> = input
            .split_whitespace()
            .skip(1)
            .map(|v| v.to_string())
            .collect();
        let first = args.first().map(|s| s.as_str()).unwrap_or("run");
        match first {
            "help" | "--help" | "-h" => {
                self.push_system_message(
                    "用法: /audit [run] | /audit fix <report.json|report.md>\n\
                     设置: /config 中 code_audit.ai 控制是否调用大模型（默认开启）\n\
                     CLI 对应: sacode audit [path] [--json|--ai|--no-ai]",
                );
            }
            "fix" => {
                let from = args.get(1).cloned().unwrap_or_default();
                if from.is_empty() {
                    self.push_error_message("用法: /audit fix <report.json>");
                    return;
                }
                match load_report(&std::path::PathBuf::from(&from)) {
                    Ok(report) => {
                        let prompt = fix_prompt_from_report(&report, 20);
                        self.input = prompt;
                        self.push_system_message(
                            "已根据审计报告填入修复 prompt，回车发送以启动 fix 任务。\n\
                             修复后可再次运行 /audit 对比报告。",
                        );
                    }
                    Err(e) => self.push_error_message(&format!("读取报告失败: {e}")),
                }
            }
            _ => self.run_audit_scan(),
        }
    }

    fn run_audit_scan(&mut self) {
        let root = self.workdir.clone();
        let mut opts = AuditScanOptions::default();
        // config code_audit.ai (default true); false → heuristic-only
        let ai_enabled = crate::cmd::config::effective_config(&root)
            .ok()
            .map(|c| code_audit_ai_enabled(&c))
            .unwrap_or(true);
        opts.use_ai = ai_enabled;
        if !ai_enabled {
            self.push_system_message("代码审计：code_audit.ai=false，仅运行启发式扫描。");
        }
        let provider = resolve_provider(&root);
        let provider = ensure_audit_provider(provider);
        if opts.use_ai && provider.is_none() {
            self.push_system_message(
                "无可用模型 provider，将仅运行启发式扫描（可用 /login 配置）。",
            );
        }
        match block_on_cli_future(run_audit(&root, &opts, provider.as_ref())) {
            Ok(outcome) => {
                let s = &outcome.report.summary;
                let mut msg = format!(
                    "代码审计完成: high={} medium={} low={} info={} ai={} (启发式={} AI发现={})\n",
                    s.high,
                    s.medium,
                    s.low,
                    s.info,
                    outcome.report.ai_used,
                    outcome.heuristic_count,
                    outcome.ai_count
                );
                for f in outcome.report.findings.iter().take(10) {
                    msg.push_str(&format!(
                        "  [{}] {} {}:{} {}\n",
                        f.severity.as_str(),
                        f.id,
                        f.file,
                        f.line.unwrap_or(0),
                        f.title
                    ));
                }
                if outcome.report.findings.len() > 10 {
                    msg.push_str(&format!(
                        "  ... 另有 {} 条\n",
                        outcome.report.findings.len() - 10
                    ));
                }
                if let Some(p) = &outcome.report_json_path {
                    msg.push_str(&format!("报告: {}\n", p.display()));
                    msg.push_str(&format!("修复: /audit fix {}", p.display()));
                }
                self.push_system_message(&msg);
            }
            Err(e) => self.push_error_message(&format!("代码审计失败: {e}")),
        }
    }
}

fn code_audit_ai_enabled(cfg: &crate::cmd::config::EffectiveConfig) -> bool {
    crate::cmd::config::current_raw_value(cfg, "code_audit.ai")
        .map(|v| v != "false")
        .unwrap_or(true)
}
