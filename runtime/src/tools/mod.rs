pub mod browser;
pub mod code;
pub mod context;
pub mod context_remote;
pub mod fs;
pub mod git;
pub mod interaction;
pub mod interceptor;
pub mod interceptors;
pub mod media;
pub mod sandbox_guard;
pub mod shell;
pub mod spec;
pub mod task;
pub mod test;
pub mod wasm;
pub mod web;

pub use spec::{SideEffectLevel, ToolLayer, ToolOutput, ToolSpec};

use std::{collections::HashMap, path::Path, sync::Arc};

use crate::model_routing::TaskProfile;

use interceptor::{InterceptContext, PostExecuteDecision, PreExecuteDecision, ToolInterceptor};

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
///
/// 工具执行拦截器链（借鉴 DSH 事件流水线，见对比文档 §3.2）：
/// - `interceptors` 按注册顺序在每次执行的 `pre_execute` / `post_execute` 调用
/// - 默认注册 [`crate::tools::interceptors::default::default_interceptors`]，
///   行为等价于原 `sandbox_guard` 检查 + 审计 + 事件发布
#[derive(Clone, Default)]
pub struct ToolRegistry {
    // Arc 包裹使 ToolRegistry::clone() 退化为引用计数递增（O(1)），
    // 消除 executor spawn 循环与 failover 路径中对 26 个工具 spec 的深拷贝。
    // register/apply_default_layers 通过 Arc::make_mut 实现写时复制，
    // 构建期 Arc 唯一引用时不触发额外拷贝。
    tools: Arc<HashMap<String, RegisteredTool>>,
    /// 工具执行拦截器链（pre_execute / post_execute 顺序执行）
    interceptors: Arc<Vec<Arc<dyn ToolInterceptor>>>,
}

impl ToolRegistry {
    /// 注册一个工具执行拦截器（追加到链尾）
    pub fn register_interceptor(&mut self, interceptor: Arc<dyn ToolInterceptor>) {
        // 写时复制：确保本 registry 的拦截器链与其他 clone 隔离
        let mut chain = (*self.interceptors).clone();
        chain.push(interceptor);
        self.interceptors = Arc::new(chain);
    }

    /// 用默认拦截器链初始化（等价于原 `sandbox_guard` 行为）
    pub fn with_default_interceptors(mut self) -> Self {
        for interceptor in interceptors::default::default_interceptors() {
            self.register_interceptor(Arc::from(interceptor));
        }
        self
    }

