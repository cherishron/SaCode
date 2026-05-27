pub mod code;
pub mod fs;
pub mod git;
pub mod interaction;
pub mod media;
pub mod shell;
pub mod spec;
pub mod task;
pub mod web;

pub use spec::{ToolSpec, ToolOutput, SideEffectLevel};

use std::collections::HashMap;

#[derive(Debug, Default, Clone)]
pub struct ToolRegistry {
    tools: HashMap<String, ToolSpec>,
}

impl ToolRegistry {
    pub fn builtin() -> Self {
        let mut tools = HashMap::new();
        tools.insert("fs.read".to_string(), fs::read::spec());
        tools.insert("fs.search".to_string(), fs::search::spec());
        tools.insert("fs.write".to_string(), fs::write::spec());
        tools.insert("fs.edit".to_string(), fs::edit::spec());
        tools.insert("fs.read_multi".to_string(), fs::read_multi::spec());
        tools.insert("fs.list".to_string(), fs::list::spec());
        tools.insert("git.diff".to_string(), git::diff::spec());
        tools.insert("interaction.ask".to_string(), interaction::ask::spec());
        tools.insert("media.read".to_string(), media::read::spec());
        tools.insert("shell.exec".to_string(), shell::exec::spec());
        tools.insert("task.spawn".to_string(), task::spawn::spec());
        tools.insert("web.fetch".to_string(), web::fetch::spec());
        tools.insert("web.search".to_string(), web::search::spec());
        Self { tools }
    }

    pub fn names(&self) -> Vec<&str> {
        self.tools.keys().map(|s| s.as_str()).collect()
    }

    pub fn get(&self, name: &str) -> Option<&ToolSpec> {
        self.tools.get(name)
    }

    pub fn execute(&self, name: &str, input: serde_json::Value) -> anyhow::Result<ToolOutput> {
        match name {
            "fs.read" => fs::read::execute(input),
            "fs.search" => fs::search::execute(input),
            "fs.write" => fs::write::execute(input),
            "fs.edit" => fs::edit::execute(input),
            "fs.read_multi" => fs::read_multi::execute(input),
            "fs.list" => fs::list::execute(input),
            "git.diff" => git::diff::execute(input),
            "interaction.ask" => interaction::ask::execute(input),
            "media.read" => media::read::execute(input),
            "shell.exec" => shell::exec::execute(input),
            "task.spawn" => task::spawn::execute(input),
            "web.fetch" => web::fetch::execute(input),
            "web.search" => web::search::execute(input),
            _ => anyhow::bail!("unknown tool: {}", name),
        }
    }
}
