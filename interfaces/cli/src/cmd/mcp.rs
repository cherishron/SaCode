use anyhow::Result;
use sacode_runtime::{
    call_mcp_tool, inspect_server, list_mcp_tools, run_stdio_server, McpConfigStore, McpSource,
    SaCodeConfig, SkillHubClient,
};
use std::path::PathBuf;

pub async fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let store = McpConfigStore::new(&workdir);
    let config = SaCodeConfig::new(&workdir);
    let client = SkillHubClient::new();

    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_servers(&store)?,
        "search" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp search <keyword>");
            } else {
                search_mcp(&client, &args[1]).await?;
            }
        }
        "install" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp install <name> [--global|-g]");
            } else {
                install_mcp(&client, &config, &args[1], is_global(&args[2..])).await?;
            }
        }
        "show" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp show <name>");
            } else {
                show_server(&store, &args[1])?;
            }
        }
        "add" => {
            // 两种用法：
            //   sacode mcp add <name> <url> [--global|-g]            — remote 类型
            //   sacode mcp add --stdio <name> <command> [args...]    — stdio 类型
            if args.len() >= 2 && args[1] == "--stdio" {
                add_stdio_server(&store, &args[2..])?;
            } else {
                add_remote_server(&store, &args[1..])?;
            }
        }
        "enable" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp enable <name> [--global|-g]");
            } else {
                store.set_enabled(&args[1], true, source_from_args(&args[2..]))?;
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
        "serve" => {
            println!("SaCode MCP stdio server ready");
            run_stdio_server()?;
        }
        "disable" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp disable <name> [--global|-g]");
            } else {
                store.set_enabled(&args[1], false, source_from_args(&args[2..]))?;
                println!("Disabled MCP server: {}", args[1]);
            }
        }
        "remove" | "rm" => {
            if args.len() < 2 {
                println!("Usage: sacode mcp remove <name> [--global|-g]");
            } else {
                store.remove(&args[1], source_from_args(&args[2..]))?;
                println!("Removed MCP server: {}", args[1]);
            }
        }
        _ => {
            println!("Unknown mcp command: {}", args[0]);
            println!("Available: search, install, list, show, add, enable, disable, remove, inspect, tools, call, serve");
        }
    }

    Ok(())
}

fn list_servers(store: &McpConfigStore) -> Result<()> {
    let entries = store.list_entries()?;
    if entries.is_empty() {
        println!("No MCP servers configured.");
        return Ok(());
    }

    println!("MCP Servers:");
    for entry in entries {
        let endpoint = if entry.server.is_stdio() {
            entry
                .server
                .command
                .as_deref()
                .unwrap_or("(missing command)")
                .to_string()
        } else {
            entry.server.url.clone()
        };
        let state = if entry.server.enabled {
            "enabled"
        } else {
            "disabled"
        };
        println!(
            "  {} [{}] - {} {} [{}]",
            entry.name,
            entry.server.server_type,
            endpoint,
            state,
            entry.source.label()
        );
    }
    Ok(())
}

/// 添加 remote (HTTP) 类型的 MCP server
fn add_remote_server(store: &McpConfigStore, args: &[String]) -> Result<()> {
    if args.len() < 2 {
        println!("Usage: sacode mcp add <name> <url> [--global|-g]");
        println!("       sacode mcp add --stdio <name> <command> [args...]");
        return Ok(());
    }
    let source = source_from_args(&args[2..]);
    store.add_remote(&args[0], &args[1], source)?;
    println!(
        "Added remote MCP server: {} -> {} [{}]",
        args[0],
        args[1],
        source.label()
    );
    Ok(())
}

