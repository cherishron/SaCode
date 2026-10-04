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

## 9. 提供商注册表（对齐模型页 Adapter 契约）

模型页要的是「多提供商 + 乐观并发 + 读面没有能带明文的槽位」，`model_settings.cj` 的单路 `base_url/model/credential-ref` 撑不起整个页面（上一条线在 `models-page-2026-10-04.md` 里也这么判）。新增 `core/src/provider_registry.cj`：

- 文档形态仍是「事件日志即真源」：`provider/upsert` / `provider/remove` / `provider/default`，每次操作从盘上重放。
- **修订号按提交次数走，不是条目数**——它是版本；`expectedRevision` 落后报 `settings-conflict`，内容不合法报 `settings-rejected`。上游把这两类分得很清，混起来 UI 就没法提示「别人先改了」。
- 写面只认白名单字段，草稿里出现 `apiKey`/`token`/`secret`/`value` 这类能承载明文的键直接拒绝；不是「存了但读的时候删掉」。
- 内置目录项 `declared`，写侧不能伪造或改它的 baseUrl/protocol，但可以被选为默认；默认指针指向被删条目或不在清单里的模型时一律回落/拒绝。

核心计数：改前 **398→405**（凭证缝）→ **TOTAL 414 / PASSED 413 / SKIPPED 1 / FAILED 0**（注册表 9 条），rc=0。

变异反证（一轮构建三处变异）：撤掉 declared 守卫、把明文键名单换成不可能命中的名字、把 baseUrl 档位校验改成恒真——各自杀掉一条独占用例。**其中一条暴露了真问题**：`registryHasNoSlotForTheSecretValue` 当时用的草稿 `models: []`，它先被「自定义提供商至少一个模型」拒绝，于是那条断言并没有在检验明文槽位这道闸——换成除 `apiKey` 外完全合法的草稿后，同一个变异才把它杀红。红集合从 2 条变成预期的 3 条。还原 `diff -q` 无输出，复跑回 414/413/1/0。


## 10. 宿主配置面 + 远端模型清单 + 轮次采纳注册表

`apps/host/src/main.cj` 新增 `providerSurfaceRequest`，把模型页的每个动作接到核心：`model/registry/{describe,update,remove,set-default,add-catalog,catalog}`、`credential/{describe,set,unset}`、`model/list`。三类拒绝按原码回传（`settings-conflict` / `settings-rejected` / `provider-not-found`），合并成「保存失败」就丢掉了「别人先改过，请重新加载」这条唯一可执行的信息。`initialize.capabilities` 同步声明这六个方法名。

新增 `core/src/model_catalog.cj`：`GET ${baseUrl}/models`，TLS 默认校验、禁跟随重定向。畸形形态一律 `bad-model-catalog`（空正文、非 JSON、顶层数组、`{"data":{}}`、条目非对象、id 非字符串、带 `error`、超 512 条、超 1MiB）， Trim + 去重保序；`summary(apiKey, ids)` 的密钥形参刻意不读，摘要面上不带凭据材料。传输失败区分 `http-status:<code>`（原样带上）与 `model-catalog-request-failed`。

轮次侧：`turn/start` 与 `task/start` 先读注册表默认指针，`openai-completions` 之外的方言在起轮前拒（`-32016 protocol-not-supported:<p>`，装配器只会出 Chat Completions 的体），凭据按 `credentialRef` 每次现取；注册表为空才回落单路模型设置与 `DSH_PROVIDER_*`。

核心计数：414 → **TOTAL 418 / PASSED 417 / SKIPPED 1 / FAILED 0 / ERROR 0**（模型清单 4 条），`cjpm test success`。桌面计数：**117/117 通过**（新增 `provider-registry.test.mjs` 4 条 + `user-text-quote.test.mjs` 1 条）。

变异反证（宿主面，两轮构建，每个变异各有一条独占受害用例）：

| 变异（只改语义不改签名） | 独占用例 | 结果 |
| --- | --- | --- |
| `resolveCredentialKey` 改成按引用缓存首次值 | 「凭据每次操作现取」 | 红：旋转后仍发旧令牌，401 断言失败 |
| `update` 提交时忽略客户端 `expectedRevision`，改传当前版本 | 「注册表读写与两类拒绝分开回传」 | 红：Missing expected rejection（冲突不再发生） |
| 轮次 `fromRegistry` 恒假（不采纳注册表） | 「轮次按注册表装配请求」 | 红：`-32016 model-not-configured` |
| 方言护栏条件改成恒假 | 「非 Chat Completions 方言显式拒绝」 | 红：`-32015 provider-init-failed:http-request-error`（真的把异方言当 Chat Completions 发了） |

第一轮三个变异同批施加时红集合为 {1,2,3,4}；其中用例 4 的红灯在「方言护栏」与「不采纳注册表」两个变异下都会出现（遮蔽），所以第 4 个变异单独一轮复跑，此时 1/2/3 全绿、只有 4 红，归因才成立。还原用 `cp` 备份 + `diff -q` 无输出，重编重打后 4 条回到全绿。

未闭合：宿主 `describe()` 的 `writable` 目前恒真（核心没有只读文档档位）；`credentialWritable`/`keyConfigured` 需要宿主在出JSON 时按引用查一次凭据层——这是下一批（桌面 IPC 通道 + 模型页真适配器）的前提。

## 11. 凭据名派生 + 描述面交出凭据状态（模型页接真实宿主的前提）

