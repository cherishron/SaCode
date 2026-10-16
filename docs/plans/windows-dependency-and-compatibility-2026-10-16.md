# Windows 依赖与兼容性评估（2026-10-16）

- 评估时点：2026-10-16；基线：HEAD `7a249a1c` + 工作区（分支 `refactor/dsh-learning`）。
- 范围：**构建环境**（开发机构建 SaCode）、**桌面运行环境**（最终用户）、**CLI 运行环境**（最终用户）三层。
- 性质：依赖与可行性评估，**不是发布声明**；所有"已修复/已就绪"结论以引用证据为准。需求口径见 [PRD](../product/PRD.md) 与 [平台支持与分发要求](../product/platform-and-distribution.md)，构建步骤见 [build-platforms.md](../build-platforms.md)。

## 1. 三层环境总览

| 层 | 需要什么 | 谁提供 | 当前状态 |
|---|---|---|---|
| 构建环境 | 仓颉 SDK 1.1.3 + stdx 1.1.3.1 + Node ≥18 + Git +（网络：npm/官方资产） | 开发者机器 | 本机已具备（见 §2.1）；两个已知坑：修正运行库来源未明、github.com 下载不稳 |
| 桌面运行（用户） | 仅 Windows 10/11 x64 + 安装包；**免 SDK/Node**（Electron + Host + 全部 DLL/时区数据随包） | 分发载荷 | **待达成**（三阻塞均已定位可修，剩"执行＋复验"）：D10 根因＝构建产物继承仓库根 Low 标签（修复＝中性导出）；D18 安装器同根因；载荷待重打包（10-16 候选宿主已带修正 DLL）——详见 §3/§4 |
| CLI 运行（用户） | npm 渠道：Node ≥18；压缩包渠道：无额外依赖（原生 exe 自带 DLL） | 分发载荷 | 接近可用：平台包 85 文件含全部 runtime/MinGW DLL；重打脚本已修复并经 A/B 验证，待正式重打换修正运行库（D19、§3 问题 2） |

## 2. 完整安装清单与配置要求

### 2.1 构建环境（在 Windows 上构建本仓所需；用户不需要）

**必须安装：**

| 项 | 版本 / 要求 | 获取与配置 | 验证方式 |
|---|---|---|---|
| 仓颉 SDK | **1.1.3**（target `x86_64-w64-mingw32`；含 cjc/cjpm/LLD/clang 与 runtime 库） | 官方安装（本机路径 `D:\Program Files\HuaWei\Cangjie`）；`CANGJIE_HOME` 指向该目录 | `cjc -v`、`cjpm --version` 正常 |
| stdx | **1.1.3.1**（匹配 SDK） | `node scripts/setup-stdx.mjs` 下载到 `.deps/stdx/`；或显式 `SACODE_STDX_LIB_DIR` | `.deps/stdx/resolved-win32-x64.json` 生成 |
| Node.js | ≥18（本机 22.22.2） | 官方安装或托管版本 | `node -v` |
| Git | 任意近期版本 | 官方安装 | 仓库操作与 F08 功能 |

**操作纪律（Windows 特有）：**

- **并发互锁**：`cjpm test` 与 `cjpm build` 共享 `target/` 会互锁（cjc 挂起不退）。并发会话必须各用独立 `--target-dir`（如 `target/tmp/<用途>-<日期>-<短id>/`）。
- **打包收集三个目录**：`pack-cli`/`pack-host` 需要 `CANGJIE_HOME/runtime/lib`、stdx 目录、（可选）`OPENSSL_HOME` 同时存在，缺任一即拒绝生成"残缺包"。
- **Electron 依赖首次下载**：`apps/desktop` 的 `npm install`/electron-builder 会从 github.com 拉取 Electron 二进制与 NSIS 工具链；**GitHub 超时会导致 rc=1 且产物时间戳不变（假失败判别点）**。规避：`npx electron-builder --config.electronDist=node_modules/electron/dist`（本地 dist 不是镜像）。

**可选（诊断/加固用）：**

