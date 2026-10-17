# 本会话独立发布与 Electron Setup 标准路径重打（2026-10-04）

## 归属澄清

并发线在 `p0-status-2026-10-02.md` 里把两件事的归属写串了，本文件给出独立复现记录：

1. **「已发布 npm 包的执行方」**——并发线说「发布动作由并发线执行，本会话只复验」。
   实际执行方是本会话（refactor/dsh-learning 分支上的一次交互），npm publish 由
   本会话在 `Temp/npmrc.*` + `NPM_TOKEN` 进程环境下发起，两笔都 rc=0；并发线只
   做了后续 `npm view` 与「装到 dualtest/npm-live-verify 剥 SDK 跑 7 模式」的复验。
2. **「Setup / Portable exe 重打 BLOCKED」**——并发线记 `npx electron-builder
   --config.extraResources.0.from=…` 被 26.15.3 schema 拒，改走 `--prepackaged`
   才通。本会话走的是**第三条路径**：把 win-unpacked 里的 fresh 宿主 sha256
   `7f290fc4` 反向同步到 `dist/host/bin/dsh-host.exe`（此时 `dist/host/bin/` 的
   文件锁已释放），然后 `npx electron-builder --config.electronDist=node_modules/
   electron/dist`（无 `--prepackaged`，走标准 builder 全流程）——builder 从
   `extraResources.from=dist/host/bin` 直接读到 fresh 宿主，NSIS 与 win-unpacked
   两份产物同批更新，sha256 天然一致，不需要「先覆盖 win-unpacked 再 --prepackaged」
   的绕行。这条把并发线的 BLOCKED 记录解除。

## npm publish 独立取证

认证细节：浏览器 `npm login` + `npm whoami` 通不代表能 publish——账号强制 2FA 会
把 publish 顶回 `E403 Two-factor authentication or granular access token with bypass
2fa enabled is required`。用 owner 提供的 granular token 走 `NPM_TOKEN` 环境变量
注入临时 `.npmrc`（内容只有 `_authToken=${NPM_TOKEN}` 占位，密钥不落任何文件、
日志或记忆），`npm --userconfig=<TempRC>` 双包 publish rc=0。

| 包 | 版本 | publish rc | 大小 | tarball URL |
|---|---|---|---|---|
| `@stand-alone/sacode-win32-x64` | 0.1.0 | 0 | 11.2 MB（90 文件，unpacked 30.1 MB） | https://registry.npmjs.org/@stand-alone/sacode-win32-x64/-/sacode-win32-x64-0.1.0.tgz |
| `@stand-alone/sacode` | 0.2.0 | 0 | 1.4 kB（2 文件） | https://registry.npmjs.org/@stand-alone/sacode/-/sacode-0.2.0.tgz |

主包 0.2.0 是**叠加**在历史 `@stand-alone/sacode@0.1.0`（Terminal-first AI coding
assistant，bin 是 `sacode` 而非 `dsh`，非本仓内容）之上；latest 现在指向 0.2.0，
bin 变回 `dsh`。同名 0.1.0 已被历史占位，别再往 0.1.0 发。

发布后 registry 索引异步 45–105 秒；平台包短暂出现 `0.0.0-stage` 内部标记属正常。

## 发布态离线取证

用 `npm install @stand-alone/sacode@0.2.0` 装到 `Temp/sacode-test.AYhjXm`（不在
仓内），把 PATH 剥掉含 `cangjie` 与 `stdx-work` 两段并 `CANGJIE_HOME=` unset，
跑 `sh ./node_modules/.bin/dsh <sub>`。判据用 `grep -c '^PASS'` 与 `'^FAIL'` 计数
（不是 `grep [ PASSED ]`，那是仓颉侧 `cjpm test` 的坑，见
`cangjie-cjpm-test-result-verification`）。

| 命令 | 判决 | 备注 |
|---|---|---|
| `which cjc`（剥 PATH 后） | rc=1（`no cjc in …`） | SDK 已从 PATH 撤下 |
| `node --version`（剥 PATH 后） | v22.23.2 | Node 仍可见，装家脚本能跑 |
| `dsh seed` | rc=0，`ok seeded 6` | 6 条种子消息落会话日志 |
| `dsh all` | rc=0，PASS 77 / FAIL 0 | 集成面 77 条断言全绿 |
| `dsh extjs` | rc=0，PASS 12 / FAIL 0 | 扩展宿主源码 `extjs/{server,host}.cjs` + `example/*.cjs` 都在包内 |
| `dsh stream` | rc=0，PASS 21 / FAIL 0 | 流协议面 |
| `dsh tool` | rc=0，PASS 11 / FAIL 0 | 工具列表与调用 |

装目录 `Temp/sacode-test.AYhjXm` 已 `rm -rf` 清理。

## Electron 2a 标准 builder 路径重打

**同步前分岔**（10:15 那份 NSIS 与 win-unpacked）：

| 路径 | host exe 体积 | sha256 前缀 |
|---|---|---|
| `dist/electron/win-unpacked/resources/host/bin/dsh-host.exe`（并发线手工覆盖的新宿主） | 4,728,320 | `7f290fc4` |
| `dist/host/bin/dsh-host.exe`（10:15 electron-builder 读源时用的旧版） | 4,289,024 | `e285f237` |

