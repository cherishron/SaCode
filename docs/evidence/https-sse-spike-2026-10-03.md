# stdx.net.http 流式 SSE 可行性小 demo 验证（2026-10-03）

本批回答一个技术问题：仓颉 stdx HTTP 客户端能否支撑真实模型 HTTPS+SSE 闭环所需的「流式读、SSE 解析、流中取消」。此前 `stdx.net.http` 只有链接验证（符号解析通过），从未发过真实请求。这是 R1 真实模型闭环最底层的技术风险点。

## 方法

独立小工程 `D:/Project/sa/saai/sse-spike/`（仓库外，不进 workspace）：Node mock SSE server（HTTP 9876 / HTTPS 9877）+ 仓颉可执行 client（stdx.net.http），`cjpm build success`。HTTPS 用自签证书，客户端 `TlsClientConfig` + `TrustAll`（stdx 文档的开发测试模式）。client 模拟 `Provider.next()` 的接缝行为：逐块读响应体、拼 SSE 事件、读超时查取消标志。

## 结果

| 用例 | 实测 | 判决 |
| --- | --- | --- |
| T1 HTTP 流式读 + SSE 解析 | `readCount=4`，4 个事件各 100ms 间隔发出、分 4 次 read 收到；text/tool-call-delta/usage/finish 四个事件文本完整 | PASS |
| T2 HTTP 流中取消 | `readTimeout=500ms`，300ms 置取消标志；`chunks=1 attempts=2 exitedByCancel=true`，未等 mock server 10s 自然结束 | PASS |
| T3 HTTPS 流式读（TLS 握手） | 自签证书 TrustAll 握手成功；`readCount=3`，三个事件完整收到 | PASS |
| T4 真实模型 HTTPS+SSE（stepfun / step-3.7-flash） | 系统 CA 验证（Default 模式）直连公网；`readCount=28 bytes=27378`，响应含 `content` delta、`usage`（`prompt_tokens:17`）与 `[DONE]` 终止符 | PASS |

`rc=0`，`spike-pass`。运行环境：PATH 含 `stdx-work/.../dynamic/stdx` 与 Windows 标准 OpenSSL 3 DLL（`libcrypto-3-x64.dll`/`libssl-3-x64.dll`）。

## 对 R1 的结论

1. `RealSseProvider <: Provider` 的路径成立：`next()` 里 `body.read(buf)` 逐块读、映射 SSE `data:` 行到 `Chunk` 四种 kind，与假 provider 走同一 `TurnLoop`。
2. 取消路径成立：请求级 `readTimeout` + 每轮查 `TurnToken.cancelled()`，读超时异常可抛出并捕获（实测 catch 到 `Exception`，日志有 `read response timeout`）。这正是 `CancellableStreamProvider` 帧间 spin 的真 SSE 对应物。
3. HTTPS 成立：TLS 握手 + 流式读同一机制，`stdx.net.tls.common` 提供 `CertificateVerifyMode`（`TrustAll` 裸构造器在 `stdx.net.tls.*` 下不可见，需加 `import stdx.net.tls.common.*`）。
4. **真实模型闭环已验证**：stepfun（OpenAI 兼容 API）以 `Default` 系统证书验证直连公网，28 次流式 read 收到完整 SSE 序列，含 `content` delta、`usage`（`prompt_tokens:17`）与 `[DONE]`。A03「真实模型 HTTPS+SSE 闭环」的传输层与分帧层判定通过；剩余的是把 `RealSseProvider` 落进 core 并按 OpenAI `choices[].delta` 解析载荷——属实现，非研究。

## OpenSSL 随包分发验证（2026-10-03 补）

spike 完成后补验了第 1 项缺口「OpenSSL 运行时依赖」。

**改动**：`scripts/pack-host.mjs` 新增自动发现逻辑——复制完传入的 DLL 目录后，沿 `process.env.PATH` 搜索 `libcrypto-3-x64.dll` / `libssl-3-x64.dll`，找到则拷进宿主 bin 目录，找不到则 `process.exit(1)` fail-loud。

