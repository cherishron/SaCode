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
pub mod test;
pub mod wasm;
pub mod web;

pub use spec::{SideEffectLevel, ToolLayer, ToolOutput, ToolSpec};

use std::{collections::HashMap, sync::Arc};

use crate::model_routing::TaskProfile;

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
    /// 工具分层标签 — 由 [`ToolRegistry::apply_default_layers`] 标注
    layer: ToolLayer,
}

/// 工具注册表 — 同时承载核心层与扩展层工具
///
/// 设计意图（灵枢 · 上下文优化）：
/// - [`ToolRegistry::builtin`] 等价于 core + extended 全集，保持向后兼容
/// - [`ToolRegistry::core_tools`] 仅返回核心层，可在最小 system prompt 中注入
/// - [`ToolRegistry::for_prompt`] 按角色 / 任务画像 / token 预算筛选工具 schema
#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: HashMap<String, RegisteredTool>,
}

/// 核心层工具名清单 — 始终注入 prompt
///
/// 选择原则：体量小、几乎所有任务路径都需要、覆盖文件读写与命令执行的基础能力。
/// 任何扩展都不应让这 4 个工具缺席，否则会破坏 LLM 的基本可用性。
const CORE_TOOL_NAMES: &[&str] = &["fs.read", "fs.write", "fs.edit", "shell.exec"];

/// 任务画像 → 扩展层工具命中规则的静态映射
///
/// 命中条件：task_profile.task_kinds 任一出现在映射 keys 中。
/// 这层映射是"按需注入"的依据，避免把全部 22 个扩展工具描述塞进 prompt。
fn extended_tools_for_task_profile(profile: &TaskProfile) -> Vec<&'static str> {
    let mut wanted: Vec<&'static str> = Vec::new();

    let needs = |kind: &str| profile.task_kinds.iter().any(|k| k == kind);

    if needs("code") || needs("implement") || needs("refactor") {
        wanted.extend(["fs.list", "fs.search", "fs.read_multi", "fs.patch", "code.symbols", "code.deps", "code.search", "git.diff"]);
    }
    if needs("explore") || needs("repo") {
        wanted.extend(["fs.list", "fs.search", "fs.read_multi", "code.symbols", "code.deps", "code.search", "git.diff"]);
    }
    if needs("test") || needs("validate") {
        wanted.extend(["test.run", "test.fix"]);
    }
    if needs("web") || needs("research") {
        wanted.extend(["web.search", "web.fetch"]);
    }
    if needs("media") || needs("image") {
        wanted.extend(["media.read", "media.vision"]);
    }
    if needs("browser") || needs("ui") {
        wanted.extend(["browser.open", "browser.navigate", "browser.snapshot", "browser.extract"]);
    }
    if needs("git") || needs("delivery") {
        wanted.extend(["git.commit", "git.diff", "git.pr"]);
    }
    if needs("interactive") || needs("ask") {
        wanted.extend(["interaction.ask"]);
    }
    if needs("spawn") || needs("parallel") {
        wanted.extend(["task.spawn"]);
    }

    // 任何角色都需要列目录能力，作为兜底
    if wanted.is_empty() {
        wanted.push("fs.list");
    }

    wanted
}

impl ToolRegistry {
    /// 注册全部内置工具（核心层 + 扩展层）
    ///
    /// 向后兼容入口：保持与历史调用方一致的语义，等价于
    /// `core_tools()` + `extended_tools()`。
    pub fn builtin() -> Self {
        let mut registry = Self::default();
        registry.register_fn(browser::open::spec(), browser::open::execute);
        registry.register_fn(browser::navigate::spec(), browser::navigate::execute);
        registry.register_fn(browser::snapshot::spec(), browser::snapshot::execute);
        registry.register_fn(browser::extract::spec(), browser::extract::execute);
        registry.register_fn(code::deps::spec(), code::deps::execute);
        registry.register_fn(code::search::spec(), code::search::execute);
        registry.register_fn(code::symbol::spec(), code::symbol::execute);
        registry.register_fn(fs::read::spec(), fs::read::execute);
        registry.register_fn(fs::search::spec(), fs::search::execute);
        registry.register_fn(fs::write::spec(), fs::write::execute);
        registry.register_fn(fs::edit::spec(), fs::edit::execute);
        registry.register_fn(fs::patch::spec(), fs::patch::execute);
        registry.register_fn(fs::read_multi::spec(), fs::read_multi::execute);
        registry.register_fn(fs::list::spec(), fs::list::execute);
        registry.register_fn(git::commit::spec(), git::commit::execute);
        registry.register_fn(git::diff::spec(), git::diff::execute);
        registry.register_fn(git::pr::spec(), git::pr::execute);
        registry.register_fn(interaction::ask::spec(), interaction::ask::execute);
        registry.register_fn(media::read::spec(), media::read::execute);
        registry.register_fn(media::vision::spec(), media::vision::execute);
        registry.register_fn(shell::exec::spec(), shell::exec::execute);
        registry.register_fn(task::spawn::spec(), task::spawn::execute);
        registry.register_fn(test::autofix::spec(), test::autofix::execute);
        registry.register_fn(test::runner::spec(), test::runner::execute);
        registry.register_fn(web::fetch::spec(), web::fetch::execute);
        registry.register_fn(web::search::spec(), web::search::execute);
        registry.apply_default_layers();
        registry
    }

