# 多平台构建、Linux 桌面与 OHOS CLI 复验

更新时间：2026-10-14（2026-10-16 并入原 `build-linux.md` 的 stdx 配置与 Linux 构建读数）。本文对应本批源码和脚本，**不是 Linux/macOS/OHOS 已通过的声明**；目标与权限规则见 [平台要求](product/platform-and-distribution.md)。

## 1. 本批交付与限制

- 平台目标映射：`scripts/platform.mjs`；Windows/Linux/macOS 的 CLI、Host、daemon 共用构建入口，OHOS 单独交叉构建 core/CLI。
- POSIX C 薄层：`core/native/platform_posix.c`，静态库生成到 `.deps/native/<target>/`。持久追加核旧字节、锁同一 fd、修坏尾、写入和同步；替换用 rename 后同步目录；新文件用 link 拒绝覆盖；判活只认 ESRCH 为不存在。
- 非 Windows 中断：`std.runtime` 注册 SIGINT/SIGTERM，回调只记原子标记、普通仓颉任务消费；最后一个令牌摘除后线程退出。Linux 实际信号投递仍待验。
- Linux Shell/PTC：bubblewrap，工作区为唯一可写宿主目录，系统工具/库只读，网络隔离、临时 HOME/TMP、清环境。缺 bwrap、user namespace 被禁用或策略不成立就拒绝，**绝不降级裸跑**。这是初始文件/进程/网络隔离，不宣称已完成内存/CPU/fork 五类资源配额验收。不支持把宿主根、系统目录或整个 HOME 当工作区；工作区内部本身包含的敏感文件仍需用户治理。
- macOS：预留目标、加载路径、数据根、文件薄层与包格式；强制执行提供者仍未接入，该类任务明确不可用，不能宣称 macOS 真实任务完整支持。
- OHOS：目标配置、原生薄层和独立压缩包构建入口就位；实际 SDK/API/ABI、信号注册、独立可执行支持及设备权限未验证，初始执行隔离提供者仍不支持 OHOS。
- 桌面默认数据：Windows 保留已有目录版规则；Linux/macOS 使用 Electron 的应用 userData 根下的 sessions/user 等子目录，`SACODE_DATA_DIR` 绝对覆盖优先。无数据迁移、无系统沙箱关闭操作。

## 2. Linux：先构建再启动桌面

在普通用户会话中操作，不以 root 启动 Electron；具备桌面显示环境。Ubuntu/Debian 示例前提（软件安装需自行授权）：Node.js 22、仓颉 1.1.3、C 编译器/ar、unzip、OpenSSL 3、bubblewrap 及 Electron 所需系统库。AppImage 可能要求 FUSE；无 FUSE 时按 AppImage 官方方式提取后启动，不能用关闭 Chromium 沙箱作为通用解决方案。

### stdx 依赖路径（手动配置）

四个生产模块的 `cjpm.toml` 为 `x86_64-unknown-linux-gnu` 和 `aarch64-unknown-linux-gnu` 配置了 `path-option = ["${SACODE_STDX_LIB_DIR}"]`。`SACODE_STDX_LIB_DIR` 必须指向解压后对应架构的 **dynamic/stdx** 目录（不是下载目录、ZIP、SDK 根或上一级 dynamic 目录），确认其中有 `stdx.crypto.common.cjo` 及配套动态库；其他 stdx 包也从该目录解析，不只单独配置 crypto.common。变量需要 export，单纯 shell 局部赋值不会传给 cjpm；没有设置时不要继续构建或把缺包视作生产源代码语法问题。aarch64 使用对应架构目录，以 `cjc -v` 的 Target 为准。

独立运行（不经 `cjpm run`）时补运行库搜索路径：

```bash
export LD_LIBRARY_PATH="$SACODE_STDX_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

不要以关闭证书验证或替换加密实现的方式解决依赖问题；stdx crypto/net 的系统 OpenSSL 等依赖仍需遵循该版本官方要求。

从检出的仓库根执行：

```bash
# 已有 SDK 时加载其环境；实际路径自行替换。
source /absolute/path/to/cangjie/envsetup.sh
cjc -v

