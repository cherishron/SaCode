use anyhow::Result;

pub async fn run(args: Vec<String>) -> Result<()> {
    let enable_acp = args.iter().any(|arg| arg == "--acp");
    let enable_lsp = args.iter().any(|arg| arg == "--lsp");

    if enable_acp && enable_lsp {
        println!("Combined serve mode is scaffolded. Start ACP and LSP in separate processes for now.");
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

    println!("Usage: sacode serve --acp --lsp");
    Ok(())
}
