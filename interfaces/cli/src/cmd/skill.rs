use anyhow::Result;
use sacode_runtime::{
    SaCodeConfig, SkillHubClient, SkillHubUploadRequest, SkillRegistry, SkillSource,
};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

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
                println!("       sacode skill install --from-git <GitHub_URL>");
            } else {
                install_command(&client, &registry, &config, &args[1..]).await?;
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
    println!("  sacode skill install --from-git <GitHub_URL>");
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

async fn install_command(
    client: &SkillHubClient,
    registry: &SkillRegistry,
    config: &SaCodeConfig,
    args: &[String],
) -> Result<()> {
    if args.first().map(String::as_str) == Some("--from-git") {
        let Some(git_url) = args.get(1) else {
            anyhow::bail!("Usage: sacode skill install --from-git <GitHub_URL>");
        };
        install_skill_from_git(registry, config, git_url)
    } else {
        install_skill(client, config, &args[0], is_global(&args[1..])).await
    }
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

fn install_skill_from_git(
    registry: &SkillRegistry,
    config: &SaCodeConfig,
    git_url: &str,
) -> Result<()> {
    let temp_dir = tempfile::tempdir()?;
    let repo_dir = temp_dir.path().join("repo");

    let status = Command::new("git")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg(git_url)
        .arg(&repo_dir)
        .status()?;
    if !status.success() {
        anyhow::bail!("git clone failed for {}", git_url);
    }

    let skill_file = discover_skill_file(&repo_dir)?;
    let content = fs::read_to_string(&skill_file)?;
    let (name, description, prompt) = parse_skill_markdown(&skill_file, &content);
    let installed = registry.save_skill(&name, &description, &prompt, SkillSource::User)?;

    println!(
        "Installed skill {} from {} to {} [user]",
        name,
        git_url,
        installed.display()
    );
    println!("User skills dir: {}", config.user_skills_dir().display());
    Ok(())
}

fn discover_skill_file(repo_dir: &Path) -> Result<PathBuf> {
    for path in [
        repo_dir.join("SKILL.md"),
        repo_dir.join("skill.md"),
        repo_dir.join("README.md"),
    ] {
        if path.exists() {
            return Ok(path);
        }
    }

    let mut files = Vec::new();
    collect_markdown_files(repo_dir, &mut files)?;
    files.sort();
    files
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("no markdown skill file found in repository"))
}

fn collect_markdown_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_files(&path, files)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("md") {
            files.push(path);
        }
    }
    Ok(())
}

fn parse_skill_markdown(path: &Path, content: &str) -> (String, String, String) {
    let mut name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("custom-skill")
        .to_string();
    let mut description = String::new();
    let mut prompt = String::new();
    let mut in_prompt = false;

    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            name = rest.trim().to_string();
            continue;
        }
        if let Some(rest) = line.strip_prefix("Description: ") {
            description = rest.trim().to_string();
            continue;
        }
        if line.trim() == "## Prompt" {
            in_prompt = true;
            continue;
        }
        if in_prompt {
            if !prompt.is_empty() {
                prompt.push('\n');
            }
            prompt.push_str(line);
        }
    }

    if description.trim().is_empty() {
        description = format!("Imported from {}", path.display());
    }
    if prompt.trim().is_empty() {
        prompt = content.trim().to_string();
    } else {
        prompt = prompt.trim().to_string();
    }

    (sanitize_skill_name(&name), description, prompt)
}

fn sanitize_skill_name(name: &str) -> String {
    let mut output = String::new();
    let mut prev_dash = false;
    for ch in name.trim().chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if matches!(ch, '-' | '_' | ' ') {
            Some('-')
        } else {
            None
        };
        if let Some(value) = mapped {
            if value == '-' {
                if !output.is_empty() && !prev_dash {
                    output.push(value);
                }
                prev_dash = true;
            } else {
                output.push(value);
                prev_dash = false;
            }
        }
    }
    let output = output.trim_matches('-').to_string();
    if output.is_empty() {
        "custom-skill".to_string()
    } else {
        output.chars().take(64).collect()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_skill_name_normalizes_title() {
        assert_eq!(sanitize_skill_name("My Custom Skill"), "my-custom-skill");
        assert_eq!(sanitize_skill_name("***"), "custom-skill");
    }

    #[test]
    fn parse_skill_markdown_extracts_prompt_section() {
        let path = Path::new("/tmp/Deploy Skill.md");
        let content = "# Deploy Skill\n\nDescription: ship build\n\n## Prompt\n\nrun {{args}}\n";
        let (name, description, prompt) = parse_skill_markdown(path, content);
        assert_eq!(name, "deploy-skill");
        assert_eq!(description, "ship build");
        assert_eq!(prompt, "run {{args}}");
    }
}
