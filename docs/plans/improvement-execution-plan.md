# SaCode 改进实施计划（细化版）

> **状态：已归档（2026-09-03）**。计划中的代码、文档与 VSCode MVP 已落地；代表性证据包括 `e53612a`、`5925de3`、`d415e16`、`f5f79fa`、`7576005`、`78ad9f8`，审批交互后续由 `6694d3b`、`432fe10`、`77d4c1e` 加固。本文件保留为历史实施记录，不再作为当前待办真源。
>
> **验证口径**：仓库自动化验证以基线提交和实际命令为准，不沿用历史累计测试数字。当前 Windows 基线见 `21f8f43`：workspace 非 doctest 测试通过，runtime 为 601 passed / 1 个显式 quarantine ignored；该 quarantine 已按完整测试路径单独运行通过。

> 依据：`.monkeycode/uploads/report-plan.md`（《SaCode 改进规划方案》）
> 本文件将报告 8 个步骤细化为可执行改动清单（文件级、函数级、验证方式），并标注现状差异与分批交付策略。
> 最后更新：2026-08-18

---

## 一、现状与报告假设的差异对照（先决条件）

| 报告假设 | 现状核实 | 处理方式 |
|----------|----------|----------|
| 定位未声明国内 | PRD v1.2 已声明"面向国内开发者" | 步骤 3 只做增量修订 |
| getting-started/tutorials 太长 | 已重写：getting-started 396 行、tutorials 349 行 cheat sheet | 步骤 1.2 收尾：示例改国内 provider |
| 知识 9 文件 | 实际 4 memory 文件 + mistakes/sessions/index/profile/project ≈ 9 知识源 | 步骤 4.2 合并到 3 文件 |
| Loop 四层过重 | 数据模型已落地但逻辑未接线（plan 传 None） | 步骤 4.1 轻量化成本低 |
| 五维冲突 | `collect_conflict_records` 5 类，validation_conflict 走自动修复（无真审批） | 步骤 4.3 简化为审批+拦截 |
| /login 两套实现 | REPL 文本向导 + TUI 两步向导，preset 硬编码 5 个 | 步骤 1.1 统一收敛 |
| 首次启动无引导 | REPL/TUI 启动均不检测 provider | 步骤 1.1 加首次引导 |
| docs/report.md 缺失 | 报告在 uploads/，docs 引用为幽灵引用 | 步骤 3 补引用/搬运 |
| PRD 拼写错误 | "MuluanPSL-2.0" | 步骤 3 修复 |

---

## 二、分批交付策略

全量 8 步骤按依赖与 ROI 分 4 批：

| 批次 | 内容 | 说明 |
|------|------|------|
| **批 1（体验+定位）** | 步骤 1 + 3 | 独立、ROI 最高、文档先行 |
| **批 2（简化）** | 步骤 4 | 代码改动集中、需回归测试 |
| **批 3（强化）** | 步骤 5 + 6 | TUI 密集改动 |
| **批 4（场景+生态）** | 步骤 7 + 8 + 2 | 新建工程/评估类 |

每批完成 → `cargo build -p sacode-cli --bins` + `cargo test --workspace` 回归。

---

## 三、步骤 1 — 首次体验优化（P0）

### 1.1 /login 交互式选择流程

**目标：** 首次配置 ≤2 步（选择 provider → 输入 Key），隐藏 Base URL。

**改动点：**

1. **统一 provider 预设源**（`kernel/src/model/provider.rs`）
   - 检查 `preset_providers()`（现有 6 个）与 config.json 实际 7 个 provider 的差异
   - 补齐：DeepSeek、通义千问（Qwen）、智谱 GLM、OpenAI、自定义（≥5 个必选）
   - 每个预设含：name、base_url、默认 model、显示名

2. **共享登录向导状态机**（新增 `interfaces/cli/src/provider_wizard.rs` 或并入 `provider_config.rs`）
   - 输入：无（交互式）或 `--provider <name> --api-key <key>`（非交互）
   - 流程：选预设 → 输 Key → 调 `connect_provider`（自动拉模型 + 写默认 rule）→ 写 provider.json + config.json
   - 供 REPL `/login` 与 TUI 登录向导共同调用

3. **REPL `/login` 重构**（`interfaces/cli/src/repl.rs:702` 附近）
   - 从"输入 name/base_url/api_key 四步"改为"预设选择 + Key"

4. **TUI 登录向导收敛**（`interfaces/cli/src/tui/provider_actions.rs`）
   - `/connect` 的硬编码 5 个 preset 改为调用共享预设
   - 保留"自定义 Base URL"入口

5. **首次启动强引导**（`repl.rs` / `tui/bootstrap.rs`）
   - 启动时若 `current_provider == None` → 提示"未配置模型服务，运行 /login"或直接弹出登录向导
   - TUI：非阻塞提示 + 一键进入向导；REPL：启动横幅提示

