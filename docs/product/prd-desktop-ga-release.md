# SaCode 桌面端 v1.5 正式发布（Ga）与品牌体系统一 PRD

> 文档状态：**规划中（待评审）**
> 文档版本：v0.1
> 更新时间：2026-10-01
> 作者：产品规划（基于两份审计输入）
> 关联输入：
> - `桌面端产品就绪度审计报告.md`（功能/性能/UX/兼容/代码质量 + 上线缺失项）
> - `品牌体系完整性审计报告.md`（命名/Logo/视觉/标语/配色/文案）
> 关联路线：`docs/product/roadmap.md` v1.3–v1.5；`docs/product/desktop-multi-agent-prd.md`

---

## 1. 背景与问题陈述

### 1.1 现状
- CLI/TUI 平台质量达标：约 1266 个测试、fmt/clippy 门禁、三平台 CI、严格发布一致性脚本。
- roadmap v1.3–v1.5 已规划桌面端从 MVP 到发布的路线图，但**审计发现 v1.5 的发布交付物实际未落地**：
  - `release.yml` 只编 CLI 与 VSIX，**无 `tauri build`、无桌面产物、无签名、无安装器**。
  - 桌面端 `tauri.conf.json` 中 `bundle.active: false`，且无 `bundle.windows`/`bundle.macOS` 配置。
- 桌面 GUI 处于「MVP 壳 + 部分验收」阶段，存在阻断性缺陷，且品牌层存在配色冲突与双品牌混淆。

### 1.2 两份审计的核心结论（节选，详见输入文档）
**桌面端就绪度（P0 阻断）：**
1. IPC 能力白名单完全缺失（13 个自定义命令无一授权，应用不可用）。
2. 发布流水线不构建/发布桌面端。
3. 无 Windows/macOS 代码签名。
4. 无安装器、无自动更新。
5. 密钥库失败静默回退明文文件（高危泄露）。
6. `web.fetch` 无 SSRF 防护。
7. 沙箱只读模式 `check_path` 空 `write_paths` 放行写入。
8. 生产代码逾千处 `.unwrap()`/`panic!` 崩溃风险。

**品牌体系（冲突/缺失）：**
- 主题配色三套互相矛盾（`#366CFF` / `#2f81f7` / `#d97757`），无单一真源。
- 设计文档方向漂移（v1 蓝版 vs refresh 暖版并存）。
- 面向用户 UI 同时暴露 `SaCode` 与 `灵枢` 双品牌、关系未定义。
- 缺失正式品牌标语与主品牌矢量 Logo 母版。
- 缺品牌圣经文档。

---

## 2. 目标与成功指标

### 2.1 定性目标
让 SaCode 桌面端从「MVP 壳」变为**可安装、可安全上线、品牌一致**的正式产品（Ga），补齐 roadmap v1.5 的发布收口，并统一跨端视觉与命名身份。

### 2.2 量化成功指标（KPI）
| 指标 | 目标值 | 度量方式 |
|---|---|---|
| 新用户安装并首次启动成功率 | ≥ 99% | 安装包 + 启动埋点/抽样 |
| 首次启动到可用 | ≤ 2 分钟 | 冷启动计时（含 sidecar 拉起） |
| 发布前高危安全漏洞 | = 0 | 安全审计 + `cargo audit` |
| 桌面端会话级崩溃率 | < 0.5% | 崩溃上报（Epic4 引入） |
| 自动更新成功率 | ≥ 95% | updater 埋点 |
| 品牌规范触达面一致性 | 100% | CLI/TUI/Desktop/VSCode/文档/图标全核对 |
| 核心用户路径 E2E 覆盖率 | 100% | Epic7 测试清单 |
| 跨端主色一致性 | 单一真源生效 | 设计令牌与图标色统一 |

---

## 3. 范围