- DevEco Studio 附带的 **LLDB 15.0.4**——本机无 cdb/WinDbg/ProcDump 时唯一可用的崩溃采栈工具（已实测可用）。
- WSL / Linux 交叉环境——仅在需要重建仓颉运行库时涉及；本机缺失（`REGDB_E_CLASSNOTREG`），该支线已停止。

### 2.2 桌面用户环境（使用 SaCode 桌面）

| 项 | 要求 | 说明 |
|---|---|---|
| 系统 | **Windows 10/11 x64**（Electron 33 下限；本机 build 26300 实测） | arm64 未验证 |
| 运行时 | **无需安装任何东西**——仓颉 runtime DLL、stdx、628 个 TZif 时区数据、Host 均随包 | 设计目标：免 SDK 启动（[build-platforms.md](../build-platforms.md) §2 验收 1） |
| 磁盘 | 约 500 MB–1 GB（安装 + 用户数据 + 缓存） | 数据根 `SACODE_DATA_DIR` 可重定向 |
| 内存 | 建议 4 GB+（Electron 基线 300–800 MB + Host）；2–4 GB 勉强 | 低配机器的替代见 §5 |
| Git（可选） | F08 的 Git 面板/差异/提交需要系统 Git | 无 Git 时编辑器/终端仍可用 |
| 模型 API Key | **必须（BYOK）**——无内置模型 | 无 Key 时仅本地编辑/终端能力 |

### 2.3 CLI 用户环境

| 渠道 | 需要 | 说明 |
|---|---|---|
| npm（`@stand-alone/sacode`） | **Node ≥18**（`bin/cli.js` 是 Node 启动器，spawnSync 包内原生 exe） | npm 负责平台包选择；不设 PATH 回退 |
| release 压缩包 | 无额外依赖（原生 exe + 85 个 DLL 直接运行） | 免 Node 的降级渠道 |

## 3. Windows 特有问题清单（"这个不行、那个不行" + 原因）

> 症状多为"双击没反应/无输出退出"，原因集中在：进程沙箱、运行库缺陷、加载器规则、系统数据缺失、工具链缺失五类。

