use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::Result;
use serde::{Deserialize, Serialize};

const USER_SACODE_DIR: &str = ".sacode";
const USER_AGENTS_FILE: &str = "AGENTS.md";
const USER_MEMORY_FILE: &str = "MEMORY.md";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodingInsight {
    pub task_types: Vec<String>,
    pub tech_stack: Vec<String>,
    pub common_issues: Vec<String>,
    pub help_patterns: Vec<String>,
    pub keywords: Vec<String>,
    pub code_styles: Vec<String>,
    pub error_handling: Vec<String>,
    pub generated_at: String,
    pub update_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairInstruction {
    pub title: String,
    pub target: String,
    pub reason: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightReport {
    pub stats: InsightStats,
    pub habits_summary: Vec<String>,
    pub insights: Vec<String>,
    pub optimizations: Vec<String>,
    pub repair_instructions: Vec<RepairInstruction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightStats {
    pub task_type_count: usize,
    pub tech_stack_count: usize,
    pub issue_count: usize,
    pub help_pattern_count: usize,
    pub keyword_count: usize,
    pub style_count: usize,
    pub error_pattern_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightArtifacts {
    pub insight: CodingInsight,
    pub report: InsightReport,
    pub generated_at: String,
    pub html_path: String,
    pub json_path: String,
    pub user_agents_path: String,
    pub user_memory_path: String,
    pub user_rules_path: String,
}

fn display_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "/")
}

pub struct InsightStore {
    root: PathBuf,
}

impl Default for InsightStore {
    fn default() -> Self {
        Self::new()
    }
}

impl InsightStore {
    pub fn new() -> Self {
        Self {
            root: user_sacode_dir(),
        }
    }

    pub fn insight_dir(&self) -> PathBuf {
        self.root.join("insight")
    }

    pub fn rules_dir(&self) -> PathBuf {
        self.root.join("rules")
    }

    pub fn json_path(&self) -> PathBuf {
        self.insight_dir().join("insights.json")
    }

    pub fn html_path(&self) -> PathBuf {
        self.insight_dir().join("report.html")
    }

    pub fn rules_path(&self) -> PathBuf {
        self.rules_dir().join("insight-rules.md")
    }

    pub fn agents_path(&self) -> PathBuf {
        self.root.join(USER_AGENTS_FILE)
    }

    pub fn memory_path(&self) -> PathBuf {
        self.root.join(USER_MEMORY_FILE)
    }

    pub fn ensure_layout(&self) -> Result<()> {
        fs::create_dir_all(self.insight_dir())?;
        fs::create_dir_all(self.rules_dir())?;

        ensure_file(
            &self.agents_path(),
            "# 用户级 AGENTS\n\n本文件用于记录跨项目长期生效的协作规则。\n",
        )?;
        ensure_file(
            &self.memory_path(),
            "# 用户级 MEMORY\n\n本文件用于记录跨项目长期生效的用户偏好和经验。\n",
        )?;
        ensure_file(
            &self.rules_path(),
            "# Insight Rules\n\n本文件记录由 /insight 生成的长期规则建议。\n",
        )?;

        Ok(())
    }

    pub fn load(&self) -> Result<Option<InsightArtifacts>> {
        let path = self.json_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(path)?;
        Ok(Some(serde_json::from_str(&content)?))
    }

    pub fn save(&self, artifacts: &InsightArtifacts) -> Result<()> {
        self.ensure_layout()?;
        fs::write(self.json_path(), serde_json::to_string_pretty(artifacts)?)?;
        fs::write(self.html_path(), render_html(artifacts))?;
        fs::write(self.rules_path(), render_rules_markdown(artifacts))?;
        Ok(())
    }
}

pub fn run() -> Result<()> {
    let workdir = env::current_dir()?;
    let messages = collect_messages_from_workspace(&workdir)?;
    if messages.is_empty() {
        println!("当前没有可分析的对话记录。请先在 TUI 或 REPL 中积累一些消息。");
        return Ok(());
    }

    let message_refs = messages
        .iter()
        .map(|(role, content)| (*role, content.as_str()))
        .collect::<Vec<_>>();
    let report = analyze_messages(&message_refs, &workdir)?;
    println!("{}", render_success_message(&report));
    Ok(())
}

pub fn render_insight(_workdir: &Path) -> Result<String> {
    let store = InsightStore::new();
    if let Some(artifacts) = store.load()? {
        Ok(render_success_message(&artifacts))
    } else {
        Ok("暂无 insight 网页报告。运行 /insight 或 sacode insight 生成用户级报告。".to_string())
    }
}

pub fn analyze_messages(messages: &[(&str, &str)], _workdir: &Path) -> Result<InsightArtifacts> {
    let store = InsightStore::new();
    store.ensure_layout()?;

    let mut insight = store
        .load()?
        .map(|artifacts| artifacts.insight)
        .unwrap_or_else(empty_insight);

    insight.update_count += 1;
    insight.generated_at = now_text();

    for (role, content) in messages {
        let content_lower = content.to_lowercase();

        detect_task_type(&content_lower, &mut insight.task_types);
        detect_tech_stack(&content_lower, &mut insight.tech_stack);
        detect_issues(&content_lower, &mut insight.common_issues);
        detect_help_patterns(role, &content_lower, &mut insight.help_patterns);
        detect_code_styles(&content_lower, &mut insight.code_styles);
        detect_error_handling(&content_lower, &mut insight.error_handling);
        extract_keywords(&content_lower, &mut insight.keywords);
    }

    normalize_insight(&mut insight);

    let report = build_report(&insight, &store);
    let artifacts = InsightArtifacts {
        generated_at: insight.generated_at.clone(),
        html_path: display_path(&store.html_path()),
        json_path: display_path(&store.json_path()),
        user_agents_path: display_path(&store.agents_path()),
        user_memory_path: display_path(&store.memory_path()),
        user_rules_path: display_path(&store.rules_path()),
        insight,
        report,
    };

    store.save(&artifacts)?;
    let _ = open_in_browser(Path::new(&artifacts.html_path));

    Ok(artifacts)
}

fn empty_insight() -> CodingInsight {
    CodingInsight {
        task_types: Vec::new(),
        tech_stack: Vec::new(),
        common_issues: Vec::new(),
        help_patterns: Vec::new(),
        keywords: Vec::new(),
        code_styles: Vec::new(),
        error_handling: Vec::new(),
        generated_at: now_text(),
        update_count: 0,
    }
}

fn now_text() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn normalize_insight(insight: &mut CodingInsight) {
    dedup_and_sort(&mut insight.task_types);
    dedup_and_sort(&mut insight.tech_stack);
    dedup_and_sort(&mut insight.common_issues);
    dedup_and_sort(&mut insight.help_patterns);
    dedup_and_sort(&mut insight.keywords);
    dedup_and_sort(&mut insight.code_styles);
    dedup_and_sort(&mut insight.error_handling);

    insight.task_types.truncate(10);
    insight.tech_stack.truncate(10);
    insight.common_issues.truncate(8);
    insight.help_patterns.truncate(8);
    insight.keywords.truncate(15);
    insight.code_styles.truncate(6);
    insight.error_handling.truncate(6);
}

fn build_report(insight: &CodingInsight, store: &InsightStore) -> InsightReport {
    let habits_summary = build_habits_summary(insight);
    let insights = build_insights(insight);
    let optimizations = build_optimizations(insight);
    let repair_instructions = build_repair_instructions(insight, store);

    InsightReport {
        stats: InsightStats {
            task_type_count: insight.task_types.len(),
            tech_stack_count: insight.tech_stack.len(),
            issue_count: insight.common_issues.len(),
            help_pattern_count: insight.help_patterns.len(),
            keyword_count: insight.keywords.len(),
            style_count: insight.code_styles.len(),
            error_pattern_count: insight.error_handling.len(),
        },
        habits_summary,
        insights,
        optimizations,
        repair_instructions,
    }
}

fn build_habits_summary(insight: &CodingInsight) -> Vec<String> {
    let mut items = Vec::new();

    if !insight.task_types.is_empty() {
        items.push(format!(
            "高频任务集中在：{}",
            insight
                .task_types
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if !insight.tech_stack.is_empty() {
        items.push(format!(
            "常接触技术栈：{}",
            insight
                .tech_stack
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if !insight.code_styles.is_empty() {
        items.push(format!(
            "偏好的实现风格：{}",
            insight.code_styles.join("、")
        ));
    }
    if !insight.error_handling.is_empty() {
        items.push(format!(
            "常讨论的稳定性模式：{}",
            insight.error_handling.join("、")
        ));
    }

    if items.is_empty() {
        items.push("当前对话样本较少，建议继续积累对话后再次生成。".to_string());
    }

    items
}

fn build_insights(insight: &CodingInsight) -> Vec<String> {
    let mut items = Vec::new();

    if !insight.common_issues.is_empty() {
        items.push(format!(
            "近期问题聚焦在：{}",
            insight.common_issues.join("、")
        ));
    }
    if !insight.help_patterns.is_empty() {
        items.push(format!(
            "你更容易从这些帮助形式中获得收益：{}",
            insight.help_patterns.join("、")
        ));
    }
    if !insight.keywords.is_empty() {
        items.push(format!(
            "高频话题词包括：{}",
            insight
                .keywords
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if insight.update_count > 1 {
        items.push(format!(
            "这份洞察已经累计更新 {} 次，适合作为长期用户级偏好来源。",
            insight.update_count
        ));
    }

    if items.is_empty() {
        items.push("当前样本还不足以提炼稳定洞察。".to_string());
    }

    items
}

fn build_optimizations(insight: &CodingInsight) -> Vec<String> {
    let mut items = Vec::new();

    if insight
        .help_patterns
        .iter()
        .any(|item| item == "提供代码示例")
    {
        items.push("在后续协作里优先给出可运行示例，减少纯概念解释占比。".to_string());
    }
    if insight.code_styles.iter().any(|item| item == "简洁代码")
        || insight.code_styles.iter().any(|item| item == "模块化")
    {
        items.push("把规则写入用户级 AGENTS，持续推动最小改动和清晰职责边界。".to_string());
    }
    if insight
        .common_issues
        .iter()
        .any(|item| item.contains("编译"))
        || insight
            .common_issues
            .iter()
            .any(|item| item.contains("依赖"))
    {
        items.push("为常见编译和依赖问题补充用户级排查清单，降低后续项目重复试错。".to_string());
    }
    if insight
        .error_handling
        .iter()
        .any(|item| item.contains("日志"))
    {
        items.push("把日志、校验、重试等稳定性要求写入用户级规则，提升默认实现质量。".to_string());
    }

    if items.is_empty() {
        items.push("建议把稳定偏好沉淀为用户级规则，逐步减少每个项目中的重复说明。".to_string());
    }

    items
}

fn build_repair_instructions(
    insight: &CodingInsight,
    store: &InsightStore,
) -> Vec<RepairInstruction> {
    let mut items = Vec::new();

    let agents_rules = build_agents_rules(insight);
    if !agents_rules.is_empty() {
        items.push(RepairInstruction {
            title: "补充用户级 AGENTS 协作规则".to_string(),
            target: store.agents_path().display().to_string(),
            reason: "把长期协作习惯写入用户级 AGENTS，后续所有项目都能直接继承。".to_string(),
            content: format!(
                "## Insight Rules\n{}",
                agents_rules
                    .iter()
                    .map(|line| format!("- {}", line))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        });
    }

    let memory_items = build_memory_items(insight);
    if !memory_items.is_empty() {
        items.push(RepairInstruction {
            title: "补充用户级 MEMORY 偏好记忆".to_string(),
            target: store.memory_path().display().to_string(),
            reason: "把长期偏好写入用户级记忆，后续项目会在进入仓库时持续参考。".to_string(),
            content: format!(
                "[Insight 偏好摘要]\n- Date: {}\n- Context: 由 /insight 用户级网页报告生成\n- Instructions:\n{}",
                now_text().split(' ').next().unwrap_or(""),
                memory_items
                    .iter()
                    .map(|line| format!("  - {}", line))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        });
    }

    let rule_items = build_rule_items(insight);
    if !rule_items.is_empty() {
        items.push(RepairInstruction {
            title: "补充用户级规则文件".to_string(),
            target: store.rules_path().display().to_string(),
            reason: "把常见失误和推荐动作收敛到规则文件，便于项目级持续规避。".to_string(),
            content: format!(
                "# Insight Generated Rules\n\n{}",
                rule_items
                    .iter()
                    .map(|line| format!("- {}", line))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        });
    }

    items
}

fn build_agents_rules(insight: &CodingInsight) -> Vec<String> {
    let mut rules = Vec::new();

    if insight.code_styles.iter().any(|item| item == "简洁代码") {
        rules.push("优先使用最小正确改动，保持实现集中，减少额外抽象。".to_string());
    }
    if insight
        .help_patterns
        .iter()
        .any(|item| item == "给出操作步骤")
    {
        rules.push("复杂任务先给出紧凑步骤，再落地代码和验证。".to_string());
    }
    if insight
        .help_patterns
        .iter()
        .any(|item| item == "提供代码示例")
    {
        rules.push("涉及实现建议时优先提供直接可用的代码和命令。".to_string());
    }
    if insight.error_handling.iter().any(|item| item == "数据校验") {
        rules.push("新增逻辑时优先补齐输入校验和错误分支。".to_string());
    }

    rules
}

fn build_memory_items(insight: &CodingInsight) -> Vec<String> {
    let mut items = Vec::new();

    if !insight.tech_stack.is_empty() {
        items.push(format!(
            "长期关注的技术栈包括：{}",
            insight
                .tech_stack
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if !insight.task_types.is_empty() {
        items.push(format!(
            "常见任务类型包括：{}",
            insight
                .task_types
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if !insight.common_issues.is_empty() {
        items.push(format!(
            "常见问题包括：{}",
            insight
                .common_issues
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }

    items
}

fn build_rule_items(insight: &CodingInsight) -> Vec<String> {
    let mut items = Vec::new();

    if insight
        .common_issues
        .iter()
        .any(|item| item.contains("性能"))
    {
        items.push(
            "遇到性能相关任务时，先定位热点，再进行最小范围优化，并保留验证结果。".to_string(),
        );
    }
    if insight
        .common_issues
        .iter()
        .any(|item| item.contains("编译"))
    {
        items.push("涉及代码修改后优先运行编译验证，尽早暴露类型和依赖问题。".to_string());
    }
    if insight
        .common_issues
        .iter()
        .any(|item| item.contains("安全"))
    {
        items.push("处理输入、认证和外部依赖时优先检查校验、权限和敏感信息暴露。".to_string());
    }
    if insight.error_handling.iter().any(|item| item == "日志记录") {
        items.push("关键流程保留必要日志和失败上下文，方便后续排障。".to_string());
    }

    items
}

fn collect_messages_from_workspace(workdir: &Path) -> Result<Vec<(&'static str, String)>> {
    let session_dir = workdir.join(".sacode").join("sessions");
    if !session_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = fs::read_dir(session_dir)?
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());

    let mut messages = Vec::new();
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(items) = value.get("messages").and_then(|value| value.as_array()) else {
            continue;
        };

        for item in items {
            let role = item
                .get("role")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let content = item
                .get("content")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let normalized = match role {
                "User" | "user" => Some("user"),
                "Assistant" | "assistant" => Some("assistant"),
                _ => None,
            };
            if let Some(role) = normalized {
                messages.push((role, content.to_string()));
            }
        }
    }

    Ok(messages)
}

fn ensure_file(path: &Path, default_content: &str) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, default_content)?;
    Ok(())
}

fn user_sacode_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(USER_SACODE_DIR)
}

fn open_in_browser(path: &Path) -> Result<()> {
    let absolute = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let target = format!(
        "file:///{}",
        absolute.display().to_string().replace('\\', "/")
    );

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&target).spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &target])
            .spawn()?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Command::new("xdg-open").arg(&target).spawn()?;
        Ok(())
    }
}

pub fn render_success_message(artifacts: &InsightArtifacts) -> String {
    format!(
        "Insight 网页报告已生成并尝试自动打开。\nHTML: {}\nJSON: {}\n用户级 AGENTS: {}\n用户级 MEMORY: {}\n用户级规则: {}\n可在网页中复制修复指令后写入对应文件。",
        artifacts.html_path,
        artifacts.json_path,
        artifacts.user_agents_path,
        artifacts.user_memory_path,
        artifacts.user_rules_path,
    )
}

fn render_rules_markdown(artifacts: &InsightArtifacts) -> String {
    let mut lines = vec![
        "# Insight Rules".to_string(),
        format!("生成时间: {}", artifacts.generated_at),
        "".to_string(),
        "## 优化项".to_string(),
    ];

    for item in &artifacts.report.optimizations {
        lines.push(format!("- {}", item));
    }

    lines.push("".to_string());
    lines.push("## 修复指令".to_string());
    for item in &artifacts.report.repair_instructions {
        lines.push(format!("### {}", item.title));
        lines.push(format!("目标文件: {}", item.target));
        lines.push(format!("原因: {}", item.reason));
        lines.push("```md".to_string());
        lines.push(item.content.clone());
        lines.push("```".to_string());
        lines.push("".to_string());
    }

    lines.join("\n")
}

fn render_html(artifacts: &InsightArtifacts) -> String {
    let stats = &artifacts.report.stats;
    let habits = render_html_list(&artifacts.report.habits_summary);
    let insights = render_html_list(&artifacts.report.insights);
    let optimizations = render_html_list(&artifacts.report.optimizations);
    let repairs = artifacts
        .report
        .repair_instructions
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let code_id = format!("repair-{}", index + 1);
            format!(
                "<section class=\"repair\"><h3>{}</h3><p class=\"meta\">目标文件：<code>{}</code></p><p>{}</p><button onclick=\"copyBlock('{}')\">复制修复指令</button><pre id=\"{}\"><code>{}</code></pre></section>",
                escape_html(&item.title),
                escape_html(&item.target),
                escape_html(&item.reason),
                code_id,
                code_id,
                escape_html(&item.content),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "<!DOCTYPE html>
<html lang=\"zh-CN\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>SaCode Insight Report</title>
  <style>
    :root {{ color-scheme: dark; }}
    body {{ margin: 0; font-family: Inter, Arial, sans-serif; background: #0b1020; color: #e8edf7; }}
    .wrap {{ max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }}
    h1, h2, h3 {{ margin: 0 0 12px; }}
    h1 {{ font-size: 32px; }}
    .sub {{ color: #98a2b3; margin-bottom: 24px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0 28px; }}
    .card {{ background: #11182d; border: 1px solid #233056; border-radius: 16px; padding: 16px; }}
    .card strong {{ display: block; font-size: 28px; color: #7cc4ff; }}
    section {{ background: #11182d; border: 1px solid #233056; border-radius: 16px; padding: 20px; margin-top: 16px; }}
    ul {{ margin: 0; padding-left: 20px; }}
    li {{ margin: 8px 0; }}
    .repair {{ margin-top: 16px; }}
    .meta {{ color: #98a2b3; }}
    button {{ background: #2f6feb; color: white; border: 0; border-radius: 10px; padding: 10px 14px; cursor: pointer; margin: 12px 0; }}
    pre {{ overflow-x: auto; background: #0b1020; border: 1px solid #233056; border-radius: 12px; padding: 14px; white-space: pre-wrap; }}
    code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
  </style>
</head>
<body>
  <div class=\"wrap\">
    <h1>SaCode Insight Report</h1>
    <p class=\"sub\">生成时间：{} | 更新次数：{} | 用户级路径：<code>{}</code></p>
    <div class=\"grid\">
      <div class=\"card\"><span>任务类型</span><strong>{}</strong></div>
      <div class=\"card\"><span>技术栈</span><strong>{}</strong></div>
      <div class=\"card\"><span>常见问题</span><strong>{}</strong></div>
      <div class=\"card\"><span>帮助模式</span><strong>{}</strong></div>
      <div class=\"card\"><span>代码风格</span><strong>{}</strong></div>
      <div class=\"card\"><span>错误处理</span><strong>{}</strong></div>
    </div>
    <section><h2>习惯说明</h2>{}</section>
    <section><h2>洞察结果</h2>{}</section>
    <section><h2>优化项</h2>{}</section>
    <section><h2>修复指令</h2>{}</section>
  </div>
  <script>
    async function copyBlock(id) {{
      const text = document.getElementById(id).innerText;
      await navigator.clipboard.writeText(text);
    }}
  </script>
</body>
</html>",
        escape_html(&artifacts.generated_at),
        artifacts.insight.update_count,
        escape_html(&user_sacode_dir().display().to_string()),
        stats.task_type_count,
        stats.tech_stack_count,
        stats.issue_count,
        stats.help_pattern_count,
        stats.style_count,
        stats.error_pattern_count,
        habits,
        insights,
        optimizations,
        repairs,
    )
}

fn render_html_list(items: &[String]) -> String {
    let rendered = items
        .iter()
        .map(|item| format!("<li>{}</li>", escape_html(item)))
        .collect::<Vec<_>>()
        .join("\n");
    format!("<ul>{}</ul>", rendered)
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn detect_task_type(content: &str, task_types: &mut Vec<String>) {
    let patterns = [
        ("重构", "代码重构"),
        ("refactor", "代码重构"),
        ("优化", "性能优化"),
        ("optimize", "性能优化"),
        ("performance", "性能优化"),
        ("修复", "Bug修复"),
        ("fix", "Bug修复"),
        ("bug", "Bug修复"),
        ("错误", "Bug修复"),
        ("添加", "新功能开发"),
        ("add", "新功能开发"),
        ("实现", "新功能开发"),
        ("implement", "新功能开发"),
        ("测试", "编写测试"),
        ("test", "编写测试"),
        ("unit", "编写测试"),
        ("文档", "编写文档"),
        ("doc", "编写文档"),
        ("document", "编写文档"),
        ("分析", "代码分析"),
        ("analyze", "代码分析"),
        ("review", "代码审查"),
        ("审查", "代码审查"),
        ("部署", "部署配置"),
        ("deploy", "部署配置"),
        ("配置", "配置管理"),
        ("config", "配置管理"),
        ("setup", "配置管理"),
        ("调试", "问题调试"),
        ("debug", "问题调试"),
        ("查询", "信息查询"),
        ("search", "信息查询"),
        ("find", "信息查询"),
        ("解释", "概念解释"),
        ("explain", "概念解释"),
        ("什么是", "概念解释"),
        ("如何", "方法询问"),
        ("how to", "方法询问"),
        ("how do", "方法询问"),
    ];

    for (keyword, task_type) in patterns {
        if content.contains(keyword) {
            task_types.push(task_type.to_string());
        }
    }
}

fn detect_tech_stack(content: &str, tech_stack: &mut Vec<String>) {
    let patterns = [
        ("rust", "Rust"),
        ("cargo", "Rust"),
        ("typescript", "TypeScript"),
        ("javascript", "JavaScript"),
        ("node", "Node.js"),
        ("npm", "Node.js"),
        ("python", "Python"),
        ("java", "Java"),
        ("spring", "Java"),
        ("go", "Go"),
        ("golang", "Go"),
        ("c++", "C++"),
        ("ruby", "Ruby"),
        ("rails", "Ruby"),
        ("php", "PHP"),
        ("laravel", "PHP"),
        ("vue", "Vue"),
        ("react", "React"),
        ("angular", "Angular"),
        ("html", "HTML"),
        ("css", "CSS"),
        ("sql", "SQL"),
        ("postgres", "PostgreSQL"),
        ("mysql", "MySQL"),
        ("mongodb", "MongoDB"),
        ("redis", "Redis"),
        ("docker", "Docker"),
        ("kubernetes", "Kubernetes"),
        ("git", "Git"),
        ("linux", "Linux"),
        ("shell", "Shell"),
        ("bash", "Shell"),
        ("api", "API"),
        ("graphql", "GraphQL"),
        ("grpc", "gRPC"),
        ("web", "Web开发"),
        ("frontend", "前端开发"),
        ("backend", "后端开发"),
        ("async", "异步编程"),
        ("test", "测试"),
        ("ci", "CI/CD"),
    ];

    for (keyword, tech) in patterns {
        if content.contains(keyword) {
            tech_stack.push(tech.to_string());
        }
    }
}

fn detect_issues(content: &str, issues: &mut Vec<String>) {
    let patterns = [
        ("type error", "类型错误"),
        ("类型错误", "类型错误"),
        ("null", "空值处理"),
        ("undefined", "未定义"),
        ("memory leak", "内存泄漏"),
        ("overflow", "溢出"),
        ("越界", "索引越界"),
        ("permission", "权限问题"),
        ("timeout", "超时"),
        ("network", "网络问题"),
        ("deadlock", "死锁"),
        ("performance", "性能问题"),
        ("慢", "性能问题"),
        ("compile", "编译错误"),
        ("构建失败", "构建错误"),
        ("dependency", "依赖问题"),
        ("conflict", "冲突"),
        ("deprecated", "废弃API"),
        ("security", "安全问题"),
        ("漏洞", "安全漏洞"),
    ];

    for (keyword, issue) in patterns {
        if content.contains(keyword) {
            issues.push(issue.to_string());
        }
    }
}

fn detect_help_patterns(role: &str, content: &str, patterns: &mut Vec<String>) {
    if role == "assistant" {
        if content.contains("示例") || content.contains("example") {
            patterns.push("提供代码示例".to_string());
        }
        if content.contains("解释") || content.contains("explain") || content.contains("原理") {
            patterns.push("解释概念原理".to_string());
        }
        if content.contains("建议") || content.contains("recommend") || content.contains("最佳")
        {
            patterns.push("提供最佳实践建议".to_string());
        }
        if content.contains("步骤") || content.contains("step") {
            patterns.push("给出操作步骤".to_string());
        }
        if content.contains("修复") || content.contains("fix") || content.contains("解决") {
            patterns.push("提供修复方案".to_string());
        }
        if content.contains("优化") || content.contains("optimize") || content.contains("改进")
        {
            patterns.push("提供优化建议".to_string());
        }
    }
}

fn extract_keywords(content: &str, keywords: &mut Vec<String>) {
    let stop_words = [
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
        "do", "does", "did", "will", "would", "shall", "should", "can", "could", "may", "might",
        "must", "need", "to", "of", "in", "for", "on", "with", "at", "by", "from", "up", "about",
        "into", "over", "after", "before", "between", "under", "again", "then", "once", "here",
        "there", "when", "where", "why", "how", "all", "each", "few", "more", "most", "other",
        "some", "such", "only", "own", "same", "so", "than", "too", "very", "just", "and", "but",
        "if", "or", "because", "as", "until", "while", "的", "是", "在", "有", "和", "与", "或",
        "但", "如果", "因为", "所以", "这", "那", "它", "我", "你", "他", "她", "我们", "他们",
        "什么", "怎么", "如何", "一个", "这个", "那个", "可以", "需要", "应该", "可能", "请",
        "谢谢",
    ];

    for word in content.split_whitespace().take(50) {
        let lowered = word.to_lowercase();
        if lowered.len() > 2 && !stop_words.contains(&lowered.as_str()) {
            keywords.push(word.to_string());
        }
    }
}

fn detect_code_styles(content: &str, code_styles: &mut Vec<String>) {
    let patterns = [
        ("functional", "函数式编程"),
        ("oop", "面向对象"),
        ("class", "面向对象"),
        ("async", "异步编程"),
        ("reactive", "响应式编程"),
        ("immutable", "不可变数据"),
        ("mutable", "可变数据"),
        ("typed", "类型系统"),
        ("strict", "严格模式"),
        ("clean code", "简洁代码"),
        ("简洁", "简洁代码"),
        ("readable", "可读性"),
        ("模块化", "模块化"),
        ("component", "组件化"),
        ("test driven", "测试驱动"),
        ("tdd", "测试驱动"),
    ];

    for (keyword, style) in patterns {
        if content.contains(keyword) {
            code_styles.push(style.to_string());
        }
    }
}

fn detect_error_handling(content: &str, error_handling: &mut Vec<String>) {
    let patterns = [
        ("try catch", "Try-Catch 模式"),
        ("exception", "异常捕获"),
        ("throw", "异常抛出"),
        ("error handling", "错误处理"),
        ("result", "Result 类型"),
        ("option", "Option 类型"),
        ("fallback", "兜底方案"),
        ("retry", "重试机制"),
        ("timeout", "超时处理"),
        ("graceful", "优雅降级"),
        ("log", "日志记录"),
        ("debug", "调试日志"),
        ("trace", "追踪日志"),
        ("assert", "断言检查"),
        ("validate", "数据校验"),
        ("校验", "数据校验"),
    ];

    for (keyword, pattern) in patterns {
        if content.contains(keyword) {
            error_handling.push(pattern.to_string());
        }
    }
}

fn dedup_and_sort(list: &mut Vec<String>) {
    list.sort();
    list.dedup();
}

pub fn insight_instruction(_workdir: &Path) -> Option<String> {
    let store = InsightStore::new();
    let artifacts = store.load().ok().flatten()?;

    let mut parts = Vec::new();
    if !artifacts.insight.tech_stack.is_empty() {
        parts.push(format!(
            "常见技术栈: {}",
            artifacts
                .insight
                .tech_stack
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !artifacts.insight.task_types.is_empty() {
        parts.push(format!(
            "常见任务: {}",
            artifacts
                .insight
                .task_types
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !artifacts.insight.code_styles.is_empty() {
        parts.push(format!(
            "代码风格偏好: {}",
            artifacts
                .insight
                .code_styles
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !artifacts.report.optimizations.is_empty() {
        parts.push(format!(
            "长期优化项: {}",
            artifacts
                .report
                .optimizations
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("；")
        ));
    }

    let user_guidance = read_user_guidance(&store);
    if let Some(guidance) = user_guidance {
        parts.push(format!("用户级规则与记忆:\n{}", guidance));
    }

    if parts.is_empty() {
        return None;
    }

    Some(format!(
        "用户级 insight 洞察：\n{}\n请在后续所有项目中参考这些长期规则和偏好。",
        parts.join("\n")
    ))
}

fn read_user_guidance(store: &InsightStore) -> Option<String> {
    let mut parts = Vec::new();

    for (label, path) in [
        ("AGENTS", store.agents_path()),
        ("MEMORY", store.memory_path()),
        ("RULES", store.rules_path()),
    ] {
        let content = fs::read_to_string(path).ok()?;
        let trimmed = content.trim();
        if trimmed.is_empty() {
            continue;
        }
        let clipped = trimmed.chars().take(1200).collect::<String>();
        parts.push(format!("[{}]\n{}", label, clipped));
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}