**验证：** 删除 `.sacode/provider.json` 后启动 → 看到引导；跑通交互式登录；`doctor` 显示正确 provider。

### 1.2 上手文档收尾

- `docs/guides/getting-started.md`：示例从 openai.com 改为 DeepSeek/智谱
- `docs/guides/tutorials.md`：核对 cheat sheet 完整性
- 新增 `docs/guides/provider-quickstart.md`：各国内 provider 获取 Key 的方法

---

## 四、步骤 3 — 定位聚焦（P2）

### 3.1 PRD 修订（`docs/product/PRD.md`）
- 修复第 12 行 `MuluanPSL-2.0` → `MulanPSL-2.0`
- 版本号 v1.2 → v1.3（标注定位收敛说明）
- 补充"平台化收敛声明"小节：ACP/LSP/Daemon 维持现状不新增

### 3.2 roadmap 修订（`docs/product/roadmap.md`）
- 修复 v1.0+ 状态符号不统一（103 行 ✅+🚧 vs 153 行 🟨）
- 补齐 `docs/report.md`、`docs/report-plan.md` 幽灵引用：
  - 将 `.monkeycode/uploads/report-plan.md` 复制到 `docs/` 或修改引用
  - 若无 report.md 正文，可生成摘要版或删除引用
- 明确 v1.2+ 平台能力维持现状

### 3.3 docs/README.md 同步
- 修正对 report.md / report-plan.md 的引用

---

## 五、步骤 4 — 过度设计简化（P3）

### 4.1 Loop 四层 → 轻量 /goal
- 现状：`loop_state.rs` 四层数据模型已落地，但 orchestrator plan 传 None（未接线）
- 改动：在 `interfaces/cli/src/cmd/orchestrator_entry.rs` 新增 `/goal <完成条件>` 命令
  - 简单执行：给定完成条件 → 单次任务执行 → 检测完成（复用 final_output 判定）
  - 不引入显式状态机；保留既有 `/loop` 不动（延后，避免回归）

### 4.2 知识系统 9 → 3 文件
- 改动点（两处映射）：
  - `runtime/src/memory/mod.rs:21-26` `MemoryKind` 枚举 → `Project` / `Experience` / `Preferences`
  - `runtime/src/wiki/mod.rs:22-27` `MEMORY_WIKI_FILES` → `project.md` / `experience.md` / `preferences.md`
- 迁移：新增迁移脚本或迁移命令（`/memory migrate`），把现有 memory/preferences/workflows/decisions/project-profile 内容归并到 3 文件，旧文件保留备份
- 更新 tutorials.md:241 标注（已是 3 文件方向）
- 注意：更新所有引用旧文件名的代码（inspect_wiki、memory 命令 list/path 等）

### 4.3 五维冲突 → 审批+拦截
- `runtime/src/agents/orchestrator.rs:441-579` `collect_conflict_records`：
  - 保留 `validation_conflict`（核心主路径）
  - 简化：`status/route/conclusion/polarity` 四类降级为日志记录，不再触发独立干预
- `handle_conflict_disposition`（115-190）：
  - `validation_conflict` 的自动 `dispatch_fix_loop` 改为经 ApprovalPolicy 审批（ApprovalDecider）
  - 危险命令拦截保持 `sandbox_guard` 既有逻辑
- 删除/降级 `conflict_records` 结构中的冗余维度（保留兼容序列化）

### 4.4 AutoLearner 调整
- 保留 mistakes → candidate → 审核闭环
- BM25 + 衰减已实现且工作正常：**不删除**，仅在代码注释与文档标注"知识量 <100 时 BM25 收益有限"，避免回归

### 4.5 yolo → auto 命名
- `schema/task.rs:10` `ExecutionMode::Yolo`：
  - 方案：保留变体名 `Yolo`（避免大规模改动），Display 输出 `auto`，serde 反序列化同时接受 `yolo`/`auto`（alias）
  - 更新 `/mode`、`--mode` 帮助文本、footer 显示为 `auto`
  - tutorials.md:123 已声明意图，同步更新

---

## 六、步骤 5 — 核心机制强化（P4）

### 5.1 三级模式视觉强化
- `interfaces/cli/src/tui/render/header_footer.rs:183-246` footer 增加模式名显示（`Mode: plan/build/auto`）
- 任务进行中显示当前模式 + 执行阶段

### 5.2 沙箱审计文档化 + 审批弹窗
- 审计日志格式文档化：新增 `docs/reference/audit-log.md`（字段、SIEM 接入示例）
- 审批弹窗：将 `modals.rs:87` 居中 `render_pending_question_panel` 从 `#[cfg(test)]` 提升到生产路径（`tui_entry.rs` 的 `ui()`），build 模式弹出显示操作+影响范围+确认/拒绝

