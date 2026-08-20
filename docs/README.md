# SaCode 文档总览

这个目录按"上手、参考、产品、方案、发布、构建"六类组织，便于按角色和场景查阅。

## 目录结构

- `guides/`：面向用户的上手文档与使用教程
- `reference/`：面向开发者和集成方的接口与架构参考
- `product/`：产品定位、PRD、路线图
- `plans/`：规划方案、专项设计与历史演进记录
- `release/`：发布流程与发布校验
- `build/`：构建与交叉编译说明

另见根目录评估与规划文档：

- [report.md](../report.md)：SaCode 可行性评估报告（四维评估）
- [report-plan.md](../report-plan.md)：基于评估报告的 12 周改进规划方案

相关入口详见根目录：[README.md](../README.md)、[AGENTS.md](../AGENTS.md)

## 推荐阅读顺序

1. `report.md` — 可行性评估报告（先了解现状与差距）
2. `report-plan.md` — 改进规划方案（12 周实施路线）
3. `guides/getting-started.md` — 安装与基本配置（30 秒→5 分钟）
4. `guides/tutorials.md` — 场景速查手册（cheat sheet）
5. `guides/examples.md` — 可复制的命令和提示词
6. `reference/command-reference.md` — CLI / TUI 命令速查
7. `reference/API.md` — 工具系统、Daemon、MCP 接口
8. `reference/architecture.md` — 分层架构与执行链路
9. `reference/development.md` — 本地开发与测试
10. `product/PRD.md` — 产品定位与能力全景
11. `product/roadmap.md` — 版本路线图

## 文档索引

### Guides — 用户上手

- `guides/getting-started.md`：安装、配置 provider、模型选择、常见工作流
- `guides/provider-quickstart.md`：国内 Provider 快速接入指南（DeepSeek/通义千问/智谱 GLM 等获取 Key 与配置）
- `guides/tutorials.md`：按真实开发任务组织的场景教程（参见 [reference/command-reference.md](reference/command-reference.md) 查看可用命令）
- `guides/examples.md`：可直接复制的提示词和命令组合

### Reference — 开发者参考

- `reference/command-reference.md`：CLI / TUI 高频命令速查（命令权威来源：`interfaces/cli/src/cmd/mod.rs`）
- `reference/API.md`：CLI、TUI、工具系统、配置文件、Daemon、MCP 接口（参见 [reference/architecture.md](reference/architecture.md) 了解整体架构）
- `reference/architecture.md`：workspace 分层、执行链路、数据落点、agents 和 routing 结构（参见 [reference/development.md](reference/development.md) 了解如何参与开发）
- `reference/development.md`：本地开发、测试、调试、文档更新约定（参见 [release/RELEASE.md](../release/RELEASE.md) 和 [build/CROSS_COMPILE.md](../build/CROSS_COMPILE.md)）
- `reference/comparison-with-deepseek-harness.md`：SaCode 与 deepseek-harness 的 7 维架构对比与可借鉴优点分析
- `reference/troubleshooting.md`：运行期已知错误清单与排查、处理状态（如 `os error 5` 拒绝访问）

### Product — 产品与路线

- `product/PRD.md`：最新产品需求文档，包含定位、目标、当前能力与阶段路线（v1.2, 2026-08-18，定位调整为"面向国内开发者的终端 AI 编程工具"）
- `product/roadmap.md`：按版本阶段拆解的路线图（当前 0.1.33，含平台化收敛声明）

### 评估与规划（根目录）

- `report.md`：SaCode 可行性评估报告（四维评估：竞争差距 / 规则审查 / 方向 / UI）
- `report-plan.md`：基于评估报告的 12 周改进规划方案（6 阶段：体验闭环 → IDE 插件 → 定位聚焦 → 过度设计简化 → 核心强化 → 场景补齐）

### Plans — 规划方案

当前活跃方案：

- `plans/capability-upgrade-plan.md`：基于 7 款竞品对比的功能完整态升级方案（工具补齐、架构暴露、生态能力）
- `plans/phase2-platform-closure-plan.md`：**第二阶段** — 平台化补全：Windows 命令适配、macOS 支持、增量索引缓存、CI 自动修复
- `plans/loop-autonomous-delivery-plan.md`：Loop 自治交付升级方案（从局部修复到端到端任务交付，注意：report-plan.md 已将其轻量化）
- `plans/plan-optimization.md`：代码质量审查与问题修复计划（P0/P1/P2 优先级）
- `plans/project-knowledge-system-plan.md`：项目级知识沉淀系统方案（注意：report-plan.md 已将其 9 文件分类合并为 3 文件）
- `plans/project-knowledge-system-implementation-plan.md`：知识沉淀系统实施清单（参见 [project-knowledge-system-plan.md](project-knowledge-system-plan.md)）
- `plans/event-sourcing-step2-design.md`：事件溯源第二步 — ExecutionReport 投影化实施切片（现状/目标/3 切片/风险兼容/验收口径）

历史归档：

- `plans/archive/README.md`：历史阶段方案导航与阅读顺序
- `plans/archive/`：包含 11 份历史方案，分为总体演进、运行时与后台能力、Agent 能力演进三组

### Release / Build — 发布与构建

- `release/RELEASE.md`：版本发布流程（参见 [reference/development.md](../reference/development.md)）
- `build/CROSS_COMPILE.md`：跨平台构建说明