| # | 症状 | 原因 | 状态 / 规避 |
|---|---|---|---|
| 1 | 双击 `SaCode.exe` 无窗口、无 stdout/stderr；退出码 `0x80000003`（STATUS_BREAKPOINT） | **根因已定位（10-16 复核）：构建产物继承仓库根 Low Mandatory Level 标签 → 主进程低完整性 → 沙箱创建匿名窗口站被拒（Win32 5）→ STATUS_BREAKPOINT**；Low 标签只在本仓库根（本机工作区隔离），上级目录与用户目录均无 | 修复路径＝交付位置**中性导出**（`scripts/export-windows-artifact.mjs`；10-08 与 10-16 两轮均有"中性位置 SMOKE PASS"对照，10-16 含**默认沙箱完整 smoke**）。**未完成**：重打包＋真实双击通道复验（D10）。临时入口 `start-sacode-no-sandbox.cmd` 仍仅限可信本地测试 |
| 2 | 仓颉程序（cjc/cjpm/自建 exe）启动即 `0xC0000005`，无输出 | `libcangjie-runtime.dll` 模块链哨兵误读（`ReadWinModuleAtInit` 把首元素前哨兵当模块，wcslen 访问冲突） | 本机 SDK 已带 **2 字节修正**（`8b1d0783…`，来源未明、非官方发布）。10-16 盘点：win-unpacked 候选与 `dist/host` 已为修正版；**npm 平台包与 `dist` 10-12 目录版仍旧版（`ca65f2b8…`，D19）**；重打路径已验证（`pack-cli-windows.mjs` 工作区修复 A/B `exit 0`）——分发前必须正式重打包 |
| 3 | NSIS 安装器报临时文件错误（`Error writing temporary file…`） | **根因已定位（10-16 探针三格对照实证）**：安装器 exe 继承 Low 标签 → 启动器解压自身到默认 `%TEMP%`（Medium）被 MIC no-write-up 拒绝 | 修复路径＝重打安装器＋中性导出＋双击复验（D18）；无安装器产物期间随包 `TEMPORARY-NO-SANDBOX.txt` 记录：优先使用 win-unpacked 目录版 |
| 4 | 命名时区（如 `Asia/Shanghai`）保存被拒 | Windows 无 zoneinfo 系统数据 | **已修复**：628 个 TZif 随 Host 打包 + `CJ_TZPATH` 发现；Host 回归 14/14 |
| 5 | 直接运行自编译 exe 报缺 `libgcc_s_seh-1.dll` / `libstdc++-6.dll` | MinGW 运行库不在系统 PATH（SDK 目录单放，不自动进 PATH） | 发布载荷已含（平台包 85 文件实测在列）；自建探针需从 SDK runtime 目录复制或加 PATH |
| 6 | 两个会话同时 `cjpm build/test` 后整轮超时、cjc 挂死 | 共享 `core/target/release` 互锁 | 规避：每会话独立 `--target-dir` |
| 7 | electron-builder 从 github.com 下载超时 → rc=1 | 网络可达性（非逻辑错误）；**产物时间戳不变，易误判** | 规避：本地 `electronDist`；不设镜像 |
| 8 | 自建 `.ps1` 验证脚本被 `PSSecurityException` 阻断 | 本机 PowerShell 脚本签名/执行策略 | 规避：驱动改为 Node 脚本（已采用）；不擅自改系统策略 |
| 9 | 崩溃后无转储、无事件、无堆栈 | 无 cdb/WinDbg/ProcDump、WER LocalDumps 未配置 | 规避：DevEco LLDB 附身采栈（已还原过现场）；配置 WER 需用户授权 |
| 10 | Host/桌面组合运行报 `EPERM: unlink`（重打载荷时） | 活的 `sacode-host.exe` 进程锁住 `bin/*.dll` | 规避：停止自有进程或改打私有输出目录；不清他人进程 |
| 11 | 同一场景不同终端表现不一（High 可试、Low 静默失败） | 进程完整性级别（Mandatory Label）不同——Low/Medium/High 与可执行文件继承标签是不同事实 | 诊断时先用 `whoami /groups` 固定身份；不把标签直接当根因 |

## 4. 普通用户环境可行性评估

**分层结论：**

1. **桌面（尚不具备普通用户分发条件，但三阻塞均已定位且修复路径已有实证）**。剩余为"重打＋复验"：
   - D10 默认启动：根因＝构建产物继承仓库根 Low 标签；修复＝交付位置中性导出（10-08/10-16 两轮"中性位置 SMOKE PASS"对照，10-16 含**默认沙箱完整 smoke**，见 [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md)）；待重打包后真实双击复验；
   - D18 NSIS 安装器：同根因（Low 标签 → 写不了默认 `%TEMP%`）；最小探针三格对照已实证；待重打安装器＋中性导出＋双击复验；
   - 分发载荷重打包：10-16 win-unpacked 候选已含修正 DLL 与最新 Host（628 TZif 在列）；`dist/` 目录版仍是 10-12 旧载荷（含旧 DLL，D19），须替换或重打。
2. **CLI（最接近可用）**。包内自带全部运行时；剩余动作：重打包换修正 DLL；压缩包渠道实测（免 Node 路径）。npm 渠道对用户额外要求 Node ≥18——对"开发者用户"可接受。
3. **构建侧依赖永远不下放给用户**：SDK/stdx/Node 仅构建者需要；用户侧只有"Windows + 安装包"（桌面）或"Node 或压缩包"（CLI）。

**资源假设 vs 现实：**

