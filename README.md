# DSH — DeepSeek Harness 全系统复刻

一份**仓颉（Cangjie）共享核心**驱动两个入口：命令行（CLI）与 Electron 桌面应用。二者使用同一个 `core`、同一份 `session.log`，行为语义一致。

> 复刻口径、18 条架构不变量与上游能力矩阵见 `docs/plans/`；已实测状态与待解锁项见 `docs/evidence/`。

## 这是什么

上游 DeepSeek Harness 是「Cordis 框架层 + 内核层 + 约 60 个能力子系统 + 交付层」的四层结构，核心主张是**会话日志是唯一真相源，模型可见历史与 UI 都是日志的投影**。本项目分批复刻其架构约束与格式兼容，当前已落地一条可运行的 P0 主干：

- 会话日志（append/flush 持久化屏障、损坏尾帧截断、崩溃恢复合成、写租约与残留接管）
- 投影（派生消息，纯函数、引用门控：无关事件不重建，命中缓存返回同一引用）
- 审批工单（`ask → answer → 一次性消费`，`asked/decided/expired` 落进同一份日志；协议面上不认调用方自报的审批字符串）
- 取消与背压（`TurnToken` 协作式取消、有界投递队列）
- JS 扩展宿主子进程驱动（NDJSON JSON-RPC，按 `callId` 配对与取消）
- 双入口（仓颉 CLI 与 Electron 桌面）与 npm 平台包
- 桌面渲染层（Vue 3 runtime + IPC 有限面，流式/审批/取消有真机断言）

尚未接入：TinyVue / TinyRobot 组件库、Next SDK、真模型 HTTPS+SSE 烟测、安装包签名与发布。Ctrl+C/SIGINT 的协作式取消已在核心（CFFI 处理器 `core/src/sigwin.cj`）与 CLI（`dsh sig`）落地，缺的是本环境无法把中断真正投递给子进程——需要一次人工在交互控制台按 Ctrl+C 的实测。逐项解锁条件见 `docs/evidence/p0-status-2026-10-02.md`。

## 架构

```
                 +---------------------+
   CLI 入口 ----> |                     |
  npm 平台包      |   core (仓颉静态库)  | <---- apps/host (JSON-RPC 宿主) <---- Electron 桌面
                 |  会话日志唯一真源    |
                 +----------+----------+
                            | 子进程驱动
                            v
                    extjs/ (Node JS 扩展宿主, NDJSON JSON-RPC)
```

| 目录 | 职责 |
| --- | --- |
| `core/` | 仓颉静态库，唯一业务真源：会话日志、投影、取消/背压、扩展进程驱动 |
| `apps/cli/` | 仓颉可执行入口，同时是可断言自测的 CLI，也是 npm CLI 的二进制来源 |
| `apps/host/` | 仓颉 NDJSON / JSON-RPC 宿主，由桌面端 spawn；stdout 只走协议帧 |
| `apps/desktop/` | Electron 壳 + 渲染层（纯 JS + Vue runtime，无打包器、无 TypeScript） |
| `extjs/` | 独立 Node JS 扩展宿主（NDJSON JSON-RPC），被 core 以子进程驱动 |
| `npm/dsh-cli`、`npm/dsh-cli-win32-x64` | npm 平台包；`bin/` 下二进制由脚本生成，不入库 |
| `scripts/pack-*.mjs` | 打包脚本（CLI / 宿主 / Vue vendor） |
| `docs/` | `plans/`（方案与能力矩阵）、`evidence/`（实测证据与阻塞项） |

## 环境要求

- **仓颉工具链**：`cjc` / `cjpm` **1.1.3**，target `x86_64-w64-mingw32`
- **Node.js** ≥ 18（本地使用 v22）
- **Windows x64**（当前仅支持 Win32 平台，依赖仓颉运行时 DLL 与 Windows DLL 搜索序）
- 无 CI、无根 `package.json`；npm 相关命令都在 `apps/desktop` 或 `npm/*` 下执行

> 注意：`apps/host/cjpm.toml` 中 stdx 动态库路径为**本机硬编码**（`C:/Users/jingg/stdx-work/...`），换机器必须修改。

## 快速开始

### 1. 核心（仓颉）

```bash
cd core
cjpm test          # 运行全部 *_test.cj 单测
```

### 2. CLI（仓颉）

```bash
cd apps/cli
cjpm build
./target/release/bin/main.exe all     # 断言式自测，子命令见下
```

子命令：`seed | projection | all | stream | tool | ext | cancel | extjs | sig`（`sig` 为中断协作式取消自测）。

### 3. 打包自包含宿主（桌面运行的前置）

宿主 exe 必须与全部依赖 DLL 同目录（依赖 Windows 默认搜索序，不拼 PATH）：

```bash
node scripts/pack-host.mjs \
  apps/host/target/release/bin/main.exe \
  apps/desktop/dist/host \
  <stdx-dll-dir> <runtime-dll-dir>
```

dev 态宿主路径固定为 `apps/desktop/dist/host/bin/dsh-host.exe`。

### 4. 桌面（Electron）

```bash
cd apps/desktop
npm install
npm start            # prestart 会自动执行 npm run vendor
```

冒烟测试：

```bash
npm run smoke        # 期望输出 SMOKE PASS
npm run ui-smoke     # 渲染层真窗口断言
```

### 5. JS 扩展宿主

```bash
cd extjs
node --test
```

## 测试

| 范围 | 命令 |
| --- | --- |
| 仓颉核心 | `cd core && cjpm test` |
| 桌面通信层与路径 | `cd apps/desktop && npm test`（即 `node --test` 自动发现） |
| 单个桌面用例 | `node --test --test-name-pattern="<name>"` |
| JS 扩展宿主 | `cd extjs && node --test` |

> 桌面单测**不要**写成 `node --test test/`——本机 Node 会把目录当模块解析，导致整串失败。
> `bridge.test.mjs` 会在仓库根创建 `dualtest/`（已 gitignore）；异常残留时先 `rm -rf dualtest` 再跑。

## 打包

```bash
# npm CLI 平台包：读取 CANGJIE_HOME（默认 D:\Program Files\HuaWei\Cangjie）
node scripts/pack-cli.mjs
node npm/dsh-cli/bin/cli.js all        # 本地按平台包启动

# Electron 安装包（产物在 apps/desktop/dist/electron/）
cd apps/desktop && npx electron-builder
```

## 复刻硬约束（改代码前必读）

- **会话日志是唯一真源**：消息与 UI 都是投影。`append` 只在实例内可见，`flush` 才跨进程持久。
- 桌面渲染层受 CSP `script-src 'self'` 约束（禁 `unsafe-eval`）：只能用 Vue **runtime** 构建 + `h()` 写视图，不能引入模板编译器、打包器或 ES module（`file://` 下会被 CORS 拦）。
- Electron IPC 面是按动作命名、逐字段校验的**有限集合**，不提供「发任意方法」通道；增删通道要同步改 `preload.cjs` 与 `test/bridge.test.mjs`。
- 打包态宿主路径只能从 `process.resourcesPath` 解析，缺失时必须 fail-loud，绝不回退 asar 内路径。
- 注释、文档、commit 一律使用中文；commit 形如 `feat(core,host): 描述`。

构建产物不入库：`target/`、`apps/desktop/dist/`、`npm/*/bin/`、`*.log` 均已在 `.gitignore` 中。

## 许可

本项目采用**木兰宽松许可证，第2版（MulanPSL-2.0）**，SPDX 标识符 `MulanPSL-2.0`，详见 `LICENSE`。