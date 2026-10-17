# Windows 三问题排查：双击 0x80000003 / 仓颉运行时 DLL / NSIS 临时文件（2026-10-16）

> 取证日 2026-10-16（下午），分支 `refactor/dsh-learning`，HEAD `7a249a1c` + 工作区。
> 范围：**只读复核 + 位置对照实验**。未修改系统 ACL/安全策略、未重打包正式产物、未提交。
> 本文件为冻结快照（只增不改）。三条问题的实时状态与缺陷编号见 [PRD-tracking.md](../product/PRD-tracking.md) D10/D18/D19；依赖侧结论见 [windows-dependency-and-compatibility-2026-10-16.md](../plans/windows-dependency-and-compatibility-2026-10-16.md)。

## 1. 结论速览

| 问题 | 根因 | 修复路径 | 本轮实证 | 剩余 |
|---|---|---|---|---|
| ① 双击 `SaCode.exe` 无反应 / `0x80000003` | **构建产物继承仓库根 Low Mandatory Level 标签** → 主进程低完整性 → 沙箱创建匿名窗口站被拒（Win32 5）→ `STATUS_BREAKPOINT` | 交付位置**中性导出**（产物移出 Low 标签树后再交付/双击） | 中性副本标签复核 = implicit-medium；**默认沙箱与 `--no-sandbox` 均全链路 `SMOKE PASS`**（GPU 进程崩溃噪音不阻塞主流程） | 真实双击通道复验；交付流程固化中性导出 |
| ② 仓颉程序启动即崩 `0xC0000005` | `libcangjie-runtime.dll` 模块链哨兵误读（`ReadWinModuleAtInit`） | 用已打 2 字节补丁的 SDK **重打平台包** | SDK = 修正版 `8b1d0783…`（含替换备份与回滚记录）；打包脚本 A/B 验证 `exit 0` 且新包带修正 DLL；win-unpacked 候选宿主已是修正版并通过 Host smoke | 正式重打 npm 平台包；`dist` 10-12 载荷仍是旧版 |
| ③ NSIS 安装器临时文件错误 | 安装器 exe **继承 Low 标签** → 低完整性进程无法写默认 `%TEMP%`（Medium，MIC no-write-up）→ "Error writing temporary file" | 重打安装器 + 中性导出 + 双击复验 | 最小 NSIS 探针三格对照：中性成功 / 仓库内失败 / 中性写 Low 目录成功——直接复现机制 | 安装器无现成产物（历史候选已清理）；重打后需双击复验 |

三条**均判定为"可修复"**（路径明确、有工具、有对照实证）；在重打包与真实双击复验完成前**不得宣布已修复**。

## 2. 问题①：0x80000003——Low 标签继承链（复核 + 对照实验）

### 2.1 标签复核（只读 `icacls`，2026-10-16）

| 路径 | Mandatory Label 读数 |
|---|---|
| `D:\Project\sa\saai\sa-code`（仓库根） | `Low Mandatory Level:(OI)(CI)(NW)` —— **可继承、No-Write-Up** |
| `D:\Project`、`D:\Project\sa`、`D:\Project\sa\saai`（上级三级） | 无 Low 标签（implicit-medium） |
| `C:\Users\jingg`、`C:\Users\jingg\Downloads`（用户目录） | 无 Low 标签（implicit-medium） |
| `target/tmp/desktop-current-candidate/7d18278c21/output-final/win-unpacked/SaCode.exe` | `Low Mandatory Level:(I)(NW)` —— 继承 |
| `apps/desktop/dist/electron/project-picker-final-20261012/win-unpacked/SaCode.exe` | `Low Mandatory Level:(I)(NW)` —— 继承 |
| `npm/sacode-cli-win32-x64/bin/*.exe / *.dll` | `Low Mandatory Level:(I)(NW)` —— 继承 |

**Low 标签只出现在本仓库根**（上级目录与用户目录均无）：这是本机工作区隔离设置，**不是系统或用户环境固有物**；凡在本仓库树内创建的文件都会继承该标签。

### 2.2 生效链条（引 10-08 / 10-11 既有证据）

- [windows-low-integrity-delivery-fix-2026-10-08.md](windows-low-integrity-delivery-fix-2026-10-08.md)：父进程令牌完整性 RID=8192（Medium），新 Electron 进程 RID=4096（Low）——新进程完整性取调用者与可执行文件标签的较小者（Microsoft MIC 规则）；Low 主进程 `CreateWindowStation` 返回 Win32 5 后退出 `0x80000003`。同字节产物经 `probe-neutral-delivery.cjs`（按内容重写、不复制安全描述符）从中性目录运行：**SMOKE PASS、退出 0**。
- [2026-10-11-takeover-regression-and-plugin-delivery.md](2026-10-11-takeover-regression-and-plugin-delivery.md) §9.10/§9.11：用户 Explorer 直接启动实测 `CreateWindowStation handle=0 error=5`；独立 32/64 位子程序写默认 TEMP 返回错误 5、写 D 盘私有目录成功；Chromium 130 枚举 12 = `SBOX_ERROR_CANNOT_CREATE_WINSTATION`。

