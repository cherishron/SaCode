use anyhow::Result;
use sacode_runtime::CheckpointStorage;
use std::path::PathBuf;

pub fn run(args: Vec<String>) -> Result<()> {
    let storage = CheckpointStorage::new(&PathBuf::from("."));

    if args.is_empty() {
        list_checkpoints(&storage)?;
        return Ok(());
    }

    let cmd = args[0].as_str();

    match cmd {
        "list" => list_checkpoints(&storage)?,
        "show" => {
            if args.len() < 2 {
                println!("Usage: checkpoint show <filename>");
                return Ok(());
            }
            show_checkpoint(&storage, &args[1])?;
        }
        "restore" => {
            if args.len() < 2 {
                println!("Usage: checkpoint restore <filename>");
                return Ok(());
            }
            restore_checkpoint(&storage, &args[1])?;
        }
        "clean" => {
            clean_checkpoints(&storage)?;
        }
        _ => {
            println!("Unknown checkpoint command: {}", cmd);
            println!("Available commands: list, show, restore, clean");
        }
    }

    Ok(())
}

fn list_checkpoints(storage: &CheckpointStorage) -> Result<()> {
    let checkpoints = storage.list()?;

    if checkpoints.is_empty() {
        println!("No checkpoints found in {}", storage.path().display());
        return Ok(());
    }

    println!("Checkpoints in {}:", storage.path().display());
    for checkpoint in checkpoints {
        println!("  {}", checkpoint);
    }

    Ok(())
}

fn show_checkpoint(storage: &CheckpointStorage, filename: &str) -> Result<()> {
    let checkpoint = storage.load(filename)?;

    println!("Checkpoint: {}", filename);
    println!("Task: {}", checkpoint.task.prompt);
    println!("Mode: {:?}", checkpoint.task.mode);
    println!("Current Step: {}", checkpoint.current_step);
    println!("Created: {}", checkpoint.created_at);
    println!("Updated: {}", checkpoint.updated_at);

    if !checkpoint.executed_tools.is_empty() {
        println!("Executed Tools:");
        for tool in &checkpoint.executed_tools {
            println!("  {} - {} ({})", tool.name, if tool.success { "OK" } else { "FAIL" }, tool.timestamp);
        }
    }

    if checkpoint.pending_approval.is_some() {
        println!("Pending Approval: {}", checkpoint.pending_approval.unwrap());
    }

    Ok(())
}

fn restore_checkpoint(storage: &CheckpointStorage, filename: &str) -> Result<()> {
    let checkpoint = storage.load(filename)?;

    println!("Restored checkpoint: {}", filename);
    println!("Task: {}", checkpoint.task.prompt);
    println!("Mode: {:?}", checkpoint.task.mode);
    println!("Current Step: {}", checkpoint.current_step);

    println!();
    println!("To continue this task, run:");
    println!("  sacode \"{}\" --mode {:?}", checkpoint.task.prompt, checkpoint.task.mode);

    Ok(())
}

fn clean_checkpoints(storage: &CheckpointStorage) -> Result<()> {
    let checkpoints = storage.list()?;

    if checkpoints.is_empty() {
        println!("No checkpoints to clean");
        return Ok(());
    }

    let path = storage.path();
    for checkpoint in &checkpoints {
        let file_path = path.join(checkpoint);
        std::fs::remove_file(&file_path)?;
        println!("Removed: {}", checkpoint);
    }

    println!("Cleaned {} checkpoint(s)", checkpoints.len());

    Ok(())
}
