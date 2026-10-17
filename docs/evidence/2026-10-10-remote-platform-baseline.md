# 远程接入平台基线证据（2026-10-10）

## 1. Windows→Linux 交叉编译探针

| 项 | 结果 |
| --- | --- |
| 探针命令 | `cjc apps/desktop/.tmp-test/windows-linux-cross-probe-20261010.cj --target=x86_64-unknown-linux-gnu` |
| 退出码 | 1 |
| 报错原文 | `error: failed to detect cangjie modules, reason: target library path is not exist : D:\Program Files\HuaWei\Cangjie\modules\linux_x86_64_cjnative` |
| 结论 | Windows SDK 不含 Linux 模块；本机 cjc 无法交叉编译到 Linux 目标 |

## 2. 官方交叉编译矩阵

来源：`https://cj-docs.gitcode.com/zh/1.1.3/dev-guide/source_zh_cn/compile_and_build/cross_compilation.html`

| 宿主 | 目标 | 是否列出 |
| --- | --- | --- |
| Windows x64 | Android aarch64 | 是 |
| Linux x64 | Android aarch64 | 是 |
| macOS | Android aarch64 | 是 |
| macOS aarch64 | iOS aarch64 | 是 |
| macOS | iOS Simulator | 是 |
| **Windows → Linux** | **否** | **未列出** |

结论：官方交叉编译矩阵不含 Windows→Linux 组合。Windows SDK 可交叉编译到 Android/ohos，但不能到 Linux。

## 3. 本机 Linux 构建环境

| 工具 | 状态 |
| --- | --- |
| WSL | `wsl.exe` 存在于 `/c/WINDOWS/System32/wsl.exe`，但 `wsl --list` 返回 `REGDB_E_CLASSNOTREG`——已安装 WSL 框架但**没有注册任何 Linux 发行版** |
| Docker | `command -v docker` 无输出，**未安装** |
| 远程 Linux 主机 | 本轮未取得授权访问；不编造 |

## 4. Linux 原生构建路线判定

| 路线 | 可行性 | 当前阻塞 |
| --- | --- | --- |
| Windows SDK 交叉编译 | **不可行** | Windows SDK 不含 Linux 模块；官方矩阵不含此组合 |
| WSL2 + Linux 仓颉 SDK | **技术可行** | 需安装 WSL2 Linux 发行版（用户操作，不在本次授权范围） |
| 独立 Linux 主机 + Linux 仓颉 SDK | **技术可行** | 需取得 Linux 主机访问授权 |
| Docker + Linux 容器 | **技术可行** | 需安装 Docker Desktop（系统依赖安装，不在本次授权范围） |

**当前判定：BLOCKED。** Linux 原生构建需要 WSL2 发行版、远程 Linux 主机或 Docker 三者之一。安装系统依赖不在本次授权范围内，不代用户安装。

## 5. Kuikly 移动工程定位

本仓 `D:/Project/sa/saai/sa-code` 内未找到 `AgentLink.kt`。`Grep` 全仓搜索 `AgentLink|validatedBase` 零命中。用户在对话中提到过 `AgentLink.kt` 和 `validatedBase()`，但这些文件不在本仓；其路径、现状和协议错位结论是用户提供的外部证据，本轮未直读原文件。

**待办：** 需用户提供 AgentLink 所在工程的准确路径，或确认在本仓新建 `apps/mobile/`。

## 6. 仓颉 Linux SDK 可用性

官方下载页 `https://cangjie-lang.cn/download/1.1.3` 列出：
- `cangjie-sdk-linux-x64-1.1.3.tar.gz`（403.3 MB）
- `cangjie-sdk-linux-aarch64-1.1.3.tar.gz`（395.7 MB）

结论：Linux 仓颉 SDK 有官方来源。一旦取得 Linux 构建环境（WSL2/远程主机/Docker），可下载并使用。

## 7. 下一步可推进项

Linux 构建环境缺失不阻塞以下工作：
- 任务 1：协议定档、方法表与契约检查（纯文档 + Node 脚本）
- 任务 6：daemon 认证与接入扩展的 Cangjie 代码（在 Windows 工具链上编译验证）
- 任务 7：显式会话归属与授权分派（在 Windows 工具链上编译验证）
- 任务 8：幂等与 SSE 恢复（在 Windows 工具链上编译验证）
- 任务 9：桌面多目标入口（Node/Electron，在 Windows 上开发和测试）

Linux 移植（任务 3-5）和移动端实机构建（任务 10）在取得 Linux 环境前保持 BLOCKED。