    /// 按 Profile 的 `extra.interceptors` 配置挂载**额外**拦截器
    ///
    /// 不重复挂载默认拦截器链（`builtin()` 等构造器已调用 `with_default_interceptors()`），
    /// 仅追加 Profile 声明的拦截器。未知名称 warn 跳过，不阻断启动。
    pub fn with_profile_interceptors(
        mut self,
        profile: Option<&crate::config::profile::Profile>,
    ) -> Self {
        if let Some(profile) = profile {
            if let Some(extra) = profile.manifest.extra.get("interceptors") {
                if let Some(names) = extra.as_array() {
                    for name in names {
                        if let Some(n) = name.as_str() {
                            if let Some(interceptor) = interceptors::default::interceptor_by_name(n)
                            {
                                self.register_interceptor(Arc::from(interceptor));
                            } else {
                                tracing::warn!("unknown interceptor '{}' in profile, skipped", n);
                            }
                        }
                    }
                } else {
                    // N4: interceptors 必须是数组，非数组时 warn（与 unknown name warn 对称）
                    tracing::warn!("profile.interceptors must be an array, got: {:?}", extra);
                }
            }
        }
        self
    }
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
        wanted.extend([
            "fs.list",
            "fs.search",
            "fs.read_multi",
            "fs.patch",
            "code.symbols",
            "code.deps",
            "code.search",
            "git.diff",
        ]);
    }
    if needs("explore") || needs("repo") {
        wanted.extend([
            "fs.list",
            "fs.search",
            "fs.read_multi",
            "code.symbols",
            "code.deps",
            "code.search",
            "git.diff",
        ]);
    }
    if needs("test") || needs("validate") {
        wanted.extend(["test.run", "test.fix"]);
    }
    if needs("web") || needs("research") {
        wanted.extend(["web.search", "web.fetch"]);
    }
    if needs("media") || needs("image") || needs("video") {
        wanted.extend(["media.read", "media.vision", "media.video"]);
    }
    if needs("browser") || needs("ui") {
        wanted.extend([
            "browser.open",
            "browser.navigate",
            "browser.snapshot",
            "browser.extract",
        ]);
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
        registry.register_fn(fs::apply_patch::spec(), fs::apply_patch::execute);
        registry.register_fn(git::commit::spec(), git::commit::execute);
        registry.register_fn(git::diff::spec(), git::diff::execute);
        registry.register_fn(git::pr::spec(), git::pr::execute);
        registry.register_fn(git::push::spec(), git::push::execute);
        registry.register_fn(interaction::ask::spec(), interaction::ask::execute);
        registry.register_fn(media::read::spec(), media::read::execute);
        registry.register_fn(media::vision::spec(), media::vision::execute);
        registry.register_fn(media::video::spec(), media::video::execute);
        registry.register_fn(shell::exec::spec(), shell::exec::execute);
        registry.register_fn(task::spawn::spec(), task::spawn::execute);
        registry.register_fn(test::autofix::spec(), test::autofix::execute);
        registry.register_fn(test::runner::spec(), test::runner::execute);
        registry.register_fn(web::fetch::spec(), web::fetch::execute);
        registry.register_fn(web::search::spec(), web::search::execute);
        registry.apply_default_layers();
        registry.with_default_interceptors()
    }

    /// 注册全部内置工具 + workdir 下发现的 WASM 插件工具
    ///
    /// 设计意图：
    /// - 在 [`builtin`] 基础上追加 `.sacode/plugins/` 下的 WASM 工具
    /// - WASM 加载失败不阻断主流程：仅 stderr 警告，返回已构建的 registry
    /// - 用于 CLI 主执行路径 / orchestrator / worker agent 等需要完整工具集的入口
    ///
    /// 注意：WASM 工具归为 Extended 层（动态注册，不计入 29 个 builtin）。
    pub fn builtin_with_wasm(workdir: &Path) -> Self {
        let mut registry = Self::builtin();
        if let Err(error) = wasm::register_wasm_tools(&mut registry, workdir) {
            eprintln!("wasm tools registration skipped: {error}");
        }
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
        registry.with_default_interceptors()
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
        registry.register_fn(fs::apply_patch::spec(), fs::apply_patch::execute);
        registry.register_fn(git::commit::spec(), git::commit::execute);
        registry.register_fn(git::diff::spec(), git::diff::execute);
        registry.register_fn(git::pr::spec(), git::pr::execute);
        registry.register_fn(git::push::spec(), git::push::execute);
        registry.register_fn(interaction::ask::spec(), interaction::ask::execute);
        registry.register_fn(media::read::spec(), media::read::execute);
        registry.register_fn(media::vision::spec(), media::vision::execute);
        registry.register_fn(media::video::spec(), media::video::execute);
        registry.register_fn(task::spawn::spec(), task::spawn::execute);
        registry.register_fn(test::autofix::spec(), test::autofix::execute);
        registry.register_fn(test::runner::spec(), test::runner::execute);
        registry.register_fn(web::fetch::spec(), web::fetch::execute);
        registry.register_fn(web::search::spec(), web::search::execute);
        registry.apply_default_layers();
        registry.with_default_interceptors()
    }

    /// 按 [`ToolLayer`] 标记默认分层
    ///
    /// 各子模块 `spec()` 不感知分层概念，统一在注册后由本方法标注：
    /// 命中 [`CORE_TOOL_NAMES`] 的工具被标记为 [`ToolLayer::Core`]，
    /// 其余保持默认 [`ToolLayer::Extended`]。
    fn apply_default_layers(&mut self) {
        // Arc::make_mut：构建期 Arc 唯一引用时零拷贝获取可变句柄；
        // clone 后调用才会触发写时复制（当前调用方都是构建后立即标注，不会触发）。
        let tools = Arc::make_mut(&mut self.tools);
        for name in CORE_TOOL_NAMES {
            if let Some(tool) = tools.get_mut(*name) {
                tool.layer = ToolLayer::Core;
            }
        }
    }

    pub fn register(&mut self, spec: ToolSpec, executor: Arc<dyn ToolExecutor>) {
        let layer = ToolLayer::default(); // 默认 Extended，由 apply_default_layers 提升
        Arc::make_mut(&mut self.tools).insert(
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
        self.execute_with_ctx(name, input, &InterceptContext::default())
    }

    /// 带拦截器上下文的工具执行（走 §3.2 拦截器链）
    ///
    /// 执行流程：
    /// 1. `pre_execute` 链顺序执行（网络/命令/路径策略、审计 preflight_start、事件发布）
    ///    - `Deny` 中断执行并返回错误（同时发布 ToolCallDenied 事件）
    ///    - `Modify` 改写后续执行的 input
    /// 2. 执行工具 executor（使用最终 input）
    /// 3. `post_execute` 链顺序执行（审计 result、事件发布、结果改写）
    ///    - `Transform` 改写返回给调用方的 output
    ///
    /// 默认拦截器链等价于原 `sandbox_guard::preflight` + `audit_execution_result` 行为，
    /// 额外把工具调用事件发布到持久化 `SessionEventLog`（§3.1 事件流投影第一步）。
    pub fn execute_with_ctx(
        &self,
        name: &str,
        input: serde_json::Value,
        ctx: &InterceptContext,
    ) -> anyhow::Result<ToolOutput> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("unknown tool: {}", name))?;

        // ── pre_execute 链 ──
        let mut effective_input = input.clone();
        let mut deny_reason: Option<String> = None;
        for interceptor in self.interceptors.iter() {
            match interceptor.pre_execute(&tool.spec, &effective_input, ctx) {
                PreExecuteDecision::Allow => {}
                PreExecuteDecision::Deny { reason } => {
                    deny_reason = Some(reason);
                    break;
                }
                PreExecuteDecision::Modify { new_input } => {
                    effective_input = new_input;
                }
            }
        }

        // ── post_execute 链（无论 pre 是否 Deny、exec 是否成功都执行，保证审计完整）──
        let exec_result = match &deny_reason {
            Some(reason) => Err(anyhow::anyhow!(reason.clone())),
            None => tool.executor.execute(effective_input.clone()),
        };

        let mut final_output: Option<ToolOutput> = None;
        let mut final_error: Option<String> = None;
        match &exec_result {
            Ok(output) => final_output = Some(output.clone()),
            Err(error) => final_error = Some(error.to_string()),
        }

        for interceptor in self.interceptors.iter() {
            match interceptor.post_execute(
                &tool.spec,
                &effective_input,
                final_output.as_ref(),
                final_error.as_deref(),
                ctx,
            ) {
                PostExecuteDecision::Keep => {}
                // 重试策略留作第二步（v1.2 异步拦截器），本期等价于 Keep
                PostExecuteDecision::Retry { .. } => {}
                PostExecuteDecision::Transform { new_output } => {
                    final_output = Some(new_output);
                }
            }
        }

        exec_result
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
        let has_role_whitelist = role.map(|r| !r.allowed_tools.is_empty()).unwrap_or(false);
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

    /// §3.4 深化：在 [`for_prompt`] 基础上叠加命名 Profile 的工具集约束。
    ///
    /// 先按原有角色白名单 / 任务画像 / token 预算筛选出候选工具，
    /// 再用 Profile 的 `enabled_tools`（glob 白名单）与 `disabled_tools`
    /// （剔除）做最终约束。核心层 4 工具仍始终保留（与 `for_prompt` 一致），
    /// 不会被 Profile 的 `enabled_tools` 误剔。
    ///
    /// 返回 `(筛选出的 spec 列表, 是否被预算裁剪)`。
    pub fn for_prompt_with_profile(
        &self,
        role: Option<&sacode_kernel::AgentRole>,
        task_profile: Option<&TaskProfile>,
        profile: Option<&crate::config::profile::Profile>,
        context_budget: Option<usize>,
    ) -> (Vec<&ToolSpec>, bool) {
        let (mut specs, trimmed) = self.for_prompt(role, task_profile, context_budget);

        let Some(profile) = profile else {
            return (specs, trimmed);
        };

        let manifest = &profile.manifest;
        if manifest.enabled_tools.is_empty() && manifest.disabled_tools.is_empty() {
            return (specs, trimmed);
        }

        // 核心层工具名集合（始终保留，不受 enabled_tools 影响）
        let core: std::collections::HashSet<String> =
            CORE_TOOL_NAMES.iter().map(|s| s.to_string()).collect();

        specs.retain(|spec| {
            // 核心层始终保留
            if core.contains(&spec.name) {
                return true;
            }
            // 先应用 enabled_tools 白名单（非空时）
            if !manifest.enabled_tools.is_empty()
                && !manifest
                    .enabled_tools
                    .iter()
                    .any(|pat| glob_match(pat, &spec.name))
            {
                return false;
            }
            // 再剔除 disabled_tools
            if manifest
                .disabled_tools
                .iter()
                .any(|pat| glob_match(pat, &spec.name))
            {
                return false;
            }
            true
        });

        (specs, trimmed)
    }
}

