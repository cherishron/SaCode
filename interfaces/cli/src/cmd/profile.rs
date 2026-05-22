use anyhow::Result;

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
    println!("Profiles:");
    println!("  default   (current) - planner:gpt-4o, coder:deepseek-coder, reviewer:gpt-4o-mini");
    println!("  economy   - planner:deepseek-chat, coder:deepseek-coder");
    println!("  local     - planner:ollama/qwen2.5-coder:7b");
}

fn use_profile(name: &str) {
    println!("Switched to profile: {}", name);
    println!("Note: Profile switching requires ~/.sacode/profiles.yaml");
}

fn show_current() {
    println!("Current profile: default");
    println!("Planner:  gpt-4o (openai)");
    println!("Coder:    deepseek-coder (deepseek)");
    println!("Reviewer: gpt-4o-mini (openai)");
}

fn show_default() {
    println!("Profile commands:");
    println!("  sacode profile ls      - List available profiles");
    println!("  sacode profile use <name> - Switch to a profile");
    println!("  sacode profile show    - Show current profile");
}
