pub mod code;
pub mod fs;
pub mod git;
pub mod shell;
pub mod spec;

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
        tools.insert("git.diff".to_string(), git::diff::spec());
        tools.insert("shell.exec".to_string(), shell::exec::spec());
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
            "git.diff" => git::diff::execute(input),
            "shell.exec" => shell::exec::execute(input),
            _ => anyhow::bail!("unknown tool: {}", name),
        }
    }
}
