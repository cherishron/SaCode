# 迭代记录（Changelog）

> 本文件记录 SaCode 的产品迭代。**项目尚未启用对外正式发布版本号，当前以「日期」为迭代锚点**；正式发布后改为语义化版本号分段（见文末「版本号与标签」）。
> 格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；分类：新增 / 变更 / 修复 / 移除 / 安全。

**维护规则（与根 `AGENTS.md`「文档同步规则」配套，强制）**

1. 每完成一项功能、闭合一个缺陷或产生对外可见变更，**必须同批**更新本文件；
2. 每条附日期与证据路径（`docs/evidence/`）或对应 PRD 域（Fxx）；
3. 未交付内容不写进已发布段落；发布时再迁移并绑定版本号；
4. **不得虚报**：测试通过、页面接线、RPC 宣告各自不足以升级为「已验证 / 已发布」；当前交付状态以 [PRD 台账交付卡](docs/product/PRD-tracking.md#当前交付卡2026-10-18-用户确认) 为准。

**当前状态**：**用户已亲手复验最小闭环通过**（2026-10-24，免安装桌面候选）——配置供应商/选模型 → 打开小项目 → AI 读取并提出修改 → 审批 → 实际修改+真实差异 → 关闭重开正确。**该闭环之外仍未验**：真实执行/构建测试（D14）、安装态（D18/D19）、正式默认启动固化（D10）与提交；**不宣称版本已交付**。

---

## 2026-10-24

> **里程碑（用户亲手复验）**：**主闭环通过**——配置供应商/选模型 → 打开小项目 → AI 读取并提出修改 → 审批 → 实际修改+真实差异 → 关闭重开正确。未覆盖：真实执行/构建、安装态、正式默认启动、提交。

> **项目评审**：完成一次抽样项目评审（安全 / 代码 / 架构 / 治理），落档 `docs/evidence/2026-10-24-project-review-security-code.md`；新增缺陷 D27–D31（见台账 §2.4）。

### 新增
- 发布通用 skill **`repo-conventions`**（仓库约定与项目治理：结构 / 文档 / 测试 / 提交安全 / 多 agent 协作 / 新项目初始化 / 项目体检）到 SkillHub，1.0.0、8 文件、`skillId 293070`；提交成功待审核。证据：`docs/evidence/2026-10-24-repo-conventions-skill-publish.md`。
- **`repo-conventions` 扩版 1.1.0（14 文件、`versionId 459409`）**：在原五类规范上新增 6 个领域——H 项目错题本、I PRD / 需求管理、J 文档维护、K 项目评审、L 安全审查、M 提交编排与推送；SKILL 领域表扩至 A–M，触发词与结构测试同步更新（10/10 通过）。证据：`docs/evidence/2026-10-24-repo-conventions-skill-publish.md` §1.1.0。
- **`repo-conventions` skill G 项目体检（只读）**：对当前仓做结构/文档/测试/提交安全/协作全维体检——**无 P0**（源码配置密钥零命中、跟踪产物 0）；P1：读数基线过期（D28）、core 单测不可编译（D27）、547 项未提交、协作登记未全覆盖；P2：活文档残留参考缩写、`docs/errors.md` 缺失、3 个空 `tmpDir*`。证据：`docs/evidence/2026-10-24-repo-conventions-project-audit.md`。
- **CLI TUI（独立增量，不入桌面候选）**：会话管理（搜索 / 改名 / 归档恢复）、配置与模型状态细化、`@` 文本文件引用、能力浏览（技能 / MCP / 权限 / 计划只读）、骨架重写、视觉与交互打磨、跨块 UTF-8 解码修复。证据：`docs/evidence/2026-10-24-cli-tui-*.md`。
- **内置浏览器（F14 人工浏览入口）**：主进程 `WebContentsView` 控制器 + 8 条 `browserView*` IPC，隔离会话、跨站 / 下载 / 权限 / 新窗口默认拒绝。证据：`docs/evidence/2026-10-24-browser-webcontents-view-wiring.md`。
- **语音输入最小闭环（F18）**：Host `voice/record|transcribe|describe` + 桌面 4 通道，录音→16kHz WAV→转写→仅写入可撤销草稿、不自动发送。证据：`docs/clients/desktop/2026-10-24-voice-input-wiring.md`。
- **上下文容量 / 用量读数接线（F06）**：接口 `context_window` 解析入注册表，容量与用量独立呈现、两侧齐全才换算百分比。证据：`docs/evidence/2026-10-24-context-meter-capacity-wiring.md`。
- **跨端打通前闸门（P0）**：daemon `--manage grant-scope` 闭集授予、`turn/poll` 游标重放（`TurnFrameJournal`）、`session/projection` 精确读取与活动会话方法错配 `-32001 session-mismatch` 早期拒绝。证据：`docs/evidence/2026-10-24-p0-cross-end-gates.md`。
- 设置类页面新增 / 编辑表单改共享弹窗（供应商页试点；模型自定义编辑表单迁入）。
- 通用 UI 设计技能 `.agents/skills/ui-design`（独立发布，非 SaCode 业务能力接线）。证据：`docs/evidence/2026-10-24-ui-design-skill-publish.md`。
- **产品四端文档体系（文档）**：新增 `docs/clients/`（总览 + `desktop`/`cli`/`mobile`/`web` 四端目录），逐端补齐用途/需求/设计/边界/分步细节与跨端差异；按名称规则把 94 篇端专属文档由 `evidence/plans/product/superpowers`**物理归入**各端目录（通用/后端 286 篇留原位），同批重写全库引用并做断链校验；登记 `docs/README.md` 第 ⑪ 类。纯文档整理，不改源码与产品状态。

### 变更
- 新增**多 agent 进度登记机制**：`docs/agents/<agent-id>.md`（各 agent 自报在飞）+ `scripts/agent-board.mjs` → 汇总看板 `docs/product/agent-board.md`；并在 `AGENTS.md` 写入强制规则（开工登记 / 收尾更新 / 收尾自检）。
- **桌面渲染层视觉一致性**：三层重复色板合并为 `styles.css` 单一真源、令牌化 21 个 CSS、对比度 18/18 通过、圆角 / 字号 / 间距回到冻结档位。证据：`docs/clients/desktop/2026-10-24-desktop-renderer-ui-token-unification.md`。
- 默认 TUI 开发 Host 刷新为修复版 `71389261…`（技能工作区缓存修复，正式候选未覆盖）。证据：`docs/evidence/2026-10-24-host-skill-workspace-cache-fix.md`。
- 文档：统一自研产品叙事，去除历史参考项目缩写作为完成口径的表述（根 `README.md` / `AGENTS.md` / `docs/product/*` / `docs/plans/README.md`）。

### 修复
- 桌面端降级审计：修复 3 处真实降级（插件安装源读取失败显式化、迁移复制双通道反馈、模型中心账本提示去误解），其余为后端未实现的如实标注。证据：`docs/clients/desktop/2026-10-24-desktop-degradation-audit.md`。
- 新建空会话统计占位隐藏。证据：`docs/clients/desktop/2026-10-24-composer-empty-stats.txt`。

---

## 2026-10-23

### 新增
- **CLI 终端交互界面（Node/Ink TUI）初版**：`apps/cli/tui/`，npm 无参数 TTY 或显式 `sacode tui` 进入，其余透传仓颉 CLI；消息走 `session/append`，起轮走 `task/start`，审批 / 取消 / 结算全走 Host。证据：`docs/clients/cli/2026-10-23-cli-tui-ink.md`。
- **Linux Electron 桌面打包与打包态验收**：远端 Ubuntu 实跑，AppImage / deb 产物，三形态协议冒烟 `SMOKE PASS`。证据：`docs/clients/desktop/2026-10-23-linux-desktop-package.md`。
- **手机工程同仓归并**：`apps/mobile`（KMP / KuiklyUI，Android 应用与鸿蒙壳）。证据：`docs/clients/mobile/2026-10-23-mobile-source-import.txt`。
- 手机配对入口整改（电脑出票→手机设备配对）、M03 Markdown / 流式渲染、M04-A 路由与任务语义修复。证据：`docs/evidence/2026-10-23-mobile-*.md`。
- Web 工作台架构与技术选型方案（独立前端 + 同源 BFF + 受保护 daemon，HTTP+SSE）。证据：`docs/clients/web/2026-10-23-web-workbench-architecture.md`、`docs/clients/web/2026-10-23-web-technical-selection.md`。

### 变更
- **Windows 候选同源重打**：以固定提交 + 构建输入补丁串行重建 core / CLI / Host / daemon（4/4 rc=0），中性目录导出 794/794 文件哈希一致，默认沙箱 / 干净 PATH `--smoke` 真实退出 0。证据：`target/tmp/candidate-rebuild-20261023/DELIVERY.md`。

### 修复
- **LongCat 真实模型主闭环**（宿主级 + GUI 级 + 界面填写 Key 补验）：读取→提出写入→审批→落盘→真实 diff→关闭重开回放；仍待用户亲手复验。证据：`docs/evidence/2026-10-23-longcat-real-task-loop.md`、`docs/clients/desktop/2026-10-23-longcat-gui-key-entry.md`。
- UI 冒烟 283/16 分诊为测试支持滞后（非产品 UI 缺陷）。证据：`docs/clients/desktop/2026-10-23-ui-smoke-triage.md`。
- CLI 入口六项缺陷修复（D25）。证据：`docs/clients/cli/2026-10-23-cli-review-and-fixes.md`。

---

## 2026-10-22

### 修复
- Linux 构建钩子按平台分流；daemon 改为单宿主共享（远端 Linux 实跑）。证据：`docs/evidence/2026-10-22-linux-build-hook-and-single-host-daemon.md`。
- 沙箱可执行解析缺陷修复与 enforcing 真实入口边界。证据：`docs/evidence/2026-10-22-sandbox-resolve-fix-and-enforcing-boundary.md`。

---

## 2026-10-21

### 新增
- 接入能力：MCP（Host 六动词 RPC、工具桥、env 透传、重连与环境净化）、技能 provider 端到端与 `skill_load` 工具、subagent 角色定义编辑器（前端）。
- 串行 IPC 接线（桌面主进程具名 handler 映射至 Host）。

### 修复
- D23 `reasoning_content` 思考链路（核心局部）；D24 多供应商 failover 六项缺陷；计划批准持久化（审查 → 修复）。

---

## 2026-10-19 / 2026-10-20

- 第一批交互：工具身份关联、取消工单收束、持久重命名 / 归档、结构化提问。证据：`docs/evidence/2026-10-19-first-batch-interactions.md`。
- c4 验收 bug 修复 6 项。证据：`docs/evidence/2026-10-19-c4-acceptance-bugfix.md`。
- AppContainer `exit 1` 根因诊断；模型 shell `io-error` 诊断折叠与 Windows 强制隔离接线。证据：`docs/evidence/2026-10-20-*.md`。

---

## 更早迭代

更早的迭代与取证以 [`docs/evidence/`](docs/evidence/)（带日期与基线的实测证据）和 git 历史为准；本文件自 2026-10-24 起按批次持续记录。

---

## 版本号与标签（待统一）

当前版本标识不一致，需统一后再启用版本号分段：

| 位置 | 当前值 |
|---|---|
| `apps/desktop/package.json` | `0.1.0` |
| `npm/sacode-cli/package.json` | `0.2.0` |
| `npm/sacode-cli-win32-x64/package.json` | `0.2.0` |
| git 标签 | `baseline/sacode-2026-10-02`、`v0.1.8/15/32/33`、`v1.0.0/1.1.0/1.1.1` |

**待办**：统一各入口版本号与标签策略，并在首个正式发布时对本文件启用语义化版本段（不臆造历史版本内容）。