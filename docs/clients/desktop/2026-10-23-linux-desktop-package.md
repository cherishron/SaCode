# 2026-10-23 Linux Electron 桌面打包与打包态验收

## 结论

在远端 Ubuntu（SSH Host `web`，134.175.155.35，内核 6.8.0-138-generic，Node v22.23.2）上，用与当前工作区同源的源码打出了 Linux 桌面包，并在产物上完成协议冒烟：

| 项 | 结果 | 读数 |
| --- | --- | --- |
| AppImage | PASS | `SaCode-0.1.0-linux-x86_64.AppImage`，133,944,198 字节，sha256 `0c5d5d0ba0177e78260ebf7c59e537645203d1cd66ed6f802951ac62787f6813`；协议冒烟 `SMOKE PASS` rc=0 |
| deb | PASS（仅载荷运行） | `SaCode-0.1.0-linux-amd64.deb`，102,549,392 字节，sha256 `835152ba2b60fcb265398d304a929161606099d829ad16a9c4b9667f57669e05`；`dpkg-deb -x` 解包后运行 `SMOKE PASS` rc=0 |
| 随包仓颉宿主 | PASS | `resources/host/bin` 94 个文件；`sacode-host` 18,942,952 字节，sha256 `0924c0a689e05bcc822e5babea28b479fe05f76765bf67c03c31a798c9c3c349`；剥净 PATH 直跑输出 `host/settled` rc=0 |
| UI 冒烟 | FAIL（17 项，非打包回归） | dev 态 / unpacked 包 / AppImage 三份均为 **282 UI OK / 17 UI FAIL**，失败行逐字节相同（`diff` 空） |
| AppImage 原生 FUSE 启动 | BLOCKED | 宿主缺 `libfuse.so.2`（`dlopen(): error loading libfuse.so.2`），解包运行模式已通过 |
| deb 安装态 | 未验证 | 未获安装授权，只做 `dpkg-deb -x` 载荷运行 |

关键结论：**打包本身没有引入 UI 回归**——同一份 UI 冒烟在 dev 态与两个打包产物上失败集完全一致；17 项不符是 HEAD 级别的测试/渲染差异（其中 preload 清单滞后项由 UI 冒烟自身的设计负责报出，IPC parity 门禁另测 198/198 PASS）。

## 候选身份与同源核对

- 本地工作区：分支 `dev`，HEAD `83837c1ef2380d969d7c534f1dd0d733d54b8d80`，带未提交改动（含 2026-10-22 沙箱解析修复与本次 `apps/desktop/package.json` 打包元数据）。
- 远端 `~/sa-code-linux` 为工作区同源副本；关键文件本地/远端 sha256 逐字节一致：
  - `core/src/windows_process_adapter.cj` `b18eeae3…72ee60`
  - `core/src/ptc_exec.cj` `5ef5a445…ca3e8`
  - `apps/desktop/package.json` `1bf3fd9b…aedaf`
  - `apps/desktop/main.cjs` `7d769f6e…541d1`
- core 与三入口（cli/host/daemon）构建 4/4 `cjpm build success` 见 [2026-10-22 Linux 构建钩子与 daemon 单宿主修复](../../evidence/2026-10-22-linux-build-hook-and-single-host-daemon.md)；本次打包用的 `apps/host/target/release/bin/main` 即该次构建产物。

## 打包链路与三处修正

固定链路：`npm run vendor` → `scripts/pack-host.mjs` → `electron-builder --linux --config.electronDist=node_modules/electron/dist --publish never`。

1. **vendor**：`VENDOR_RC=0`；vue runtime 就位，tinyvue 308,823 字节，tinyrobot js 3,917,779 + css 149,498 字节，next-sdk 315,588 字节，15 个 TypeScript 页面编译完成。
2. **pack-host**：以 Linux 宿主编译产物 + `.deps/stdx/linux-x64/.../dynamic/stdx` + `$HOME/cangjie-1.1.3/cangjie/runtime/lib/linux_x86_64_cjnative` 为输入，非 win32 分支只复制 `.so` 并 `chmod 0o755`；共 94 个文件。
3. **electron-builder 首次失败**：`executableName contains characters that cannot be safely used in file paths: @stand-alonesacode-desktop`。根因是包名 `@stand-alone/sacode-desktop` 被 Linux 目标直接当作可执行名。修正：`build.linux.executableName = "sacode"`（Windows 目标未动）。
4. **deb 元数据失败**：`Please specify project homepage` + `Please specify author 'email' … required to set Linux .deb package maintainer`。修正：新增 `homepage`（仓库地址 `https://gitee.com/cherishron/SaCode`）与 `build.linux.maintainer = "SaCode Team"`（不引入个人邮箱）。
5. **deb 的 fpm 工具下载超时**：该 VM 到 GitHub release 约 18 KB/s，`got` 超时。处置：用 `curl -C -` 续传同一官方归档（9,762,595 字节），校验 sha256 = `44b0ec60…989f` 与 `app-builder-lib/out/toolsets/linux.js` 内登记值一致后，种入 `@electron/get` 缓存目录（URL 去文件名后 sha256 命名的 `downloads/b97a7b0f…32cce2/`）；重跑即 `using cached artifact`，deb 生成成功。未使用第三方镜像。