### 5.3 checkpoint 进度
- `runtime/src/agents/checkpoint.rs`（如存在）：补充进度字段（当前/总数）
- TUI Loop 顶部进度条：`Phase 2/5 ●●○○○`（新增 render 组件）

---

## 七、步骤 6 — TUI 信息密度（P4 伴生）

### 6.1 工具调用卡片
- `interfaces/cli/src/tui/render/main_layout.rs:180-214` 增强工具行渲染：
  - 状态图标（✓/✗）、耗时、输出摘要（成功/失败 + 摘要）
  - 可折叠：展开显示完整输出
- 数据来源：现有 `Event::ToolCallStarted/Finished` 的 name/success/output，增加 duration 字段（runner.rs:445-456）

### 6.2 审批流可视化
- 见 5.2 弹窗

### 6.3 命令体系分层
- `interfaces/cli/src/tui/commands.rs` 一级命令表标注层级：
  - L1（5 个）：`/login`、`/models`、`/mode`、`/agents`、`/help`
  - L2（按需发现）：`/memory`、`/wiki`、`/loop`、`/checkpoint`
  - L3：CLI 子命令不暴露
- `/help` 按当前模式（plan/build/auto）显示相关命令

---

## 八、步骤 7 — 场景补齐（P5）

### 7.1 CI/CD 集成
- 新增 `.github/workflows/sacode-ci.yml` 模板（Ghost 模式 + `--json`）
- 新增 `docs/guides/ci-integration.md`（GitHub Actions / GitLab CI 示例）

### 7.2 代码审查增强
- `skills/` 中 `/review-pr` skill 增强：对 diff 输出变更影响面、风险点、建议（结构化）

### 7.3 远程开发
- 新增 `docs/guides/remote-development.md`（SSH + 终端兼容性说明）

### 7.4 测试编写流程
- `docs/guides/tutorials.md` 或新文档："分析代码→生成测试→运行验证"一键流程（结合 test.run 自动检测 cargo/npm/go/pytest）

---

## 九、步骤 8 — 开源策略评估（伴随性）

- 新增 `docs/decision/open-source-strategy.md`：
  - MulanPSL-2.0 → MIT/Apache-2.0 评估（影响、既有贡献者授权、过渡方案）
  - npm 分发策略评估（预编译 vs 源码构建）
- **只产出评估文档，不改 LICENSE**（需法律审查）

---

## 十、步骤 2 — VSCode 扩展 MVP（P1，独立批次）

### 2.1 扩展工程（新增 `interfaces/vscode/`）
- `package.json`：activationEvents、contributes.commands/views
- `extension.js` / `src/extension.ts`：侧边栏 Webview 面板
- 复用 daemon HTTP/SSE（`/api/stream`、`/events`，支持 task_id 过滤）
- MVP 范围：发起任务、查看工具调用、显示结果（不做编辑器内联）

### 2.2 `sacode ide` 命令升级（`interfaces/cli/src/cmd/ide.rs`）
- 从"仅生成配置"升级为"安装/激活 VSCode 扩展"（检测 VSCode CLI、拷贝扩展、提示激活）

### 2.3 验证
- 手动：启动 `sacode serve` → VSCode 扩展连接 → 发任务看 SSE 流（无自动化测试，人工验收）

---

## 十一、风险与回归控制

| 风险 | 控制 |
|------|------|
| 知识文件合并破坏 memory/wiki 命令 | 每改动点前跑 `cargo test --workspace`；迁移脚本保留备份 |
| 冲突检测简化破坏 orchestrator | 保留 validation_conflict 主路径；只降级不删除序列化字段 |
| yolo 命名破坏现有配置 | serde alias 兼容旧值 |
| 批 4 VSCode 扩展范围失控 | 严格 MVP：发任务+看结果 |

## 十二、验收清单（全量完成后）

- [x] `/login` 两步交互配置与首次启动引导已落地
- [x] `doctor` 可显示配置的国内 provider
- [x] PRD/roadmap/README 定位与文档引用已完成一致性整理
- [x] `/goal` 可用；知识文件收敛为 3 个；冲突主路径保留审批+拦截
- [x] `auto` 模式命名生效且 `yolo` 旧配置兼容
- [x] TUI 工具卡片、审批弹窗、模式徽章与 `/help` 上下文感知已落地
- [x] CI 模板、`/review-pr` 增强、远程开发与测试流程文档齐备
- [x] 开源策略评估文档已产出（`docs/decision/open-source-strategy.md`）
- [x] VSCode 扩展 MVP 已接通 `sacode serve`，并补充 daemon 管理、SSE 与审批交互
- [x] workspace build/test 已纳入 Linux、macOS、Windows CI；外部依赖测试显式 quarantine 后单独强制执行
