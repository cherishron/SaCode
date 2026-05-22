use anyhow::Result;

pub fn run() -> Result<()> {
    println!("SaCode Init");
    println!();
    println!("This command will guide you through setting up SaCode.");
    println!();
    println!("Steps:");
    println!("  1. Configure API keys for providers");
    println!("  2. Select default profile");
    println!("  3. Set workspace preferences");
    println!();
    println!("Run the following to configure:");
    println!("  sacode profile use <name>");
    println!();
    println!("Or set environment variables:");
    println!("  OPENAI_API_KEY=your-key");
    println!("  DEEPSEEK_API_KEY=your-key");
    println!();

    Ok(())
}
