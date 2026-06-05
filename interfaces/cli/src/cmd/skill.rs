use anyhow::Result;
use sacode_runtime::{
    SaCodeConfig, SkillHubClient, SkillHubUploadRequest, SkillRegistry, SkillSource,
};
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
        "upload" | "publish" => {
            if args.len() < 2 {
                println!("Usage: sacode skill upload <name> [--author <author>] [--version <version>] [--tags <tags>]");
            } else {
                upload_skill(&client, &registry, &args[1], &args[2..]).await?;
            }
        }
        "versions" => {
            if args.len() < 2 {
                println!("Usage: sacode skill versions <name>");
            } else {
                list_versions(&client, &args[1]).await?;
            }
        }
        "info" => {
            if args.len() < 2 {
                println!("Usage: sacode skill info <name>");
            } else {
                get_skill_info(&client, &args[1]).await?;
            }
        }
        _ => {
            println!("Unknown skill command: {}", args[0]);
            println!("Available: search, install, list, show, update, remove, run, upload, versions, info");
        }
    }

    Ok(())
}

fn list_skills(registry: &SkillRegistry) -> Result<()> {
    println!("Skills:");
    for skill in registry.list()? {
        println!(
            "  {} - {} [{}]",
            skill.name,
            skill.description,
            skill.source.label()
        );
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
    println!(
        "  sacode skill upload <name> [--author <author>] [--version <version>] [--tags <tags>]"
    );
    println!("  sacode skill versions <name>");
    println!("  sacode skill info <name>");
}

async fn upload_skill(
    client: &SkillHubClient,
    registry: &SkillRegistry,
    name: &str,
    args: &[String],
) -> Result<()> {
    let skill = registry.get(name)?;
    let mut author = skill.author.clone().unwrap_or_else(|| "local".to_string());
    let mut version = skill.version.clone().unwrap_or_else(|| "1.0.0".to_string());
    let mut tags = skill.tags.clone();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--author" | "-a" => {
                if i + 1 < args.len() {
                    author = args[i + 1].clone();
                    i += 2;
                } else {
                    anyhow::bail!("--author requires a value");
                }
            }
            "--version" | "-v" => {
                if i + 1 < args.len() {
                    version = args[i + 1].clone();
                    i += 2;
                } else {
                    anyhow::bail!("--version requires a value");
                }
            }
            "--tags" | "-t" => {
                if i + 1 < args.len() {
                    tags = args[i + 1]
                        .split(',')
                        .map(|tag| tag.trim().to_string())
                        .collect();
                    i += 2;
                } else {
                    anyhow::bail!("--tags requires a value");
                }
            }
            _ => i += 1,
        }
    }

    let request = SkillHubUploadRequest {
        name: skill.name.clone(),
        description: skill.description.clone(),
        author,
        version,
        prompt: skill.prompt.clone(),
        tags,
    };

    let response = client.upload_skill(request).await?;
    if response.success {
        println!("Skill {} uploaded successfully!", skill.name);
        if let Some(url) = response.download_url {
            println!("Download URL: {}", url);
        }
    } else {
        println!("Failed to upload skill: {}", response.message);
    }
    Ok(())
}

async fn list_versions(client: &SkillHubClient, name: &str) -> Result<()> {
    let versions = client.list_skill_versions(name).await?;
    if versions.is_empty() {
        println!("No versions found for skill {}", name);
        return Ok(());
    }

    println!("Versions for {}:", name);
    for version in versions {
        println!("  v{} - {}", version.version, version.created_at);
    }
    Ok(())
}

async fn get_skill_info(client: &SkillHubClient, name: &str) -> Result<()> {
    let info = client.get_skill_info(name).await?;
    println!("Name: {}", info.name);
    println!("Description: {}", info.description);
    println!("Author: {}", info.author);
    println!("Version: {}", info.version);
    if let Some(rating) = info.rating {
        println!("Rating: {:.1}", rating);
    }
    if let Some(count) = info.download_count {
        println!("Downloads: {}", count);
    }
    if !info.tags.is_empty() {
        println!("Tags: {}", info.tags.join(", "));
    }
    if let Some(created) = info.created_at {
        println!("Created: {}", created);
    }
    if let Some(updated) = info.updated_at {
        println!("Updated: {}", updated);
    }
    println!("Download URL: {}", info.download_url);
    Ok(())
}

async fn install_skill(
    client: &SkillHubClient,
    config: &SaCodeConfig,
    name: &str,
    global: bool,
) -> Result<()> {
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
    let source = if global {
        SkillSource::User
    } else {
        SkillSource::Project
    };
    registry.remove_skill(name, source)?;
    println!(
        "Removed skill {} from {}",
        name,
        if global {
            "~/.sacode/skills"
        } else {
            "./.sacode/skills"
        }
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