/// 添加 stdio (子进程) 类型的 MCP server
///
/// 用法：`sacode mcp add --stdio <name> <command> [args...] [--global|-g]`
fn add_stdio_server(store: &McpConfigStore, args: &[String]) -> Result<()> {
    if args.len() < 2 {
        println!("Usage: sacode mcp add --stdio <name> <command> [args...] [--global|-g]");
        return Ok(());
    }
    let name = &args[0];
    let command = &args[1];

    // 收集命令行参数，过滤掉 --global/-g 标志
    let (server_args, global_flags): (Vec<&String>, Vec<&String>) = args[2..]
        .iter()
        .partition(|a| a.as_str() != "--global" && a.as_str() != "-g");
    let server_args: Vec<String> = server_args.iter().map(|s| s.to_string()).collect();
    let source = if global_flags.is_empty() {
        McpSource::Project
    } else {
        McpSource::User
    };

    store.add_stdio(
        name,
        command,
        &server_args,
        &std::collections::BTreeMap::new(),
        source,
    )?;
    let args_display = if server_args.is_empty() {
        String::new()
    } else {
        format!(" {}", server_args.join(" "))
    };
    println!(
        "Added stdio MCP server: {} -> {}{} [{}]",
        name,
        command,
        args_display,
        source.label()
    );
    Ok(())
}

async fn search_mcp(client: &SkillHubClient, keyword: &str) -> Result<()> {
    let servers = client.search_mcp(keyword).await?;
    if servers.is_empty() {
        println!("No MCP servers found.");
        return Ok(());
    }

    println!("SkillHub MCP results:");
    for server in servers {
        println!(
            "  {} - {} - {}",
            server.name, server.url, server.description
        );
    }
    Ok(())
}

async fn install_mcp(
    client: &SkillHubClient,
    config: &SaCodeConfig,
    name: &str,
    global: bool,
) -> Result<()> {
    let path = if global {
        config.user_mcp_config()
    } else {
        config.project_mcp_config()
    };
    client.install_mcp(name, &path).await?;
    println!(
        "Installed MCP server {} to {} [{}]",
        name,
        path.display(),
        if global { "user" } else { "project" }
    );
    Ok(())
}

async fn inspect(store: &McpConfigStore, name: &str) -> Result<()> {
    let server = store.get(name)?;
    let details = inspect_server(&server).await?;
    println!("Name: {}", name);
    println!("Type: {}", server.server_type);
    if server.is_stdio() {
        if let Some(cmd) = &server.command {
            let args = server
                .args
                .as_ref()
                .map(|a| a.join(" "))
                .unwrap_or_default();
            println!("Command: {} {}", cmd, args);
        }
    } else {
        println!("URL: {}", server.url);
    }
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

async fn call(
    store: &McpConfigStore,
    server_name: &str,
    tool_name: &str,
    json_args: &str,
) -> Result<()> {
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
    println!("  sacode mcp search <keyword>");
    println!("  sacode mcp install <name> [--global|-g]");
    println!("  sacode mcp list");
    println!("  sacode mcp show <name>");
    println!("  sacode mcp add <name> <url> [--global|-g]");
    println!("  sacode mcp add --stdio <name> <command> [args...] [--global|-g]");
    println!("  sacode mcp enable <name> [--global|-g]");
    println!("  sacode mcp disable <name> [--global|-g]");
    println!("  sacode mcp remove <name> [--global|-g]");
    println!("  sacode mcp inspect <name>");
    println!("  sacode mcp tools <name>");
    println!("  sacode mcp call <server> <tool> <json>");
    println!("  sacode mcp serve");
}

fn show_server(store: &McpConfigStore, name: &str) -> Result<()> {
    let server = store.get(name)?;
    println!("Name: {}", name);
    println!("Type: {}", server.server_type);
    println!("Enabled: {}", server.enabled);
    if server.is_stdio() {
        if let Some(cmd) = &server.command {
            let args = server
                .args
                .as_ref()
                .map(|a| a.join(" "))
                .unwrap_or_default();
            println!("Command: {} {}", cmd, args);
        }
    } else {
        println!("URL: {}", server.url);
    }
    Ok(())
}

fn is_global(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--global" || arg == "-g")
}

fn source_from_args(args: &[String]) -> McpSource {
    if is_global(args) {
        McpSource::User
    } else {
        McpSource::Project
    }
}
