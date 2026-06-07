use std::path::Path;

use anyhow::Result;
use sacode_runtime::MemoryKind;

use super::memory::append_project_candidate;
use crate::mistakes::MistakeBookStore;

pub fn run(args: Vec<String>) -> Result<()> {
    let store = MistakeBookStore::new(Path::new("."));

    if args.is_empty() {
        list_mistakes(&store)?;
        return Ok(());
    }

    match args[0].as_str() {
        "list" => list_mistakes(&store)?,
        "show" => {
            if args.len() < 2 {
                println!("Usage: sacode mistakes show <index>");
                return Ok(());
            }
            show_mistake(&store, &args[1])?;
        }
        "learn" => {
            if args.len() < 2 {
                println!("Usage: sacode mistakes learn <index>");
                return Ok(());
            }
            learn_mistake(&store, &args[1])?;
        }
        cmd => {
            println!("Unknown mistakes command: {}", cmd);
            println!("Available commands: list, show, learn");
        }
    }

    Ok(())
}

fn list_mistakes(store: &MistakeBookStore) -> Result<()> {
    let book = store.load()?;
    if book.entries.is_empty() {
        println!("No mistakes recorded in .sacode/mistakes.json");
        return Ok(());
    }

    println!("Mistakes:");
    for (index, entry) in book.entries.iter().enumerate() {
        println!(
            "  {}. [{}] {} - {}",
            index + 1,
            entry.scope,
            entry.timestamp,
            entry.summary
        );
    }
    Ok(())
}

fn show_mistake(store: &MistakeBookStore, index: &str) -> Result<()> {
    let index = match index.parse::<usize>() {
        Ok(value) if value > 0 => value,
        _ => {
            println!("Index must be a positive integer");
            return Ok(());
        }
    };

    let book = store.load()?;
    let Some(entry) = book.entries.get(index - 1) else {
        println!("Mistake entry {} not found", index);
        return Ok(());
    };

    println!("Mistake {}", index);
    println!("Scope: {}", entry.scope);
    println!("Time: {}", entry.timestamp);
    println!("Summary: {}", entry.summary);
    println!("Details: {}", entry.details);
    Ok(())
}

fn learn_mistake(store: &MistakeBookStore, index: &str) -> Result<()> {
    let index = match index.parse::<usize>() {
        Ok(value) if value > 0 => value,
        _ => {
            println!("Index must be a positive integer");
            return Ok(());
        }
    };

    let book = store.load()?;
    let Some(entry) = book.entries.get(index - 1) else {
        println!("Mistake entry {} not found", index);
        return Ok(());
    };

    let content = format!("{}；修复时优先检查：{}", entry.summary, entry.details);
    let appended = append_project_candidate(
        Path::new("."),
        MemoryKind::Workflow,
        content,
        format!("由 /mistakes learn 从第 {} 条错误记录生成", index),
    )?;

    if appended {
        println!("已生成候选记忆条目，等待 /memory approve 审核");
    } else {
        println!("检测到重复内容，已跳过生成候选记忆");
    }

    Ok(())
}
