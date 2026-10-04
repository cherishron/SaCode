# 接手模型供应商纵向切片与协议帧修复（2026-10-04）

## 0. 接手现场

上一条线（额度耗尽）留下一批未落库改动。接手时工作区状态：

| 类别 | 文件 | 状态 |
|---|---|---|
| 仓颉核心新增（未跟踪） | `core/src/model_agent.cj` `model_agent_test.cj` `model_settings.cj` `model_settings_test.cj` `model_tools.cj` | 已读完，功能成体系 |
| 核心改动 | `core/src/model_request.cj` `core/src/session.cj` | 已跟踪、未提交 |
| 宿主 | `apps/host/src/main.cj` | 已跟踪、未提交，**且编译失败** |
| 桌面 | `package.json` `package-lock.json` `renderer/app.js` `test/bridge.test.mjs` `test/model-todo.test.mjs`（未跟踪） | 已跟踪/未跟踪混着 |

接手时的真实计数（工作区态取证）：

- `cd core && cjpm test`：**TOTAL 398 / PASSED 397 / SKIPPED 1 / FAILED 0 / ERROR 0**，rc=0。
- `cd apps/host && cjpm build`：**rc=1**，整条 workspace 构建被这一处卡住。
- `cd apps/desktop && npm test`：**113 用例 / 108 通过 / 5 失败**。

## 1. 宿主编译失败：捕获可变变量的 Lambda 不能间接调用

```
error: lambda capturing mutable variables needs to be called directly
  ==> apps/host/src/main.cj:689:62
note: 'key' is mutable
```

`var key` 被续请求闭包捕获。改成先冻结再捕获：

```
let turnKey = key
let real = RealSseProvider(baseUrl, turnKey, reqBody, tk)
let continuation: (String) -> Provider = { request => RealSseProvider(baseUrl, turnKey, request, tk) }
```

修完 `cjpm build success`，重打宿主 91 文件。桌面 5 条失败里有 4 条随之消失——它们的真因是 `dist/host/bin/dsh-host.exe` 还是上一轮的旧产物（mtime 10:22），而这几条用例打的是宿主可执行文件，不是源码。

## 2. 剩下那条从没绿过的用例：协议帧被正文撕裂

`test/model-todo.test.mjs` 仍失败，报 `timeout: turn/poll`。用一次性驱动（`target/dbg-model-todo.mjs`，gitignore 内）手工喂 NDJSON 并原样打印 stdout，拿到硬证据：

```
out {"jsonrpc":"2.0",...,"frames":["tool-call-delta:{"todos":[{"c","tool-call-delta:ontent":" ...
```

`turn/poll` 把帧正文原样拼进 JSON 字符串，正文里的 `"` 没转义 → 整行不是合法 JSON → `host-bridge.cjs` 的 `JSON.parse` 抛错后 `continue` 静默丢弃 → 调用方永远等不到那一 id 的回复，只能超时。**这不是那条用例写错了，是它撞上了宿主的一个既有缺陷**：真实模型正文（含工具参数 JSON）一定会带引号与换行，任何一次带引号的回复都会让桌面端卡死。

同一条边界上还有两处同类问题：结算帧的 `r.text`/`r.finishReason`；`session/subscribe` 把日志里的 `eventType` 原样拼帧——会话日志是唯一真源，外来写者可以在类型字段里留下引号与转义换行，那等于**注入协议行**。

## 3. 红→绿→变异

新增 `apps/desktop/test/frame-escape.test.mjs` 两条用例（真机 HTTP/SSE 与手工构造的日志行）：

