---
feature: ai-design-tdesign
status: delivered
updated: 2026-09-21
branch: dev
commits: 35bacb0..working-tree # uncommitted on dev; not pushed
---

# AIDesign（TD 示例库 + AI 设计变体）

## Report

**What was built** — 设计阶段 AIDesign：内置 5 个 TDesign 风格示例（看板/列表/表单/落地页/空态）；`sacode design list|show|apply` 产出 `.sacode/design/<id>/{brief,prompt}.md`；`sacode design variants <id>` 调用当前 provider 生成 1–3 个 AI 设计变体（`.sacode/design/<id>/variants/variant-n/`，含 meta.json），`apply --variant N` 可选用变体，`--out` 可指定设计库根目录（默认 `.sacode/design`）。不生成 TSX、不装 TDesign 依赖。TUI `/design` 同等入口。无 provider 时 variants 明确提示登录/配置。

**Verification** —
- `cargo test -p sacode-runtime ai_design` → PASS 12
- `cargo test -p sacode-cli --lib design` → PASS 4
- CLI smoke：`design list` 5 例；`apply td-form-settings` 写出 brief/prompt
- Review + re-review：critical 全清；`--out` 与 provider 就绪与 audit 对齐（`ensure_audit_provider`）

**Journey log** —
1. 用户拍板本轮深度为「示例库 + AI 变体」，不做 UI 代码生成。
2. 变体 JSON 解析必须先整体成功再落盘，避免半截 success。
3. `String::truncate` 在中文摘要上可能 panic → 改为 UTF-8 边界安全截断。
4. 残留：`design variants` 仍固定写默认库路径；自定义 `--out` 后 apply variant 需先把变体生成到同一库根（后续可给 generate 加 `--out`）。
5. `DesignExample.prompt` 字段暂为占位，`render_prompt` 由其他字段合成。

## [S1] Problem

项目设计阶段缺少 SaCode 内置的 AI Design 能力；需要可选 **TD（TDesign 风格）示例**，并支持在选中示例后由大模型按项目上下文生成 **2–3 个设计变体简报**，用户挑选后再 apply，得到设计简报与后续 UI 任务提示。

## [S2] Design

### 命令

```text
sacode design list
sacode design show <id>
sacode design variants <id> [--project <name>] [--count N]
sacode design apply <id> [--variant N] [--project <name>] [--out <dir>]
```

TUI `/design`：`list|show|variants|apply`。

### 示例库（内置，TD 风格）

| id | 名称 | 场景 |
|----|------|------|
| td-dashboard | 数据看板 | 指标卡 + 表格 + 筛选 |
| td-list-table | 列表管理 | 搜索/分页/操作列 |
| td-form-settings | 表单设置 | 分组表单 + 校验 |
| td-landing | 落地页 | Hero + 特性 + CTA |
| td-empty | 空状态 | 引导操作 |

字段：`title`, `summary`, `components[]`, `layout_notes`, `design_tokens`, prompt 合成逻辑。

### AI 设计变体（已拍板）

1. `design variants <id>` 调用当前 provider（`ensure_audit_provider` 就绪检查；无 provider → 提示 `sacode account login`）
2. 输入：示例元数据 + 可选项目名 + AGENTS.md/README 摘要
3. 输出：1–3 变体（默认 3），路径 `.sacode/design/<id>/variants/variant-<n>/{brief.md,prompt.md,meta.json}`
4. `meta.json`：`id`, `title`, `focus`, `components[]`, `diff_from_base`
5. `apply <id> --variant N [--out <dir>]`：选中变体 brief+prompt 写入设计库 `<out>/<id>/`（默认 `.sacode/design`），保留 `variants/`
6. `apply <id>` 无 variant：内置基准示例
7. **不**生成 TSX/前端代码

## [S3] Out of Scope

- Figma API 同步
- 视觉自动截图 QA
- 直接生成/安装 TDesign 组件代码

## Tasks

- [x] T1: 示例数据 + `runtime/ai_design` 读写 brief — acceptance: list/show/apply 单测 (covers: S2)
- [x] T2: AI variants：prompt + provider 调用 + 变体落盘 — acceptance: mock/解析单测；无 provider 有清晰错误；apply --variant 可用 (covers: S2; depends: T1)
- [x] T3: CLI `sacode design` — acceptance: list 5 例；variants/apply 生成 brief.md；`--out` 支持 (covers: S2; depends: T1)
- [x] T4: TUI `/design` — acceptance: 列表与 apply/variants 提示 (covers: S2; depends: T3)
- [x] T5: verify + review 记录 (covers: S1–S2)
