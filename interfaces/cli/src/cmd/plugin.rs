use anyhow::Result;
use sacode_runtime::ToolRegistry;

pub fn run(args: Vec<String>) -> Result<()> {
    if args.is_empty() {
        show_default();
        return Ok(());
    }

    match args[0].as_str() {
        "list" | "ls" => list_plugins(),
        _ => {
            println!("Unknown plugin command: {}", args[0]);
            println!("Available: list");
        }
    }

    Ok(())
}

fn list_plugins() {
    let registry = ToolRegistry::builtin();
    println!("Built-in tools:");
    for name in registry.names() {
        if let Some(spec) = registry.get(name) {
            println!("  {} - {}", name, spec.description);
            println!("    Side effect: {:?}", spec.side_effect_level);
            println!("    Approval: {}", if spec.needs_approval() { "required" } else { "auto" });
        }
    }
}

fn show_default() {
    println!("Plugin commands:");
    println!("  sacode plugin list - List available tools");
}
