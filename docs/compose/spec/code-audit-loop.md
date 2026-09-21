---
feature: code-audit-loop
status: delivered
updated: 2026-09-21
branch: dev
commits: 35bacb0..working-tree # uncommitted on dev; not pushed
---

# AI 代码审计与修复迭代

## Report

**What was built** — SaCode 增加面向代码质量/安全的 AI 审计闭环：`sacode audit`（CLI 命令触发）启发式扫描（密钥/SQL 拼接/危险 shell 拼串/unwrap）并可选调用当前 provider 做 AI 二次审计，写出 `.sacode/code-audit/<stamp>/report.{json,md}`；`sacode audit fix --from` 用报告生成修复任务 prompt（含再审计提示），走现有 task runner。TUI `/audit` 同等扫描；`/config` 暴露 `code_audit.ai`（默认 true）设置开关。报告与 AI prompt 中的疑似密钥脱敏；Finding 带 `schema_version`；`report.md` 可解析到同目录 `report.json`。

**Verification** —
- `cargo test -p sacode-runtime code_audit` → PASS 21
- `cargo test -p sacode-cli --lib audit` → PASS 12（含 config `code_audit.ai`）
- `cargo test -p sacode-cli --lib config` → PASS 29（含 live gateway）
- `cargo check -p sacode-cli -p sacode-runtime` → PASS
- CLI smoke：`audit --no-ai` 检出植入密钥，报告 mask 为 `****7890`
- Review + re-review：critical 全清

**Journey log** —
1. 并行子代理实现 runtime/CLI/TUI；共享接线（`commands.rs`/`local_commands.rs`）由编排器预写避免冲突。
2. Windows 上 `cargo test` 不会刷新 `target/debug/sacode.exe`，smoke 必须 `cargo build -p sacode-cli --bin sacode`。
3. 首轮 review critical：md fix 入口、finding schema_version、shell 拼串启发式、UTF-8 truncate、design `--out`（跨功能）。
4. `ai_used` 语义定为「AI 轮成功调用」而非「AI 有 finding」；空结果也算已用 AI。
5. 残留非 critical：`design variants` 未跟 `--out`（变体仍写默认库）；unwrap 每文件上限已补计数。

## [S1] Problem

用户需要在 SaCode 内打开代码审计：AI 自主发现漏洞/缺陷 → 生成报告 → 可继续让 AI **按报告修复**并迭代。当前仅有沙箱 `audit.log`（操作审计），**没有**面向代码质量/安全的审计报告与 fix 闭环。

## [S2] Design

### 入口与触发（已拍板）

| 入口 | 行为 |
|------|------|
| `sacode audit [path...]` | **CLI 命令触发**：扫描工作区（默认 `.`），写报告 |
| `sacode audit --json` | stdout 打印 JSON 摘要 |
| `sacode audit fix --from <report.json\|report.md>` | 用报告生成修复任务（md 解析为同目录 report.json） |
| TUI `/audit` | 同等扫描，展示摘要 + 报告路径 |
| TUI `/config` 设置项 | `code_audit.ai`（bool，默认 true）控制是否调用大模型 |

### 扫描流水线

1. **启发式**：高风险 token/密钥、SQL 字符串拼接、危险 shell 拼串、`unwrap()` 于非 test 路径、明文密码字段
2. **AI（config `code_audit.ai` 默认 true，CLI `--no-ai`/`--ai` 可覆盖）**：provider 二次审计；失败仅告警，启发式报告仍写出
3. **报告**：`.sacode/code-audit/<timestamp>/report.json` + `report.md`

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

报告 JSON：`schema_version`, `created_at`, `root`, `findings[]`, `summary{counts}`, `provider`, `ai_used`。
`AuditScanOutcome` 统计 `heuristic_count` 与 `ai_count`；`ai_used` 表示 AI 轮成功调用。

### 修复迭代

`sacode audit fix` 生成 prompt（含 findings + 「修复后可再次 `sacode audit` 对比」），走现有 `run_fix_prompt`（Build + ApprovalPolicy::Prompt）。

### 安全

- 报告与 AI prompt 中疑似密钥脱敏（`****` + 后 4 位）
- Provider 就绪：`ensure_audit_provider`；无 base_url 时不臆造 model/api_key

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
