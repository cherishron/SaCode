use anyhow::Result;
use sacode_runtime::{
    PluginDescriptor, PluginKind, PluginLoader, PluginRegistry, SkillHubClient, SkillHubPluginMeta,
};
use std::path::{Path, PathBuf};

use crate::plugin_config::{PluginConfigStore, PluginEntry, PluginSource};

pub async fn run(args: Vec<String>) -> Result<()> {
    let client = SkillHubClient::new();
    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_plugins().await?,
        "search" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin search <keyword>");
            } else {
                search_plugins(&client, &args[1]).await?;
            }
        }
        "show" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin show <name>");
            } else {
                show_plugin(&client, &args[1]).await?;
            }
        }
        "install" => {
            if args.len() < 2 {
                println!("Usage: sacode plugin install <name> [--global|-g]");
            } else {
                install_plugin(&client, &args[1], is_global(&args[2..]))?;
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
            println!("Available: list, search, show, install, remove, enable, disable");
        }
    }

    Ok(())
}

async fn list_plugins() -> Result<()> {
    let plugin_store = PluginConfigStore::new(&PathBuf::from("."));
    let registry = PluginRegistry::discover(&PathBuf::from(".")).await;
    println!("Built-in tools:");
    for entry in registry
        .list()
        .iter()
        .filter(|entry| entry.kind.label() == "builtin")
    {
        println!("  {} - {}", entry.name, entry.description);
        if let Some(side_effect) = entry.side_effect_level {
            println!("    Side effect: {:?}", side_effect);
        }
        if let Some(approval_required) = entry.approval_required {
            println!(
                "    Approval: {}",
                if approval_required {
                    "required"
                } else {
                    "auto"
                }
            );
        }
    }

    let mcp_entries: Vec<_> = registry
        .list()
        .iter()
        .filter(|entry| entry.kind.label() == "mcp")
        .collect();
    if !mcp_entries.is_empty() {
        println!("MCP tools:");
        for entry in mcp_entries {
            println!("  {} - {}", entry.name, entry.description);
            if let Some(side_effect) = entry.side_effect_level {
                println!("    Side effect: {:?}", side_effect);
            }
            if let Some(approval_required) = entry.approval_required {
                println!(
                    "    Approval: {}",
                    if approval_required {
                        "required"
                    } else {
                        "auto"
                    }
                );
            }
            println!(
                "    Input schema: {}",
                entry
                    .input_schema
                    .as_ref()
                    .and_then(|schema| serde_json::to_string(schema).ok())
                    .unwrap_or_else(|| "{}".to_string())
            );
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
    println!("  sacode plugin search <keyword>");
    println!("  sacode plugin show <name>");
    println!("  sacode plugin install <name> [--global|-g]");
    println!("  sacode plugin remove <name> [--global|-g]");
    println!("  sacode plugin enable <name> [--global|-g]");
    println!("  sacode plugin disable <name> [--global|-g]");
}

async fn search_plugins(client: &SkillHubClient, query: &str) -> Result<()> {
    let plugin_store = PluginConfigStore::new(&PathBuf::from("."));
    let registry = merged_registry(&plugin_store).await?;
    let local_matches = registry.search(query);
    let remote_matches = client.search_plugins(query).await.unwrap_or_default();
    if local_matches.is_empty() && remote_matches.is_empty() {
        println!("No plugins found.");
        return Ok(());
    }

    println!("Plugin results:");
    for entry in local_matches {
        println!(
            "  {} - {} [{}:{}]",
            entry.name,
            entry.description,
            entry.kind.label(),
            entry.source_label
        );
    }
    for entry in remote_matches {
        println!(
            "  {} - {} [remote:skillhub] ({}, v{})",
            entry.name, entry.description, entry.author, entry.version
        );
    }
    Ok(())
}

async fn show_plugin(client: &SkillHubClient, name: &str) -> Result<()> {
    let plugin_store = PluginConfigStore::new(&PathBuf::from("."));
    let registry = merged_registry(&plugin_store).await?;
    if let Ok(entry) = registry.get(name) {
        print_plugin_descriptor(entry);
        return Ok(());
    }

    let entry = client.get_plugin_info(name).await?;
    print_remote_plugin(&entry);
    Ok(())
}

fn print_plugin_descriptor(entry: &PluginDescriptor) {
    println!("Name: {}", entry.name);
    println!("Description: {}", entry.description);
    println!("Kind: {}", entry.kind.label());
    println!("Source: {}", entry.source_label);
    println!("Enabled: {}", if entry.enabled { "yes" } else { "no" });
    if let Some(version) = entry.version.as_deref() {
        println!("Version: {}", version);
    }
    if let Some(side_effect) = entry.side_effect_level {
        println!("Side effect: {:?}", side_effect);
    }
    if let Some(approval_required) = entry.approval_required {
        println!(
            "Approval: {}",
            if approval_required {
                "required"
            } else {
                "auto"
            }
        );
    }
    if let Some(schema) = &entry.input_schema {
        println!(
            "Input schema: {}",
            serde_json::to_string_pretty(schema).unwrap_or_else(|_| "{}".to_string())
        );
    }
    if !entry.tags.is_empty() {
        println!("Tags: {}", entry.tags.join(", "));
    }
}

fn print_remote_plugin(entry: &SkillHubPluginMeta) {
    println!("Name: {}", entry.name);
    println!("Description: {}", entry.description);
    println!("Kind: remote");
    println!("Source: skillhub");
    println!("Author: {}", entry.author);
    println!("Version: {}", entry.version);
    if !entry.tags.is_empty() {
        println!("Tags: {}", entry.tags.join(", "));
    }
    if !entry.download_url.trim().is_empty() {
        println!("Download URL: {}", entry.download_url);
    }
    if let Some(source_ref) = &entry.source_ref {
        println!("Source ref: {}", source_ref);
    }
}

async fn resolve_install_candidate(name: &str) -> Result<Option<PluginDescriptor>> {
    let plugin_store = PluginConfigStore::new(&PathBuf::from("."));
    let registry = merged_registry(&plugin_store).await?;

    if let Ok(entry) = registry.get(name) {
        return Ok(Some(entry.clone()));
    }

    let matches = registry.search(name);
    if matches.len() == 1 {
        return Ok(Some(matches[0].clone()));
    }

    Ok(None)
}

async fn resolve_remote_install_candidate(
    client: &SkillHubClient,
    name: &str,
) -> Result<Option<SkillHubPluginMeta>> {
    if let Ok(entry) = client.get_plugin_info(name).await {
        return Ok(Some(entry));
    }

    let matches = client.search_plugins(name).await.unwrap_or_default();
    if matches.len() == 1 {
        return Ok(matches.into_iter().next());
    }

    Ok(None)
}

async fn merged_registry(plugin_store: &PluginConfigStore) -> Result<PluginRegistry> {
    let mut registry = PluginRegistry::discover(&PathBuf::from(".")).await;
    for entry in plugin_store.list_entries()? {
        let name = entry.plugin.name.clone();
        let description = configured_description(&entry.plugin.description);
        let kind = configured_kind(&entry.plugin.kind);
        let version = normalized_version(&entry.plugin.version);
        let enabled = entry.plugin.enabled;
        let source_label = configured_source_label(&entry);
        registry.push(PluginLoader::configured_plugin(
            name,
            description,
            kind,
            version,
            enabled,
            source_label,
        ));
    }
    Ok(registry)
}

fn normalized_version(version: &str) -> Option<String> {
    let trimmed = version.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn configured_description(description: &str) -> String {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        "Configured plugin entry".to_string()
    } else {
        trimmed.to_string()
    }
}

fn configured_kind(kind: &str) -> PluginKind {
    match kind.trim().to_lowercase().as_str() {
        "builtin" => PluginKind::Builtin,
        "mcp" => PluginKind::Mcp,
        _ => PluginKind::Configured,
    }
}

fn configured_source_label(entry: &crate::plugin_config::PluginResolvedEntry) -> String {
    let trimmed = entry.plugin.source_ref.trim();
    if trimmed.is_empty() {
        entry.source.label().to_string()
    } else {
        trimmed.to_string()
    }
}

fn install_plugin(client: &SkillHubClient, name: &str, global: bool) -> Result<()> {
    let store = PluginConfigStore::new(&PathBuf::from("."));
    let source = source_from_global(global);
    let local_candidate = if let Ok(handle) = tokio::runtime::Handle::try_current() {
        tokio::task::block_in_place(|| handle.block_on(resolve_install_candidate(name)))?
    } else {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(resolve_install_candidate(name))?
    };

    let remote_candidate = if local_candidate.is_none() {
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            tokio::task::block_in_place(|| {
                handle.block_on(resolve_remote_install_candidate(client, name))
            })?
        } else {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            runtime.block_on(resolve_remote_install_candidate(client, name))?
        }
    } else {
        None
    };

    let (resolved_name, description, kind, source_ref, download_url) = if let Some(entry) = local_candidate {
        (
            entry.name,
            entry.description,
            entry.kind.label().to_string(),
            entry.source_label,
            String::new(),
        )
    } else if let Some(entry) = remote_candidate {
        (
            entry.name,
            entry.description,
            PluginKind::Configured.label().to_string(),
            entry
                .source_ref
                .unwrap_or_else(|| format!("skillhub:{}", entry.author)),
            entry.download_url,
        )
    } else {
        (
            name.to_string(),
            "Configured plugin entry".to_string(),
            "configured".to_string(),
            if global {
                "user".to_string()
            } else {
                "project".to_string()
            },
            String::new(),
        )
    };

    // 尝试下载 WASM 文件（如果有 download_url）
    let wasm_path = if !download_url.trim().is_empty() {
        let wasm_dir = store.wasm_dir(source);
        let wasm_file = store.wasm_file_path(&resolved_name, source);
        match download_wasm_plugin(&download_url, &wasm_dir, &wasm_file) {
            Ok(path) => {
                println!("Downloaded WASM plugin: {}", path.display());
                path.to_string_lossy().to_string()
            }
            Err(e) => {
                eprintln!("Warning: failed to download WASM plugin: {}", e);
                String::new()
            }
        }
    } else {
        String::new()
    };

    store.upsert(
        PluginEntry {
            name: resolved_name.clone(),
            version: "latest".to_string(),
            enabled: true,
            description,
            kind,
            source_ref,
            download_url,
            wasm_path,
        },
        source,
    )?;
    println!(
        "Installed plugin {} to {} [{}]",
        resolved_name,
        if global {
            store.user_path().display().to_string()
        } else {
            store.project_path().display().to_string()
        },
        if global { "user" } else { "project" }
    );
    Ok(())
}

/// 下载 WASM 插件文件到本地目录
fn download_wasm_plugin(url: &str, wasm_dir: &Path, wasm_file: &Path) -> Result<PathBuf> {
    use std::io::Read;

    // 创建目录
    std::fs::create_dir_all(wasm_dir)?;

    // 使用 reqwest 同步 HTTP 下载
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {}", e))?;

    let mut response = client
        .get(url)
        .send()
        .map_err(|e| anyhow::anyhow!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        anyhow::bail!(
            "HTTP {}: failed to download WASM plugin from {}",
            response.status(),
            url
        );
    }

    let mut body = Vec::new();
    response
        .read_to_end(&mut body)
        .map_err(|e| anyhow::anyhow!("failed to read response body: {}", e))?;

    // 写入文件
    std::fs::write(wasm_file, &body)?;
    Ok(wasm_file.to_path_buf())
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