**实测**（三步取证）：

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| S1 重打宿主 | `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx-dll-dir> <cangjie-runtime-dll-dir>` | `+ libcrypto-3-x64.dll ← C:\Users\jingg\.qoder-cn\bin\git\mingw64\bin` `+ libssl-3-x64.dll ← …` `host 打包完成：91 个文件`（原 89 + OpenSSL 2）PASS |
| S2 宿主 exe 干净 PATH 启动 | `PATH="C:\Windows\System32;C:\Windows" ./dsh-host.exe` | 输出 JSON-RPC 帧 `{"jsonrpc":"2.0","method":"host/settled",…}`，`rc=0`。全部 import-table DLL 从 exe 同目录加载成功。PASS |
| S3 OpenSSL DLL 干净 PATH 加载 | PowerShell P/Invoke `LoadLibrary("libcrypto-3-x64.dll")` / `LoadLibrary("libssl-3-x64.dll")`，`$env:PATH` 仅 System32，工作目录为宿主 bin | `PASS libcrypto-3-x64.dll LoadLibrary=140732677488640` `PASS libssl-3-x64.dll LoadLibrary=140734231871488`。Windows 默认搜索序找到 exe 同目录的 OpenSSL DLL。PASS |

S3 精确模拟了 `libcangjie-dynamicLoader-opensslFFI.dll` 在运行时 `LoadLibrary` 加载 OpenSSL 的行为：剥掉 PATH 后仍能从 exe 同目录找到 OpenSSL DLL。

**限制**：S2 证明宿主 import-table DLL 全部加载，S3 证明 OpenSSL DLL 可被 `LoadLibrary` 找到。宿主进程内真正的 TLS 握手要等 `apps/host` 接入 `RealSseProvider` 后在端到端测试中覆盖（`RealSseProvider` 已在 core 仓内通过真实 API 三轮闭环，见下节）。spike 二进制与宿主编译依赖不同，无法直接从宿主 bin 目录复跑 T3/T4；改用 PowerShell `LoadLibrary` 做等价验证。

## 尚未覆盖 / 注意事项

- ~~OpenSSL 运行时依赖~~：已随包分发并验证（见上节）。
- 真实 provider 载荷解析：初版已落地，但同帧多事件、工具元数据、usage 次序、TLS 校验和错误分类未闭合；不能划为完成。
- ~~未测长会话背压与真实网络中断~~：长会话背压（10006 帧真实 SSE + cap=3 溢出守恒 + 逐字段回放）与真实网络中断（timeout/断连/取消/TLS/HTTP 状态）已于 2026-10-03 闭合，见「真实网络与公网严格复验」与「长会话背压与无损重放」两节。
- API key 仅经环境变量 `STEPFUN_API_KEY` 传入，未写进源码、日志或本证据；不在本文记录 key 值。

## RealSseProvider 接入 core（2026-10-03 补）

**历史实现记录（非当前契约验收）**：初版 `core/src/sse.cj` 包装 InputStream 并发起 HTTPS POST，但生产使用 TrustAll，畸变 JSON 静默跳过，每帧只取一个事件。下述历史绿灯不能证明这些缺陷已修复。

**真实 API 三轮复验**（`STEPFUN_API_KEY` 经环境变量传入，未入库）：

| 轮次 | 真实用例耗时 | 用例结果 | 备注 |
|---|---|---|---|
| 1 | 12.55 s | PASSED | 模型推理链长 |
| 2 | 2.88 s | PASSED | 模型直答 |
| 3 | 12.14 s | PASSED | 推理链长 |

三轮 `realModelSse` 均满足当时的 `hasFinish=true` 断言；该断言不检查正文、usage 完整性或 `[DONE]` 实际到达，因此不能据此认定 SSE 契约完整。

**关键修复（真实 API 暴露、mock 套件钉死）**：

- **每帧 choices + usage 同帧**：stepfun 等 provider 每一帧都带 `usage`（`completion_tokens` 递增），不是只在末帧。初版解析器「先查 usage」把 content 帧全吞成 usage 帧（实测 18 帧 usage、0 帧 text）。修复：先查 `choices`，且「有 choices 数组的帧绝不再落 usage 分支」——抽 `parseChoice` helper，role-only 首帧也走它返回 `None`，不再误判为 usage。
- **空 choices 末帧**：流末单独的 `{"choices":[],"usage":{...}}` 帧才落 usage 分支。
- 实测响应存在 `delta.reasoning` / `delta.reasoning_content` 与非空 `delta.content`。此前用两次独立请求作对照，不能证明失败请求本身没有正文；删除正文断言后得到的三轮通过只证明弱化的 finish 断言，不能证明正文解析完整或模型有时只输出推理。

