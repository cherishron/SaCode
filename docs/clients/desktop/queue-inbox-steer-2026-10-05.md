# 运行中消息队列接入仓颉核心（2026-10-05）

对照冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 直读的上游 inbox 契约，把前端 QueueDock 从「控制式适配器」换成真实仓颉真源，并补上此前完全缺失的产品起轮通路。上游 MIT 许可证与来源见 `renderer/assets/dsh-ui-LICENSE.txt`（前端首轮证据在 [queue-dock-2026-10-04.md](queue-dock-2026-10-04.md)）。

## 上游契约（直读原文，非推断）

- 投影键 `inbox`，状态形如 `{'next-turn': UserMessage[], 'next-step': UserMessage[]}`；承载者是 `ReactLoopInbox`。
- **唯一**持久事件：`agent/inbox/spliced {target,start,removedCount?,inserted[],outcome?}`，`ignorable: true`。`inserted/claimed/discarded` 只是实时外发，不落日志。
- 准入是另一件事：送达写成独立的 `user/message`，队列事件本身不进模型可见历史（两条账互不冒充）。
- 送达窗口不对称：一个 pre-step 边界送 **全部** `next-step`；一个轮次边界只送 **恰好一条** `next-turn`，按 FIFO，绝不合并成一句。
- 用户取消保留队列（`keepInbox: true`，不写 canceled 拼接）；只有清空写 `outcome: 'canceled'`。
- 操作返回 `{accepted: true}`，**非幂等**（找不到条目报 `session/queue-item-not-found`），也不带 revision 守卫；空白正文按 bad-request 拒；无轮次可补报 `session/steer-unavailable`。
- 行身份是 `MessageId`，去重键是 `source.rpcId`；没有队列长度或体积上限；状态按 Session 归属。

## 本批实现

- `core/src/inbox.cj` `AgentInbox`：拼接按日志重放重建，读不懂的拼接单独计 `badCount`（不把记录损坏说成「用户没排队」）；条目 id 由核心铸造，界面递进来的 id 没有通路；`queue/step/edit/remove/steerFromQueue/claimStep/claimTurn/keepOnCancel/clear/snapshot/sizeOf/hasRpc/clearedCount`。
- 拼接是「回放 → 算增量 → 写一条整体替换」的跨多条事件读改写，单条 `append` 的锁护不住它；宿主协议线程与 runner 线程都会写，故所有写入口持同一把会话日志锁，类内只调私有方法，不自锁重入。
- `apps/host`：新增 `queue/describe`、`queue/enqueue`、`queue/update` 三个有限方法（并入 `allowedDuringTurn` 白名单与 `initialize.capabilities`），`task/start` 在轮次边界摘恰好一条并作为 `user/message` 落盘；缺配置显式 `-32016 model-not-configured`，绝不静默退回示例 provider。
- `core/src/model_agent.cj`：在写完工具结果、构造下一次请求之前摘全部 `next-step` 并逐条 `append("user/message")`，同时外发 `projection:queue`。`step-limit` 分支在其之前 break——没有下一次请求还摘走条目等于把消息吞进没人看的清单。
- `apps/desktop`：新增 `dsh:taskStart`（空载荷）与 `dsh:queueDescribe/queueEnqueue/queueUpdate` 四条按动作命名、逐字段校验的 IPC 通道（`/^q\d{1,18}$/` + `edit|remove|steer` 白名单），不提供「发任意方法」通路；QueueDock 接宿主投影；结算后先按核心重读清单再起下一轮，用户按停止的那一轮不起新轮；轮次运行中收到 `projection:queue` 就同时重读正文与清单。
- `renderer/frame.css`：`.error` 由文档流内改成会话区顶端浮层。它在流内会把输入区从停靠位顶走，实测打断三条已钉住的几何不变量。
- `scripts/sse-contract-server.cjs`：看门狗时限改为 `SSE_WATCHDOG_MS` 可配（默认仍 20 秒），新增 `/tools` 路由（首请求 1.5 秒后抛 `todo_write` 造成步边界，次请求收尾）。

## 证据

