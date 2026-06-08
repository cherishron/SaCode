use std::path::PathBuf;

use anyhow::Result;

pub fn run() -> Result<()> {
    println!("{}", render_hooks());
    Ok(())
}

pub fn render_hooks() -> String {
    let _workdir = PathBuf::from(".");
    [
        "Hooks",
        "当前内置 Hook:",
        "- logging: 记录任务、步骤、工具、检查点生命周期事件",
        "",
        "生命周期:",
        "- task_started",
        "- task_finished",
        "- step_started",
        "- step_finished",
        "- tool_started",
        "- tool_finished",
        "- approval_requested",
        "- approval_resolved",
        "- checkpoint_saved",
        "",
        "当前状态:",
        "- RuntimeOrchestrator 默认注册 logging hook",
    ]
    .join("\n")
}