**限制**：宿主 `apps/host` 尚未调 `RealSseProvider`（仍是 `CancellableStreamProvider` 假 provider）；端到端 TLS 握手在宿主进程内的真实跑通要等宿主接入后覆盖。本节只证明 core 仓内 `RealSseProvider` 解析逻辑与真实 API 闭环。

## 长会话背压与网络中断（2026-10-03 补）

**验收更正**：以下 128 条绿灯为历史工作区结果，不代表长会话背压或真实网络中断已完成。ByteBuffer EOF 不等于网络断连；cap=1、5 帧的测试不等于长会话压力测试；当时还混淆读取异常与 EOF，并错误落盘中断正文。相关项的补齐过程见后两节（真实网络七项 + 10006 帧长流），本段历史读数保持原样不退改。

**短队列基线**：`deliveryQueueOverflowSignalsWithoutLoss` 和 `slowConsumerDrainsAndDeliveryResumes` 只覆盖短流与溢出计数；`stream/chunk` 当时仅保存 kind，不能从它恢复丢失的正文或工具参数，`dropped()==0` 也不能证明恢复无损。

**网络中断 / abrupt EOF**：补两条用例钉「断线 ≠ 取消」的不变量——

| 用例 | 流形态 | delivered | text | finishReason | interrupted | cancelled | token.cancelled() |
|---|---|---|---|---|---|---|---|
| `sseAbruptEofBeforeFinishLeavesInterruptedNotCancelled` | 1 帧 text，无 finish 无 [DONE] | 1 | "hello" | "" | true | false | false |
| `sseAbruptEofAfterFinishCompletesCleanly` | text + finish，无 [DONE] | 2 | "hi" | "stop" | false | false | false |

关键不变量：
- **网络断开不自动翻 `TurnToken`**：token 只代表用户意图。旧实现错误地对未取消的 EOF 写 `assistant/message`，不能据此宣称中断正文不进历史；该边界由后续 core 契约修复用例验证。
- **`[DONE]` 只是终止符，不是终态信号**：真正的终态是 `finish_reason`。有 finish 就不算 interrupted（见第二条用例）；无 finish 即使流自然 EOF 也算 interrupted（见第一条）。

**历史实现限制**：读取异常被吞成 -1，与 EOF 混淆，未验证真实 timeout 或断连分类。没有自动重试不等于重连契约已验收；本批不增加重试调度，也不将其标为完成。

core 测试套件：**128 用例全绿**（原 120 + SSE 新增 8：4 解析 + 1 帧形回归 + 2 EOF + 1 真实 API 集成）。真实 API 三轮 + 本次 final 轮均 `realModelSse` PASSED。

## core 契约修复进行中（2026-10-03）

