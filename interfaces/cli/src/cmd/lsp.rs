use anyhow::Result;
use sacode_lsp::{run_stdio_server, run_tcp_server, LspConfig};

pub async fn run(args: Vec<String>) -> Result<()> {
    let mut config = LspConfig::default();
    let mut tcp = false;
    apply_args(&mut config, &args, &mut tcp);

    match args.first().map(|value| value.as_str()) {
        Some("status") => {
            if tcp {
                println!(
                    "LSP TCP server configured on {}:{}",
                    config.server.host, config.server.port
                );
            } else {
                println!("LSP stdio server ready");
            }
            Ok(())
        }
        Some("serve") | None => {
            if tcp {
                run_tcp_server(&config).await
            } else {
                run_stdio_server(&config).await
            }
        }
        Some(other) => anyhow::bail!("unknown lsp command: {}", other),
    }
}

fn apply_args(config: &mut LspConfig, args: &[String], tcp: &mut bool) {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--tcp" => *tcp = true,
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