| 阶段 | 构建 | 结果 |
|---|---|---|
| 红 | 修复前宿主 | `timeout: turn/poll`（新用例 1） |
| 半绿 | 只修 frames + 结算 tail | 新用例 1 **ok**；新用例 2 仍 `timeout: session/subscribe` |
| 绿 | 再修 subscribe | 桌面 **115 / 115 / 0 失败**，rc=0 |
| 变异 | 同时把 frames 与 subscribe 两处转义改回原文（各自独占受害用例） | 红集合恰为 3 条：新用例 1、新用例 2、`model-todo`；不跨该边界的 `host-todo`/`model-context`/`turn-settle` 5 条全绿 → 断言不空转 |
| 还原 | `cp` 备份还原，`diff -q` 无输出（逐字一致），重建重打 | 115 / 115 / rc=0 |

变异轮里 `r.text` 字段没单独施加：它与 frames 同处一帧、受害用例重叠，拆开归因需要两轮构建，故只保留两条独占受害的变异，该字段由新用例 1 的 `result.text` 断言覆盖。

## 4. 双入口复验（工作区态）

| 入口 | 命令 | 实测 |
|---|---|---|
| 桌面 | `cd apps/desktop && rm -rf dualtest && npm test` | 115 用例 / 115 通过 / 0 失败 |
| CLI | `cd apps/cli && cjpm build` → 仓库根逐模式跑 | all 77、stream 21、tool 11、ext 8、cancel 9、extjs 12、headless 36 = **174 PASS / 0 FAIL** |
| 核心 | `cd core && cjpm test` | 398 / 397 通过 / 1 跳过 / 0 失败 |
| JS 扩展宿主 | `cd extjs && node --test` | 16 / 16 |

CLI 的 `extjs` 模式必须在仓库根跑：它以相对工作目录 `extjs` 拉起子进程，在 `apps/cli/target/release/bin` 下跑会报 `WorkingDirectory "extjs" not exist`（第一次就被这个假失败骗了一下）。

## 5. 供应商通道实测（step_plan）

密钥只从本地 gitignore 文件与环境变量读，不写进任何入库文件。

| 探测 | 结果 |
|---|---|
| `GET /models` | http=200，10 个模型，含 `step-5-preview` |
| `POST /chat/completions` 非流式 | http=200，正文 `SAKOT`，带 `reasoning_content` 与 `usage` |
| `POST /chat/completions` `stream:true` | 12 条 `data:`，终止序：正文块 → `finish_reason:"stop"` → `choices: []` 的纯 usage 块 → `data: [DONE]` |

解析器契约要点（`core/src/sse.cj` 已按此实现，实测对上）：每个块都带 `usage`，且中途出现全零 usage 块——只有最后一次非零值可用，不能拿第一块；`delta` 同时给 `reasoning` 与 `reasoning_content`（现实现只取 `content`，推理增量被丢弃，尚未投影到 UI）；`content` 为空串的块不少，不能当结束标志。

## 6. 后端完整性审计结论（接手时的真实缺口）

按「UI 面 → IPC 通道 → 宿主方法 → 核心 API」逐段核，缺的是中间那一段：

| 能力 | 核心 | 宿主 | 桌面通道 | 判定 |
|---|---|---|---|---|
| 模型配置/密钥 | `ModelSettings` 读写落盘 | `model/get` `model/configure` `model/use-key` 已应答 | **`preload.cjs` 一个都没有** | 宿主在应答，UI 无从调；模型页是无适配器的纯 UI |
| 连接测试 | — | **没有任何方法** | 无 | 完全未实现 |
| 密钥持久化 | 只存 `credentialRef` 名字 | 明文密钥只在宿主进程内存 | — | 重启即失，「装上就能用」不成立；`model_settings.cj` 注释却写着「交给平台安全存储」 |
| 发送→起轮 | `task/start` 已具备 | 已应答且 fail-loud | `userSend` 只落盘不起轮 | 聊天要点两个按钮才动 |
| JS 扩展 | `ExtProcess` 真实拉起 | `extension/host/*` 7 个方法已应答 | 无通道 | 只有 CLI 在用 |
| 消息队列 | 无 | 无 | `app.js` 里 `rows: []` | 整条纵切未实现 |
| 附件 | `attach.cj` 只有标记 | 无 | 加号按钮 `disabled: true` | 未实现 |
| 会话标题生成 | `SessionTitleService` | 无动词 | 手输 | 未接线 |
| 工具面 | `ModelAgentLoop` 里 `if (call.name != "todo_write") throw` | — | — | 绕开了 `ToolRegistry`/审批台，与既有工具面是分裂的两套 |
| `initialize.capabilities` | — | 漏报 4 个已应答方法 | — | 能力声明与实现不一致 |