- TurnLoop 已加读取返回后的取消检查，仅完整终态落 `assistant/message`，接收 finish 后不再读取下一帧。中断正文经 flush/load 后仍不进模型历史。
- 红灯记录：`core/provider-turn-red.clean.log` 为 TOTAL 135 / PASSED 134 / FAILED 1，指定 `interruptedProviderDoesNotPublishAssistantHistory`；`provider-cancel-red2.clean.log` 的失败清单含读取期间取消用例；`provider-finish-red3.clean.log` 为 TOTAL 148 / PASSED 146 / SKIPPED 1 / FAILED 1，指定终态取消优先级用例。
- 修复后的工作区取证：`core/provider-core-final.clean.log` 最后 Summary 为 TOTAL 148 / PASSED 147 / SKIPPED 1 / FAILED 0 / ERROR 0，rc=0。跳过项是真实模型（本轮环境未注入 `STEPFUN_API_KEY`），不计为公网通过。
- core / CLI / Host `cjpm build success`、rc=0；extjs 14/14、rc=0。CLI/Host 只做构建兼容检查，未接真实模型、未重打交付包。
- 最终 SSE 实施：默认系统 CA 验证并禁重定向；安全 HTTP 状态错误；多行 SSE/UTF-8 分片、全部工具分片及 index/id/name；累计 usage 取最新总量一次并在 finish 前交付；DONE 禁后续读取；区分 timeout/read-error/cancelled/EOF；损坏协议明确失败；行/事件/队列有界，资源关闭幂等。OpenAI `length` 映射 `max-tokens`，TurnLoop 在 finally 关闭实现 Resource 的 provider。
- 审查新增两条红灯见 `provider-review-red.clean.log`（指定关闭资源与 length 映射用例）。修复后 `provider-review-final.clean.log`：TOTAL 161 / PASSED 158 / SKIPPED 1 / FAILED 1 / ERROR 1，rc=1。剩余两条是 `catalogCreatesNamedEmptyConversationAndPersistsSelection`、`catalogRejectsInvalidIdsAndTitlesWithoutWriting`，不归因于本批，但全套结论仍为 FAIL。
- 定向 `cjpm test --skip-build --filter '*sse*' --no-progress`：26 通过 / 135 跳过 / FAILED 0 / ERROR 0，rc=0（TOTAL 161 为套件注册数，非实际执行数）。core 最终 build rc=0。
- 尚未实测：默认 30 秒读超时下的取消延迟（现有取消取证均在 500ms 测试超时下取得）。不得把 InputStream 探针当网络取证；两入口与发布包未接入。

## 真实网络与公网严格复验（2026-10-03）

`scripts/sse-contract-server.cjs` 随机端口仅绑定 127.0.0.1；openssl 临时生成自签证书，退出清理，不修改系统信任库。生产 provider 增具名 readTimeout，默认仍 30 秒。

重建后 `cjpm test --filter '*sseNetwork*' --no-progress`：实际执行 **7/7**，rc=0，覆盖 401/429/500 安全错误、重定向目标请求及凭据计数为 0、默认 TLS 拒绝自签、阻塞超时、阻塞取消不投递后帧、途中断开不 complete、正文→usage→finish→DONE。日志 `core/network-review.clean.log`，注册 TOTAL 171 / PASSED 7 / SKIPPED 164 / FAILED 0 / ERROR 0。

取消取证使用 500ms 读超时（代理测得取消收束约 383ms、阻塞超时约 521ms），**不证明默认 30 秒配置下立即中断**（本批长流取消同样只证明测试超时下的收束，该条仍未闭）。

## 长会话背压与无损重放（2026-10-03 补）

**实现变更**：`stream/chunk` 落盘从只存 `ch.kind` 改存结构 JSON（kind/text/reason/choiceIndex/toolIndex/toolId/toolName，可选元数据用 JSON null 区分缺失与空字符串）；`DeliveryQueue` 消费即从底层 ArrayList 移除（原 `head++` 只挪下标、底层无限增长），`drain(0)`/负数不再破坏计数。原来那条「仍未验收」的欠账在此闭合。

**夹具**（`scripts/sse-contract-server.cjs` 新增两个路由，期望记录与 SSE 线帧分开独立构造，不调用被测序列化器）：
- `/long`：10006 帧 SSE，写缓冲满时等 drain 再续写（真实背压），末帧后 `[DONE]`。0-3 帧为两组工具参数分片（`{"路径":"` 与 `中文0\目录\n data: ","值":1}`），10004 帧 usage total_tokens 12345，10005 帧 finish `tool_calls`；正文帧含中文、换行、双引号、字面 `data:` 与制表符。
- `/long-expected`：10006 行 NDJSON 期望记录，与线帧同一生成器的独立输出。

**红灯**：三条新用例（`sseNetworkLongStreamOverflowReplaysEveryPersistedField`、`sseNetworkLongCancelledPrefixReplaysWithoutAssistant`、`deliveryQueueReclaimsConsumedStorageAcrossLongCycles`）先红，rc=1。

