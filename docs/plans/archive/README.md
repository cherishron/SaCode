# 历史方案归档

这个目录存放 SaCode 在不同阶段形成的方案文档、升级草案和实现拆分记录。

这些文档的作用是保留设计脉络和拆解细节，当前生效的产品口径以 `docs/product/PRD.md` 和 `docs/product/roadmap.md` 为准。

## 建议阅读顺序

1. `final-roadmap.md`
2. `runtime-unification-plan.md`
3. `sub-agents-implementation-plan.md`
4. `daemon-http-api-implementation-plan.md`
5. `scheduled-tasks-implementation-plan.md`
6. `agent-teams-implementation-plan.md`

## 文档分组

### 总体演进

- `final-roadmap.md`：统一运行时与平台化演进的完整总方案
- `integration-feasibility-analysis.md`：集成可行性分析与阶段判断

### 运行时与后台能力

- `runtime-unification-plan.md`：统一运行时内核
- `daemon-upgrade-plan.md`：daemon 升级方案
- `daemon-http-api-implementation-plan.md`：daemon + HTTP API 实施拆解
- `scheduled-tasks-implementation-plan.md`：定时任务实现方案
- `scheduled-tasks-channels-http-api-plan.md`：任务、Channels、HTTP API 的联动设计

### Agent 能力演进

- `sub-agents-upgrade-plan.md`：sub-agents 升级草案
- `sub-agents-implementation-plan.md`：sub-agents 实施拆解
- `agent-teams-upgrade-plan.md`：agent teams 升级草案
- `agent-teams-implementation-plan.md`：agent teams 实施拆解

## 使用建议

1. 需要了解当前正式产品方向时，优先阅读 `docs/product/`。
2. 需要理解某项能力为何这样设计时，再回看本目录对应历史方案。
3. 当历史方案与当前代码或 PRD 不一致时，以当前代码、`docs/product/PRD.md` 和 `docs/product/roadmap.md` 为准。
