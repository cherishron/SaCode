use anyhow::Result;
use sacode_runtime::{list_enabled_mcp_tool_specs, McpConfigStore, ToolRegistry};
use std::path::PathBuf;

pub async fn run(args: Vec<String>) -> Result<()> {
    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_plugins().await?,
        _ => {
            println!("Unknown plugin command: {}", args[0]);
            println!("Available: list");
        }
    }

    Ok(())
}

async fn list_plugins() -> Result<()> {
    let registry = ToolRegistry::builtin();
    println!("Built-in tools:");
    for name in registry.names() {
        if let Some(spec) = registry.get(name) {
            println!("  {} - {}", name, spec.description);
            println!("    Side effect: {:?}", spec.side_effect_level);
            println!("    Approval: {}", if spec.needs_approval() { "required" } else { "auto" });
        }
    }

    let store = McpConfigStore::new(&PathBuf::from("."));
    if let Ok(specs) = list_enabled_mcp_tool_specs(&store).await {
        if !specs.is_empty() {
            println!("MCP tools:");
            for spec in specs {
                println!("  {} - {}", spec.name, spec.description);
                println!("    Side effect: {:?}", spec.side_effect_level);
                println!("    Approval: {}", if spec.needs_approval() { "required" } else { "auto" });
                println!("    Input schema: {}", serde_json::to_string(&spec.input_schema).unwrap_or_else(|_| "{}".to_string()));
            }
        }
    }

    Ok(())
}

fn show_default() {
    println!("Plugin commands:");
    println!("  sacode plugin list - List available tools");
}
