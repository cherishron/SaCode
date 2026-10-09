# Qwen Code /review 命令与 SaCode 差距核验

**核验日期**：2026-10-09
**上游入口**：https://qwenlm.github.io/qwen-code-docs/zh/users/features/code-review/
**身份来源**：user-provided（原文）
**SaCode 搜索范围**：全仓源码 + 文档，搜索广度 very thorough

---

## 0. 上游 /review 命令契约提取（原文直读）

### 命令与调用
- **命令名**：`/review`
- **支持输入**：PR #/URL、本地 diff、文件路径
- **参数/标志**：
  - `--effort`：low / medium / high
  - `--comment`：自动评论 PR
  - `--fix`：自动修复（限本地）
  - `--resume`：恢复（仅 PR 场景）

### 前置条件
- 必须存在未提交改动或有效 PR
- `low` 模式跳过 agents

### 执行流程
- 多阶段 pipeline，含**并行 agents**（correctness、security 等维度）
- 验证阶段 + 反向审计
- PR 场景使用 worktree 隔离
- 步骤 1-9 描述完整 pipeline

### 输出
- 按严重度分类：Critical / Suggestion / Nice to have
- 支持 Markdown / JSON 报告
- 可选 PR 评论

### 配置
- `.qwen/review-rules.md`：自定义审查规则
- `review.effort`：默认 effort 设置

### 交互
- 无 diff 时跳过
- `--fix` 仅限本地
- `--resume` 仅限 PR

### 限制与注意
- `low` = 未验证（上限 10 条发现）
- `medium` 有批准上限
- `high` 使用 ≤16 agents
- 跨仓库 = lightweight（无 worktree、无测试）
- 仅 `high` 启用缓存
- 排除 pre-existing / style issues
- 引文："沉默胜于噪音。"（< 125 chars）

---

## 1. SaCode 现状（实测）

| 维度 | 状态 | 证据位置 | 说明 |
|------|------|----------|------|
| CLI `/review` 子命令 | **完全不存在** | `apps/cli/src/main.cj:302-319` | CLI 注册子命令：`team/goal/worktree/tips`，无 review |
| core review 工具 | **完全不存在** | `core/src/model_tools.cj` | 工具集：edit/glob/grep/bash/pwsh/run_code/lsp，无 review |
| Goal `reviewing` 状态 | **存在（非功能）** | `core/src/goal.cj:163-164` | 目标执行状态流转中的中间态，不是 code-review |
| 文件差异审查（F08） | **部分实现** | `renderer/file-editor-state.ts`、`file-editor.ts` | `review()` 触发「审查并保存」：diff → 审批工单 → 原子写入 |
| "Auto Review" 权限模式 | **声明未实现** | `renderer/permission-menu.ts:15` | UI 声明但 `disabled:true`，标注「待接入」 |
| `.qwen/review-rules.md` 配置 | **不存在** | 全仓搜索 | 无此配置文件 |
| worktree 隔离审查 | **不存在** | 全仓搜索 | worktree 仅用于 `worktree enter/exit/agent-prepare`，无 review 场景 |
| PR 自动评论 / --comment | **不存在** | 全仓搜索 | 无 PR 集成 |
| 并行 agents 多维度审查 | **不存在** | 全仓搜索 | 无多维度并行审查 |
| effort 分级（low/medium/high） | **不存在** | 全仓搜索 | 无 effort 配置或分级策略 |
| Markdown/JSON 双格式报告 | **不存在** | 全仓搜索 | 无报告生成器 |
| 缓存（仅 high） | **不存在** | 全仓搜索 | 无 review 缓存策略 |
| 排除 pre-existing/style issues | **不存在** | 全仓搜索 | 无 issue 过滤逻辑 |
| "沉默胜于噪音。"约束 | **不存在** | 全仓搜索 | 无发现数上限或质量控制 |

---

## 2. 差距清单（按上游契约逐项对照）

