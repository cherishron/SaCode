# 项目评审：安全 / 代码 / 架构 / 治理（2026-10-24）

> 类别：评审证据（一次性、带日期的评审记录）。范围是**抽样评审**，不是全量逐行审计，也不是渗透测试；未运行完整测试套件、未做动态利用验证。
> 结论用于补登缺陷，不代表对功能完成状态的升级；现行范围与状态以 [PRD](../product/PRD.md) 与 [台账交付卡](../product/PRD-tracking.md#当前交付卡2026-10-18-用户确认) 为准。

## 0. 范围与方法

- **覆盖**：`core`（474 文件 / 82,358 行）、`apps/{cli,host,daemon}`、`apps/desktop/renderer`（135 文件 / 62,222 行）、原生 C（`windows_process.c` / `windows_workspace.c` / `platform_posix.c`）、`scripts`、依赖清单。
- **方法**：安全关键实现的代码抽查 + 模式化核查（凭据 / 命令执行 / 路径边界 / IPC / 脱敏 / 后门开关），并与既有缺陷台账（D03–D26）、安全证据交叉核对。
- **局限**：抽样；未跑全量 core 测试（当前编译受阻，见 D27）；未做动态验证。

## 1. 结论摘要

| 维度 | 评级 | 一句话 |
|---|---|---|
| 安全 | 良好 | 抽查**未发现可直接利用的高危漏洞**；沙箱/审批/凭据/IPC 设计为最大亮点 |
| 架构 | 良好 | 共享 core + 多端适配边界清晰，安全机制集中在少数核心模块 |
| 代码质量 | 中 | 核心实现质量高，但全量单测无法编译（D27），规模偏大 |
| 测试 | 中 | 测试量大（core 237 / desktop 227），但整体回归跑不起来（D27） |
| 项目/治理 | 偏低 | 发散、无收敛闸门、无固定评审基线（D28） |

## 2. 安全评审

### 2.1 强项（有代码证据）

| 面 | 证据 | 评价 |
|---|---|---|
| 沙箱 fail-closed | `core/src/sandbox.cj:51-66`：`confine` 只接受闭集 `read-only/workspace-write`，其余（含 `danger-full-access`、拼错、空串）一律抛；注释明确"原先只拦 danger-full-access 是 fail-open，已修" | 优秀 |
| Linux 隔离 | `core/src/platform_sandbox.cj:10-46`：bwrap `--unshare-all --cap-drop ALL --clearenv`，只读白名单系统目录，工作区唯一可写，不挂 `/home`/`/run`/根/DBus；工作区路径拒 `/`、HOME、系统目录 | 优秀 |
| 审批协议 | `core/src/approval.cj`：一次性票据、票绑工具、单调钟过期（防改时）、认不出的决定不改判、旧 ID 不可重用 | 优秀 |
| 凭据缝 | `core/src/credential.cj`：配置面只带引用（=环境变量名）、每次重解析不缓存、空值算缺席、活环境供值不可写、`safeSummary` 不带值、**明文存储如实标注** | 优秀 |
| IPC 面 | `apps/desktop/preload.cjs` 顶层 219 通道；`main.cjs` 120 个显式 `ipcMain.handle` + `domainChecked(args, check)` 逐字段校验器 + models/customs/plugins guard；**无"发任意方法"通用转发** | 良好 |
| 错误脱敏 | `core/src/transport_failure.cj:99`、`mcp_client.cj` 环境净化（`<redacted>`）、`remote_audit.cj`；`secret_bundle.cj:27` 结构上**不提供跳过校验开关** | 良好 |
| 无密钥入库 | 唯一"疑似硬编码密钥"是 `core/src/transport_failure_test.cj:42-44` 的**假串**，且断言"摘要不得含它"——是脱敏测试 | 良好 |
| 无产品级后门 | 未发现"跳过 TLS 验证 / 禁用沙箱 / 信任所有"的用户开关 | 良好 |

### 2.2 发现

- **[P2 / 详见 D14] Windows 执行默认不可用 + 无沙箱后端**：`platform_sandbox.cj:48-52` 对 Windows/macOS/OHOS 返回 `SandboxRuntime()`（`backendAvailable=false`）。安全上这是**正确的 fail-closed**（Windows 上跑命令默认被拒，不会裸跑）；功能上即 `D14`——Windows 用户跑不了命令/测试。需**补后端，而非放宽**。
- **[P2 / D29] 凭据明文存用户文件**：非 OS 钥匙串（已如实标注）。建议上 Windows DPAPI / macOS Keychain。
- **[P2 / D30] 浏览器驱动关 Chrome 沙箱**：`core/src/bu_exec.cj:26-27` 用 `--headless --no-sandbox --disable-gpu`。headless Chrome 沙箱关闭 + 可访问网络；**需确认是否有外层进程隔离/网络限制**（未见其走 `platform_sandbox`）。
- **[P2] TLS 无显式 pin/主机名校验核对**：`transport_failure.cj` 只做错误分类，验证依赖底层默认。建议明确核对"证书链 + 主机名"是否强制、无开关可放宽。
- **[P2 / D31] 无持续安全扫描**：有一次性密钥扫描证据（`KEY_ON_DISK=[]`），但未纳入 CI 常规门禁（依赖漏洞 / secret / SAST）。

> 未发现 P0 级安全漏洞（无真实密钥泄露、无通用 IPC 转发、无跳过验证后门、隔离默认 fail-closed）。

## 3. 代码 / 架构评审

**优点**
- 共享 core + 多端复用同一业务核心；`README.md` 架构图与 `AGENTS.md` 模块边界与实现一致。
- 安全机制收敛在少数模块（approval / sandbox / credential / execution）。
- 渲染层守 CSP（纯 JS + Vue runtime + `h()`，第三方构建期折叠）；`apps/desktop` **无 runtime 依赖**（仅 devDependencies：electron/esbuild/shiki/@xterm），产物运行时零 npm 依赖——供应链面小。
- 大量显式边界（"不假装已做到"）。

**技术债 / 风险**
- `core` 规模偏大（474 文件）；测试与源码同目录分布。
- **全量单测无法编译**（D27）。
- 未闭合：D03 / D04 / D06 / D07 / D08 / D22 / D23 / D24 / D25 / D26。

## 4. 测试评审

- 规模：`core` 237 个 `*_test.cj`、`desktop` 227 个 `*.test.mjs`，另有协议 smoke 与 `--ui-smoke`。
- 可验证性受损：全量 core 测试编译失败/超时（D27），只能跑子集；部分用例依赖真实外部条件跳过；Electron GUI 受环境限制。

## 5. 项目 / 治理评审

- 进度：F01–F21 **21 域 0 个"已验证"**；主闭环已由用户亲手复验（仅主闭环）。
- 治理：多 AI 会话并行、7 个 worktree、~150 个未提交文件、270 份 evidence / 64 份 plans；产出膨胀、交付未同步。
- 根因：**缺少强制收敛闸门**（AGENTS.md 已写规则但无执行机制）。
- **无固定评审/交付基线**（D28）：工作区大量未提交，导致"评审/交付到底锚定哪一版"不确定。

## 6. 分级发现汇总

| 级别 | 发现 | 对应 |
|---|---|---|
| P1 | 全量 core 单测无法编译 → 无法整体回归 | **D27** |
| P1 | 工作区大量未提交 → 无固定评审/交付基线 | **D28** |
| P1 | Windows 执行不可用、无沙箱后端 | D14 |
| P1 | 治理无收敛闸门 → 发散 | 见交付卡"暂缓与安全边界" |
| P2 | 凭据明文（非 OS 钥匙串） | **D29** |
| P2 | 浏览器 `--no-sandbox` 外层隔离待确认 | **D30** |
| P2 | 无持续安全扫描入 CI | **D31** |

## 7. 结论

1. **安全设计是被低估的强项**，质量高于市面多数同类工具，且贯彻了"fail-closed 优先于功能可用"。
2. **最大问题不是安全，是治理与收敛**：技术资产已厚，但缺"把厚变成交付"的机制。
3. **最该先做**：冻结一个提交基线 + 修通全量 core 测试（D27/D28）；否则任何"整体评审/验收"都缺立足点。

## 8. 方法边界与未覆盖

- 未做：全量逐行审计、动态渗透、依赖 SBOM/CVE 扫描、跨端（Web/Mobile/daemon 远端）安全专项、原生 C 的内存安全专项。
- 本评审为一次性快照；结论随源码变化需重评。