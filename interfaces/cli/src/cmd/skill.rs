use anyhow::Result;
use sacode_runtime::{SaCodeConfig, SkillHubClient, SkillRegistry, SkillSource};
use std::{env, path::PathBuf};

pub async fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let registry = SkillRegistry::new(&workdir);
    let config = SaCodeConfig::new(&workdir);
    let client = SkillHubClient::new();

    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_skills(&registry)?,
        "search" => {
            if args.len() < 2 {
                println!("Usage: sacode skill search <keyword>");
            } else {
                search_skills(&client, &args[1]).await?;
            }
        }
        "install" => {
            if args.len() < 2 {
                println!("Usage: sacode skill install <name> [--global|-g]");
            } else {
                install_skill(&client, &config, &args[1], is_global(&args[2..])).await?;
            }
        }
        "show" => {
            if args.len() < 2 {
                println!("Usage: sacode skill show <name>");
            } else {
                show_skill(&registry, &args[1])?;
            }
        }
        "remove" | "rm" => {
            if args.len() < 2 {
                println!("Usage: sacode skill remove <name> [--global|-g]");
            } else {
                remove_skill(&registry, &args[1], is_global(&args[2..]))?;
            }
        }
        "update" => {
            if args.len() < 2 {
                println!("Usage: sacode skill update <name> [--global|-g]");
            } else {
                install_skill(&client, &config, &args[1], is_global(&args[2..])).await?;
            }
        }
        "run" => {
            if args.len() < 2 {
                println!("Usage: sacode skill run <name> [args...]");
            } else {
                run_skill(&registry, &args[1], &args[2..])?;
            }
        }
        _ => {
            println!("Unknown skill command: {}", args[0]);
            println!("Available: search, install, list, show, update, remove, run");
        }
    }

    Ok(())
}

fn list_skills(registry: &SkillRegistry) -> Result<()> {
    println!("Skills:");
    for skill in registry.list()? {
        println!("  {} - {} [{}]", skill.name, skill.description, skill.source.label());
    }
    Ok(())
}

async fn search_skills(client: &SkillHubClient, keyword: &str) -> Result<()> {
    let skills = client.search_skills(keyword).await?;
    if skills.is_empty() {
        println!("No skills found.");
        return Ok(());
    }

    println!("SkillHub results:");
    for skill in skills {
        println!(
            "  {} - {} ({}, v{})",
            skill.name, skill.description, skill.author, skill.version
        );
    }
    Ok(())
}

fn show_skill(registry: &SkillRegistry, name: &str) -> Result<()> {
    let skill = registry.get(name)?;
    println!("Name: {}", skill.name);
    println!("Description: {}", skill.description);
    println!("Source: {}", skill.source.label());
    println!("Path: {}", skill.path.display());
    println!();
    println!("Prompt:");
    println!("{}", skill.prompt);
    Ok(())
}

fn show_default() {
    println!("Skill commands:");
    println!("  sacode skill search <keyword>");
    println!("  sacode skill install <name> [--global|-g]");
    println!("  sacode skill list");
    println!("  sacode skill show <name>");
    println!("  sacode skill update <name> [--global|-g]");
    println!("  sacode skill remove <name> [--global|-g]");
    println!("  sacode skill run <name> [args...]");
}

async fn install_skill(client: &SkillHubClient, config: &SaCodeConfig, name: &str, global: bool) -> Result<()> {
    let dir = if global {
        config.user_skills_dir()
    } else {
        config.project_skills_dir()
    };
    let skill = client.install_skill(name, &dir).await?;
    println!(
        "Installed skill {} to {} [{}]",
        name,
        skill.path.display(),
        if global { "user" } else { "project" }
    );
    Ok(())
}

fn remove_skill(registry: &SkillRegistry, name: &str, global: bool) -> Result<()> {
    let source = if global { SkillSource::User } else { SkillSource::Project };
    registry.remove_skill(name, source)?;
    println!(
        "Removed skill {} from {}",
        name,
        if global { "~/.sacode/skills" } else { "./.sacode/skills" }
    );
    Ok(())
}

fn run_skill(registry: &SkillRegistry, name: &str, args: &[String]) -> Result<()> {
    let workdir = env::current_dir()?;
    let rendered = registry.render_prompt(name, &args.join(" "), &workdir)?;
    println!("{}", rendered);
    Ok(())
}

fn is_global(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--global" || arg == "-g")
}