**同步 + 重打动作**（本会话）：

1. `cp -f win-unpacked/resources/host/bin/dsh-host.exe dist/host/bin/dsh-host.exe`
   复验 sha256 两边一致 `7f290fc4`。
2. `npm install`（apps/desktop）——`node_modules/electron/dist` 与 `electron-builder`
   此前被并发线的 `npm ci` 清掉了，重装 38 秒 rc=0，装到 `electron@33.4.11`。
   `^33.0.0` range 现在从 `node_modules/electron/package.json` 解析成具体版本，
   electron-builder 26.15.3 才能启动。
3. `npx --no-install electron-builder --config.electronDist=node_modules/electron/dist`
   rc=0，日志明确 `file signing skipped via signExecutable configuration`——
   显式关签名，与 `signExecutable:false` 一致。

**产物**（10:31 一次生成，NSIS 内 host 与 win-unpacked 同源）：

| 交付物 | 体积 | sha512 前缀 |
|---|---|---|
| `SaCode Setup 0.1.0.exe`（NSIS） | 86,807,682 B | `2141c882652dac33f7e8f9be16094cf1` |
| `sacode-portable.exe` | 86,655,638 B | `969cde7628fd4b2351fbdafb984a516d` |
| `win-unpacked/SaCode.exe` | 188,784,640 B | `8e75f9fd777c312d1fb6d5287b0b7c80` |
| 两处 `dsh-host.exe`（`win-unpacked/resources/host/bin/` 与 `dist/host/bin/`） | 4,728,320 B | sha256 `7f290fc4` 逐字等 |

对照备份 10:15 旧 NSIS `6d09e61f…`：新 `2141c882…` **变了**，证新宿主真进了 NSIS
装包，不是「装了上一轮旧宿主」的假象。备份 `pre-2a/` 已清理。

**复验**（win-unpacked 直跑）：

| 命令 | rc | 判决 |
|---|---|---|
| `npm run ui-smoke`（走 `--ui-smoke`） | 0 | `UI_SMOKE PASS`，UI OK 195 / UI FAIL 0 |
| `npm run smoke`（走 `--smoke`） | 0 | `SMOKE PASS`，7 行 SMOKE 断言（含 `initialize` 能力表 + `session/projection` + `session/subscribe` + 未知方法 -32601 + durability 屏障 submit=5→flush=6 + 干净退出） |

`UI OK 195` 是并发线与本会话的断言累积（记忆里那句「72 断言」是更早的基线，
不是回归）。

## 签名状态与决策

owner 已选路线 0：**接受未签名**。原因——本仓为复刻实验、个人开发无公司主体，
真发布需先过 Azure Trusted Signing 或商业 CA 两档阶梯（详见
`user-indie-no-code-signing-entity`）。`package.json` 的 `win.signExecutable:false`
保持不动，`Get-AuthenticodeSignature` 对 NSIS、portable、SaCode.exe 三个 exe
都返 `NotSigned`。真人装到干净 Windows 时 SmartScreen 会给「未知发布者」拦一下，
走「更多信息 → 仍要运行」即可绕过。

## 剩余 BLOCKED

| 项 | 判决 | 解锁条件 |
|---|---|---|
| ② Electron 代码签名 | **BLOCKED-签名（决策：接受 unsigned）** | 若日后要真签名：路线 B 需 owner 提供 `.pfx`+密码 + 移除 `signExecutable:false` + 重跑 builder；路线 C 需 Azure Trusted Signing 租户 + 域名验证 |
| ③ NSIS 真人安装/卸载 | **BLOCKED-真人** | owner 在一台干净 Windows（非本机）双击 `SaCode Setup 0.1.0.exe`，走完安装向导、跑一轮真实对话（能 seed / send / UI 看到投影），控制面板卸载并确认目录清空 |
| CLI `realstream` 子命令（剥 SDK） | BLOCKED（凭证缺失） | 需 `DSH_PROVIDER_BASE_URL` 与 `STEPFUN_API_KEY` 环境注入；本会话只跑过 500ms 短超时证取消在途 turn，30s 默认读超时未独立复验 |
| CLI `sig` 子命令 | PARTIAL（环境阻塞） | 本机 `GenerateConsoleCtrlEvent` 全 ret=True 却无人收到（`windows-console-ctrl-c-evidence`）；租约与结算的旁路断言已跑通，「中断真的送达」需真人按 Ctrl+C 或换 CI |

## 与其他证据文档的关系

- `p0-status-2026-10-02.md` 里并发线的 npm publish 归属与 Setup BLOCKED 记录以
  本文件为准做更正。
- 提交面：本会话独立落库 `chore(scripts): pack-host OpenSSL` + `feat(scripts):
  pack-cli 补 stdx/OpenSSL/MinGW` + `feat(npm): 改到 @stand-alone/sacode` +
  `feat(core,cli,host,desktop): 接入 RealSseProvider` + 本证据。