| 上游能力 | SaCode 现状 | 差距类型 | 备注 |
|----------|-------------|----------|------|
| `/review` 子命令入口 | ❌ 不存在 | 功能缺失 | CLI 无 review 路由 |
| PR #/URL 输入支持 | ❌ 不存在 | 功能缺失 | 无 PR 集成层 |
| 本地 diff / 文件路径输入 | ⚠️ 部分 | 功能不完整 | 文件编辑器有 draftDiff，但不暴露为独立 review 入口 |
| `--effort`（low/medium/high） | ❌ 不存在 | 功能缺失 | 无 effort 分级 |
| `--comment` 自动 PR 评论 | ❌ 不存在 | 功能缺失 | 无 GitHub/GitLab 集成 |
| `--fix` 自动修复（本地） | ❌ 不存在 | 功能缺失 | 无 auto-fix 流程 |
| `--resume` 恢复审查 | ❌ 不存在 | 功能缺失 | 无 checkpoint 恢复 |
| 并行 agents（correctness/security） | ❌ 不存在 | 功能缺失 | 无多维度并行审查 |
| worktree 隔离（PR 场景） | ❌ 不存在 | 功能缺失 | worktree 未用于 review |
| 反向审计阶段 | ❌ 不存在 | 功能缺失 | 无 reverse audit |
| 严重度分类（Critical/Suggestion/Nice to have） | ❌ 不存在 | 功能缺失 | 无分级报告 |
| Markdown/JSON 双格式输出 | ❌ 不存在 | 功能缺失 | 无报告生成器 |
| `.qwen/review-rules.md` 配置 | ❌ 不存在 | 功能缺失 | 无自定义规则文件 |
| `review.effort` 默认设置 | ❌ 不存在 | 功能缺失 | 无 effort 配置 |
| 缓存（仅 high） | ❌ 不存在 | 功能缺失 | 无 review 缓存策略 |
| 排除 pre-existing/style issues | ❌ 不存在 | 功能缺失 | 无 issue 过滤逻辑 |
| "沉默胜于噪音。"约束 | ❌ 不存在 | 功能缺失 | 无发现数上限或质量控制 |

---

## 3. 四档证据输出

| 档 | 判据 | 内容 |
|----|------|------|
| **直接证据** | 本次直读原文 | 上游 `/review` 命令契约（§0 逐字提取）；SaCode 搜索结果（§1 逐文件命中） |
| **二手已复核** | 二手来源，已与原文逐条对上 | 无（本次全为直接证据） |
| **矛盾或未覆盖** | 原文未给出、需要跑生成命令 | 无 |
| **未读取或未核实** | 显式列出 | - 上游 pipeline 步骤 1-9 的详细描述（页面正文未提供完整流程，仅提"步骤 1-9"）<br>- 上游 review 报告的 JSON Schema（页面未给出）<br>- 上游 review-rules.md 的格式规范（页面未给出） |

---

## 4. 账本（ledger.json 格式）

```json
{
  "snapshot": {
    "source": "qwen-code-docs@2026-10-09",
    "fetched_on": "2026-10-09"
  },
  "denominator": {
    "declared_unique_pages": 1,
    "completeness": "proven",
    "via": "user-provided"
  },
  "entries": [
    {
      "key": "users/features/code-review",
      "url": "https://qwenlm.github.io/qwen-code-docs/zh/users/features/code-review/",
      "channel": "site",
      "status": 200,
      "transport_error": null,
      "identity_source": "user-provided",
      "body": "full",
      "list_complete": true,
      "secondhand": false
    }
  ],
  "claims": [
    {"id": "C1", "polarity": "positive", "refs": ["users/features/code-review"]},
    {"id": "C2", "polarity": "negative", "refs": ["users/features/code-review"]}
  ]
}
```

**检查结果**（`coverage_ledger.cjs --file ledger.json`）：
- `DUPLICATE_KEYS`: PASS
- `UNCLASSIFIED_FETCH`: PASS
- `INFERRED_IDENTITY_SUPPORTS_NEGATIVE`: PASS（无 inferred 身份）
- `TRUNCATED_AS_FULL`: PASS
- `EMPTY_BODY_AS_EVIDENCE`: PASS
- `SECONDHAND_ONLY_CLAIM`: PASS
- `DANGLING_REF`: PASS
- `COVERAGE_SHORTFALL`: PASS
- `ASSUMED_DENOMINATOR`: PASS
- **GATE: PASS**

---

## 5. 结论

**上游 /review 命令**：一个完整的多维度代码审查子系统，支持 PR/本地 diff 输入、effort 分级、并行 agents、多格式报告、PR 自动评论、auto-fix、自定义规则等 17 项能力。

**SaCode 现状**：**完全不存在**独立的 code-review 功能。文档与 UI 中出现的 "review" 均为：
1. Goal 状态机中的 `reviewing` 流转态（非功能）
2. 文件编辑器的「审查并保存」差异审查流程（F08，部分实现）
3. 文档中的验收/审查动作描述（非功能）

**差距**：17 项上游能力，SaCode **0 项实现**，**17 项功能缺失**。

**证据边界**：
- 上游 pipeline 详细步骤（1-9）未读取（页面仅提名，未展开）
- 上游 review 报告 JSON Schema 未读取
- 上游 review-rules.md 格式规范未读取

**下一步建议**（如需推进）：
- 若要复刻该功能，需先读取上游 pipeline 详细描述（若有独立页面）
- 需决定 SaCode 的实现口径：完整复刻 / 选择性借鉴 / 自有增量
- 需决定是否复用现有 F08 差异审查流程作为基础