**绿灯（代理日志 `core/longstream-final.clean.log`，实测打印值）**：
- 完整流：delivered **10006**（精确相等），cap=3、峰值 3、overflow **9900**；守恒式 consumed(103) + queued(3) + overflow(9900) = 10006，无静默丢弃；flush/load 后 durableCount == eventCount = **10008**；按 `seq` 分页游标逐行回放，7 个字段与 `/long-expected` 逐字一致（restored=10006）；`r.text` 与期望正文拼接相等；`assistant/message` 恰 1 条；`deriveMessages()` 不含任何 `stream/chunk`。
- 取消流：第 257 帧投递后取消，overflow 252，守恒 2 + 3 + 252 = 257；回放后 `assistant/message` 为 0，已投递前缀完整。
- 队列回收：20000 次单帧循环峰值 1、结束后 retained 0；10000 次「 offer 3 → drain 2 → offer 1 → drain 8」部分消费循环 overflow 恰 10000、retained 0。

**独立复验（本轮，新构建不用 `--skip-build`）**：`core/longstream-verify.clean.log` 最后一个 Summary 为 TOTAL **177** / PASSED **176** / SKIPPED 1 / FAILED 0 / ERROR 0，rc=0，末行 `cjpm test success`；跳过项仍是无凭证公网模型用例。上述断言级证据在复跑中全部成立（精确计数以代理日志为准，两轮夹具确定性一致）。

**仍未闭合的界**：只有投递队列有界，会话日志与装配状态仍随会话增长；历史 kind-only 旧记录无法补回正文；长流取消只在 500ms 测试读超时下取证；未跑 Electron、未碰公网；两个产品入口仍用假 provider。

公网 stepfun 严格复验：使用此前已授权凭证，仅在内存注入子进程环境，不写入源码或日志。`*RealModelSse*` 套件实际执行 **1/1**，rc=0，3.54 秒；断言正文非空、finish、DONE 三者同时成立。日志 `core/provider-public-final.clean.log`：TOTAL 171 / PASSED 1 / SKIPPED 170 / FAILED 0 / ERROR 0。小写过滤名未匹配导致 0 执行的前一次结果已排除，不能当通过。

最终全量工作区：`core/provider-network-closeout.clean.log`，TOTAL 171 / PASSED 170 / SKIPPED 1 / FAILED 0 / ERROR 0，rc=0；真实模型在全量无凭证环境中跳过，公网结果以单独的严格复验为准。历史会话目录红灯本次未出现，本批未修改其实现。不宣称干净提交态、双入口真模型接入或发布包通过。

## apps/host 接入 RealSseProvider（2026-10-04）

**实现**（`apps/host/src/main.cj` 第 587–621 行，净增 37 行）：`turn/start` 改为 env 驱动选择 provider——`DSH_PROVIDER_BASE_URL` 非空时构造 `RealSseProvider`，空串退回原 `CancellableStreamProvider`。env 经 `host-bridge.cjs` 的 `HostBridge(hostPath, env)` 已透传自桌面进程，本端只读不写，IPC 表面未改。

- env 变量：`DSH_PROVIDER_BASE_URL`、`DSH_PROVIDER_MODEL`（默认 `gpt-3.5-turbo`）、`DSH_PROVIDER_KEY`（回退 `STEPFUN_API_KEY`，再回退空串）。
- 请求体：从 `shared.snapshotEvents()` 取最后一条 `eventType=="user"` 的事件正文，`jsonEscapeText` 转义后构造 `{"model":"<model>","messages":[{"role":"user","content":"<lastUser>"}],"stream":true}`。
- 构造失败兜底：`RealSseProvider` 构造抛错时先 flush 已积攒写入、归还租约，再 emit `-32015 provider-init-failed`，不留半开 turn。
- `turn/start` ok 帧新增 `"provider":"real"|"fake"` 字段（有限字段集合的扩展，不破坏现有契约）。

**TDD 红绿**（`apps/desktop/test/host-provider.test.mjs`，新建文件，不动现有测试）：
- 红灯：旧宿主 ok 帧为 `{"started":true,"limit":2,"epoch":1}`，无 `provider` 字段，`assert.equal(undefined,"real")` 失败，rc≠0。日志 `apps/host/host-provider-red.log`。
- 绿灯（独立复跑）：`node --test apps/desktop/test/host-provider.test.mjs` → 1 test / 1 pass / 0 fail，rc=0，152ms。实测值：`provider="real"`、polled frames `["text:first","usage:22","finish:"]`、终态 `text=first / finishReason=stop / usage=22`、projection `["assistant/message: first"]`。日志 `apps/host/host-provider-green.log`。
- 取证用本机夹具 `scripts/sse-contract-server.cjs` 的默认 SSE 分支（`/chat/completions` 路由按 `url.split('/')[1]` 取 `chat`，命中 default 分支返回 `first`→`usage(22)`→`finish(stop)`→`[DONE]`）；key 用 `"fixture-only"`，非密钥。

