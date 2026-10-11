# 批次 F · 插件管理四项缺口的逐项处置（2026-10-11）

口径：只做只读勘察，不改代码、不跑构建。每项给**分类 + 证据（file:line）+ 处置**，且区分
「提交态 HEAD」与「工作树态」——这两态在本批不同形，混为一谈就会把别人在飞的修复当成已落地。

结论一句话：四项里有三项在 HEAD 上是**如实拒绝或空集**，一项是**模拟成功**（`install cancel`）；
那项在并发会话的未落库文件里已经被改成具名拒绝，但 HEAD 还没拿到这个修复。

## 1. remote source（从注册表装远程源）

- 分类：**后端未实现**（功能级，不是补漏）。
- 证据：
  - `apps/host/src/main.cj` 里 `plugin/registries` 是一条早退分支，恒回 `{"registry":null,"fallbackRegistries":[]}`；
  - 核心安装入口只吃本地目录：`core/src/plugin_store.cj:329 public func install(sourcePath: String)`，
    `inspectSource(sourcePath)` 同一形状；
  - 全仓（`core/src` + `apps/host/src`）没有取包与解包实现：`untar|tarball|extractArchive|decompress|compress.tar` 各口径 **0 命中**；
    但缺的**不是库**——随包 stdx 里就有 `libstdx.compress.tar.dll` / `stdx.compress.tar.cjo`，能力面是齐的，只差没人接。
- 处置：保持现在的如实空清单，**不**在 UI 上编一个假注册表。要做是独立功能：注册表元数据抓取 + tar(.gz) 解包 + 校验，
  验收门槛必须是「从公网源装上一个真插件并激活」，不是「端点回 200」。

## 2. entry enable（逐条 entry 开关）

- 分类：**入口已透传，后端未实现**，且拒绝已具名。
- 证据：
  - 壳层通道在位：`apps/desktop/preload.cjs:112 pluginsSetRowEnabled`；
  - 工作树态由 `apps/desktop/plugins-ipc.cjs:18` 透传 `plugin/entry/set-enabled`（该文件**未落库**，`git status` 报 `??`）；
  - 宿主明确拒绝：`apps/host/src/main.cj:890` → `errFrame(-32033, "plugin-entry-not-wired")`；
  - 核心没有 entry 级开关的存储模型：`PluginStore` 只有包级 `setEnabled`（`core/src/plugin_store.cj:404`），没有 entry 字段。
- 处置：HEAD 态这条已经是具名拒绝，不算已解决、也不算静默失败，**保持**。
  要实现得先给核心加 entry 级启用位（存储字段 + 版本位 + 迁移），再让宿主把它接进装配序；
  那是模型扩展，不是把 -32033 删掉。

## 3. install cancel（取消在途安装）

- 分类：HEAD 态 **模拟成功**（本批唯一的假象），工作树态已改成具名拒绝但**未落库**。
- 证据：
  - HEAD：`git show HEAD:apps/desktop/main.cjs` 的 `sacode:pluginsInstallCancel`（HEAD 行 724–726）
    直接 `return { cancelled: true, output: "install-was-not-running" }`——
    根本没有在途任务，却回一个成功形状；UI 会显示「已取消」。
  - 工作树：`apps/desktop/plugins-ipc.cjs:50-53` 先 `sanitizeEntryId(requestId)` 再
    `throw Error('plugin-install-cancel-not-wired')`——同一个动作改成如实拒绝。
  - 语义侧：核心安装在 RPC handler 内**同步完成**并当场回 `phase:"done"`（`apps/host/src/main.cj` 的 `plugin/install/start`），
    宿主也没有 `plugin/install/cancel`（不在 `:1017` 的 capabilities 清单里）——确实没有可取消的窗口。
- 处置（二选一，不留模糊态）：
  1. **改文档标模拟** = 现状（HEAD）不可接受，因为它不是「标注」而是「伪装成成功」；
  2. **改成如实拒绝** = 并发会话的 `plugins-ipc.cjs` 已经这么做，**要它落库**才算这条修完。
  真要实现取消，前提是 `install` 变异步任务（与 `execution/*`、`turn/*` 同一套在途模型），属架构改动。

## 4. build approval（审批插件构建步骤）

