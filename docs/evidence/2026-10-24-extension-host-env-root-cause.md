# extension/host 5 红的环境根因：仓库根 Low 完整性标签继承

- 日期：2026-10-24
- 范围：`apps/desktop/test/bridge.test.mjs` 中 `extension/host/*` spawn 族 5 条红（#33/35/36/37/38），承接 [P0 跨端打通前闸门](2026-10-24-p0-cross-end-gates.md) §5.2 的「预先存在的工具链/环境问题」定性。
- 一句话：**不是代码缺陷**。宿主 EXE 位于带 Low Mandatory Level 标签的仓库根下 → 继承 Low 完整性级别（Low IL）→ 它拉起的 JS 宿主子进程同样 Low IL，无法 `lstat('D:\')` → node 解析脚本路径即失败 → 一帧不回 → `js-host-handshake-timeout`。同源二进制放到中性目录（`SACODE_HOST` 指向）后，extension 子集 7/7、全量 83/83 全绿。

## 1. 现象与复现

- 仓库内默认 dev 布局跑 `apps/desktop` 的 `bridge.test.mjs`：`# tests 39` → `33 pass / 5 fail / 1 cancelled`，5 红即：
  - `#33 桌面入口经 core 拉起 JS 宿主并完成 load/list/call/dispose`
  - `#35 重复 spawn 被拒且不得把已运行的宿主弄丢`
  - `#36 桌面宿主退出前结算 JS 子进程，不留孤儿`
  - `#37 extension/host/call 立刻回执，在途调用不挡读侧`
  - `#38 extension/host/cancel 取消在途调用，只按 callId 结算一帧`
- 失败表现：`extension/host/spawn` 超时；Host stderr 打印 `js-host-handshake-timeout: received=0`，回执 `-32011 js-host-handshake-timeout`。
- P0 曾按宿主 PID 采样判「从未出现任何子进程」——**该结论不准确**：子进程确实被拉起，只是在毫秒级内退出，WMI/任务管理器采样漏采。

## 2. 定位过程（只读探针 + 临时诊断）

1. 直探 `extension/host/spawn`（Host 二进制 + `node=process.execPath` + `dir=extjs`）：drain 子进程 stdout 得 0 帧，Host 约 4s 打 `js-host-handshake-timeout`。
2. 手动对照组：以本机 node 直接 `node server.cjs` 喂 `initialize` 帧 → **正常应答**（脚本、node、协议均可）。排除脚本/环境本身。
3. 落盘标记探针：替换为「启动即写 `marker.txt`（不依赖 stdin）」的服务端脚本。
   - 对照组（自己 node spawn）：`marker` 正常写入并回帧；
   - 经宿主 spawn：**`marker` 缺失** → 子进程未执行脚本即退出。
4. 排除传参路径：分别试 `server.cjs` 相对参数 + `workingDirectory`、绝对路径、正/反斜杠——**均同样失败**；`ExtProcess.start()` 全程返回 true、无 `spawn-failed`（`launch` 未抛异常）。排除 launch 抛错、相对路径、workingDirectory 未应用、斜杠转义或被吞参数。
5. **临时诊断**（后已全部回退）：把 `core/src/extproc.cj` 的 `stdErr` 由 `Discard` 改 `Pipe` 并抽干到核心 stderr，暴露子进程真实报错：
   ```
   Error: EPERM: operation not permitted, lstat 'D:\'
     code: 'EPERM', errno: -4048, syscall: 'lstat', path: 'D:\\'
     at Object.realpathSync (node:fs:2749) … resolveMainPath …
   ```
   即 **node 子进程无法 `lstat` D: 盘根**，`realpathSync` 失败 → 主模块解析失败 → 秒退、0 帧。同一路径由普通 token 的 node（对照组）可正常 `lstat`。

## 3. 决定性 A/B（同源码、同二进制、同 node、同脚本，只差「宿主所在位置」）

| 宿主来源 | extension 子集 | 全量 `bridge.test.mjs` |
|---|---|---|
| 仓库内 `apps/host/target/release/bin/main.exe`（默认 dev 布局） | — | **39 用例：33 pass / 5 fail / 1 cancelled** |
| 中性导出 `D:\tmp\host-nv-1024\main.exe`（`SACODE_HOST` 指向） | **7/7 pass** | **83 tests / 83 pass / 0 fail / 0 cancelled** |

- 中性导出 = 把同一次构建产物的 `main.exe` + 全部 83 个 DLL 整体拷到仓库外中性目录（中等完整性、非仓库根继承）。
- `apps/desktop/test/bridge.test.mjs:18` 原生支持 `SACODE_HOST` 覆盖宿主路径，故无需改测试即可取证。
- 唯一变量是「宿主 EXE 所在目录的完整性标签」；其余（源码、DLL、node、脚本、协议）完全一致。

## 4. 判定与边界

- **根因**：仓库根带 **Low Mandatory Level 标签**，其下构建出的宿主 EXE 被继承为 Low IL；子进程继承同一 Low IL。node 在解析入口脚本时对 `D:\` 根执行 `lstat`，Low IL 被拒（`EPERM -4048`）。与 `AGENTS.md`「仓库根 Low Mandatory Level 标签继承」（cjpm 子进程继承 Low、中性导出正常）**同源**。
- **性质**：环境/布局问题，**非 `core/`、`apps/host/` 业务逻辑缺陷**。extension/host 的 Host 侧实现正确（中性宿主下 7/7、全量 83/83 通过即为证）。
- **未改环境**：按 AGENTS 约束，未移除任何 SID/Everyone DENY、未递归重置 ACL、未改动仓库根完整性标签——排查全程只读 + 可选临时诊断，且诊断已回退。

## 5. 本次已回退的临时改动（工作区核对）

- `core/src/extproc.cj`：临时 `stdErr: ProcessRedirect.Pipe` + `drainStderr` + `import std.console.*` 已全部删除，`git diff` 与 HEAD **无差异**。`apps/host/src/main.cj` 的 `server.cjs` 绝对路径试探已还原为原句 `ExtProcess(jsonStr(body, "node"), ["server.cjs"], workingDirectory: Path(jsonStr(body, "dir")))`。
- 重建 `apps/host && cjpm build` rc=0（29 warnings），产物恢复洁净；临时探针脚本、落盘标记目录、`buildlog.txt`、中性导出目录均已清理。
- 结论：**本批无产品代码净改动**（`apps/host/src/main.cj` 的其余差异来自既有的终端接线批，与本排查无关；`core` 零改动）。

## 6. 影响与后续

- 仓库内 dev 布局下 `extension/host` spawn 族**必然红**，与实现质量无关；需要「宿主运行在中性位置」或「安装态布局」才具备验证条件。取证/复验时可用 `SACODE_HOST` 指向中性导出宿主。
- 是否解除仓库根完整性标签属**环境治理**，须单独授权与最小范围评估（AGENTS 已明确此类调整不得擅自执行）；本记录**不主张**该改动。
- 未验边界：真实安装态（NSIS/asar/unpacked）下同链路未在本批复验；`turn/cancel 联动` 与「宿主任一退出前收束」两例在中性宿主下通过，但未在安装态复跑。