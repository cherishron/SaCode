# Linux 构建与 stdx 路径

> Linux CLI、daemon 与 Electron 桌面都是正式支持目标，不是只支持 Windows。本文是依赖与已知构建读数；产品矩阵及后续 macOS/OHOS 路线见 [平台支持与分发要求](product/platform-and-distribution.md)。

本项目使用仓颉 SDK **1.1.3** 和匹配的扩展标准库 **stdx 1.1.3.1**。stdx 是平台相关的二进制依赖，不能把 Windows 的 DLL/cjo 目录用在 Linux。

## 配置

四个生产模块的 `cjpm.toml` 为 `x86_64-unknown-linux-gnu` 和 `aarch64-unknown-linux-gnu` 配置了：

```toml
path-option = ["${SACODE_STDX_LIB_DIR}"]
```

`SACODE_STDX_LIB_DIR` 必须指向解压后对应 Linux 架构的 **dynamic/stdx** 目录，而不是下载目录、ZIP、SDK 根或上一级 dynamic 目录。确认该目录里有 `stdx.crypto.common.cjo` 及配套动态库；其他 stdx 包一起从这个目录解析，不只单独配置 crypto.common。

在已加载仓颉 SDK 环境的 Linux shell 中配置，例如：

```bash
# 把占位路径改成实际安装目录；路径应为绝对路径。
export SACODE_STDX_LIB_DIR="/absolute/path/to/linux_x86_64_cjnative/dynamic/stdx"
test -f "$SACODE_STDX_LIB_DIR/stdx.crypto.common.cjo"
cjc -v
cjpm build
```

若 SDK 不在 PATH，请先按 SDK 官方方式加载 `envsetup.sh`。aarch64 使用对应架构的 stdx 目录，以 `cjc -v` 的 Target 为准。变量需要 export，单纯 shell 局部赋值不会传给 cjpm；没有设置时不要继续构建或把缺包视作生产源代码语法问题。

## 独立运行产物

`cjpm run` 与直接运行产物是不同的动态库加载环境。直接启动 Linux 产物时，按所用 SDK 的运行库要求，补充 stdx 动态库搜索路径：

```bash
export LD_LIBRARY_PATH="$SACODE_STDX_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

不要以关闭证书验证或替换加密实现的方式解决依赖问题；stdx crypto/net 的系统 OpenSSL 等依赖仍需遵循该版本官方要求。

## 验证范围

2026-10-13：官方 CJPM 文档确认 `target.*.bin-dependencies.path-option` 支持环境变量插值，本机 Windows 仓颉 **1.1.3** 的独立生产编译已确认该变量被解析、可找到 `stdx.crypto.common` 并完成链接。

本轮环境是 Windows；添加 Linux 目标配置不等于 Linux 四模块已编译通过。Linux 构建仍需对应 SDK、stdx、系统链接依赖，并可能暴露仓库其他平台代码问题。Windows 原有路径保持不变，没有要求当前 Windows 构建新增环境变量。

## 已收到的 Linux 构建结果

用户在 Linux 设置上述变量验证，两次结果对照：

| 提交 | core | cli | daemon | host |
| --- | --- | --- | --- | --- |
| `f0e7cb6` | 静态库通过（31 warnings） | 链接失败，缺 Windows API | `scheduler.cj:51` 语法失败 | 两次编译超时，未进入链接 |
| `7b42013` | 通过 | 通过，产出 14MB 二进制，`main --help` 正常 | 同上，仍失败 | 未编译，桌面端仍 Windows-only |
| `2c56c76` | 通过 | 通过，产出约 14MB 二进制 | 通过，旧 scheduler 文件已删除 | 未编译；Linux 桌面仍待适配与验证 |

平台声明隔离修正（`e2e8bf7`）解除了 CLI 的链接失败。daemon 的失败经快照编译取证为**腐化的死代码**（零调用方、引用不存在的 `HostBridge`、使用 1.1.3 已移除的枚举 `ordinal`），处置为移除该实现与其空骨架测试，而不是凭空补全一个没有调用方的功能。

**在上述实测基线上不能把项目描述为 Linux 可完成真实任务**：当时非 Windows 信号、残留租约判活、持久追加与原子替换后端未实现。2026-10-14 本批新增 POSIX 薄层、信号消费、Linux 隔离及桌面/npm 构建入口，但尚待你的 Linux 复验，不能用源码落地覆盖旧限制记录或宣称运行通过。最新步骤见 [多平台构建与复验](build-platforms.md)，旧取证见 [Linux 后端交接](evidence/2026-10-13-linux-executable-build-followup.md)。

以上为用户提供的 Linux 实测，不是本机 Windows 交叉验证。Linux 架构、命令全量日志及 daemon 服务运行结果未随本次消息提供，不自行补推。

## Linux 桌面下一步与验收出口

1. 固定源码的 Host 在 Linux 编译、启动并走真实协议；不能因尚无 Linux 桌面包长期排除 Host。
2. 实现目标平台的持久文件、进程判活/监督、系统中断、核心授权与隔离后端；不可用时仍明确拒绝，不为“可用”静默降低安全要求。
3. 适配可执行文件名、运行库加载、TLS、可写数据根、宿主及扩展子进程；Linux 不加载 Windows exe/DLL。
4. 再构建 Electron Linux 包，从默认启动验证真实任务、审批/取消/结算、重启恢复和安装数据保留。明确显示系统依赖和前提，不使用旧 Windows 产物凑通过。
5. 从同一固定提交输出 Linux CLI/服务/桌面候选和校验和；npm 平台包与 GitHub 构建分别实现并验收。

macOS 复用共享契约但按自身 ABI/加载器/权限适配，运行暂待设备。OHOS 是独立交叉目标：需要配套的 native SDK、仓颉 OHOS 编译器/运行库与 ohos stdx。**本文 Linux GNU 命令不能作为鸿蒙 CLI 构建命令**；已核官方有 Linux 主机 OHOS SDK 1.1.3，待验证入口及显式前提见 [构建指南 §4](build-platforms.md)。
