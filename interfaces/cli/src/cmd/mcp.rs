use anyhow::Result;
use sacode_runtime::{call_mcp_tool, inspect_server, list_mcp_tools, McpConfigStore};
use std::path::PathBuf;

pub async fn run(args: Vec<String>) -> Result<()> {
    let store = McpConfigStore::new(&PathBuf::from("."));

    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_servers(&store)?,
        "show" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp show <name>");
            } else {
                show_server(&store, &args[1])?;
            }
        }
        "add" => {
            if args.len() < 3 {
                println!("Usage: sacode mcp add <name> <url>");
            } else {
                store.add_remote(&args[1], &args[2])?;
                println!("Added MCP server: {}", args[1]);
            }
        }
        "enable" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp enable <name>");
            } else {
                store.set_enabled(&args[1], true)?;
                println!("Enabled MCP server: {}", args[1]);
            }
        }
        "inspect" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp inspect <name>");
            } else {
                inspect(&store, &args[1]).await?;
            }
        }
        "tools" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp tools <name>");
            } else {
                tools(&store, &args[1]).await?;
            }
        }
        "call" => {
            if args.len() < 4 {
                println!("Usage: sacode mcp call <server> <tool> <json-args>");
            } else {
                call(&store, &args[1], &args[2], &args[3]).await?;
            }
        }
        "disable" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp disable <name>");
            } else {
                store.set_enabled(&args[1], false)?;
                println!("Disabled MCP server: {}", args[1]);
            }
        }
        "remove" | "rm" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp remove <name>");
            } else {
                store.remove(&args[1])?;
                println!("Removed MCP server: {}", args[1]);
            }
        }
        _ => {
            println!("Unknown mcp command: {}", args[0]);
            println!("Available: list, show, add, enable, disable, remove, inspect, tools, call");
        }
    }

    Ok(())
}

fn list_servers(store: &McpConfigStore) -> Result<()> {
    let config = store.load()?;
    if config.mcp.is_empty() {
        println!("No MCP servers configured.");
        return Ok(());
    }

    println!("MCP servers:");
    for (name, server) in config.mcp {
        println!(
            "  {} - {} - {} - {}",
            name,
            server.server_type,
            if server.enabled { "enabled" } else { "disabled" },
            server.url
        );
    }
    Ok(())
}

async fn inspect(store: &McpConfigStore, name: &str) -> Result<()> {
    let server = store.get(name)?;
    let details = inspect_server(&server).await?;
    println!("Name: {}", name);
    println!("Type: {}", server.server_type);
    println!("URL: {}", server.url);
    println!("Enabled: {}", server.enabled);
    if let Some(protocol) = details.protocol_version {
        println!("Protocol: {}", protocol);
    }
    if let Some(server_name) = details.server_name {
        println!("Server: {}", server_name);
    }
    if let Some(version) = details.server_version {
        println!("Version: {}", version);
    }
    if let Some(instructions) = details.instructions {
        println!();
        println!("Instructions:");
        println!("{}", instructions);
    }
    Ok(())
}

async fn tools(store: &McpConfigStore, name: &str) -> Result<()> {
    let server = store.get(name)?;
    let tools = list_mcp_tools(&server).await?;
    println!("MCP tools from {}:", name);
    for tool in tools {
        let description = tool.description.unwrap_or_default();
        if description.is_empty() {
            println!("  {}", tool.name);
        } else {
            println!("  {} - {}", tool.name, description);
        }
    }
    Ok(())
}

async fn call(store: &McpConfigStore, server_name: &str, tool_name: &str, json_args: &str) -> Result<()> {
    let server = store.get(server_name)?;
    let arguments: serde_json::Value = serde_json::from_str(json_args)?;
    let result = call_mcp_tool(&server, tool_name, arguments).await?;
    println!("is_error: {}", result.is_error);
    println!("content:");
    println!("{}", serde_json::to_string_pretty(&result.content)?);
    Ok(())
}

fn show_default() {
    println!("MCP commands:");
    println!("  sacode mcp list                 - List configured MCP servers");
    println!("  sacode mcp show <name>          - Show local MCP server config");
    println!("  sacode mcp add <name> <url>     - Add a remote MCP server");
    println!("  sacode mcp enable <name>        - Enable a server");
    println!("  sacode mcp disable <name>       - Disable a server");
    println!("  sacode mcp remove <name>        - Remove a server");
    println!("  sacode mcp inspect <name>       - Inspect remote MCP server");
    println!("  sacode mcp tools <name>         - List remote MCP tools");
    println!("  sacode mcp call <server> <tool> <json> - Call remote MCP tool");
}

fn show_server(store: &McpConfigStore, name: &str) -> Result<()> {
    let server = store.get(name)?;
    println!("Name: {}", name);
    println!("Type: {}", server.server_type);
    println!("Enabled: {}", server.enabled);
    println!("URL: {}", server.url);
    Ok(())
}
