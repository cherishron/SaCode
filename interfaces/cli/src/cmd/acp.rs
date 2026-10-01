use anyhow::Result;
use sacode_acp::{run_server, run_stdio_server, AcpConfig};

pub async fn run(args: Vec<String>) -> Result<()> {
    let mut config = AcpConfig::default();
    apply_args(&mut config, &args);

    match args.first().map(|value| value.as_str()) {
        // `sacode acp`（无参数）默认进入 stdio 服务端 —— 编辑器以 agent_server 接入
        // （Zed 等配置 `args: ["acp"]`，对齐 opencode acp 约定）。
        Some("stdio") | None => run_stdio_server().await,
        Some("serve") => run_server(&config).await,
        Some("status") => {
            println!(
                "ACP server configured on {}:{} (use `sacode acp` for stdio agent mode)",
                config.server.host, config.server.port
            );
            Ok(())
        }
        Some(other) => anyhow::bail!("unknown acp command: {}", other),
    }
}

fn apply_args(config: &mut AcpConfig, args: &[String]) {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--host" => {
                if let Some(value) = iter.next() {
                    config.server.host = value.clone();
                }
            }
            "--port" => {
                if let Some(value) = iter.next() {
                    if let Ok(port) = value.parse() {
                        config.server.port = port;
                    }
                }
            }
            _ => {}
        }
    }
}