### 2.3 本轮复现与 A/B 对照

10-16 凌晨留档（仓库内候选，`target/tmp/desktop-current-candidate/7d18278c21/` 各 `smoke-*/run.log`）：

| 组 | 参数 | 读数 |
|---|---|---|
| smoke-captured-default / same-env-default / diagnostic-disable-gpu / diagnostic-logging | 默认沙箱（含 `--disable-gpu`、`--enable-logging` 变体） | `EXIT_CODE=2147483651`（`0x80000003`），无输出 |
| smoke-captured-no-sandbox / same-env-no-sandbox | `--no-sandbox` | `EXIT_CODE=0` + `SMOKE PASS` |

本轮会话新实验（产物 = `output-final/win-unpacked`，341 MB / 795 文件）：

| 组 | 位置 | 参数 | 读数 |
|---|---|---|---|
| **B0** | **中性**（`C:\Users\jingg\Downloads\SaCode-neutral-verify-20261016`，robocopy 复制，`SaCode.exe` = implicit-medium） | `--smoke`（**默认沙箱**） | **`SMOKE PASS`**：initialize/projection/subscribe/durability、退出 0 全通；stderr 含 GPU 进程 `0xC0000005` 噪音 7 次后软件回退，未 FATAL |
| B2 | 中性 | `--smoke --no-sandbox` | **`SMOKE PASS`**（无 GPU 噪音） |
| B1 | 中性 | `--smoke --disable-gpu`（默认沙箱） | GPU 进程反复崩溃后 `FATAL: GPU process isn't usable`（变体读数） |
| B3 | 中性 | `--version`（默认沙箱，未进入 smoke） | 同型 GPU 崩溃（探测形态） |
| A2 | 仓库内（Low） | `--smoke`（默认沙箱） | 静默退出（exit 0、无输出；事件日志无崩溃记录） |

**通道边界（订正）**：本 agent 会话通道中，Chromium 沙箱化 GPU 进程存在 `0xC0000005` 崩溃噪音，但**不阻塞完整 smoke 主流程**——B0 在默认沙箱模式下完整 `SMOKE PASS`（GPU 进程崩溃后回退软件渲染）；`--no-sandbox` 下无噪音（B2）。`--version` / `--disable-gpu` 单探测形态的 FATAL 属该通道 GPU 子路径不稳定，不影响"中性导出解除 `0x80000003`"的结论。最终验收仍以真实双击（用户通道）为准。

**附加发现（诊断环境）**：WorkBuddy 会话进程树内存在 `ELECTRON_RUN_AS_NODE=1`（仅 Process 级，User/Machine 级为空）。诊断运行若不清除该变量，`SaCode.exe` 会退化为纯 Node 报 `bad option: --smoke`（exit 9）——**与产品缺陷无关**，用户双击不受影响；本仓诊断脚本应显式清除（`start-sacode-no-sandbox.cmd` 早已设置该变量为空）。

### 2.4 修复路径

1. **即时可用**：目录版经"非继承位置"交付（`robocopy` 到仓库外 + `icacls` 复核目标 `SaCode.exe` 无 Low 标签）；单文件（安装器/portable）用 `scripts/export-windows-artifact.mjs`（拒绝仓库内目的地、按内容重写、核对标签与 SHA）。
2. **流程固化**：构建产物在进入交付/双击环节前必须做中性导出，否则继承 Low 标签；`export-windows-artifact.mjs` 已把"目标必须是普通 Medium"设为硬门槛。
3. **最终验收**：真实双击（用户通道）跑默认沙箱模式。

## 3. 问题②：仓颉运行时 DLL——现状盘点与重打路径

### 3.1 哈希盘点（2026-10-16）

| 位置 | `libcangjie-runtime.dll` SHA256 前缀 | 判定 |
|---|---|---|
| SDK `D:\Program Files\HuaWei\Cangjie\runtime\lib\windows_x86_64_cjnative` | `8b1d0783…`（Oct 15 20:31） | **修正版** |
| SDK 备份 `runtime-backups/20261015-211124-511`、`20261015-211158-966` | `ca65f2b8…` | 原始（替换前），含 `repair-record.txt`：原始 CA65F2B8 → 补丁 8B1D0783 + 管理员回滚命令 |
| `npm/sacode-cli-win32-x64/bin/` | `ca65f2b8…` | **旧版，需重打包** |
| `apps/desktop/dist/electron/project-picker-final-20261012/win-unpacked/resources/host/bin/` | `ca65f2b8…` | **旧版**（10-12 构建早于 10-15 补丁） |
| `target/tmp/…/output-final/win-unpacked/resources/host/bin/`（10-16 候选） | `8b1d0783…` | 修正版（构建时取自打补丁 SDK） |
| `apps/desktop/dist/host/bin/` | `8b1d0783…` | 修正版 |
| `target/tmp/pack-cli-windows-verify/out-new/bin/`、`out-old/bin/` | `8b1d0783…` | 修正版（打包源为当前 SDK） |

### 3.2 重打路径（已验证工具）