## 打包态验收

- **协议冒烟**（`--smoke --no-sandbox`，`xvfb-run -a`）：
  - unpacked：`SMOKE PASS` rc=0；`initialize` 返回 `core:"cangjie"` 与完整方法面；
  - AppImage（`APPIMAGE_EXTRACT_AND_RUN=1`）：`SMOKE PASS` rc=0；
  - deb 载荷（`dpkg-deb -x` 到 `/tmp` 后运行，随即删除）：`SMOKE PASS` rc=0。
  - 三次运行后 `pgrep -x sacode-host` 均为 0，无孤儿宿主。
- **宿主动态库**：对随包 `sacode-host` 执行 `LD_LIBRARY_PATH=<同目录> ldd`，`not found` 计数为 0；剥净 PATH（`env -i PATH=/usr/bin:/bin HOME=$HOME LD_LIBRARY_PATH=<bin>`）直跑输出 `host/settled` 且 rc=0。
- **UI 冒烟**：源码内夹具路径有显式覆盖口 `SACODE_SSE_FIXTURE`（代码注释即写明打包态由驱动指向仓库真实夹具）。带该变量后三份运行读数一致：

```
dev        : 282 OK / 17 FAIL
unpacked   : 282 OK / 17 FAIL
AppImage   : 282 OK / 17 FAIL
diff(dev, unpacked)  = 空
diff(dev, AppImage)  = 空
```

  首次不带 `SACODE_SSE_FIXTURE` 的 unpacked 运行得到 239 OK / 16 FAIL，随后在提示词增强夹具处报 `Cannot find module <asar>/scripts/sse-contract-server.cjs` 退出——这是夹具定位方式，不是产品缺陷；按代码约定补上覆盖变量后跑满 282/17。

- **17 项不符的性质**：
  - `preload 未登记的额外键=…` 一项是 UI 冒烟自维护清单滞后。`node scripts/check_ipc_surface_parity.cjs` 实测 `GATE: PASS (8 checks, fail=0)`，`surface-set-parity: preload 198 个方法 ↔ main 198 个通道，双向差集为空`——通道本身两侧一致。
  - 其余 16 项为渲染/交互断言（气泡角色分组、窄窗重排高度、流式正文共享样式、取消回显、菜单焦点等），在 dev 态与打包态同样不符，属 HEAD 现状。

## 未覆盖与边界

- AppImage 原生 FUSE 挂载未验证：该 VM 缺 `libfuse.so.2`；`APPIMAGE_EXTRACT_AND_RUN=1` 路径已通过。真实桌面需安装 FUSE2 运行时。
- deb 未安装（`dpkg -i` 未获授权）；仅验证载荷可运行。安装脚本、注册与卸载未验。
- 17 项 UI 不符未在本批修复（非打包范围）；已按 HEAD 现状记录。
- electron-builder 的 `desktopName is not set` 为**非阻断警告**（窗口与桌面项关联），未处理。
- 未签名（Linux 目标无签名配置）、未提交、未推送、未发布。

## 产物与日志

- 远端产物：`~/sa-code-linux/apps/desktop/dist/electron/{SaCode-0.1.0-linux-x86_64.AppImage,SaCode-0.1.0-linux-amd64.deb}`；`dist/host/bin`（94 文件）随包打入 `resources/host/bin`。
- 日志副本：`target/tmp/linux-desktop-20261023/`（`linux-smoke-*.log`、`linux-uismoke-*.log`、`electron-builder-{linux,deb,deb2}.log`），随 `target/` 忽略。

## 复现命令（远端）

```bash
cd ~/sa-code-linux/apps/desktop
npm run vendor
cd ~/sa-code-linux
node scripts/pack-host.mjs apps/host/target/release/bin/main apps/desktop/dist/host \
  .deps/stdx/linux-x64/linux_x86_64_cjnative/dynamic/stdx \
  "$HOME/cangjie-1.1.3/cangjie/runtime/lib/linux_x86_64_cjnative"
cd apps/desktop
npx electron-builder --linux --config.electronDist=node_modules/electron/dist --publish never
```

```bash
cd ~/sa-code-linux/apps/desktop
SACODE_SSE_FIXTURE=$HOME/sa-code-linux/scripts/sse-contract-server.cjs \
  timeout 300 xvfb-run -a ./dist/electron/linux-unpacked/sacode --ui-smoke --no-sandbox
APPIMAGE_EXTRACT_AND_RUN=1 timeout 240 xvfb-run -a \
  ./dist/electron/SaCode-0.1.0-linux-x86_64.AppImage --smoke --no-sandbox
```

（`--no-sandbox` 仅用于无桌面会话的自动化冒烟；不代表产品默认关闭沙箱。）