**构建**：`cd apps/host && cjpm build` → `cjpm build success`，rc=0；`dsh-host.exe` mtime 2026-10-04 00:35:35、size 4289024（旧值 mtime 2026-10-03 18:40、size 3991552——mtime 与体积均更新，非旧产物）。DLL 不变，仅 `cp main.exe → dsh-host.exe`，未重跑 pack-host.mjs。

**仍未闭合的界**：桌面尚无设置界面让用户在应用内配置 provider——当前须在启动桌面进程前把 env 备好（或由 OS 环境注入），自定义供应商设置 UI 留到下次批次。CLI 入口（`apps/cli`）未接真实 provider。未跑 Electron、未碰公网、未提交。core 本批未动，core 用例数仍 177/176+1skip。

## apps/cli 接入 RealSseProvider（2026-10-04）

**实现**（`apps/cli/src/main.cj` 第 698–740 行新增，净增 44 行）：新增 `realstream` 子命令，与既有 `stream`/`all`/`headless` 等模式并列，不改任何旧模式。

- env 变量与 host 同款：`DSH_PROVIDER_BASE_URL`（空串合法 skip，退 0）、`DSH_PROVIDER_MODEL`（默认 `gpt-3.5-turbo`）、`DSH_PROVIDER_KEY`（回退 `STEPFUN_API_KEY`，再回退空串）。
- baseUrl 非空时构造请求体 `{"model":"<model>","messages":[{"role":"user","content":"hello"}],"stream":true}`（`jsonEscapeText` 转义），`RealSseProvider(baseUrl, key, reqBody, tk)` 经 `TurnLoop().run(...)` 跑一轮，6 条 `expect()` 断言：真实流自然收束（`!cancelled && finishReason=="stop"`）、夹具正文（`text=="first"`）、夹具用量（`usage=="22"`）、三帧交付（`delivered==3`）、未被中断（`!interrupted`）、flush/load 后 `deriveMessages()` 含 `assistant/message: first`。末尾落 `ALL PASS`/`FAILURES=N` 汇总。

**TDD 红绿**：
- 红灯：分支故意用 `CancellableStreamProvider`（假 provider），`DSH_PROVIDER_BASE_URL=http://127.0.0.1:1` 非空避开 skip → 4 条 FAIL（`text=你好，world`、`usage=12`、`delivered=5`、回放得 `你好，world`），`FAILURES=4`，rc≠0。日志 `apps/cli/cli-realstream-red.log`。
- 绿灯（独立复跑）：重建 CLI `cjpm build success` rc=0（exe mtime 2026-10-04 08:18、size 4215808，非旧产物）；启本机夹具 → `DSH_PROVIDER_BASE_URL=http://127.0.0.1:<port> DSH_PROVIDER_MODEL=fixture DSH_PROVIDER_KEY=fixture-only dsh realstream` → `ALL PASS`，rc=0。实测 `cancelled=false/delivered=3/text=first/usage=22/finish=stop`，6/6 断言通过。日志 `apps/cli/cli-realstream-green.log`。

**两入口均接真实 provider**：`apps/host`（`turn/start` env 驱动，绿灯 1/1）与 `apps/cli`（`realstream` 子命令，绿灯 ALL PASS）共享同一 `core.RealSseProvider`、同一 env 变量约定。桌面 `host-bridge.cjs` 已透传 env，但桌面无设置界面——用户须在启动桌面进程前把 env 备好。

## 归档位置

demo 工程本体在仓库外 `D:/Project/sa/saai/sse-spike/`（cjpm.toml、src/main.cj、mock-server.js、mock-server-tls.js、key.pem/cert.pem），不入库；本记录即其证据。