| 步骤 | 结果 |
| --- | --- |
| 红先（core） | 未实现 `AgentInbox` 前编译器报 `undeclared identifier`（`target/core-inbox-red.log`），落实现后转绿 |
| 核心单测 | `cd core && cjpm test`：`Summary TOTAL: 431 PASSED: 430 SKIPPED: 1 FAILED: 0 ERROR: 0`，`rc=0`（`target/inbox-step-green2.log`），其中 `inbox*` 11 条钉重放、窗口、非幂等、取消保留、rpcId 去重、步边界送达 |
| 变异反证 | `claimTurn` 由「恰好一条」改成「全部摘走」→ 只杀掉 `inboxClaimWindowIsOnePerTurnAndAllPerStep` 一条（`Expect Failed: turned.size == 1`、`sizeOf("next-turn") == 2`），`TOTAL 430 FAILED 1 rc=1`；还原经 `diff` 证明逐字一致（`target/inbox-mut1.log`） |
| 宿主队列（对旧宿主红） | `node --test test/message-queue.test.mjs` 5 条：对改动前的 `dsh-host.exe` 全部失败，对重打宿主 5/5 通过；含跨进程重放（`agent/inbox/spliced` 落 `session.log`、排队条目不出现在投影）与轮次边界恰好一条 |
| 步边界宿主用例（红先） | 新增「步边界把即时补充送进下一次模型请求」：对未接线宿主报 `AssertionError: 步边界要把补充的那句送成模型见过的用户消息`（`target/step-host-red.log`），接线后通过，并断言两份清单皆空且 `bad === 0` |
| 桌面单测 | `cd apps/desktop && npm test`：`# tests 132 # pass 132 # fail 0 # skipped 0`，`rc=0`（`target/desktop-test-3.log`） |
| 组件级 UI 冒烟 | `cd apps/desktop && npm run ui-smoke`：`UI_SMOKE PASS`，200 条 `UI OK`、0 条 `UI FAIL`（`target/ui-smoke-queue3.log`）。上一轮 `ui-smoke-queue2.log` 报 1 条未复现的高度回位失败，见「诚实边界」 |
| 另一入口复验 | core 改动后重打 CLI：`cd apps/cli && cjpm build` 通过，`main.exe` 断言自测 `77 PASS / 0 FAIL / ALL PASS`，`rc=0`（`target/cli-step-run.log`）；`cd extjs && node --test` `16/16`、`rc=0` |
| 全页冒烟 | 见下节 |

## 全页冒烟

`npx electron . --frame-smoke`（`target/frame-golden13.log`）：`FRAME 汇总 {"groups":247,"checks":709,"failed":0}`。金路径 6 组逐条为：

- `发送即自动起轮并收到真流式答复`——含 `usageFromRealStream`（夹具这一轮 22 token 的增量正好等于核心读数差），账是从真流里来的，不是界面自己算的。
- `运行中发送进入核心队列并在轮次边界自动送达`——排队时投影里没有那句，边界之后才有，且 `stillOnePerTurn` 钉住「一次只摘一条」。
- `按停止只撤本轮且排队条目仍留在核心`——`turnRecordedCancelled` + 取消后 `queue/describe` 仍返回那一条，且它没有变成 `user/message`。
- `面板删除走核心操作并清空队列`——点面板自己的删除按钮，核心两份清单都空。
- `即时补充在步边界送进本轮并作为用户消息落盘`——`/tools` 路由在 1.5 秒后抛 `todo_write` 造成步边界；运行中排队再点「即时补充」，正文出现那句、面板清空、`bad === 0`（两个线程写同一份清单没写出读不懂的拼接）。该机制的红先证据在核心与宿主两层（见上表），金路径这一条是端到端确认。
- `缺模型配置时消息仍入会话并显式报错`——撤掉配置后发消息：句子留在会话里、页面出现「还没有配置模型」那句中文、助手条数不涨。

上一轮（`target/frame-golden12.log`）同一入口报 `247 组 / 709 条 / failed 1`，唯一失败就是本节的步边界用例，其失败事实被打印为 `panelClearedMidTurn:false` 而其余三项为真：夹具第二次请求即刻收尾，导致读 DOM 时轮次已结算。改成第二次请求也拖 1.2 秒，让「还在跑、面板已清空」真的存在可观察时刻，再跑即 `failed 0`。这是改夹具的可观察性，不是放宽断言。


## 交付态复验（提交 4bf7ef3 之后重打）

| 步骤 | 结果 |
| --- | --- |
| 宿主重打 | `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx 动态目录> <CANGJIE_HOME/runtime/lib/windows_x86_64_cjnative>` → 「host 打包完成：91 个文件」，包内 exe 与构建产物 `cmp` 逐字一致 |
| 重打后开发态 | `npm test` 132/132、`rc=0`；`npm run smoke` → `SMOKE PASS`、`rc=0` |
| 桌面包 | `npx electron-builder --config.directories.output=dist/electron-queue --config.electronDist=node_modules/electron/dist` → `rc=0`；产出 `SaCode Setup 0.1.0.exe` 86,915,071 B 与 `sacode-portable.exe` 86,763,041 B。**没有走镜像**，electron 源用本机已装官方 dist；`signExecutable:false` 显式关签名，日志逐条打了 `file signing skipped` |
| 宿主双份一致性 | `dist/host/bin/dsh-host.exe` 与 `dist/electron-queue/win-unpacked/resources/host/bin/dsh-host.exe` 的 sha256 同为 `b97094cf…65d0b9`——安装包带的就是这一批的宿主，不是上一轮旧产物 |
| 打包态冒烟 | 直接跑 `win-unpacked/SaCode.exe --smoke` → `SMOKE PASS`、`rc=0`（打包态宿主路径由 `process.resourcesPath` 解析） |
| CLI 发布态 | `node scripts/pack-cli.mjs` → 45 个文件；`npm pack --offline` 两个 tarball 装进仓内一次性目录，剥掉含 `cangjie`/`stdx-work` 的 PATH 段并 `unset CANGJIE_HOME`（`which cjc`/`which cjpm` 均不可见、`node` 仍可见）后 `dsh all/extjs/stream/tool` → `rc=0`，`PASS 77/12/21/11`、`FAIL 0` |