能力矩阵现状：**12 ✔ / 51 ◐ / 0 ☐**（README 行不计能力）。默认模型仍硬编码 `gpt-3.5-turbo`；`turn/start` 在无 base_url 时静默走假 provider（`task/start` 会 fail-loud）。

## 7. 本批入库范围

一个提交落地「接手 + 修复」这一条最小自洽绿线：核心的模型纵向切片（provider 配置、请求装配、工具调用按索引装配、多步循环）、宿主的真实 provider 接入与协议帧转义、桌面的真机用例与待办投影刷新帧。之所以不拆成两个提交：上一条线留下的宿主文件本来就编译失败，任何「只提交继承部分」的切法都会造出一个不可编译、且带一条已知红用例的中间提交；拆开只为形式上的归属，代价是历史里出现假红灯。

## 8. 凭证缝（上游 credentials 硬规约落地）

上游原文取证：`docs/subsystems/credentials.md`（api.github.com contents，冻结 639ed01，sha `eb708f95…`，496 行直读）与 `docs/subsystems/settings.md`（sha `ff047b74…`）。落地的四条不变量：引用名只接受 POSIX 环境变量语法；分层 `env` > `user-file`，每次操作重新解析（旋转密钥落到下一次请求，不需要重启）；空值在所有层都算缺席且盘上一行都不留；由活环境供值的引用**写入当场拒绝**——写了也会被影子压住，那是假装保存成功。`describe()` 是配置面唯一读面，没有任何槽位能带值穿过。

新增 `core/src/credential.cj` + 7 条用例。核心计数：改前 **TOTAL 398 / PASSED 397**，改后 **TOTAL 405 / PASSED 404 / SKIPPED 1 / FAILED 0 / ERROR 0**，rc=0。

一次 `--filter credential` 跑出 `PASSED: 0 / SKIPPED: 405 / rc=0` —— 过滤器没匹配上任何用例，全量被跳过。**这不是通过**，据此改判全量跑才作数。

变异反证（一轮构建同时施加三个变异，各配独占受害用例）：

| 变异 | 改法 | 唯一受害者 |
|---|---|---|
| 撤掉环境只读闸 | `envLookup(ref).size > 0` → `< 0` | `credentialEnvLayerShadowsUserFileAndIsNotWritable` |
| 空值不再等于撤销 | 落盘条件 `value.size > 0` → `>= 0` | `credentialEmptyValueMeansAbsentEverywhere` |
| 读侧改成首次为准 | `found` 覆盖条件加 `found.size == 0` | `credentialMalformedStoreLinesAreNotConfigured` |

红集合恰为这 3 条（`FAILED: 3`，其余 401 通过），`cp` 还原后 `diff -q` 无输出、复跑回 405/404/1/0。

明文密钥只从本地 gitignore 文件与环境变量读，未进入任何入库文件；提交前对本批全部文件跑过密钥串扫描，结果 `NO-SECRET-IN-STAGED`。

需要说清的一点：`user-file` 层沿用上游 local provider 的 env-file 形态——值是明文存在用户自有文件里，**不是操作系统钥匙串**。`model_settings.cj` 顶部注释原先写「明文密钥交给平台安全存储」，那是尚未成立的前提；要不要再往平台安全存储（DPAPI / Credential Manager）硬一层是另一件事，这里不假装已经做到。