# x64 用 linux-x64，arm64 改 linux-arm64；不可搬用另一架构运行库。
export SACODE_TARGET=linux-x64
# 若已有匹配 stdx，可以显式提供；否则 setup-stdx 从官方 release 下载。
# export SACODE_STDX_LIB_DIR=/absolute/path/to/linux_x86_64_cjnative/dynamic/stdx
node scripts/setup-stdx.mjs
node scripts/verify-platform.mjs
node scripts/build-native.mjs --verify
node scripts/build-platform.mjs
node scripts/pack-cli.mjs --no-build
node scripts/verify-npm-install.mjs
```

新构建产物及绝对来源映射记录在 `target/tmp/platform-build/<target>/`；每角色独立 target，不能相互覆盖名字同为 `main` 的产物。不能用旧 `apps/host/target/.../main` 代替本批输出。

### 开发态先看真实窗口

```bash
# pack-cli 已把目标 runtime/stdx 收到平台包，复用它为桌面 Host 提供库。
node scripts/pack-host.mjs \
  npm/sacode-cli-linux-x64/bin/sacode-host \
  apps/desktop/dist/host \
  npm/sacode-cli-linux-x64/bin

cd apps/desktop
npm ci
npm run vendor
npm start
```

arm64 对应改平台包路径。HTTPS 需要可用信任锚；可在 pack-host 增加 `--ca-bundle=/absolute/path/to/trusted-ca-bundle.pem`，不能通过关闭证书校验解锁。

### 生成安装候选

```bash
# 返回仓库根；构建和依赖准备已完成。
node scripts/package-platform.mjs
```

Linux 输出 AppImage、deb、CLI 原生压缩包、npm 主包/平台包 tgz、`SHA256SUMS` 和构建元信息到 `apps/desktop/dist/releases/linux-x64/`（或 linux-arm64）。这是候选，不自动发布 npm/GitHub Release。

### 真正的验收出口

1. 默认启动看到工作台，Host 初始化正常；不传 no-sandbox、不用仓内旧宿主。
2. 选择测试项目和模型，完成一次真实任务：读文件 → 审批 → 改文件 → 验证 → 看差异 → 真实结算。密钥不放命令行、日志或回传材料。
3. Linux Shell 用 `/bin/sh`，PowerShell 仅在安装 pwsh 后可用；初始沙箱禁止网络，因此依赖下载会明确失败，不自动放开网络。工作区外写入和读取 HOME 凭据应被阻止。
4. 停止长任务时检查父/子进程、输出和终态；点击停止或发 SIGINT 不等于停止证据。bwrap 的 PID namespace/父死亡收尾须实际验证。
5. 关闭并重启，核会话/改动/审批恢复；未知副作用不自动重放。重新进入项目，核大小写不同的文件不会串观察或租约。
6. 安装候选在无仓颉 SDK 搜索路径环境启动，再复验真实任务与用户数据保留。构建、npm 安装 smoke、真实任务和设备安装分别报告。

## 3. npm 安装与正式发布

本批创建 Windows x64、Linux x64/arm64、macOS x64/arm64 平台包清单，并对齐主包/平台包版本 `0.2.0`。这不证明所有原生版本已构建，更不证明 registry 已发布。

本地 tarball 安装示例（文件名以 `npm pack` 实际输出为准）：

```bash
npm install -g ./stand-alone-sacode-linux-x64-0.2.0.tgz \
  ./stand-alone-sacode-0.2.0.tgz