### 交付态边界与一条必须上报的冲突

- NSIS 安装包**没有真的双击装到本机**（会写用户目录，需用户在场确认）；打包态证据来自 `win-unpacked` 直跑与 `portable` 产物存在性。
- 打包态只跑了 `--smoke`；`--ui-smoke` 与 `--frame-smoke` 的完整链在开发态跑，打包态未重跑。
- 签名仍未定，三条路线（接受未签名 / Azure Trusted Signing / 商业 CA）待用户选择。
- **冲突（不替他人裁决）**：本次 `app.asar` 里打进了 **152 个 npm 包**（`app.asar` 52.8 MB），根因是工作区里另一会话尚未提交的 `apps/desktop/package.json` 改动把 `@opentiny/next-sdk` 声明成了**生产依赖**（`dependencies`），electron-builder 会按声明把它的整棵传递树（`@ai-sdk/*`、`@modelcontextprotocol/sdk`、`express`、`hono` 等）收进包。这与 `AGENTS.md` 记的「第三方组件构建期折叠、**产物运行时零 npm 依赖**」直接矛盾。本批未改该文件（既不吞并也不回退），要么把它改成构建期折叠（照 TinyVue/TinyRobot 的既有路子），要么显式承认桌面产物从此依赖 npm 运行时——需要用户定。

## 诚实边界

- 起轮失败码到中文提示的映射此前是坏的：Electron 会在宿主帧外再套一层 `Error: `，原来的 `replace(/^-?\d+\s*/,"")` 去不掉前缀，映射表整体命中不到，页面只显示「起轮失败：Error: -32016 …」。本轮改为按「数字 + 空白 + 标识」提取符号码，金路径场景 C 才真的断言到那句中文提示——该用例写在实现之后，属测试后补，不是红先。
- `dsh:taskStart` 与三条队列通道的 preload 形状用例同样是实现之后补的（`test/task-start-ipc.test.mjs`），不宣称红先。
- 全页冒烟中「真实会话切换保留阅读位置」在某一轮报 1 条失败（`scrollTop` 相对 100 的 1px 判据），下一轮 246 组全通过且未复现；同一批 `--ui-smoke` 里「切回后重新适配长草稿高度」也报过一次（草稿值已恢复、高度未在所等窗口内回位），上一轮同代码全绿。两条都是「切换会话后恢复几何」类 1px 判据，失败那一轮日志里都有 Chromium 侧降级记录（`Network service crashed` / `GPU state invalid after WaitForGetOffsetInRang`）。未归因到本批改动，按未结案记录，不当作已修，也不改判据。
- `queue/update` 的错误码在渲染层没有中文映射（`updateQueue` 直接把宿主文本贴到面板），只有起轮那条通路做了码→提示的翻译；`-32023 queue-steer-unavailable` 目前只可能在空闲态出现（按钮在空闲时被禁用），暂留原文。
- AGENTS.md 说增删 IPC 通道要同步 `preload.cjs` 与 `test/bridge.test.mjs`；实际枚举暴露面的是 `test-support/ui-smoke.cjs` 的白名单（`bridge.test.mjs` 只测 HostBridge 传输，不含通道名）。本轮把该白名单的三份副本收成一份常量：原先「列表 31 项、长度写死 27」自相矛盾，一加通道就把自己判红。

- 步边界送达只在「确有下一次请求」的位置摘取；`maxSteps` 触顶那条分支不摘。取消发生在工具结果之前时同样不摘。
- 队列不看长度、不分优先级、不跨会话合并，与上游一致；上游的 `agent/inbox/inserted|claimed|discarded` 实时外发本仓未做（桌面走 `queue/describe` 重读），不影响持久真源。
- 真实模型（StepFun 端点）的端到端复验在打包态与本批未重跑；本轮队列与起轮证据全部来自本机 SSE 契约夹具。
