# Linux 构建与 stdx 路径

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

## 已收到的 Linux 构建结果（f0e7cb6）

用户已在 Linux 设置上述变量验证：core 静态库通过（31 warnings），CLI 因 Windows API 链接失败，host 两次编译超时（未进入链接），daemon 因 `scheduler.cj:51` 的 `TaskDefinition?` 语法失败。

这说明 stdx 路径只是第一层；**目前不能把项目描述为 Linux 可执行程序已可构建或可用**。平台声明隔离修正和具体限制见 [Linux 后端构建交接](evidence/2026-10-13-linux-executable-build-followup.md)。非 Windows 信号、租约判死和持久文件后端仍需明确实现，不能以静默降级绕过这些约束。