### 3.1 In Scope
- 桌面端可运行性修复（IPC 能力、panic 兜底）。
- 桌面端发布与分发链路（CI `tauri build`、签名、安装器、自动更新、发布门禁）。
- 安全加固（密钥回退、SSRF、沙箱只读、审批覆盖、CSP、daemon 鉴权）。
- 稳定性与崩溃恢复（前端错误边界、TUI 信号恢复、unwrap 收敛、超时重试、stdin 防 OOM）。
- 桌面体验补齐（通知、窗口状态、多窗口、浅色主题、离线 UX、跨平台文件夹选择、CLI 补全）。
- 品牌体系统一（主色定源、设计文档收敛、矢量 Logo、标语、灵枢定位、品牌圣经）。
- 测试与质量门禁（E2E、覆盖率、cargo audit/deny、npm lockfile、薄弱 crate 补测）。

### 3.2 Out of Scope（本期不做）
- Scheduled Tasks / Agent Teams / Channels（平台化收敛已延后）。
- ACP Client + OpenCode Backend（属 v1.4，独立排期）。
- 新功能特性开发（聚焦「可上线 + 一致」，不扩能力面）。
- 商标法律注册检索（建议并行外部进行，不阻塞）。

---

## 4. 用户与角色

| 角色 | 描述 | 核心诉求 |
|---|---|---|
| 终端开发者（主用户） | 习惯 Shell/CLI 的开发者 | 桌面端安装即用、稳定不崩、品牌可信 |
| 国内企业用户 | 关注可审计、国内模型适配 | 安全合规、密钥不落盘、审计完整 |
| 开源贡献者 | 参与 SaCode 开发 | 一致的开发体验与品牌规范 |
| 运维/发布负责人 | 负责发版 | 确定性构建、签名、可回滚、自动更新 |

---

## 5. 史诗分解（Epics）与验收标准

### Epic 1 — 桌面端可运行性（P0 阻断）
**用户故事**：作为用户，我希望安装打开桌面端后所有原生能力（启动守护进程、文件夹选择、终端、托盘、自启、代理）都能正常工作。
**需求与验收**：
- AC1：`capabilities/default.json` 为全部 13 个自定义 `#[tauri::command]` 补 `allow-*`（或采用等价授权），`tauri build` 后所有 IPC 调用不再 `PermissionDenied`。
- AC2：Rust 端为 Tauri 命令处理器与 `daemon_proxy` 增加集成测试；`main.rs` 关键路径补单测。
- AC3：TUI 增加 `set_panic_hook` + `SIGINT` 恢复，panic/中断后终端不卡在 raw+alt-screen。

### Epic 2 — 发布与分发链路（P0 阻断）
**用户故事**：作为用户，我希望从官网/发布页下载安装包，一键安装并后续自动静默更新。
**需求与验收**：
- AC1：`release.yml` 增加 `tauri build` 矩阵（Windows x64 / macOS x64+arm64 / Linux x64），产出桌面产物并上传 Release。
- AC2：启用 `bundle.windows`（Authenticode 签名）与 `bundle.macOS`（Apple 公证），证书与密钥经 CI secret 注入，不落库。
- AC3：`bundle.active: true`，启用 NSIS / MSI / dmg / deb 目标。
- AC4：引入 `tauri-plugin-updater`，配置签名更新源，发布流程产出带签名的更新清单。
- AC5：发布门禁补充 sidecar / ACP / Desktop 确定性检查（对齐 roadmap v1.5 P1）。

### Epic 3 — 安全加固（P0 高危）
**用户故事**：作为企业用户，我要求密钥不落盘、工具调用不越权、网络访问不触及内网。
**需求与验收**：
- AC1：`identity/service.rs` 密钥库写入失败时**必须显式要求** `--insecure-file-secrets` 才回退明文，否则报错退出。
- AC2：`tools/web/mod.rs` 的 `normalize_url` 增加私有网段/回环/链路本地（含 `169.254.169.254`）过滤。
- AC3：`sandbox/mod.rs` 的 `check_path` 在 `write_paths` 为空时**拒绝**写入（纵深防御生效）。
- AC4：审批在 `Plan` 模式同样触发（当前仅 `Build` 模式）。
- AC5：`tauri.conf.json` 启用 `security.csp`（最小必要来源）。
- AC6：确认 `daemon/approval.rs` 仅绑定 `127.0.0.1` 且需 token 鉴权。