    /// 仅注册核心层工具 — 用于最小 system prompt 场景
    ///
    /// 设计意图：当上下文预算极紧（例如 SDK 嵌入式调用）时，
    /// 仅暴露 4 个核心工具即可让 LLM 完成基础读写与命令执行。
    pub fn core_tools() -> Self {
        let mut registry = Self::default();
        registry.register_fn(fs::read::spec(), fs::read::execute);
        registry.register_fn(fs::write::spec(), fs::write::execute);
        registry.register_fn(fs::edit::spec(), fs::edit::execute);
        registry.register_fn(shell::exec::spec(), shell::exec::execute);
        registry.apply_default_layers();
        registry
    }

    /// 仅注册扩展层工具 — 通常与 [`core_tools`] 组合使用
    pub fn extended_tools() -> Self {
        let mut registry = Self::default();
        registry.register_fn(browser::open::spec(), browser::open::execute);
        registry.register_fn(browser::navigate::spec(), browser::navigate::execute);
        registry.register_fn(browser::snapshot::spec(), browser::snapshot::execute);
        registry.register_fn(browser::extract::spec(), browser::extract::execute);
        registry.register_fn(code::deps::spec(), code::deps::execute);
        registry.register_fn(code::search::spec(), code::search::execute);
        registry.register_fn(code::symbol::spec(), code::symbol::execute);
        registry.register_fn(fs::search::spec(), fs::search::execute);
        registry.register_fn(fs::patch::spec(), fs::patch::execute);
        registry.register_fn(fs::read_multi::spec(), fs::read_multi::execute);
        registry.register_fn(fs::list::spec(), fs::list::execute);
        registry.register_fn(git::commit::spec(), git::commit::execute);
        registry.register_fn(git::diff::spec(), git::diff::execute);
        registry.register_fn(git::pr::spec(), git::pr::execute);
        registry.register_fn(interaction::ask::spec(), interaction::ask::execute);
        registry.register_fn(media::read::spec(), media::read::execute);
        registry.register_fn(media::vision::spec(), media::vision::execute);
        registry.register_fn(task::spawn::spec(), task::spawn::execute);
        registry.register_fn(test::autofix::spec(), test::autofix::execute);
        registry.register_fn(test::runner::spec(), test::runner::execute);
        registry.register_fn(web::fetch::spec(), web::fetch::execute);
        registry.register_fn(web::search::spec(), web::search::execute);
        registry.apply_default_layers();
        registry
    }

    /// 按 [`ToolLayer`] 标记默认分层
    ///
    /// 各子模块 `spec()` 不感知分层概念，统一在注册后由本方法标注：
    /// 命中 [`CORE_TOOL_NAMES`] 的工具被标记为 [`ToolLayer::Core`]，
    /// 其余保持默认 [`ToolLayer::Extended`]。
    fn apply_default_layers(&mut self) {
        for name in CORE_TOOL_NAMES {
            if let Some(tool) = self.tools.get_mut(*name) {
                tool.layer = ToolLayer::Core;
            }
        }
    }

