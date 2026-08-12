use anyhow::Result;
use sacode_acp::{run_server, run_stdio_server, AcpConfig};

pub async fn run(args: Vec<String>) -> Result<()> {
    let mut config = AcpConfig::default();
    apply_args(&mut config, &args);

    match args.first().map(|value| value.as_str()) {
        Some("status") => {
            println!(
                "ACP server configured on {}:{}",
                config.server.host, config.server.port
            );
            Ok(())
        }
        Some("serve") | None => run_server(&config).await,
        Some("stdio") => {
            println!("ACP stdio server ready");
            run_stdio_server().await
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
