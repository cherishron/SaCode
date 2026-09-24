---
feature: code-audit-loop
status: delivered
updated: 2026-09-23
branch: dev
commits: 35bacb0..working-tree # uncommitted on dev; not pushed
---

# AI 代码审计与修复迭代

## Report

**What was built** — SaCode 增加面向代码质量/安全的 AI 审计闭环：`sacode audit`（CLI 命令触发）启发式扫描（密钥/SQL 拼接/危险 shell 拼串/unwrap）并可选调用当前 provider 做 AI 二次审计，写出 `.sacode/code-audit/<stamp>/report.{json,md}`；`sacode audit diff` 支持未暂存 + 未跟踪、已暂存、相对目标分支三种本地差分，只报告新侧新增行；`sacode audit pr` 从 GitHub PR files/blob API 获取 head 快照并生成本地报告，显式 `--publish` 时才创建 COMMENT review 和新增行行内评论；`sacode audit fix --from` 用报告生成修复任务 prompt（含再审计提示），走现有 task runner。TUI `/audit` 同等全量扫描；`/config` 暴露 `code_audit.ai`（默认 true）设置开关。报告与 AI prompt 中的疑似密钥脱敏；Finding 带 `schema_version`；`report.md` 可解析到同目录 `report.json`。

**Verification** —
- `cargo test -p sacode-runtime code_audit` → PASS 23
- `cargo test -p sacode-cli --lib audit` → PASS 39（audit_pr 17 项，含 `--publish` 三条幂等分支）
- `cargo test -p sacode-cli --lib config` → PASS 29（含 live gateway）
- `cargo check -p sacode-cli` / `cargo fmt --all -- --check` → PASS
- `audit pr` 端到端由本地 mock GitHub API 覆盖（拉取 PR → files patch → blob 解码 → 差分扫描 → 发布 payload 断言 token/event/line；`--publish` 三条幂等分支：首帖创建、无新发现零请求、有新发现补发增量 review）
- CLI smoke：`audit --no-ai` 检出植入密钥，报告 mask 为 `****7890`
- CLI error path smoke：非 GitHub remote、PR 编号 0、`--repo invalid`、缺 GitHub 凭据均返回明确错误且不 panic
- Review + re-review：critical 全清

**Journey log** —
1. 并行子代理实现 runtime/CLI/TUI；共享接线（`commands.rs`/`local_commands.rs`）由编排器预写避免冲突。
2. Windows 上 `cargo test` 不会刷新 `target/debug/sacode.exe`，smoke 必须 `cargo build -p sacode-cli --bin sacode`。
3. 首轮 review critical：md fix 入口、finding schema_version、shell 拼串启发式、UTF-8 truncate、design `--out`（跨功能）。
4. `ai_used` 语义定为「AI 轮成功调用」而非「AI 有 finding」；空结果也算已用 AI。
5. 残留非 critical：`design variants` 未跟 `--out`（变体仍写默认库）；unwrap 每文件上限已补计数。
6. `audit pr` review 阶段修正：`scan_kind` 下沉到 `run_diff_audit`（原先先按 diff 落盘再改内存，产生重复报告目录和错误路径）；blob 串行改受控并发（每批 8）；`max_files` 达标即停页；只接受 HTTPS/SSH GitHub remote（去掉 `http://`）。
7. `audit pr` 发布安全硬化：非 open PR 拒绝发布；正文/评论中和 `@mention` 与外部 `<!--`；HTML 注释标记 ID 限安全字符；review body 与行内评论均有长度上限。
8. 本环境 `origin` 为 Gitee 且无 GitHub 凭据，故真实远端 smoke 未执行；fork 同名分支歧义由 `select_pr` 单测覆盖。
9. `--publish` 幂等化：以正文标记识别已有总结 review，行内评论按 `path:line` 去重。原方案设想原地刷新总结，先后尝试 `PUT`（GitHub 对 review 更新端点返回 405）与 `PATCH`，最终确认 `COMMENT` review 处于 `COMMENTED` 状态、仅 `APPROVED`/`DISMISSED` 可 PATCH，原地刷新不可达，删除该分支；本地 mock 曾复述同一错误假设导致测试全绿，改为三条真实可达分支后覆盖。

## [S1] Problem

用户需要在 SaCode 内打开代码审计：AI 自主发现漏洞/缺陷 → 生成报告 → 可继续让 AI **按报告修复**并迭代。当前仅有沙箱 `audit.log`（操作审计），**没有**面向代码质量/安全的审计报告与 fix 闭环。

## [S2] Design

### 入口与触发（已拍板）