    pub fn register(&mut self, spec: ToolSpec, executor: Arc<dyn ToolExecutor>) {
        let layer = ToolLayer::default(); // 默认 Extended，由 apply_default_layers 提升
        self.tools.insert(
            spec.name.clone(),
            RegisteredTool {
                spec,
                executor,
                layer,
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

    /// 仅返回指定分层的工具 spec
    pub fn specs_by_layer(&self, layer: ToolLayer) -> Vec<&ToolSpec> {
        self.tools
            .values()
            .filter(|tool| tool.layer == layer)
            .map(|tool| &tool.spec)
            .collect()
    }

    /// 返回核心层工具名（按 [`CORE_TOOL_NAMES`] 顺序）
    pub fn core_layer_names(&self) -> Vec<&str> {
        CORE_TOOL_NAMES
            .iter()
            .filter(|name| self.tools.contains_key(**name))
            .copied()
            .collect()
    }

    /// 返回扩展层工具名（按注册顺序）
    pub fn extended_layer_names(&self) -> Vec<&str> {
        self.tools
            .iter()
            .filter(|(_, tool)| tool.layer == ToolLayer::Extended)
            .map(|(name, _)| name.as_str())
            .collect()
    }

    pub fn get(&self, name: &str) -> Option<&ToolSpec> {
        self.tools.get(name).map(|tool| &tool.spec)
    }

    pub fn execute(&self, name: &str, input: serde_json::Value) -> anyhow::Result<ToolOutput> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("unknown tool: {}", name))?;

        if let Err(error) = sandbox_guard::preflight(&tool.spec, &input) {
            sandbox_guard::audit_execution_result(
                &tool.spec,
                &input,
                None,
                Some(&error.to_string()),
            );
            return Err(error);
        }

        match tool.executor.execute(input.clone()) {
            Ok(output) => {
                sandbox_guard::audit_execution_result(&tool.spec, &input, Some(&output), None);
                Ok(output)
            }
            Err(error) => {
                sandbox_guard::audit_execution_result(
                    &tool.spec,
                    &input,
                    None,
                    Some(&error.to_string()),
                );
                Err(error)
            }
        }
    }

    // ── 灵枢 · 上下文优化 ──────────────────────────────────────────

    /// 按角色 / 任务画像 / token 预算筛选需要注入 prompt 的工具 spec
    ///
    /// 筛选规则（按优先级递减）：
    /// 1. **核心层始终注入**：`fs.read` / `fs.write` / `fs.edit` / `shell.exec`
    ///    保证 LLM 的基础可用性。
    /// 2. **角色白名单**：若 `role.allowed_tools` 非空，扩展层仅注入其列出的工具
    ///    （核心层仍可被角色白名单"额外"声明，但不会因白名单缺失而被剔除）。
    /// 3. **任务画像命中**：若未提供角色白名单，则按 [`TaskProfile::task_kinds`]
    ///    映射出相关扩展工具。
    /// 4. **token 预算裁剪**：若 `context_budget` 给定，按"核心 → 角色命中 → 任务命中"
    ///    顺序累加 spec 字符数，超出预算时截断并返回截断标记。
    ///
    /// 返回值：`(筛选出的 spec 列表, 是否被预算裁剪)`
    pub fn for_prompt(
        &self,
        role: Option<&sacode_kernel::AgentRole>,
        task_profile: Option<&TaskProfile>,
        context_budget: Option<usize>,
    ) -> (Vec<&ToolSpec>, bool) {
        // 1. 收集候选工具名（按优先级顺序，去重）
        let mut ordered_names: Vec<String> = Vec::new();
        let push_if_present = |name: &str, target: &mut Vec<String>| {
            if self.tools.contains_key(name) && !target.iter().any(|n| n == name) {
                target.push(name.to_string());
            }
        };

        // 1a. 核心层（始终注入）
        for name in CORE_TOOL_NAMES {
            push_if_present(name, &mut ordered_names);
        }

        // 1b. 角色白名单（若提供且非空）
        let has_role_whitelist = role
            .map(|r| !r.allowed_tools.is_empty())
            .unwrap_or(false);
        if let Some(role) = role {
            for name in &role.allowed_tools {
                // 白名单里也允许出现核心工具（无害，去重即可）
                push_if_present(name, &mut ordered_names);
            }
        }

        // 1c. 任务画像命中（仅在无角色白名单时启用，避免与白名单语义冲突）
        if !has_role_whitelist {
            if let Some(profile) = task_profile {
                for name in extended_tools_for_task_profile(profile) {
                    push_if_present(name, &mut ordered_names);
                }
            }
        }

        // 2. 解析为 spec 列表
        let mut specs: Vec<&ToolSpec> = ordered_names
            .iter()
            .filter_map(|name| self.tools.get(name).map(|t| &t.spec))
            .collect();

        // 3. token 预算裁剪（按近似 4 字符 / token 估算）
        let trimmed = match context_budget {
            Some(budget) => {
                let mut used_chars: usize = 0;
                let mut kept: Vec<&ToolSpec> = Vec::new();
                let mut overflow = false;
                for spec in specs.drain(..) {
                    let cost = estimate_spec_chars(spec);
                    if used_chars + cost > budget {
                        overflow = true;
                        break;
                    }
                    used_chars += cost;
                    kept.push(spec);
                }
                specs = kept;
                overflow
            }
            None => false,
        };

        (specs, trimmed)
    }
}

/// 近似估算单个 ToolSpec 注入 prompt 的字符开销
///
/// 包含 name / description / input_schema 的字符数，
/// token 估算按 4 字符 / token 折算（与常见 tokenizer 量级一致）。
/// 不引入额外 tokenizer 依赖，仅用于预算裁剪的相对比较。
fn estimate_spec_chars(spec: &ToolSpec) -> usize {
    let schema_chars = spec
        .input_schema
        .to_string()
        .chars()
        .count();
    spec.name.chars().count() + spec.description.chars().count() + schema_chars
}
