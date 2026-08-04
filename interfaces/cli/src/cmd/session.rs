//! `sacode session` 命令 — 暴露 SessionService 到 CLI 层
//!
//! 子命令：
//!   sacode session list              列出当前所有 session
//!   sacode session close <id>        关闭指定 session
//!   sacode session cancel <id>       取消指定 session
//!   sacode session history <id>      查看 session 历史事件
//!
//! 设计说明：
//! SessionService 此前仅存在于 runtime 层未被 CLI 消费（孤儿 API）。
//! 阶段二将其暴露，使 session 生命周期可跨入口管理，
//! 为统一状态机的跨进程恢复奠定基础。

use anyhow::Result;
use sacode_runtime::SessionService;

pub fn run(args: Vec<String>) -> Result<()> {
    let service = SessionService::new();

    let sub = args.first().map(|s| s.as_str()).unwrap_or("list");
    match sub {
        "list" => list_sessions(&service),
        "close" => {
            let id = args
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("用法: sacode session close <session_id>"))?;
            service.close_session(id)?;
            println!("session {id} 已关闭");
            Ok(())
        }
        "cancel" => {
            let id = args
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("用法: sacode session cancel <session_id>"))?;
            service.cancel_session(id)?;
            println!("session {id} 已取消");
            Ok(())
        }
        "history" => {
            let id = args
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("用法: sacode session history <session_id>"))?;
            let history = service.session_history(id)?;
            println!("session {id} 历史元数据：");
            println!("  事件数:       {}", history.event_count);
            println!("  预估 tokens:  {}", history.estimated_tokens);
            println!("  压缩:         {}", if history.compressed { "是" } else { "否" });
            if let Some(ratio) = history.compression_ratio {
                println!("  压缩率:       {:.2}%", ratio * 100.0);
            }
            if let Some(cp) = &history.last_checkpoint {
                println!("  最近 checkpoint: {cp}");
            }
            if let Some(fork) = &history.forked_from {
                println!("  fork 自:      {fork}");
            }
            Ok(())
        }
        "help" | "-h" | "--help" => {
            print_help();
            Ok(())
        }
        other => {
            anyhow::bail!("未知子命令: {other}\n运行 `sacode session help` 查看可用命令")
        }
    }
}

fn list_sessions(service: &SessionService) -> Result<()> {
    let sessions = service.list_sessions();
    if sessions.is_empty() {
        println!("当前无活跃 session");
        return Ok(());
    }

    println!("共 {} 个 session：", sessions.len());
    println!("{:-<80}", "");
    for handle in sessions {
        println!("id:     {}", handle.id);
        println!("cwd:    {}", handle.cwd.display());
        println!("status: {:?}", handle.status);
        if !handle.tools.is_empty() {
            println!("tools:  {}", handle.tools.join(", "));
        }
        if let Some(cp) = &handle.last_checkpoint {
            println!("checkpoint: {cp}");
        }
        println!("{:-<80}", "");
    }
    Ok(())
}

fn print_help() {
    println!("sacode session — 会话管理");
    println!();
    println!("用法:");
    println!("  sacode session list              列出当前所有 session");
    println!("  sacode session close <id>        关闭指定 session");
    println!("  sacode session cancel <id>       取消指定 session");
    println!("  sacode session history <id>      查看 session 历史事件");
    println!("  sacode session help              显示此帮助信息");
}
