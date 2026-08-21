use anyhow::Result;
use std::net::SocketAddr;

pub async fn run(args: Vec<String>) -> Result<()> {
    let enable_acp = args.iter().any(|arg| arg == "--acp");
    let enable_lsp = args.iter().any(|arg| arg == "--lsp");

    if enable_acp && enable_lsp {
        println!(
            "Combined serve mode is scaffolded. Start ACP and LSP in separate processes for now."
        );
        return Ok(());
    }

    if enable_acp {
        println!("Use `sacode acp serve` to start ACP server.");
        return Ok(());
    }

    if enable_lsp {
        println!("Use `sacode lsp serve` to start LSP server.");
        return Ok(());
    }

    // 解析端口（默认 8080）
    let port = args
        .iter()
        .find_map(|arg| {
            arg.strip_prefix("--port=")
                .and_then(|p| p.parse::<u16>().ok())
        })
        .unwrap_or(8080);
    let host = args
        .iter()
        .find_map(|arg| arg.strip_prefix("--host=").map(|h| h.to_string()))
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| anyhow::anyhow!("无效的监听地址: {}", e))?;

    eprintln!("SaCode daemon 启动中... http://{}", addr);
    sacode_runtime::daemon::run_daemon(addr).await;
    Ok(())
}