### Epic 4 — 稳定性与崩溃恢复（P0/P1）
**用户故事**：作为用户，我希望应用罕见异常时能优雅降级、不白屏、不崩进程。
**需求与验收**：
- AC1：前端 `main.ts` 增加 `app.config.errorHandler` + `onErrorCaptured`，全局错误边界 + 崩溃上报（脱敏）。
- AC2：生产代码高危路径 `.unwrap()`/`panic!` 收敛为可恢复错误（按审计报告清单逐项）。
- AC3：`provider/client.rs` 流式超时调优（仅限连接/首字节，不含整段生成）+ 429 重试。
- AC4：`runtime_entry.rs` stdin 改为流式/分块读取，防 GB 级管道 OOM。
- AC5：PTY 工作线程 `catch_unwind`，避免单线程 panic 拖垮进程。

### Epic 5 — 桌面体验补齐（P1/P2）
**用户故事**：作为用户，我希望桌面端具备现代桌面应用的完整体验。
**需求与验收**：
- AC1：引入系统通知（任务完成 / 待审批 / 错误）。
- AC2：窗口位置/尺寸/最大化状态持久化（`window-state` 插件）。
- AC3：支持多窗口 / 多项目（或明确 v1.5 不做并文档化）。
- AC4：浅色主题 + 终端 truecolor 能力探测。
- AC5：离线/重连明确 UX（连接状态 + 重连提示）。
- AC6：文件夹选择跨平台（Linux/macOS 不再返回 Err）。
- AC7：CLI 增加 shell 自动补全（bash/zsh/fish/pwsh）。

### Epic 6 — 品牌体系统一（P1/P2，结合品牌审计）
**用户故事**：作为用户与贡献者，我希望 SaCode 在各触达面呈现一致、专业的品牌形象。
**需求与验收**：
- AC1：**主色定源**——选定暖色陶土 `#d97757` 体系为唯一品牌色，废弃 v1 蓝版；VSCode 图标蓝 `#366CFF` 同步归入同色系（重新生成图标）。
- AC2：**设计文档收敛**——明确 `desktop-ui-refresh`（暖）为唯一真源，标记 v1 蓝版为历史。
- AC3：**矢量 Logo 母版**——产出 SaCode 主品牌 SVG 母版 + 使用规范（留白/最小尺寸/禁用组合）。
- AC4：**品牌标语**——产出中英文一句话价值主张，落地 About 页与文档首页。
- AC5：**灵枢定位决策**——明确 `灵枢` 是「引擎代号（不应暴露给用户）」还是「功能品牌（保留）」，据此收敛 `ChatCard`/`turn-events` 等 UI 文案。
- AC6：**品牌圣经**——编写文档定义 Cherishron / SaCode / 灵枢 三层关系、配色、字体、文案语气与适用场景。

### Epic 7 — 测试与质量门禁（P1/P2）
**用户故事**：作为发布负责人，我希望每次发版都有确定性、可度量的质量保障。
**需求与验收**：
- AC1：桌面端引入 E2E（Playwright），覆盖启动→对话→工具卡→审批核心路径。
- AC2：CI 接入覆盖率度量（llvm-cov / codecov），设最低门槛。
- AC3：CI 增加 `cargo audit` 与 `cargo deny`（SCA + 许可合规）。
- AC4：`npm-package` 提交 `package-lock.json`（安装可复现）。
- AC5：`interfaces/acp`（4 测试）、`interfaces/desktop/src-tauri`（8 测试）补强至合理覆盖。

---

## 6. 优先级（RICE 概览）

| Epic | Reach | Impact | Confidence | Effort(人周) | RICE | 排序 |
|---|---|---|---|---|---|---|
| E1 可运行性 | 3 | 3 | 1.0 | 0.5 | **18.0** | P0 |
| E3 安全加固 | 2 | 3 | 1.0 | 1.5 | **4.0** | P0 |
| E2 发布分发 | 3 | 3 | 0.9 | 3.0 | **2.7** | P0 |
| E4 稳定性 | 3 | 2 | 0.8 | 2.0 | **2.4** | P1 |
| E7 测试门禁 | 1 | 2 | 0.8 | 2.0 | **0.8** | P1 |
| E6 品牌统一 | 2 | 2 | 0.7 | 2.0 | **1.4** | P1 |
| E5 体验补齐 | 2 | 2 | 0.7 | 2.5 | **1.1** | P2 |