/// re-export glob_match 供 ToolRegistry 的 for_prompt_with_profile 复用
/// （定义在 config::profile，避免重复实现）
use crate::config::profile::glob_match;

/// 近似估算单个 ToolSpec 注入 prompt 的字符开销
///
/// 包含 name / description / input_schema 的字符数，
/// token 估算按 4 字符 / token 折算（与常见 tokenizer 量级一致）。
/// 不引入额外 tokenizer 依赖，仅用于预算裁剪的相对比较。
fn estimate_spec_chars(spec: &ToolSpec) -> usize {
    let schema_chars = spec.input_schema.to_string().chars().count();
    spec.name.chars().count() + spec.description.chars().count() + schema_chars
}

#[cfg(test)]
mod tests {
    use super::*;

    /// builtin_with_wasm 在无 .sacode/plugins 目录时等价于 builtin
    /// 验证 WASM 注册失败不阻断主流程
    #[test]
    fn builtin_with_wasm_falls_back_to_builtin_when_no_plugins_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let registry = ToolRegistry::builtin_with_wasm(tmp.path());

        // 核心层 4 个工具必须存在
        assert!(registry.get("fs.read").is_some());
        assert!(registry.get("fs.write").is_some());
        assert!(registry.get("fs.edit").is_some());
        assert!(registry.get("shell.exec").is_some());