- `target/tmp/pack-cli-windows-verify/verify-result.md`（10-16，一次性产物，可随 `target/` 清理）：`scripts/pack-cli-windows.mjs` 的 MinGW 段修复（必需 `libwinpthread-1.dll` + 可选 `libgcc_s_seh-1.dll`/`libstdc++-6.dll`；依据 PE 导入闭包）通过 A/B 验证：OLD `exit 1`（缺 libgcc），NEW `exit 0`，`out-new/bin` 80 颗 DLL + 修正版 runtime。**该脚本改动为工作区未提交状态**。
- 正式重打前置：构建 `apps/cli`（`main.exe` 当前已清理）或用 `SACODE_CLI_EXE` 指预构建 exe；重打产物替换 `npm/sacode-cli-win32-x64` 后即携带修正版 DLL。
- win-unpacked 候选（10-16）宿主已是修正版，且本文件 §2.3 B2 的 `SMOKE PASS` 已覆盖真实 Host 初始化/投影/订阅——修正 DLL 在桌面载荷内实际生效。

### 3.3 边界

- 2 字节修正**来源未明、非官方发布**（沿用既有口径，见 [2026-10-15-p1-cancel-budget-fix.md](2026-10-15-p1-cancel-budget-fix.md)）；重打/分发前需用户确认是否接受该修正作为交付基础。
- 未做：官方 SDK 升级对照、修正版在其他仓颉程序（cjc/cjpm）上的回归。

## 4. 问题③：NSIS 临时文件错误——探针矩阵实证

### 4.1 机制

NSIS 大型安装器（>500 KB）运行时，启动器先把自身解压到 `%TEMP%` 再执行；`%TEMP%` 默认位于用户目录（Medium 完整性），而**低完整性进程写 Medium 对象被 MIC no-write-up 拒绝** → `NSIS Error: Error writing temporary file. Make sure your temp folder is valid.`（用户 10-11 截图原文）。

### 4.2 最小探针三格对照（本轮新增，直接实证）

探针：`target/tmp/nsis-temp-probe-20261016/`（`temp-probe.nsi` 纯 ASCII、`SilentInstall silent`、8 MB 不可压载荷触发"解压到 TEMP"路径；`run-probe.mjs` 捕获退出码并检查结果文件）。同一二进制，仅位置不同：

| 实验 | 探针位置 | `%TEMP%` 目标 | 结果 | 说明 |
|---|---|---|---|---|
| N1 | 中性（implicit-medium） | `C:\Users\jingg\AppData\Local\Temp`（Medium） | **成功**：`exit 0`，写 `sacode-nsis-temp-probe-ok.txt`、解压 8 MB 载荷 | 正常用户场景 |
| N2 | 仓库内（Low 标签） | 同上 | **失败**：无写入、无解压（静默退出） | 复现"低完整性写不了 Medium TEMP" |
| N3 | 中性 | 仓库内私有目录（Low） | **成功** | Medium 写 Low 允许——解释 10-11 探针" D 盘私有目录 rc=0" |

三格结果与 MIC 规则完全一致，与 [2026-10-11-takeover-regression-and-plugin-delivery.md](2026-10-11-takeover-regression-and-plugin-delivery.md) §9.9/§9.10 的既有读法（C 盘 TEMP 失败/D 盘成功）互为印证，并补上了当时"没有取证到具体文件访问失败的底层原因"的缺口。

**边界**：探针为静默模式，未复现交互式错误对话框（用户截图为交互形态）；机制判定不受影响。10-11 记录"最小 NSIS 探针在默认 C 盘 TEMP 12 秒未退出"与"写 TEMP 错误 5"分别对应交互弹窗等待与静默拒绝两种形态。

### 4.3 修复路径

1. **重打安装器/portable**（electron-builder，nsis/portable targets；10-11 已解决"构建期"同类问题的先例：TEMP 指到私有目录后实产 `rc=0`）；
2. **中性导出**：`export-windows-artifact.mjs` 支持单文件（10-08 已演示导出 93,880,558 B 的 `SaCode Setup 0.1.0.exe`，目标标签核对通过）；
3. **双击复验**：交互式安装/卸载全流程 + 快捷方式注册。

**现状**：当前无安装器产物（历史候选已随产物清理批次移除），重打后按 1→3 复验。

## 5. 总判定与剩余工作

- 三问题**均可修复**：① 与 ③ 的根因同为"仓库根 Low 标签继承"，修复动作同为"重打包 + 中性导出 + 真实双击复验"；② 的修复动作是"用打补丁 SDK 重打平台包"。
- 共同剩余工作：
  1. **重打包**：npm 平台包（换修正 DLL）、安装器/portable（新建 + 中性导出）、`dist` 目录版（10-12 载荷旧 DLL；可直接以 10-16 候选替换）；
  2. **中出入库流程固化**：交付产物落点校验（`check_artifact_placement` 门禁之外，新增交付前标签核对）；
  3. **真实双击复验**：默认沙箱模式 + 安装/卸载全流程（agent 通道不能替代）。
- 在以上完成前，**不得对外分发**带 Low 标签或旧版 DLL 的载荷；D10/D18/D19 保持未闭合。