- 分类：**语义上是空集**，拒绝已具名（工作树态）。
- 证据：
  - 壳层把参数形状校严格：`apps/desktop/plugins-ipc.cjs:39-41`——不是数组或超过 100 条回
    `bad-approved-builds`；**非空即** `throw Error('plugin-build-approval-not-wired')`；
    空列表才透传 `plugin/install/start`；
  - 宿主 `plugin/install/start` 完全不读 `approvedBuilds`/`registry`（`apps/host/src/main.cj` 内 grep 0 命中），
    核心安装只是把目录放进包库（`PluginStore.install`），**不执行任何构建脚本** → 没有需要审批的构建步骤。
- 处置：保持具名拒绝。这条与「审批」在产品里的真语义（要跑 `npm install`/`build` 才启用）之间差的不是接线，
  而是核心根本没有构建期执行；把它当「已解决」是错的，当「如实拒绝且理由成立」是对的。

## 5. 汇总

| 项 | HEAD 态 | 工作树态 | 本批判定 |
| --- | --- | --- | --- |
| remote source | 空注册表 + 只吃本地路径 | 同 | 后端未实现，保持空清单；做是独立功能 |
| entry enable | 宿主 -32033 具名拒绝 | 壳层透传 + 宿主 -32033 | 未实现但如实拒绝，不算已解决 |
| install cancel | **`{cancelled:true}` 模拟成功** | 具名拒绝（未落库） | 本批唯一假象，等 `plugins-ipc.cjs` 落库 |
| build approval | 未见具名拒绝路径 | 非空即具名拒绝 | 空集成立，理由已在代码注释里 |

解锁/推进动作（都不在本批）：
- 让并发会话把 `apps/desktop/plugins-ipc.cjs` 与其 `main.cjs` 拆分落库，第 3 项的假象才从 HEAD 消失；
- 第 1、2 项若要真做，先补核心的模型（远程源解包链 / entry 级启用位），再谈接线与测试。

## 6. 第 3 项（install cancel）复验：HEAD 的假象原文钉出，工作树的修复+钉桩用例实测绿，但仍未落库（2026-10-11 08:37–08:46 实测）

上面 §5 的表是 03:52 的快照，本轮只补第 3 项的两端证据，表体不改。

**HEAD 侧假象的原文**（`git show HEAD:apps/desktop/main.cjs` 第 724-726 行，逐字）：

```
ipcMain.handle("sacode:pluginsInstallCancel", async (_e, args) => {
  return { cancelled: true, output: "install-was-not-running" };
});
```

没有任何在途安装被取消，却回 `cancelled: true` —— 渲染层 `plugin-manager-adapter.ts:331` 收到回执后把状态推到 `cancelling`，这是本批唯一的模拟成功。HEAD 的 `plugin-manager-wiring.test.mjs` 里也只有 entry 那条 `/-32033 plugin-entry-not-wired/`，**没有**任何针对取消的拒绝断言，所以 HEAD 上这条假象没有测试能挡住。

**工作树侧**：`apps/desktop/plugins-ipc.cjs` 整个文件是**未跟踪**（`git status` 显示 `??`），里面 `:50-52` 已把同一动作改成 `throw Error('plugin-install-cancel-not-wired')`；`test/plugin-manager-wiring.test.mjs` 是**已跟踪但被改**（` M`），新增用例 `宿主没有安装取消契约时桌面不得假报已取消`（该文件 `:39`）。

**本轮实测读数**：带凭据全套 `node --test`（671 条）里这四条接线用例逐条绿 —— `ok 371 桌面包启停保留布尔类型和核心回执`、`ok 372 桌面组件启停请求写动作，宿主拒绝不得伪装成功`、**`ok 373 宿主没有安装取消契约时桌面不得假报已取消`**、`ok 374 桌面检视和安装进度原样返回宿主事实`；整批 `# pass 669 / # fail 0 / # cancelled 0`，rc=0。

**判决不变**：第 3 项在**工作树态**已经是「具名拒绝 + 有测试钉住」（不再是假象），但**HEAD 态仍是模拟成功**，所以本批不把它算作已解决。这两个文件都在并发会话手里（一个未跟踪、一个已修改未提交），我不动它们、也不代它们落库——落库动作只能由那条线自己做。反证一句如实说：`ok 373` 绿的是**工作区态**，不是提交态；只跑 HEAD 副本时这条用例根本不存在，因此它现在挡不住任何回归。