        // 无 WASM 工具
        assert!(registry
            .specs()
            .iter()
            .all(|s| !s.name.starts_with(super::wasm::WASM_TOOL_PREFIX)));
    }

    /// builtin_with_wasm 加载 .sacode/plugins 下的 WASM 插件
    #[test]
    fn builtin_with_wasm_registers_wasm_plugin_from_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let plugins_root = tmp.path().join(".sacode").join("plugins");
        let plugin_dir = plugins_root.join("demo");
        std::fs::create_dir_all(&plugin_dir).expect("create plugin dir");

        // 写入 manifest（声明一个 greet 函数）
        let manifest = r#"{"name":"demo","version":"0.1.0","description":"demo","wasm_path":"plugin.wasm","functions":[{"name":"greet","description":"say hi","input_schema":{"type":"object"},"output_schema":{"type":"string"},"side_effect_level":null}]}"#;
        std::fs::write(plugin_dir.join("manifest.json"), manifest).expect("write manifest");
        // 写入 WASM magic + version 1 占位（extism 加载可能失败，但 ToolSpec 注册不依赖实际加载）
        std::fs::write(plugin_dir.join("plugin.wasm"), b"\0asm\x01\x00\x00\x00")
            .expect("write wasm");

        let registry = ToolRegistry::builtin_with_wasm(tmp.path());
        // WASM 工具应出现在 registry 中
        let wasm_tool = registry.get("wasm.demo.greet");
        assert!(wasm_tool.is_some(), "wasm tool should be registered");
        assert_eq!(
            wasm_tool.unwrap().description,
            "say hi",
            "wasm tool description should come from manifest"
        );
    }

    /// §3.4 深化：for_prompt_with_profile 应用 Profile 工具集约束
    ///
    /// 语义：Profile 的 enabled_tools 仅对 `for_prompt` 已产出的候选集做白名单
    /// 过滤（不主动新增工具）。核心层 4 工具始终保留。
    #[test]
    fn for_prompt_with_profile_constrains_tools() {
        let registry = ToolRegistry::builtin();

        // 构造一个会命中 web + git + media 的任务画像，使候选集包含这些扩展工具
        let mut task_profile = crate::model_routing::TaskProfile::default();
        task_profile.task_kinds.extend(
            ["web", "git", "media", "test"]
                .iter()
                .map(|s| s.to_string()),
        );

        // 构造一个只放行 fs/web 的 Profile
        let mut manifest = crate::config::profile::ProfileManifest::default();
        manifest.name = "web".to_string();
        manifest.enabled_tools = vec!["fs.*".to_string(), "web.*".to_string()];
        let profile = crate::config::profile::Profile {
            name: "web".to_string(),
            inheritance_chain: vec!["web".to_string()],
            manifest,
        };

        let (specs, _) =
            registry.for_prompt_with_profile(None, Some(&task_profile), Some(&profile), None);
        let names: Vec<&str> = specs.iter().map(|s| s.name.as_str()).collect();

        // 核心层 4 工具始终保留
        assert!(names.contains(&"fs.read"));
        assert!(names.contains(&"fs.write"));
        assert!(names.contains(&"fs.edit"));
        assert!(names.contains(&"shell.exec"));

        // 扩展层受 enabled_tools 约束：web.* 通过（命中任务画像且在白名单内）
        assert!(
            names.iter().any(|n| n.starts_with("web.")),
            "web.* glob should match"
        );

        // git/media/test 命中了任务画像，但被 Profile 的 enabled_tools 白名单剔除
        assert!(
            !names.contains(&"git.commit"),
            "git.* outside web/fs glob should be filtered"
        );
        assert!(
            !names.contains(&"media.read"),
            "media.* should be filtered by profile"
        );
        assert!(
            !names.contains(&"test.run"),
            "test.* should be filtered by profile"
        );
        // 不存在任何不在 web.* 或核心层之外的扩展工具
        for n in &names {
            if n.starts_with("web.") {
                continue;
            }
            assert!(
                ["fs.read", "fs.write", "fs.edit", "shell.exec"].contains(n),
                "unexpected tool leaked past profile whitelist: {n}"
            );
        }
    }

    /// §3.4 深化：无 Profile 时 for_prompt_with_profile 退化为 for_prompt
    #[test]
    fn for_prompt_with_profile_none_is_full() {
        let registry = ToolRegistry::builtin();
        let (specs, _) = registry.for_prompt_with_profile(None, None, None, None);
        // 无 Profile 时，除核心层外仍有任务画像命中兜底（fs.list 等）
        assert!(specs.iter().any(|s| s.name == "fs.read"));
    }

    /// §3.4 深化：disabled_tools 显式剔除（即便任务画像命中）
    #[test]
    fn for_prompt_with_profile_disabled_tools_remove() {
        let registry = ToolRegistry::builtin();
        let mut task_profile = crate::model_routing::TaskProfile::default();
        task_profile
            .task_kinds
            .extend(["git", "web"].iter().map(|s| s.to_string()));

        let mut manifest = crate::config::profile::ProfileManifest::default();
        manifest.name = "no-git-push".to_string();
        manifest.disabled_tools = vec!["git.push".to_string()];
        let profile = crate::config::profile::Profile {
            name: "no-git-push".to_string(),
            inheritance_chain: vec!["no-git-push".to_string()],
            manifest,
        };

        let (specs, _) =
            registry.for_prompt_with_profile(None, Some(&task_profile), Some(&profile), None);
        let names: Vec<&str> = specs.iter().map(|s| s.name.as_str()).collect();
        // git.commit 仍应保留（仅 git.push 被禁用）
        assert!(names.contains(&"git.commit"), "git.commit should survive");
        assert!(!names.contains(&"git.push"), "git.push should be disabled");
    }

    /// 默认拦截器链应恰好挂载一次；`with_profile_interceptors` 不重复追加。
    #[test]
    fn with_profile_interceptors_does_not_duplicate_defaults() {
        let default_len = ToolRegistry::builtin().interceptors.len();

        let no_profile_len = ToolRegistry::builtin()
            .with_profile_interceptors(None)
            .interceptors
            .len();
        assert_eq!(
            no_profile_len, default_len,
            "with_profile_interceptors(None) 不应重复挂载默认拦截器"
        );

        let profile = crate::config::profile::Profile {
            name: "audit".to_string(),
            inheritance_chain: vec![],
            manifest: {
                let mut m = crate::config::profile::ProfileManifest::default();
                m.extra
                    .insert("interceptors".to_string(), serde_json::json!(["audit"]));
                m
            },
        };
        let with_profile_len = ToolRegistry::builtin()
            .with_profile_interceptors(Some(&profile))
            .interceptors
            .len();
        assert_eq!(
            with_profile_len,
            default_len + 1,
            "with_profile_interceptors 应仅追加 profile 声明的拦截器，且不重复默认链"
        );
    }

    /// profile.interceptors 非数组时 warn 且不追加拦截器。
    #[test]
    fn with_profile_interceptors_warns_on_non_array() {
        let default_len = ToolRegistry::builtin().interceptors.len();

        let profile = crate::config::profile::Profile {
            name: "bad".to_string(),
            inheritance_chain: vec![],
            manifest: {
                let mut m = crate::config::profile::ProfileManifest::default();
                m.extra
                    .insert("interceptors".to_string(), serde_json::json!("audit"));
                m
            },
        };
        let len = ToolRegistry::builtin()
            .with_profile_interceptors(Some(&profile))
            .interceptors
            .len();
        assert_eq!(len, default_len, "非数组 interceptors 不应追加任何拦截器");
    }
}
