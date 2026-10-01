# SaCode 文档总览

本目录按「上手、参考、产品、方案、发布、构建」六类组织，便于按角色与场景查阅。文档使用统一命名规范：目录名为主题复数小写；文件名为 `<类型>-<主题>.md`（如 `guide-*`、`prd-*`、`plan-*`、`spec-*`、`ref-*`、`adr-*`、`report-*`、`release-*`、`verification-*`）。

## 目录结构

- `guides/`：面向用户的上手文档与使用教程
- `product/`：产品定位、PRD、路线图（含 `reports/` 背景报告）
- `architecture/`：面向开发者与集成方的接口与架构参考（`ref-*`）
- `specs/`：技术方案与规格（`spec-*`、`schema-*`）
- `plans/`：实施计划与专项设计（历史归档在 `plans/archive/`）
- `decisions/`：决策记录（`adr-*`）
- `release/`：发布流程与兼容矩阵
- `verification/`：验收与端到端验证
- `build/`：构建与交叉编译说明
- `STATUS.md`：当前进度真源（原 `PROGRESS.md`）

**进度真源**：[STATUS.md](STATUS.md)（当前实际状态、验证记录、前后端对照）

背景评估报告（原根目录）：
- [report-feasibility.md](product/reports/report-feasibility.md)：SaCode 可行性评估报告（四维评估）
- [report-improvement-plan.md](product/reports/report-improvement-plan.md)：基于评估报告的 12 周改进规划方案

相关入口详见仓库根目录：[README.md](../README.md)、[AGENTS.md](../AGENTS.md)

## 推荐阅读顺序

1. `product/reports/report-feasibility.md` — 可行性评估报告（先了解现状与差距）
2. `product/reports/report-improvement-plan.md` — 改进规划方案（12 周实施路线）
3. `guides/guide-getting-started.md` — 安装与基本配置（30 秒→5 分钟）
4. `guides/guide-tutorials.md` — 场景速查手册
5. `guides/guide-examples.md` — 可复制的命令和提示词
6. `guides/guide-vscode-extension.md` — VSCode 扩展安装、daemon 自动管理与排障
7. `architecture/ref-command-reference.md` — CLI / TUI 命令速查
8. `architecture/ref-api.md` — 工具系统、Daemon、MCP 接口总览
9. `architecture/ref-daemon-api.md` — daemon HTTP、SSE、审批与重连协议
10. `architecture/architecture.md` — 分层架构与执行链路
11. `architecture/ref-development.md` — 本地开发与测试
12. `product/prd-main.md` — 产品定位与能力全景
13. `product/roadmap.md` — 版本路线图

## 文档索引

### Guides — 用户上手
- `guides/guide-getting-started.md`：安装、配置 provider、模型选择、常见工作流
- `guides/guide-provider-quickstart.md`：国内 Provider 快速接入（DeepSeek/通义千问/智谱 GLM 等）
- `guides/guide-tutorials.md`：按真实开发任务组织的场景教程
- `guides/guide-examples.md`：可直接复制的提示词和命令组合
- `guides/guide-vscode-extension.md`：VSCode 扩展安装、配置、daemon 自动管理、审批与 SSE 排障
- `guides/guide-remote-development.md`：远程开发模式
- `guides/guide-ci-integration.md`：CI 集成说明
- `guides/guide-test-flow.md`：测试流程

### Architecture — 开发者参考
- `architecture/ref-command-reference.md`：CLI / TUI 高频命令速查（权威来源：`interfaces/cli/src/cmd/mod.rs`）
- `architecture/ref-api.md`：CLI、TUI、工具系统、配置文件、Daemon、MCP 接口总览
- `architecture/ref-daemon-api.md`：daemon HTTP 路由、SSE `Last-Event-ID`、审批与重连协议
- `architecture/architecture.md`：workspace 分层、执行链路、数据落点、agents 与 routing 结构
- `architecture/ref-development.md`：本地开发、测试、调试、文档更新约定
- `architecture/ref-audit-log-format.md`：审计日志格式
- `architecture/ref-troubleshooting.md`：运行期已知错误清单与排查
- `architecture/ref-comparison-deepseek-harness.md`：SaCode 与 deepseek-harness 的架构对比

