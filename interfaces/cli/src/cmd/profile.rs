use anyhow::Result;

use crate::project_profile::ProjectProfileStore;

pub fn run(args: Vec<String>) -> Result<()> {
    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "ls" | "list" => list_profiles(),
        "use" => {
            if args.len() < 2 {
                println!("Usage: sacode profile use <name>");
            } else {
                use_profile(&args[1]);
            }
        }
        "show" => show_current(),
        _ => {
            println!("Unknown profile command: {}", args[0]);
            println!("Available: ls, use, show");
        }
    }

    Ok(())
}

fn list_profiles() {
    let store = ProjectProfileStore::new(std::path::Path::new("."));
    let config = match store.ensure_exists() {
        Ok(config) => config,
        Err(error) => {
            println!("Failed to load project profiles: {}", error);
            return;
        }
    };

    println!("Profiles:");
    for (name, profile) in config.profiles {
        let current = if name == config.current { " (current)" } else { "" };
        println!(
            "  {}{} - planner:{}, coder:{}, reviewer:{}",
            name,
            current,
            profile.planner,
            profile.coder,
            profile.reviewer
        );
    }
}

fn use_profile(name: &str) {
    let store = ProjectProfileStore::new(std::path::Path::new("."));
    match store.set_current(name) {
        Ok(_) => {
            println!("Switched to profile: {}", name);
            println!("Saved to .sacode/profile.json");
        }
        Err(error) => println!("Failed to switch profile: {}", error),
    }
}

fn show_current() {
    let store = ProjectProfileStore::new(std::path::Path::new("."));
    let config = match store.ensure_exists() {
        Ok(config) => config,
        Err(error) => {
            println!("Failed to load current profile: {}", error);
            return;
        }
    };

    let Some(profile) = config.profiles.get(&config.current) else {
        println!("Current profile is unavailable");
        return;
    };

    println!("Current profile: {}", config.current);
    println!("Planner:  {}", profile.planner);
    println!("Coder:    {}", profile.coder);
    println!("Reviewer: {}", profile.reviewer);
}

fn show_default() {
    println!("Profile commands:");
    println!("  sacode profile ls      - List available profiles");
    println!("  sacode profile use <name> - Switch to a profile");
    println!("  sacode profile show    - Show current profile");
}
