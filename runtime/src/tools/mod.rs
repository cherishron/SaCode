pub mod browser;
pub mod code;
pub mod fs;
pub mod git;
pub mod interaction;
pub mod media;
pub mod sandbox_guard;
pub mod shell;
pub mod spec;
pub mod task;
pub mod web;

pub use spec::{ToolSpec, ToolOutput, SideEffectLevel};

use std::{collections::HashMap, sync::Arc};

pub trait ToolExecutor: Send + Sync {
    fn execute(&self, input: serde_json::Value) -> anyhow::Result<ToolOutput>;
}

#[derive(Clone)]
struct FnToolExecutor {
    execute_fn: fn(serde_json::Value) -> anyhow::Result<ToolOutput>,
}

impl ToolExecutor for FnToolExecutor {
    fn execute(&self, input: serde_json::Value) -> anyhow::Result<ToolOutput> {
        (self.execute_fn)(input)
    }
}

#[derive(Clone)]
struct RegisteredTool {
    spec: ToolSpec,
    executor: Arc<dyn ToolExecutor>,
}

#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: HashMap<String, RegisteredTool>,
}

impl ToolRegistry {
    pub fn builtin() -> Self {
        let mut registry = Self::default();
        registry.register_fn(browser::open::spec(), browser::open::execute);
        registry.register_fn(browser::navigate::spec(), browser::navigate::execute);
        registry.register_fn(browser::snapshot::spec(), browser::snapshot::execute);
        registry.register_fn(browser::extract::spec(), browser::extract::execute);
        registry.register_fn(fs::read::spec(), fs::read::execute);
        registry.register_fn(fs::search::spec(), fs::search::execute);
        registry.register_fn(fs::write::spec(), fs::write::execute);
        registry.register_fn(fs::edit::spec(), fs::edit::execute);
        registry.register_fn(fs::read_multi::spec(), fs::read_multi::execute);
        registry.register_fn(fs::list::spec(), fs::list::execute);
        registry.register_fn(git::diff::spec(), git::diff::execute);
        registry.register_fn(interaction::ask::spec(), interaction::ask::execute);
        registry.register_fn(media::read::spec(), media::read::execute);
        registry.register_fn(shell::exec::spec(), shell::exec::execute);
        registry.register_fn(task::spawn::spec(), task::spawn::execute);
        registry.register_fn(web::fetch::spec(), web::fetch::execute);
        registry.register_fn(web::search::spec(), web::search::execute);
        registry
    }

    pub fn register(&mut self, spec: ToolSpec, executor: Arc<dyn ToolExecutor>) {
        self.tools.insert(
            spec.name.clone(),
            RegisteredTool {
                spec,
                executor,
            },
        );
    }

    pub fn register_fn(
        &mut self,
        spec: ToolSpec,
        execute_fn: fn(serde_json::Value) -> anyhow::Result<ToolOutput>,
    ) {
        self.register(spec, Arc::new(FnToolExecutor { execute_fn }));
    }

    pub fn names(&self) -> Vec<&str> {
        self.tools.keys().map(|s| s.as_str()).collect()
    }

    pub fn specs(&self) -> Vec<&ToolSpec> {
        self.tools.values().map(|tool| &tool.spec).collect()
    }

    pub fn get(&self, name: &str) -> Option<&ToolSpec> {
        self.tools.get(name).map(|tool| &tool.spec)
    }

    pub fn execute(&self, name: &str, input: serde_json::Value) -> anyhow::Result<ToolOutput> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("unknown tool: {}", name))?;

        sandbox_guard::preflight(&tool.spec, &input)?;
        tool.executor.execute(input)
    }
}
