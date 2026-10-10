# 2026-10-11 · 批次 E 打包与打包态验收

构建时间 04:27–04:38（本机 UTC+8），源码基线 `b4b52a6`（批次 C/D 已入库的两笔）。工作区另有并发会话在途改动（`package.json` 的 `afterPack`/`*-ipc.cjs` 清单、`apps/daemon`、`core/src/execution_*.cj` 等），**本轮产物是从工作区态打出来的，不是从提交态**——这条差异如实记在这里，本批不替他线背书。

## 1. 构建

| 步骤 | 读数 |
| --- | --- |
| `npx electron-builder --config.electronDist=node_modules/electron/dist`（默认 TMP） | rc=1；`packaging`/`copying unpacked Electron`/`updating asar integrity`/`target=portable` 都过了，**`target=nsis` 报 `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`，Exit code: null**，盘上只剩 153273 B 的半成品 setup |
| 同一条命令把 `TMP/TEMP` 指到 `apps/desktop/.tmp-test/t2` 后单打 `--win nsis` | **rc=0**，`SaCode Setup 0.1.0.exe` 93861035 B |
| afterPack 卫生 | 保留生效：`win-unpacked` 里 `debug.log` 与 `resources/default_app.asar` 均不存在（`after-pack.cjs` 干的两件事） |
| 产物入库检查 | `git check-ignore -v` 三个产物全部命中 `.gitignore:119 apps/desktop/dist/`，**不会入库** |

NSIS 那一跳与批次 D 定到的同一条本机前提有关（`%TEMP%` 对非白名单可执行文件拒写/拒执行），不是脚本坏：换 TMP 落点即 rc=0。

## 2. 打包态断言（双入口各 296）

判据用应用自己落盘的 `ui-smoke-report.json`，**不拿空 stdout 或启动器退出码当证据**（portable 的 stdout 就是空的）。

| 入口 | 命令 | 报告读数 |
| --- | --- | --- |
| win-unpacked | `dist/electron/win-unpacked/SaCode.exe --ui-smoke --no-sandbox` | rc=0，stdout `OK` 296 行、FAIL 0；报告 `checks=296 passed=true→296 passed=false→0 failed=0 packaged=true` |
| portable | `dist/electron/sacode-portable.exe --ui-smoke --no-sandbox` | 启动器 rc=0 且 stdout 0 字节；报告 `checks=296 passed=true→296 passed=false→0 failed=0 packaged=true` |

两条都需要 `SACODE_SSE_FIXTURE` 指到真实 `scripts/sse-contract-server.cjs`：第一次没带这个变量时，win-unpacked 在 252 条处 `SMOKE FAIL 增强夹具提前退出 code=1 ... Cannot find module '...\win-unpacked\scripts\sse-contract-server.cjs'`。这是夹具自身的约定（打包态从 asar 往上爬找不到仓库 `scripts/`，由驱动注入路径），不是产品缺陷，但**不带该变量时安装包这条断言集会残缺**，值得写下来。

渲染层新鲜度：`resources/app.asar` 内 12 个本批迁出模块逐个在位（`session-state.js` `side-panels.js` `team-state.js` `settings-state.js` `turn-poll-state.js` `send-queue-state.js` `tool-approval-state.js` `workspace-state.js` `attachment-state.js` `model-directory-state.js` `session-catalog.js` `enhance.js`），随包宿主目录 92 个文件。

## 3. 载荷哈希四方对账（`sacode-host.exe`）

用 electron-builder 缓存里的 7za 从两个安装包里把宿主抽出来再算，`Size` 与源文件一致（11158528 B）：

```
6e71a371fb8303df  dist/host/bin/sacode-host.exe            （批次 B 本轮重建的源）
6e71a371fb8303df  dist/electron/win-unpacked/resources/host/bin/sacode-host.exe
6e71a371fb8303df  NSIS SaCode Setup 0.1.0.exe 抽出的一份
6e71a371fb8303df  sacode-portable.exe 抽出的一份
```

四个面同一颗宿主，没有「安装包带上一轮旧宿主」。

## 4. 签名状态（实测，不粉饰）

`Get-AuthenticodeSignature` 四个对象全部 **NotSigned**：`win-unpacked/SaCode.exe`、`sacode-portable.exe`、`SaCode Setup 0.1.0.exe`、包内 `sacode-host.exe`。这是 `build.win.signExecutable=false` 的**主动选择**（无本机证书），因此「安装包已产出」与「已签名可分发」是两句话，本轮只成立前一句。

## 5. BLOCKED 与残留

- **NSIS 真机安装/卸载：BLOCKED**。未获授权，本轮没有运行 `SaCode Setup 0.1.0.exe /S`，也没有动用户已安装的应用。解锁动作：授权后在一次性会话目录里静默装→启动 `--ui-smoke`→卸载→核对注册表与安装目录无残留。
- 残留核查：跑完后 `tasklist //FI "IMAGENAME eq sacode-host.exe"` 与 `SaCode.exe` 均回 `INFO: No tasks are running which match the specified criteria.`，**自有宿主与打包态壳零残留**。
- 未做（不是失败，是本轮没主张）：布局冒烟没有在打包态重跑（只在开发态 192 组绿）；A3 的真模型端到端仍卡在凭据，见 `2026-10-11-windows-tls-anchor-audit.md` §9。

> **本条后半句已被 2026-10-11 06:13 的复测推翻**（原文保留）：A3 的真模型端到端**不再**卡在凭据——`~/.sacode/user/credentials.env` 里的 StepFun 键实测可用，界面「新增供应商→填密钥→保存→选模型→发送」已出真答复，判据逐条成立，见同一文档 §13.1（凭据归因的作用域更正）与 §13.2（A3 完整口径 PASS 表）。本条前半句（布局冒烟未在打包态重跑）仍然成立。