模型页的草稿上没有「凭据环境变量名」这一栏，页面提示写明 ID「用于派生凭据名」。派生落在核心 `deriveCredentialRef(id)`（大写、`-`→`_`、套 `SA_CODE_…_API_KEY` 命名空间），不是宿主也不是渲染层——两个入口必须推出同一个名字，否则 CLI 里配好的密钥在桌面端解析成另一个空引用。

红灯是 `textField` 对**缺字段**直接抛 `settings-rejected`（provider_registry.cj:504），即这份文档原本要求全字段齐备。改成 `optionalTextField(obj, key, required)`：写侧允许不给（不给才派生），回放侧仍严格（自家写出的形态一定带这个字段）。显式给了但形状不对（`9bad`）仍然拒绝——派生不兜这个。

宿主 `providerSurfaceRequest` 两处补强：
- 描述/写回面改用 `providerViewJson`，逐提供商按 `credentialRef` 现查凭据层，交出 `keyConfigured` 与 `credentialWritable`。启动环境提供的引用报 `writable:false`，页面据此把密钥框锁住。
- `model/list` 允许内联 `{baseUrl, apiKey}`：「获取可用模型」发生在保存之前，草稿里的地址与刚敲进的密钥直接去问远端。内联明文只活在这一次调用里——不进注册表、不进会话日志、不进回执（断言 `!JSON.stringify(inline).includes('inline-secret')`）。

计数：核心 **TOTAL 420 / PASSED 419 / SKIPPED 1 / FAILED 0 / ERROR 0**（+2），`cjpm test` rc=0；桌面 **122/122 通过**（`provider-registry.test.mjs` 4→6 条）。新增两条桌面用例在改宿主前取到真红灯：第 5 条 `-32020 settings-rejected`（旧宿主不吃无引用草稿），第 6 条 `keyConfigured` 期望 `true` 实得 `undefined`。

## 12. 桌面 IPC 通道 + 模型页真适配器（选择与配置在产品里真的驱动宿主）

新增 6 条按动作命名的通道（`preload.cjs`）：`modelsDescribe/modelsCatalog/modelsSave/modelsRemove/modelsSetDefault/modelsList`，没有新增「发任意方法」的通路（`test/models-ipc.test.mjs` 断言 `api` 上不存在 `request`，并逐字段比对发送的载荷形状）。主进程侧把校验拆进 `models-guard.cjs`（与 `stdio-guard.cjs`/`paths.cjs` 同样的「主进程逻辑拆成可 node 测的模块」做法）：白名单之外的字段丢弃、能承载明文的键位拒收、版本号非整数拒收、密钥控制字符与长度封顶。`modelsSave` 写完注册表后，用**回执里派生出的 credentialRef** 去落凭据——渲染层全程没有指定凭据名的通路。

渲染层 `renderer/app.js` 交出两个真适配器：`modelsAdapter`（load/save/remove/listModels，宿主错误码 `settings-conflict`→页面 `model-conflict`、`read-only`→`model-read-only`）与 `modelDirectory`（输入区选择器的目录：groups 取注册表、select 写默认指针）。模型页此前挂着「后端尚未接入」的诚实告示，现在告示撤掉并由真往返断言替代。

真实验收（真 Chromium + 真打包宿主，`npx electron . --frame-smoke`，rc=0，**243 条 FRAME PASS / 0 FAIL**）：
- `模型页真实产品入口`：`后端尚未接入` 不再出现；`目录来自宿主而非空表`：协议下拉 3 项、目录下拉含 `StepFun`（此前那条 `catalogFromHost` 断言写成 `[].every(...)`，空集合聚合出假红，已改成先开表单再核具体选项）。
- `模型页写入落到宿主进程`：页面上填的 `smoke-gw` 由**另一个进程**读回，`credentialRef` 为派生的 `SA_CODE_SMOKE_GW_API_KEY`、`keyConfigured:true`、注册表文档面不含明文、`credential/describe` 读回 configured。
- `选择器改动落到宿主默认指针`：在产品输入区点选 `冒烟模型` 之后，宿主侧 `defaultProviderId/defaultModel` 即为该选择——下一轮请求就按它装配（宿主侧那条断言已由 `provider-registry.test.mjs` 第 3 条钉住）。
- `宿主删除提供商并清掉默认指针`：冒烟自己收尾，后续用例回到「未配置注册表」的默认路径，不污染别的检查。

桌面 node 计数：122 → **124/124 通过**（新增 `models-ipc.test.mjs` 2 条）。

命名收口：用户可见面上撤掉上游产品名——引用气泡的 tooltip 不再回显 `@[…](dsh-session:…)` 线串（改为显示标题，同时仍**兼容**读入 `dsh-session:` 与新的 `sacode-session:` 两种写法，避免旧日志里的引用失效）；演示文件工具的路径由 `dsh-tool.txt` 改为 `sacode-tool.txt`（`renderer/app.js`、`main.cjs` 布局冒烟期望值、`ui-smoke.cjs` 两处断言同步）。仍存的 `window.dsh` 全局名、`dsh:*` 通道前缀、`DSH_PROVIDER_*` 环境变量与 `dsh-host.exe` 属于内部/交付面标识，改名要同时动打包脚本与安装资源路径，留作单独一批。

已知边界：宿主 → 渲染层没有配置变更推送，`modelDirectory` 只在保存/删除后与启动时主动 `load()`；带外（如 CLI）改注册表时，输入区的已选标签会短暂陈旧，直到下一次加载。