### Product — 产品与路线
- `product/prd-main.md`：总体产品需求文档（定位、目标、当前能力、阶段路线）
- `product/prd-desktop-multi-agent.md`：Desktop、多客户端共享层、Agent Backend 与 OpenCode ACP 接入专项 PRD
- `product/prd-sadesign-desktop.md`：SaDesign 桌面 PRD（独立产品线）
- `product/prd-desktop-ga-release.md`：v1.5 桌面端正式发布与品牌统一 PRD
- `product/prd-unified-identity.md`：统一账号体系专项 PRD（sa-idp 对齐，认证身份）
- `product/roadmap.md`：按版本阶段拆解的路线图（当前 1.1.1，含客户端化定向扩展）
- `product/status.json`：机器可读能力状态真源

### Specs — 技术方案与规格
- `specs/spec-desktop-backend-wiring.md`：身份/权益/License/Desktop 后端接入
- `specs/spec-sacode-identity-i3.md`：I3 OIDC 客户端
- `specs/spec-tauri-desktop-m2.md`：Tauri Desktop M2
- `specs/spec-desktop-sidecar.md`：桌面 sidecar 安全方案
- `specs/spec-desktop-ui-refresh.md`：桌面 UI 刷新（现行视觉真源，取代原 v1 蓝版设计）
- `specs/spec-ai-design-tdesign.md`：AI 设计与 TDesign 规范
- `specs/spec-code-audit-loop.md`：代码审计循环方案
- `specs/spec-git-platform-oauth.md`：Git 平台 OAuth 方案
- `specs/schema-unified-identity.sql`：统一账号体系完整建库 SQL（配套 `product/prd-unified-identity.md`）

### Plans — 实施计划
当前活跃方案：
- `plans/plan-desktop-multi-agent.md`：Desktop、多客户端、ACP Client 与 OpenCode Backend 的迁移、切片与发布门禁
- `plans/plan-capability-upgrade.md`：基于竞品对比的功能完整态升级方案
- `plans/plan-loop-autonomous-delivery.md`：Loop 自治交付升级方案
- `plans/plan-optimization.md`：代码质量审查与问题修复计划（P0/P1/P2）
- `plans/plan-project-knowledge-system.md` + `plans/plan-project-knowledge-system-impl.md`：项目级知识沉淀系统设计与实施清单
- `plans/plan-event-sourcing-step2.md`：事件溯源第二步 — ExecutionReport 投影化
- `plans/plan-sse-stability-enhancement.md`：SSE 稳定性增强
- `plans/plan-local-mode.md`：本地模式方案
- `plans/plan-improvement-execution.md`：改进执行计划
- `plans/plan-desktop-iteration-plan.md`：桌面迭代计划
- `plans/plan-desktop-settings-center.md`：设置中心扩展
- `plans/plan-desktop-conversation-edge-nav.md`：对话边缘导航
- `plans/plan-desktop-layout-contract.md` / `plan-desktop-interface-contract.md`：布局/接口契约
- `plans/plan-desktop-layout-parity.md` / `plan-desktop-layout-audit.md` / `plan-desktop-monkeycode-parity.md`：布局对齐/审计/与 MonkeyCode 对齐
- `plans/plan-desktop-integration-acceptance.md` / `plan-desktop-native-acceptance.md`：集成验收/原生验收

历史归档：
- `plans/archive/README.md`：历史阶段方案导航
- `plans/archive/`：11 份历史方案（总体演进、运行时与后台能力、Agent 能力演进）

### Decisions — 决策记录
- `decisions/adr-open-source-strategy.md`：开源策略决策

### Release / Build — 发布与构建
- `release/RELEASE.md`：版本发布流程
- `release/release-1.1.1.md`：1.1.1 版本发布说明
- `release/compatibility.md` / `compatibility.json`：版本兼容矩阵
- `build/CROSS_COMPILE.md`：跨平台构建说明

### Verification — 验收
- `verification/verification-t3-agent-loop-e2e.md`：Agent Loop 端到端验证（T3）
