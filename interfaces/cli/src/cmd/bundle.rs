//! `sacode bundle` — §3.4 第二步 Bundle 可分发单元闭环
//!
//! 命令：
//! - `sacode bundle export <name> [--profile <profile>]`：把当前生效组合
//!   （命名 Profile + 全部 Patch 叠加）导出为 `.sacode/bundles/<name>.bundle.json`。
//! - `sacode bundle import <path>`：导入一个 `.bundle.json` 到本地 bundles 目录。
//! - `sacode bundle ls`：列出本地 bundles 目录下的 Bundle。

use std::path::PathBuf;

use anyhow::Result;
use sacode_runtime::{export_bundle, import_bundle, profiles_dir_of, PatchSet, Profile};

pub fn run(args: Vec<String>) -> Result<()> {
    if args.is_empty() {
        print_help();
        return Ok(());
    }

    match args[0].as_str() {
        "export" => {
            if args.len() < 2 {
                println!("Usage: sacode bundle export <name> [--profile <profile>]");
                return Ok(());
            }
            let name = args[1].clone();
            let profile_name = extract_flag(&args, "--profile");
            export(name, profile_name)?;
        }
        "import" => {
            if args.len() < 2 {
                println!("Usage: sacode bundle import <path-to-bundle.json>");
                return Ok(());
            }
            import(PathBuf::from(&args[1]))?;
        }
        "ls" | "list" => list()?,
        _ => {
            println!("Unknown bundle command: {}", args[0]);
            print_help();
        }
    }

    Ok(())
}

fn export(name: String, profile_name: Option<String>) -> Result<()> {
    let workdir = std::env::current_dir()?;
    let project_dir = workdir.join(".sacode");

    let profile = profile_name.and_then(|p| {
        let dir = profiles_dir_of(&project_dir);
        match Profile::resolve(&dir, &p) {
            Ok(profile) => Some(profile),
            Err(e) => {
                eprintln!("warning: profile '{p}' 解析失败，仅导出 Patch 叠加：{e}");
                None
            }
        }
    });

    let patches_dir = project_dir.join("patches");
    let patches = PatchSet::load_all(&patches_dir).unwrap_or_default();

    let path = export_bundle(&project_dir, &name, profile.as_ref(), &patches)?;
    println!("exported bundle → {}", path.display());
    if let Some(p) = &profile {
        println!(
            "  from profile: {} (chain: {:?})",
            p.name, p.inheritance_chain
        );
    }
    println!("  applied patches (priority order): {:?}", patches.names());
    Ok(())
}

fn import(bundle_path: PathBuf) -> Result<()> {
    let workdir = std::env::current_dir()?;
    let project_dir = workdir.join(".sacode");
    let bundle = import_bundle(&project_dir, &bundle_path)?;
    println!("imported bundle '{}'", bundle.name);
    println!("  enabled_tools: {:?}", bundle.enabled_tools);
    println!("  roles: {:?}", bundle.roles);
    println!("  mcp_servers: {:?}", bundle.mcp_servers);
    Ok(())
}

fn list() -> Result<()> {
    let workdir = std::env::current_dir()?;
    let bundles_dir = workdir.join(".sacode").join("bundles");
    if !bundles_dir.is_dir() {
        println!("no bundles found");
        return Ok(());
    }
    println!("Bundles:");
    let entries = std::fs::read_dir(&bundles_dir)?;
    for entry in entries {
        let path = entry?.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".bundle.json"))
            .unwrap_or(false)
        {
            if let Ok(bundle) = sacode_runtime::BundleManifest::load_from(&path) {
                println!("  {} - {}", bundle.name, bundle.description);
            }
        }
    }
    Ok(())
}

fn extract_flag(args: &[String], flag: &str) -> Option<String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == flag {
            return iter.next().cloned();
        }
    }
    None
}

fn print_help() {
    println!("Bundle commands:");
    println!(
        "  sacode bundle export <name> [--profile <profile>] - Export current combo to a bundle"
    );
    println!("  sacode bundle import <path>                          - Import a bundle into local project");
    println!("  sacode bundle ls                                    - List local bundles");
}