> RICE = (Reach×Impact×Confidence) / Effort；数值仅用于相对排序，非精确预测。

---

## 7. 里程碑（对齐审计报告 A/B/C 与 roadmap v1.5）

### M1 — 消除发布阻断（约 2–3 周）
**目标**：桌面端能跑、能装、能安全启动。
- E1（全）+ E2（AC1–AC3 基础构建/签名/安装器）+ E3（AC1–AC3 密钥/SSRF/沙箱）。
- 退出标准：本地 `tauri build` 出带签名安装包；IPC 全部可用；密钥失败不落盘；SSRF/沙箱只读通过安全自测。

### M2 — 安全上线与品牌定调（约 2–3 周）
**目标**：可灰度发布，品牌方向锁定。
- E3（余下 AC4–AC6）+ E4（AC1–AC3 错误边界/panic恢复/TUI）+ E6（AC1–AC5 主色/标语/灵枢定位）+ E7（AC1 E2E 起步）。
- 退出标准：崩溃上报可用；TUI 中断恢复；主色全端统一；品牌标语落地；核心路径 E2E 通过。

### M3 — 体验打磨与质量固化（约 2–3 周）
**目标**：正式 Ga。
- E4（余下）+ E5（全）+ E6（AC6 品牌圣经）+ E7（余下 覆盖率/audit/deny/lockfile/薄弱 crate 补测）+ E2（AC4–AC5 updater + 发布门禁）。
- 退出标准：自动更新可用；通知/窗口状态/浅色主题到位；CI 全绿含覆盖率与 audit；品牌圣经评审通过。

---

## 8. 风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| 代码签名证书/公证账号未就绪 | 阻塞 M1 签名 | 提前采购/配置 Windows Authenticode 与 Apple Developer 账号 |
| `tauri build` 跨平台 CI 资源/系统 WebView 依赖 | 阻塞 M1 构建 | 提前验证 CI runner（尤其 macOS 公证需专用环境） |
| 灵枢定位争议（引擎 vs 功能品牌） | 影响 E6 文案与文档 | M2 初即由产品决策，避免后期返工 |
| 主色变更牵动多处资产（图标/文档/UI） | 范围蔓延 | 以设计令牌为唯一真源，自动化校验 |
| 自动更新需稳定签名更新源 | 影响 M3 | M2 末确定更新通道与回滚策略 |
| 平台层 unwrap 收敛工作量被低估 | 影响 E4 进度 | 按审计报告清单分批，优先高危路径 |

---

## 9. 验收与发布标准（Definition of Done / Release Criteria）

Ga 发布前必须全部满足：
1. M1–M3 全部 Epic 验收标准通过。
2. CI 三平台 `tauri build` + 签名 + 安装器产出，发布门禁全绿（含 `cargo audit`/`deny`、覆盖率门槛、E2E）。
3. 安全自测：密钥不落盘、SSRF 拦截、沙箱只读、审批覆盖 Plan、CSP 生效、daemon 鉴权确认——**0 高危**。
4. 品牌规范评审通过：主色单一真源、跨端一致、标语与 Logo 母版就位、品牌圣经发布。
5. 崩溃率 < 0.5%、首次启动 ≤ 2 分钟、自动更新 ≥ 95%（灰度数据）。
6. 用户文档（安装/更新/故障排查）与 About 页信息齐全。

---

## 10. 与现有文档关系

- **补充** `roadmap.md` v1.5：把「Desktop installers / 凭据迁移 / 发布门禁」从规划项落地为可执行 PRD，并补齐审计发现的真实缺口（IPC 白名单、发布不构建桌面等）。
- **并列** `desktop-multi-agent-prd.md`：本 PRD 聚焦「发布 + 品牌」，不重复多 Agent 客户端能力设计。
- **不冲突** `unified-identity-prd.md`：该文档为认证身份（sa-idp 登录），本 PRD 的密钥/品牌为独立维度。
- **输入依赖**：两份审计报告（`桌面端产品就绪度审计报告.md`、`品牌体系完整性审计报告.md`）为本 PRD 的问题清单真源。
