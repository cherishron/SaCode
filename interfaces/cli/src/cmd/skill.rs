use anyhow::Result;
use sacode_runtime::SkillRegistry;
use std::{env, path::PathBuf};

pub fn run(args: Vec<String>) -> Result<()> {
    let registry = SkillRegistry::new(&PathBuf::from("."));

    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_skills(&registry)?,
        "add" => {
            if args.len() < 4 {
                println!("Usage: sacode skill add <name> <description> <prompt>");
            } else {
                add_skill(&registry, &args[1], &args[2], &args[3..].join(" "))?;
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
                println!("Usage: sacode skill remove <name>");
            } else {
                remove_skill(&registry, &args[1])?;
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
            println!("Available: list, add, show, remove, run");
        }
    }

    Ok(())
}

fn list_skills(registry: &SkillRegistry) -> Result<()> {
    println!("Skills:");
    for skill in registry.list()? {
        println!("  {} - {} ({})", skill.name, skill.description, skill.path.display());
    }
    Ok(())
}

fn show_skill(registry: &SkillRegistry, name: &str) -> Result<()> {
    let skill = registry.get(name)?;
    println!("Name: {}", skill.name);
    println!("Description: {}", skill.description);
    println!("Path: {}", skill.path.display());
    println!();
    println!("Prompt:");
    println!("{}", skill.prompt);
    Ok(())
}

fn show_default() {
    println!("Skill commands:");
    println!("  sacode skill list       - List available skills");
    println!("  sacode skill add <name> <description> <prompt> - Save a project skill to .sacode/skills");
    println!("  sacode skill show <name> - Show skill prompt");
    println!("  sacode skill remove <name> - Remove a project skill");
    println!("  sacode skill run <name> [args...] - Render a runnable skill prompt");
}

fn add_skill(registry: &SkillRegistry, name: &str, description: &str, prompt: &str) -> Result<()> {
    let path = registry.save_project_skill(name, description, prompt)?;
    println!("Saved project skill {} to {}", name, path.display());
    Ok(())
}

fn remove_skill(registry: &SkillRegistry, name: &str) -> Result<()> {
    registry.remove_project_skill(name)?;
    println!("Removed project skill {} from .sacode/skills", name);
    Ok(())
}

fn run_skill(registry: &SkillRegistry, name: &str, args: &[String]) -> Result<()> {
    let workdir = env::current_dir()?;
    let rendered = registry.render_prompt(name, &args.join(" "), &workdir)?;
    println!("{}", rendered);
    Ok(())
}