| 入口 | 行为 |
|------|------|
| `sacode audit [path...]` | **CLI 命令触发**：扫描工作区（默认 `.`），写报告 |
| `sacode audit --json` | stdout 打印 JSON 摘要 |
| `sacode audit diff` | 审查未暂存修改和未跟踪代码文件，只报告新增行 |
| `sacode audit diff --staged` | 审查 index 中已暂存内容；不受后续工作区修改影响 |
| `sacode audit diff --base <ref>` | 审查 `<merge-base(ref, HEAD)>..HEAD` 的已提交差分；不含脏工作区 |
| `sacode audit pr [number]` | GitHub PR 本地审查；省略编号时按当前分支匹配唯一开放 PR；默认不写远端 |
| `sacode audit pr [number] --repo owner/name` | 覆盖 `origin` 自动识别，适配 fork 或特殊 remote |
| `sacode audit pr [number] --publish` | 显式创建一条 COMMENT review（总结 + 最多 50 条新增行行内评论）；重跑幂等：已有总结 review 时不重复创建，只补发新发现；行内评论按 `path:line` 去重 |
| `sacode audit fix --from <report.json\|report.md>` | 用报告生成修复任务（md 解析为同目录 report.json） |
| TUI `/audit` | 同等扫描，展示摘要 + 报告路径 |
| TUI `/config` 设置项 | `code_audit.ai`（bool，默认 true）控制是否调用大模型 |

### 扫描流水线

1. **启发式**：高风险 token/密钥、SQL 字符串拼接、危险 shell 拼串、`unwrap()` 于非 test 路径、明文密码字段
2. **AI（config `code_audit.ai` 默认 true，CLI `--no-ai`/`--ai` 可覆盖）**：provider 二次审计；差分模式提供新增行前后各 3 行上下文，但仅接收定位在新增行上的 finding；失败仅告警，启发式报告仍写出
3. **报告**：`.sacode/code-audit/<timestamp>/report.json` + `report.md`；差分报告额外记录 `scan_kind=diff`、`scan_target`、`files_scanned`、`changed_lines`；PR 审查写 `scan_kind=pr`、`scan_target=github:<owner/name>/pull/<N>`，且只写一次（由 `run_diff_audit` 统一落盘）

### Finding 契约

```json
{
  "schema_version": 1,
  "id": "CA-001",
  "severity": "high|medium|low|info",
  "category": "security|correctness|maintainability",
  "file": "path",
  "line": 12,
  "title": "…",
  "detail": "…",
  "suggestion": "…",
  "source": "heuristic|ai"
}
```

报告 JSON：`schema_version`, `created_at`, `root`, `findings[]`, `summary{counts}`, `provider`, `ai_used`, `scan_kind`, `scan_target`, `files_scanned`, `changed_lines`。旧报告缺少新字段时按全量扫描兼容读取。
`AuditScanOutcome` 统计 `heuristic_count` 与 `ai_count`；`ai_used` 表示 AI 轮成功调用。

### 修复迭代

`sacode audit fix` 生成 prompt（含 findings + 「修复后可再次 `sacode audit` 对比」），走现有 `run_fix_prompt`（Build + ApprovalPolicy::Prompt）。

### 安全

- 报告与 AI prompt 中疑似密钥脱敏（`****` + 后 4 位）
- Provider 就绪：`ensure_audit_provider`；无 base_url 时不臆造 model/api_key
- PR 审查默认**只写本地**；仅 `--publish` 创建一条 `COMMENT` review（不 approve/request changes）
- `--publish` 前要求 PR `state == "open"`；行内评论只落在 GitHub patch 确认的新增行（`side: "RIGHT"`），上限 50 条
- `--publish` 重跑幂等：按总结正文中的 `<!-- sacode-audit-pr -->` 标记识别已发布的 SaCode review，已存在则不重复创建；行内评论按 `path:line` 与既有评论去重，重复执行不刷屏
- GitHub 限制：提交的 review 不可删除，行内评论不可事后编辑，`COMMENT` 类型 review 处于 `COMMENTED` 状态且不可 `PATCH`（仅 `APPROVED`/`DISMISSED` 可 PATCH）。故不做原地刷新，只保证「不重复创建 + 只补新发现」
- 发布正文中和 `@mention` 与外部 `<!--`，注释标记 ID 限安全字符；review body 与评论均有长度上限
- GitHub API base 固定官方地址，无 CLI 注入入口；仅接受 HTTPS/SSH remote（拒绝明文 `http://`）

## [S3] Out of Scope

- 商用 SAST 引擎、许可证扫描
- Desktop 完整设置面板 UI（本轮 TUI `/config` 即可）
- 自动 CI 门禁发布

## Tasks

- [x] T1: runtime `code_audit` 类型 + 报告读写 + 启发式扫描 — acceptance: 单测含 finding 构造与 report 序列化；密钥脱敏 (covers: S2)
- [x] T2: AI 审计 prompt + provider 调用解析 + ai_count — acceptance: 解析 findings；AI 失败时仍有启发式结果；outcome.ai_count 正确 (covers: S2; depends: T1)
- [x] T3: CLI `sacode audit` / `audit fix` — acceptance: 扫描写 report.json/md；fix prompt 含 findings 与再审计提示 (covers: S2; depends: T1)
- [x] T4: TUI `/audit` + config `code_audit.ai` — acceptance: `/audit` 展示摘要与报告路径；config 可切换 AI (covers: S2; depends: T3)
- [x] T5: verify + review — acceptance: 测试与 smoke 记录 (covers: S1–S2)
- [x] T6: CLI `sacode audit diff` — acceptance: worktree/staged/base 三种范围；只报告新增行；复用报告和 fix 闭环 (covers: S2; depends: T3)
- [x] T7: CLI `sacode audit pr` — acceptance: GitHub PR 元数据/文件/blob；本地默认；显式 publish 总结与新增行评论；复用报告契约 (covers: S2; depends: T6)