sacode --help
```

主包按 OS/架构解析可选平台包，不回退 PATH 上的另一版可执行文件；CLI 和 daemon 均从同一包取 Host 和库。先发布各已验收平台包，再发布主包；未验平台保留明确缺包错误。npm 登录、凭据、正式 `npm publish` 是独立发布动作，本批不执行。

OHOS 初始使用独立 tar.gz，不将其伪装为 npm 的 GNU/Linux 平台包，也不臆称目标设备可运行 Node/npm/Git/LSP。

## 4. Linux 交叉构建 OHOS CLI

官方 [仓颉 1.1.3 下载页](https://cangjie-lang.cn/download/1.1.3) 已核有 `cangjie-sdk-linux-x64-ohos-1.1.3.tar.gz`，SHA256 和下载入口收在 `scripts/sdk-assets.json`；这是配套发行件存在的证据，不是项目交叉编译通过。

需先准备：
- Linux 主机可执行的仓颉 **1.1.3 OHOS SDK**（不是普通 GNU/Linux SDK 加一个 target）。
- 对应 OHOS native SDK 的 clang、llvm-ar、sysroot；SDK/API 与目标运行库版本要匹配，不能只选“最新版”。
- stdx **1.1.3.1 ohos-aarch64** 与目标仓颉运行库目录；不能沿用之前 Linux 的环境变量值。

确认工具链后执行以下**待验证入口**，路径均替换为实际目录：

```bash
source /absolute/path/to/cangjie-ohos/envsetup.sh
export SACODE_TARGET=ohos-arm64
export OHOS_CC=/absolute/path/to/native/llvm/bin/clang
export OHOS_AR=/absolute/path/to/native/llvm/bin/llvm-ar
export OHOS_SYSROOT=/absolute/path/to/native/sysroot
export SACODE_RUNTIME_LIB_DIR=/absolute/path/to/ohos/runtime/lib
unset SACODE_STDX_LIB_DIR
node scripts/setup-stdx.mjs
node scripts/build-platform.mjs
node scripts/package-platform.mjs
```

`build-platform` 将 sysroot 写入私有源码副本清单，只构建 core/CLI，使用 `aarch64-linux-ohos`，不修改用户 cjpm 配置。产物位置通过本轮目录搜索验证唯一，再生成候选。若 SDK 不支持独立 exe、缺目标库或 API，**保留编译失败与解锁条件，不把动态库/帮助输出包装成完整 CLI 支持**。

输出 `apps/desktop/dist/releases/ohos-arm64/` 的原生 CLI tar.gz、校验和及 `deviceRunVerified:false`。在 Linux 主机直接执行它不是 OHOS 运行验证；必须后续目标设备按权限规则运行。鸿蒙 ArkTS/ArkUI 前端仍是后续独立项目。

## 5. GitHub Actions

- `.github/workflows/build.yml`：Windows x64、Linux x64、macOS arm64 的自动构建候选，固定 SDK 1.1.3 官方 URL/SHA256，下载匹配 stdx，构建、打包、npm 安装验证，再上传产物和日志。macOS 签名/公证未配置，产物只能作未签名候选；不假报设备任务已验。
- `.github/workflows/ohos-cli.yml`：手动触发，Linux self-hosted runner 标签 `ohos-sdk`，需预装配套仓颉 OHOS/native SDK 和上面的环境。无 runner 时排队不是构建通过；不自动安装未经核定版本的 OHOS SDK。
- Windows/Linux/macOS 的 SDK 可用仓库变量 `CANGJIE_<PLATFORM>_URL` / `_SHA256` 成对覆盖；未覆盖使用 `sdk-assets.json` 的已核官方入口。下载校验失败直接停止，不关闭 TLS 验证。
- 实际 Git 远端当前仍是 Gitee。只有仓库同步到 GitHub 后 workflow 才能运行；本批不擅自新建仓库或修改远端，也不提供真实 Actions 运行 PASS。

## 6. 本机验证与遗留

本机是 Windows。已实际完成工作区四模块生产构建、平台路径/清单检查、vendor 构建、Windows 平台包生成，以及本地 tgz 私有安装后的无 SDK CLI `--help` 与包内 Host 初始化。未运行旧测试/CLI 断言式自测，未调用收费模型、迁移用户数据或正式发布。

准备提交的候选也单独复验：剥离未完成 slash 命令骨架、昵称功能与旧测试后，Windows core/CLI/Host/daemon 各自 exit=0，npm 私有安装入口检查通过，vendor 构建与 Windows 目录候选打包 exit=0；目录载荷 36 条相对 require 依赖及 Host/动态库齐备。仅目录打包，不记 NSIS 安装或真实 GUI PASS。候选及日志位于 `apps/desktop/.tmp-test/takeover-20261011/platform-candidate-20261014/`，这避免用整个工作区绿色冒充提交候选证据。

Linux 分支曾在私有副本以 Windows 编译器及文档信号签名替身作语法核查，已修正变量定义顺序和消费线程返回类型；该实验**不是 Linux 编译/链接/信号投递/原生持久验证**。C 薄层、Linux 桌面、macOS 与 OHOS 的真实读数由目标环境按上述步骤补齐。

历史固定 `2c56c76` 的旧四模块门禁曾超时并遗留本会话 cjc；已只结束命令行匹配私有副本的那个进程。新构建入口和验收门禁改为限时清理自有进程树/组，缺项与跳过不得返回假绿。

### Linux 后续实测与运行库收集修正（2026-10-14）

用户反馈 `setup-stdx`、`verify-platform`、`build-native` 均 PASS，`build-platform` 四模块成功；`pack-cli --no-build` 因名字为 `libpcre2-8.so` 的目录被按文件复制，报 `ERR_FS_EISDIR`。本次消息未附具体提交 SHA，不自行补写基线，也不升级为桌面或真实任务验收通过。

CLI 与 Host 现共用 `scripts/runtime-libraries.mjs`：递归检查真实子目录，只复制符合动态库名称的普通文件或指向文件的软链接，展开到包内 `bin/`；文件软链接解引用后保留原别名，不遍历目录软链接，不把 README 或整个 `.so` 同名目录当载荷。CLI 继续排除 unittest 等编译/测试专用库。

本机新增夹具覆盖上述目录结构、版本库名、文件软链接、排除项，以及模拟 Linux Host 打包；`node scripts/verify-platform.mjs` 为 68 项通过。这是 Windows 上的打包逻辑验证，不替代 Linux 动态加载与运行。更新源码后可直接重跑 `pack-cli --no-build`（保留已成功的本轮构建记录），再继续 npm 安装与桌面步骤。

### 已登记的 Linux 构建读数（并入自原 `build-linux.md`，2026-10-16）

用户在 Linux 设置上述 stdx 变量后验证，两次结果对照：

| 提交 | core | cli | daemon | host |
| --- | --- | --- | --- | --- |
| `f0e7cb6` | 静态库通过（31 warnings） | 链接失败，缺 Windows API | `scheduler.cj:51` 语法失败 | 两次编译超时，未进入链接 |
| `7b42013` | 通过 | 通过，产出 14 MB 二进制，`main --help` 正常 | 同上，仍失败 | 未编译，桌面端仍 Windows-only |
| `2c56c76` | 通过 | 通过，产出约 14 MB 二进制 | 通过，旧 scheduler 文件已删除 | 未编译；Linux 桌面仍待适配与验证 |

平台声明隔离修正（`e2e8bf7`）解除了 CLI 的链接失败；daemon 的失败经快照编译取证为**腐化的死代码**（零调用方、引用不存在的 `HostBridge`、使用 1.1.3 已移除的枚举 `ordinal`），处置为移除该实现与其空骨架测试，而不是凭空补全一个没有调用方的功能。**在上述实测基线上不能把项目描述为 Linux 可完成真实任务**：当时非 Windows 信号、残留租约判活、持久追加与原子替换后端未实现；2026-10-14 批次新增 POSIX 薄层、信号消费、Linux 隔离及桌面/npm 构建入口，但尚待 Linux 复验。旧取证见 [Linux 后端交接](evidence/2026-10-13-linux-executable-build-followup.md)。

以上为用户提供的 Linux 实测，不是本机 Windows 交叉验证；日志未随消息提供，不自行补推。macOS 复用共享契约但按自身 ABI/加载器/权限适配，运行暂待设备；OHOS 是独立交叉目标，**本文 Linux GNU 命令不能作为鸿蒙 CLI 构建命令**，待验证入口见 §4。
