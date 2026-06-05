# SaCode 文档总览

这个目录按“上手、参考、产品、方案、发布、构建”六类组织，便于按角色和场景查阅。

## 目录结构

- `guides/`：面向用户的上手文档与使用教程
- `reference/`：面向开发者和集成方的接口与架构参考
- `product/`：产品定位、PRD、路线图
- `plans/`：规划方案、专项设计与历史演进记录
- `release/`：发布流程与发布校验
- `build/`：构建与交叉编译说明

## 推荐阅读顺序

1. `guides/getting-started.md`
2. `guides/tutorials.md`
3. `guides/examples.md`
4. `reference/command-reference.md`
5. `reference/API.md`
6. `reference/architecture.md`
7. `reference/development.md`
8. `product/PRD.md`
9. `product/roadmap.md`

## 文档索引

### Guides

- `guides/getting-started.md`：安装、配置 provider、模型选择、常见工作流
- `guides/tutorials.md`：按真实开发任务组织的场景教程
- `guides/examples.md`：可直接复制的提示词和命令组合

### Reference

- `reference/command-reference.md`：CLI / TUI 高频命令速查
- `reference/API.md`：CLI、TUI、工具系统、配置文件接口
- `reference/architecture.md`：workspace 分层、执行链路、数据落点、agents 和 routing 结构
- `reference/development.md`：本地开发、测试、调试、文档更新约定

### Product

- `product/PRD.md`：最新产品需求文档，包含定位、目标、当前能力与阶段路线
- `product/roadmap.md`：按版本阶段拆解的路线图

### Plans

- `plans/plan-optimization.md`：问题修复与优化计划
- `plans/config-command-plan.md`：`/config` 交互式配置命令设计
- `plans/archive/README.md`：历史阶段方案导航与阅读顺序
- `plans/archive/`：历史阶段方案与拆分后的专项计划

### Release / Build

- `release/RELEASE.md`：版本发布流程
- `build/CROSS_COMPILE.md`：跨平台构建说明