| 资源 | 我们的开发机 | 普通用户可能 | 影响 |
|---|---|---|---|
| 内存 | 充裕 | 4–8 GB 常见，2–4 GB 存在 | 桌面可用但吃紧；CLI 无压力 |
| 磁盘 | 充裕 | 系统盘常不足 10 GB 空闲 | 桌面 ~1 GB；安装到用户目录（`perMachine:false` 已是用户级） |
| CPU/GPU | 无特殊需求 | 无特殊需求 | 默认启动崩溃已定位为完整性标签问题（非 GPU）；agent 会话通道内 Chromium 沙箱化 GPU 进程崩溃为**通道噪音**（不阻塞完整 smoke 主流程，回退软件渲染）；真实机器低配 GPU 环境随"双击复验"一并观察 |
| 网络 | 相对稳定 | 可能受限/代理 | 模型请求必须（BYOK）；安装包本身不依赖外网 |
| 管理员权限 | 有 | 可能没有 | 数据/安装均按用户级设计：`SACODE_DATA_DIR` 可重定向、目录不可写 fail-loud 不猜 C 盘 |

## 5. 替代方案与降级策略

| 场景 | 降级路径 | 代价/边界 |
|---|---|---|
| 桌面默认启动失败（修复前过渡） | ① **中性导出副本**：把 win-unpacked 复制/导出到仓库外（非 Low 标签）目录后再双击——10-16 已实证；**标准落点 `D:\tmp\SaCode-<用途>-<日期>`＋固定入口 `D:\tmp\SaCode-latest`（目录联接；10-16 双路径默认沙箱 smoke 均 PASS）** ② 临时 `start-sacode-no-sandbox.cmd`（**仅限可信本地测试**）③ 切换 CLI 使用同一核心 | ① 需一次性复制（约 341 MB）并 `icacls` 复核标签 ② 沙箱隔离降低，只能作为临时入口 ③ 无图形界面 |
| 机器低配（2–4 GB / 无独显） | 优先 CLI；桌面仅轻量会话 | CLI 内存占用小一个数量级；体验差异明示 |
| 用户无 Node | 用 release 压缩包（原生 exe，免 Node） | npm 渠道不可用；需文档引导 |
| 无 Git | 编辑器/终端/对话可用；Git 面板明确禁用 | F08 部分能力缺失，不假装可用 |
| 无外网（或仅弱网） | 本地功能可用；模型能力不可用（BYOK 前提） | 核心价值受限，需在页面明示 |
| NSIS 安装失败 | 中性导出后的安装器（重打后）／win-unpacked 目录版／portable 单文件 | 目录版无开始菜单集成；升级靠替换目录 |
| 无 SDK/无开发工具 | **无需降级**——用户侧本来就不需要 SDK | 这是产品设计目标（打包自带运行时） |
| 安全软件拦截（Electron/NSIS 误报） | 提示用户加白/用便携版 | 未取证，列为待复验项 |
| 模型用量受限/无 Key | 仅本地编辑与会话记录 | 与"可信可控"定位一致：不偷偷用替代后端 |
| 开发机上运行仓库内构建产物 | 先中性导出（复制/`export-windows-artifact.mjs`）再运行 | 仓库根 Low 标签会被一切仓内新文件继承；交付前必须复核 |

## 6. 结论与待办建议（按优先级）

1. **重打包分发载荷**（含修正运行库 DLL + 628 TZif + 当前 Host/CLI）——所有分发的共同前置；npm 平台包与 `dist` 目录版载荷仍是旧 DLL（D19）；
2. **交付流程固化中性导出**：单文件用 `scripts/export-windows-artifact.mjs`；目录版复制到非 Low 目录并以 `icacls` 复核目标标签——同时消除 D10/D18 根因；**落点标准＝`D:\tmp\SaCode-<用途>-<日期>`（10-16 实测无 Low 标签），固定入口 `D:\tmp\SaCode-latest`（目录联接，换版时重指）**；
3. **真实双击复验**：默认沙箱启动（D10）＋交互式安装/卸载全流程（D18）——须用户通道执行，agent 会话通道不能替代；
4. **CLI 压缩包免 Node 渠道实测**（verify-npm-install 已有基础）；
5. 普通用户文档（安装/降级/故障排查）随产品化在 `product/` 落位——本评估可作为其输入。

**复核入口**：每次重打包/分发验收后，用 §3 清单逐项复核；依赖变化（SDK/stdx/Node/Electron 版本）须同批更新本文件与 [平台支持与分发要求](../product/platform-and-distribution.md)。
