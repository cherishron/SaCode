use anyhow::Result;
use sacode_runtime::{list_enabled_mcp_tool_specs, McpConfigStore, ToolRegistry};
use std::path::PathBuf;

use crate::plugin_config::{PluginConfigStore, PluginEntry, PluginSource};

pub async fn run(args: Vec<String>) -> Result<()> {
    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_plugins().await?,
        "install" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin install <name> [--global|-g]");
            } else {
                install_plugin(&args[1], is_global(&args[2..]))?;
            }
        }
        "remove" | "rm" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin remove <name> [--global|-g]");
            } else {
                remove_plugin(&args[1], is_global(&args[2..]))?;
            }
        }
        "enable" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin enable <name> [--global|-g]");
            } else {
                set_plugin_enabled(&args[1], true, is_global(&args[2..]))?;
            }
        }
        "disable" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin disable <name> [--global|-g]");
            } else {
                set_plugin_enabled(&args[1], false, is_global(&args[2..]))?;
            }
        }
        _ => {
            println!("Unknown plugin command: {}", args[0]);
            println!("Available: list, install, remove, enable, disable");
        }
    }

    Ok(())
}

async fn list_plugins() -> Result<()> {
    let plugin_store = PluginConfigStore::new(&PathBuf::from("."));
    let registry = ToolRegistry::builtin();
    println!("Built-in tools:");
    for name in registry.names() {
        if let Some(spec) = registry.get(name) {
            println!("  {} - {}", name, spec.description);
            println!("    Side effect: {:?}", spec.side_effect_level);
            println!(
                "    Approval: {}",
                if spec.needs_approval() {
                    "required"
                } else {
                    "auto"
                }
            );
        }
    }

    let store = McpConfigStore::new(&PathBuf::from("."));
    if let Ok(specs) = list_enabled_mcp_tool_specs(&store).await {
        if !specs.is_empty() {
            println!("MCP tools:");
            for spec in specs {
                println!("  {} - {}", spec.name, spec.description);
                println!("    Side effect: {:?}", spec.side_effect_level);
                println!(
                    "    Approval: {}",
                    if spec.needs_approval() {
                        "required"
                    } else {
                        "auto"
                    }
                );
                println!(
                    "    Input schema: {}",
                    serde_json::to_string(&spec.input_schema).unwrap_or_else(|_| "{}".to_string())
                );
            }
        }
    }

    let entries = plugin_store.list_entries()?;
    if !entries.is_empty() {
        println!("Configured plugins:");
        for entry in entries {
            let version = if entry.plugin.version.trim().is_empty() {
                "latest"
            } else {
                entry.plugin.version.as_str()
            };
            println!(
                "  {} {} | {} [{}]",
                entry.plugin.name,
                version,
                if entry.plugin.enabled {
                    "enabled"
                } else {
                    "disabled"
                },
                entry.source.label()
            );
        }
    }

    Ok(())
}

fn show_default() {
    println!("Plugin commands:");
    println!("  sacode plugin list - List available tools");
    println!("  sacode plugin install <name> [--global|-g]");
    println!("  sacode plugin remove <name> [--global|-g]");
    println!("  sacode plugin enable <name> [--global|-g]");
    println!("  sacode plugin disable <name> [--global|-g]");
}

fn install_plugin(name: &str, global: bool) -> Result<()> {
    let store = PluginConfigStore::new(&PathBuf::from("."));
    store.upsert(
        PluginEntry {
            name: name.to_string(),
            version: "latest".to_string(),
            enabled: true,
        },
        source_from_global(global),
    )?;
    println!(
        "Installed plugin {} to {} [{}]",
        name,
        if global {
            store.user_path().display().to_string()
        } else {
            store.project_path().display().to_string()
        },
        if global { "user" } else { "project" }
    );
    Ok(())
}

fn remove_plugin(name: &str, global: bool) -> Result<()> {
    let store = PluginConfigStore::new(&PathBuf::from("."));
    store.remove(name, source_from_global(global))?;
    println!(
        "Removed plugin {} [{}]",
        name,
        if global { "user" } else { "project" }
    );
    Ok(())
}

fn set_plugin_enabled(name: &str, enabled: bool, global: bool) -> Result<()> {
    let store = PluginConfigStore::new(&PathBuf::from("."));
    store.set_enabled(name, enabled, source_from_global(global))?;
    println!(
        "{} plugin {} [{}]",
        if enabled { "Enabled" } else { "Disabled" },
        name,
        if global { "user" } else { "project" }
    );
    Ok(())
}

fn is_global(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--global" || arg == "-g")
}

fn source_from_global(global: bool) -> PluginSource {
    if global {
        PluginSource::User
    } else {
        PluginSource::Project
    }
}
