# SaCode 模型中心设计（供应商 / 自定义模型 / 调度恢复 / 计量预算 / 加速 / 迁移）

- 日期：2026-10-05
- 目标：当前无需账号即可使用、用户自主管理、支持安全换机迁移，并保留后续接入用户体系边界的模型中心
- 关联口径：`docs/plans/plan-deepseek-harness-replication.md` §2（18 条架构不变量）、§2.5（配置面）、`docs/plans/dsh-capability-matrix.md`（提供商/凭证/token-meter 相关行）
- 涉及模块：`core`（新增 5 个文档面 + 2 个决策面）、`apps/host`（新增动词）、`apps/cli`（新增自检模式）、`apps/desktop`（模型页 / 统计页 / IPC 通道）、`scripts/pack-*`（迁移助手随包）
- 本设计**不缩减**目标里任何一项；分批只是落地顺序，不是范围裁剪

---

## 1. 现状（本批直读源码核实，不靠记忆）

### 1.1 已经有、可直接复用的缝

| 既有能力 | 位置 | 与本设计的关系 |
| --- | --- | --- |
| 多提供商注册表：事件日志即真源、`expectedRevision` 乐观并发、协议闭集、`settings-conflict` 与 `settings-rejected` 分诊 | `core/src/provider_registry.cj:130`（`providers.log` 见 `:142`，协议闭集 `:41`） | **就是第 1 层「供应商」**，扩展而非另建 |
| 读面无带明文槽位：草稿里出现 `apiKey/key/token/secret/value` 直接拒 | `provider_registry.cj:330` | 迁移包「配置面永不带密钥」沿用同一纪律 |
| `baseUrl` 只允许 https 或本机回环 http，禁 `@ ? #` | `provider_registry.cj:436` | 加速通道的目标地址校验在它之上再加一层 |
| 凭据引用与值分离：`env` > `user-file` 分层、每次操作现解析、`describe()` 只回事实 | `core/src/credential.cj:68`（`:77` 落 `credentials.env`，`:128` 读面，`:154` 环境影子拒绝写入） | **本机凭证库**就是它；迁移包的密钥条目必须走这同一个 store，不能另开一份 |
| 远端模型清单拉取 + 连接测试：坏响应不等于「0 个模型」、摘要不带凭据 | `core/src/model_catalog.cj:101`（`:15`、`:95`） | 「拉取模型」的传输层已具备，缺的是**发现结果 → 自定义模型**的导入编排 |
| 会话级 token 计量：账从会话日志重算、超档那笔不计入、预算只能收紧 | `core/src/meter.cj:7`（`:62` 收紧、`:52` 结算） | 这是**失控闸门**，不是模型额度；两者在 §7 明确分权 |
| 请求装配：标准消息与工具结果全部从会话日志重建 | `core/src/model_request.cj:7` | 调度器插在装配之前，不改变装配的纯函数性质 |
| 单一 provider 的真实请求装配点 | `apps/host/src/main.cj:1172`（`RealSseProvider(baseUrl, turnKey, reqBody, tk)`） | **调度器的唯一插入点**，桌面与宿主共用 |

### 1.2 确认是空白（不是推断，是 0 命中）

| 缺口 | 取证方式 | 结论 |
| --- | --- | --- |
| 价格 / 金额 / 币种 / 十进制定点 | `core/src` 全量 grep `price\|cost\|currency\|Decimal\|pricing` | **0 命中**，金额账本完全未实现 |
| 熔断 / 健康 / 冷却 / 重试 / 故障转移 | `core/src` 全量 grep `circuit\|breaker\|health\|failover\|cooldown\|Retry-After\|retry\|fallback` | 只有无关命中（`SessionWorkspace.fallback`、标题 fallback），**调度期故障处理为 0** |
| 轮询 / 加权选择 / 能力过滤 | 同上 | 未实现；当前只有 `setDefault` 单指针（`provider_registry.cj:296`） |
| 自定义模型（多上游绑定 + 权重 + 预算） | 无对应文档面 | 未实现 |
| 配置导出 / 导入 / 迁移包 | 无对应模块 | 未实现 |
| 加速通道 | 无 | 未实现 |

### 1.3 两个改变设计判断的实测事实

1. **OpenSSL 运行库已经随包分发**：`scripts/pack-cli.mjs:113` 与 `scripts/pack-host.mjs:23` 就把 `libcrypto-3-x64.dll`/`libssl-3-x64.dll` 拷进产物（因为 `stdx.net.tls` 走 opensslFFI），实测装包目录 `resources/host/bin/` 里确有 `libcrypto-3-x64.dll`。
   → **加密迁移包不引入新的分发负担**：任何能跑真实 https 模型的机器，本来就带着 libcrypto。
   这修正了 `core/src/sha256.cj:5-9` 注释里「stdx 发行包不带 libssl/libcrypto」的语境——那句话对**开发态 SDK 目录**成立，对**交付产物**不成立。
2. SDK 里有 `libcangjie-std-crypto.cipher.dll` / `libcangjie-std-crypto.digest.dll`，`stdx` 里有 `libstdx.crypto.crypto.dll`（符号表里能看到 `GCM`）。
   → AEAD 原语大概率可用，但**具体 API 形态我还没证**（`strings` 从 `.cjo` 里取不出符号）。所以 §10 批次 0 先跑一个最小编译探针钉住它，探针不过则按 §10 的降级阶梯走，**不允许**为了绿灯手写对称加密。

3. **本栈的密码学面实测清单**（从 SDK/stdx 的二进制符号抽取，`strings` 在本机不可用，改用 Node 读 latin1 后取可见串）：
   - `std.crypto.cipher` 只有**接口** `BlockCipher`（`encrypt`/`decrypt`），**没有任何具体算法**；`std.crypto.digest` 同理只有 `Digest` 接口与泛化 `digest`。这修正了 `core/src/sha256.cj:5-9` 的「本机唯一的摘要实现是 stdx.crypto.digest」——不是「唯一」，是 **std 侧根本没有现成实现**。
   - `stdx.crypto.crypto` 的**唯一具体分组密码是 `SM4`**，模式枚举 `OperationMode` 有 `CBC|CTR|GCM`，并暴露 `aad`/`tagSize`/`ivSize`/`key`；另有 `PaddingMode`（`NoPadding|PKCS7Padding`）与 `SecureRandom`（带 `priv` 私有随机字节）。
   - **全栈 0 处 `AES` 命中**；**0 处任何 KDF**（`PBKDF`/`Scrypt`/`HKDF` 全无命中）；`stdx.crypto.digest` 有 `SHA256`/`SHA384`/`MD5` 与 `HMAC(key, Digest)`。
   → 结论：**AEAD 可用但只有 SM4-GCM**，且**口令派生必须自建**（见 §8.2）。这把我原先写的 `AES-256-GCM` 直接推翻。

---

## 2. 三层数据模型

### 2.1 第 1 层：供应商（扩展现有 `ProviderRecord`）

现有字段 `id/name/baseUrl/protocol/credentialRef/declared/models[]` 全部保留，新增：

| 新字段 | 语义 | 约束 |
| --- | --- | --- |
| `sortOrder` | 列表展示顺序，同时是新增绑定的默认顺序 | 整数，允许空洞（拖动只改这一列，**不改任何自定义模型的调度序**） |
| `enabled` | 全局硬开关 | 缺省 `true`；关断后所有绑定不可调度 |
| `transport` | `direct` \| `relay` | 见 §6 |

`models[]`（现有 `ModelSpec`）就是第 2 层的载体，见下。

### 2.2 第 2 层：上游模型 = `(providerId, modelId)`

不新开文档面，仍随供应商记录落 `providers.log`（一次改动一条事件，避免拆成两份真源）。`ModelSpec` 在现有 `id/name/contextWindow/maxTokens/image` 之外新增：

| 字段 | 说明 |
| --- | --- |
| `inputModalities` / `outputModalities` | 文本 / 图片 / 音频 / 视频 / 向量 的枚举数组 |
| `supports` | `tools` / `stream` / `structuredOutput` 三个能力位 |
| `meterUnit` | `token` \| `image` \| `second` \| `request` \| `unknown`——**不把一切模态折算成 token** |
| `provenance` | `provider-listed` \| `user-entered` \| `human-confirmed`；拉取失败或字段缺失时保持 `unknown` |
| `availability` | `available` \| `unsupported` \| `unknown`（供应商明确说不支持 → 该绑定对该能力不可用） |

硬约束：**不按模型名推断能力**。名称只用于推荐展示；未知一律 `unknown`，而 `unknown` 在能力过滤里**不等于满足**（§4），避免「名字像就投进去」。

### 2.3 第 3 层：自定义模型（新文档面 `custom-models.log`）

沿用 `providers.log` 的事件回放 + `expectedRevision` 形态（同一套冲突/拒绝分诊），条目：

| 分组 | 字段 |
| --- | --- |
| 身份 | `id`（稳定 ID，迁移与熔断都认它）、`name`、`description`、`enabled` |
| 能力 | `category`（主分类）、`requires`（所需能力集合） |
| 绑定 | `bindings[]`：`providerId` + `modelId` + `enabled` + `order` + `weight` + 计价条目 + 计价版本 |
| 参数 | `defaultParams`（温度、最大输出等） |
| 预算 | `dailyTokens` / `monthlyTokens` / `dailyAmount` / `monthlyAmount` / `currency` / `maxOutputTokens` / 模态单位预算 |
| 探测 | `probe.enabled`、`probe.maxPerDay`（策略默认值见 §5.3） |
| 调度 | `mode`: `round-robin` \| `weighted`（默认 `weighted`，即平滑加权轮询） |

规则：

- **计价属于每条绑定**，一个自定义模型只有一个 `currency`；跨币种的绑定要么显式登记换算并记快照，要么拒绝保存——不允许用统一单价把金额算错。
- 同一 `(providerId, modelId)` 在一个自定义模型里**不得重复绑定**（沿用 `parseModels` 的去重纪律，`provider_registry.cj:388`）。
- 能力不适配的绑定**保存即拒**（`settings-rejected`），例如生图模型不能绑进 `requires=[tools, text-output]` 的编程模型。
- 供应商删除后，指向它的绑定转为 `dangling`，显示「供应商已关闭/已删除」，配置保留但不参与调度。
- **日常任务的选择面只列自定义模型**（桌面下拉与 CLI 的模型参数同一份读面）；供应商、`baseUrl`、凭据、价格都不出现在任务输入路径上——这是「用户只需定义自己的模型，不必反复选供应商、不必填密钥」的可执行形式。

### 2.4 数据归属：本地身份（为账号体系留的缝）

新增 `Principal`（`core/src/principal.cj`）：落一个**安装 ID** 在用户设置目录，字段只有 `kind: "local"` 与 `installationId`。

所有新文档（`custom-models.log`、`route-health.log`、`usage-ledger.log`、`relay.log`）的写入都必须带当前 principal；调度与账本查询都以 principal 为作用域。

**现在就缝好，但不建设账号**：调度器只接 principal 上下文，不接「怎么登录来的」。未来绑定账号是一个**显式迁移操作**（重映射 owner），绝不按名称合并，也不因登录自动把本地数据上云。

---

## 3. 模块划分（每个单元一个职责）

| 单元 | 职责 | 依赖 | 明确禁止 |
| --- | --- | --- | --- |
| `ModelSettingsDoc`（现 `provider_registry.cj` 扩展） | 供应商/上游模型文档的读写与校验 | `SessionLog`、`CredentialStore` | 不发起网络、不解析凭据值、不做任何调度 |
| `CustomModelRegistry`（新） | 自定义模型与绑定的读写、能力适配校验、乐观并发 | 同上 | 不选路、不查健康状态 |
| `RouteHealth`（新） | 路由健康状态的记录与查询：作用域、失败计数、`notBefore`、下次探测时间 | `SessionLog`、注入的时钟 | 不发起探测请求、不调度 |
| `ModelRouter`（新） | 纯决策：给定自定义模型 + 请求所需能力 + 健康视图 + 账本视图 → 选一条路由或返回**带类型的拒绝** | 前两者的只读视图 | 不做 I/O、不写状态、不读时钟（时钟由调用方注入）、不重试 |
| `UsageLedger`（新） | 每次上游尝试的预留/结算/作废、十进制定点金额、幂等、待核算 | `SessionLog`、`WriteLease` | 不选路、不调用 provider、不猜成本 |
| `MigrationBundle`（新） | 导出/导入包构造、差异计算、口令加密封包 | `CredentialStore`、AEAD 原语 | 不碰账本、不碰健康状态、不写 `providers.log` 之外的真源 |
| `TransportChannel`（新，薄） | 把一次 provider 请求按 `direct`/`relay` 送出去；只决定「走哪条线」 | `stdx.net.http` | **不选模型、不改预算、不重试已可能送达的请求** |
| 桌面渲染层 | 呈现与交互 | 有限 IPC | 不调度、不记账、不缓存路由决策 |

不变量：**桌面和 CLI 都只能通过同一组仓颉 API 得到决策**，渲染层与宿主脚本里不允许出现「我自己挑一个 provider」的通路。

---

## 4. 调度规则

每次请求先过滤再选择，顺序固定，任一环节不过都返回**带类型码的拒绝**（不返回模糊的「失败」）：

```text
自定义模型 enabled
→ 供应商 enabled
→ 绑定 enabled 且非 dangling
→ 上游 availability 满足请求所需能力
→ 凭据可解析（describe().configured == true）
→ 路由未被健康状态暂停（notBefore 未到 → 排除）
→ 预算允许（已用 + 在途预留 + 本次预留 ≤ 上限）
→ 按 mode 选一条
```

选择算法：

- `round-robin`：按 `order` 升序循环，游标落在**当前可用集合**内（跳过被排除项，不是「轮到就失败」）。
- `weighted`：平滑加权轮询（Nginx 式：每次给各候选加 `weight`，选累计值最大者并减去总权重）。**长期比例可确定断言**，且不需要随机数。
- 不用随机权重作默认：小样本失衡且难测难解释。

确定性合同：给定同一文档态 + 同一健康态 + 同一注入时钟 + 同一请求能力，`ModelRouter` 的输出必须逐字可重放——这是 §9 里权重/轮询用例的立身前提，也是 `ModelRouter` 不读真实时钟的原因。

供应商开关的语义（照目标收口，不引入「关开关能撤回远端」的错觉）：

- 关断后：新请求与**尚未发出的后续步骤**立即排除该供应商。
- 已发出的请求默认允许结束；要立即停走显式取消（沿用现有 `turn/cancel`），不提供「关开关顺带撤回」。
- 下游配置保留并显示「供应商已关闭」。

---

## 5. 失败分类与健康恢复

### 5.1 暂停作用域（不再一律「当天熔断到明天」）

熔断单位是**作用域**，作用域有三档，按实际受影响范围选最窄的一档：

| 档 | 键 | 适用于 |
| --- | --- | --- |
| `upstream` | `providerId + modelId` | 模型自身故障（5xx、协议畸形、该模型明确不支持） |
| `route-set` | `credentialRef` | 额度/限流是**按凭证或账户**给的（例如「5 小时额度」）——暂停该凭证下受影响的全部路由，换个自定义模型也拦，堵住「换个模型名继续撞额度」 |
| `channel` | `transport + relaySlug` | 线路/加速层故障，**不计入模型三次失败** |

`route-set` 档是关键修正：目标原文按「供应商 + 上游模型」熔断，但五小时额度这类事实按凭证下发；只按模型熔断会让同凭证的其它模型继续烧。作用域记在事件里，页面按档展示。

### 5.2 失败分类表（有效失败的判定）

| 情况 | 计入三次 | 附加动作 |
| --- | --- | --- |
| 连接失败、超时、5xx、协议异常响应 | 是 | 作用域 `upstream` |
| 429 限流 | 是 | 遵守响应里的 `Retry-After`/额度重置时间；能归因到凭证时升档 `route-set` |
| 额度耗尽（供应商明确表达） | 是 | 直接 `route-set`，`notBefore` 取供应商给出的重置时刻 |
| 用户取消 | 否 | 已收到的 usage 照记（§7） |
| 本地参数校验 / 预算拒绝 | 否 | 属本地决策，不冤枉供应商 |
| 工具执行失败 | 否 | 不是模型侧 |
| 401 / 403 | 否（不消耗三次机会） | 暂停该凭证作用域 + 明确提示修凭证，**不定时盲试** |
| 上游明确不支持某能力 | 否 | 该绑定对该能力置 `unsupported`，不再盲重试 |
| 无法归因（线路与模型分不清） | 标 `unknown` | 不累加任何一档的计数，页面如实显示「归因未知」 |

### 5.3 冷却与低频探测

- 累计 **3 次有效失败** → 该作用域退出正常调度，进入 `cooling`，写 `notBefore`。
- `notBefore` 取值优先级：**供应商证据 > 退避阶梯**。供应商给了 `Retry-After` 或额度重置时刻就照它；没给则按 `30min → 1h → 2h → 4h`（同一作用域连续冷却逐档抬升，上限 4h），全部可配置，默认即此。
- **成功不清零累计失败数**，但恢复正常调度；失败数只做展示与归因。
- 状态持久化在 `route-health.log`，**跨重启不丢**；不再有「次日自动恢复」这条——恢复由探测决定。
- 探测去重：探测任务持有 `WriteLease`（复用 `model_settings.cj:58` 的租约形态），同一作用域同时只允许一个在途探测；CLI 与桌面共享这份租约，因此不会各探一次。
- **谁发起探测**：由活着的宿主进程（桌面 spawn 的 `dsh-host`）跑探测定时器；CLI 的单发子命令**不**起后台定时器，只在 `route/probe/run` 被显式调用时探一次。软件全部关着时不继续产生探测费用，也不假装恢复。
- 探测预算：`probe.maxPerDay` 默认每个作用域每日 **3 条**，探测费用计入 `usage_kind=probe` 且受模型额度预算约束；上限可改，改法同其它写面（带 `expectedRevision`，落一条事件）。
- 探测成功 → 状态转 `trial`：只放行**一条**正常请求做确认，该请求成功才回 `available`，失败则回 `cooling` 并抬一档。
- 探测形态阶梯（能省则省，且不许越档宣称）：
  1. 供应商明确的**额度/健康只读接口**（零推理成本，优先）；
  2. 该接口不存在时，用**最小真实请求**探一次——明确会产生费用，计入 `usage_kind=probe` 并受探测预算约束；
  3. 模型列表拉取成功**不等于**推理可用；文本探测成功**不等于**生图可用——探测必须打在即将使用的那条路由与那个能力上。
- 页面显示：当前档、累计失败数、最近失败原因、`notBefore`、下次探测时刻、最近一次探测结论。

---

## 6. SaCode 统一海外加速

**定位**：可选的受控传输通道，不接管模型中心。加速服务里**不再有第二套调度器/预算器**。

```text
桌面 / CLI →（本机）仓颉核心：能力过滤、健康、预算预留、记账
           → TransportChannel：direct 或 relay
           → 上游供应商
```

- `direct`：直连供应商 `baseUrl`（现状路径）。
- `relay`：请求发给 SaCode 加速端点，由它转发上游。端点与允许的 provider slug 集合来自配置文档 `relay.log`，**用户不能借 relay 传任意目标地址**——`TransportChannel` 只接受 `(relaySlug, protocolPath)` 二元组，slug 不在允许集内即 `relay-target-rejected`。这条是「不做开放代理」的可执行形式，同时挡住内网/回环/云元数据地址。
- 路径形态：`{relayBase}/upstream/{relaySlug}/{protocol 的规范路径}`，鉴权是 SaCode 访问凭据（`credentialRef`，沿用 `CredentialStore`，值不落配置文档）。`relayBase` 同样过 §1.1 的 https 校验。
- **信任边界必须显式写在页面上**：走 relay 时，请求内容与上游凭据会经过 SaCode 服务。默认不持久保存用户上游密钥（每次请求现取现用）；UI 在把某供应商切成 `relay` 时给出一次明确提示，不做默认开启。
- 流式与取消：relay 必须原样透传正文、工具调用增量、`usage`、终止序与 `[DONE]`；客户端取消尽力取消上游。 SSE 解析契约按 `core/src/sse.cj` 已实测的形态走，**relay 不得改写帧语义**（改写过的 provider 侧证据见 `docs/evidence/handoff-model-provider-2026-10-04.md` §5）。
- **不盲目重放**：请求已可能送达上游、或已开始吐字时，绝不自动换线路重发；状态不明写 `待核算`（§7）。只有在能确认请求未发出、或供应商提供可靠幂等凭据时，才允许重试，且重试次数不进 `ModelRouter`（路由一次只给一条，重发是 `TransportChannel` 的显式白名单行为）。
- 线路健康与模型健康分开：relay/网络故障记 `channel` 档，不动 `upstream` 计数（§5.1）。
- 加速服务自身的访问授权独立设计，**不要求先建账号体系**：现阶段是一把可撤销的访问凭据；未来接账号时换成账号权益，配置文档结构不变。

---

## 7. 计量、账本与预算

### 7.1 每次上游尝试独立记账

一个目标执行可多次调模型，一次逻辑请求可能在 A 上失败后换 B 成功，所以账本粒度是**上游尝试**，不是「一轮」：

```text
目标 / 会话
  └─ 逻辑请求（logicalRequestId）
       ├─ 上游尝试 A（attemptId）：失败
       └─ 上游尝试 B（attemptId）：成功
```

每条尝试记：`attemptId`、`logicalRequestId`、`session`、`goal`、`turn`、`usageKind`（`chat` / `goal-execution` / `prompt-enhancement` / `connection-test` / `capability-test` / `probe` / `relay`）、`customModelId`、`providerId`、`modelId`、起止时间与耗时、结果分类、输入/输出/缓存读写 token、模态计量（图片张数、音频秒数）、金额与币种、计价版本、`meterSource`（供应商 usage / 本地按价推算 / 用量未知）。

**失败和取消也可能收费**：有 usage 就记；没有 usage 记 `meterSource=unknown`，**不许记成零消费**（这条与 `meter.cj:52` 的 `absent` 语义一致——现有实现已拒绝把「没收到」推断成「没花钱」，账本继承它）。

### 7.2 金额表示

- **固定精度十进制定点**：整数微单位（1 货币单位 = 10^6 微单位）+ ISO 币种码，不做浮点累加。
- 计价按绑定，单位由该上游的 `meterUnit` 决定（token / 张 / 秒 / 请求 / 文档），**不把图像音频折算成 token**。
- 每次结算写入**计价快照**；改价只影响之后的请求，历史账单永不重算。
- 本仓自有的 SHA-256 与账本无关；定点加法全部显式走 `Int64` 并带溢出检查——超出即拒绝结算并标 `待核算`，不允许静默回绕。

### 7.3 预留 / 结算 / 作废

```text
检查预算 → 原子预留本次额度 → 发起请求 → 按实际用量结算 → 释放剩余预留
```

- 预留与结算都在 `usage-ledger.log` 上持 `WriteLease` 落盘，**同机 CLI 与桌面共享同一本账**（跨机器不共享，见 §8）。
- 结算按 `attemptId` **幂等**：同一 attempt 第二次结算返回首次结论、不重复扣费。
- `已用 + 在途预留` 不得突破上限；只看「请求结束后的已用」等于放行并发超支。
- 无法可靠预估成本的请求（`meterUnit=unknown` 或严格预算模式）：**拒绝执行**，或要求用户显式允许按估算预留；不允许默默当零成本发出去。
- 请求状态不明 / 缺 usage → 保留 `待核算` 记录，**不无条件释放为零消费**。
- 供应商关闭或会话被抛弃时，该 attempt 的预留必须显式作废（`void`），否则在途额度会永久占位。

### 7.4 两类预算分权（消除与现有不变量的表面冲突）

`meter.cj` 的「预算只能收紧」是**会话失控闸门**（防单会话跑飞，放宽必须走不到那条路）；目标里的日/月额度是**用户自主配置的配额**。两者是不同的东西，规则不同，都保留：

| 预算 | 落点 | 能不能抬高 | 生效范围 |
| --- | --- | --- | --- |
| 会话失控闸门 | `TokenMeter`（会话日志） | **只能收紧**（现状不变，一字不改） | 当前会话 |
| 模型额度预算 | 自定义模型（日/月 token、日/月金额、单次最大输出、模态单位） | 用户可改，走 `expectedRevision`；每次修改落一条事件 | 本机作用域，从**下一次预留**起生效 |

**修改模型额度永不追溯清零已用额度或历史账单**——这是「不能通过导入配置静默清零账本」的同一条纪律。

### 7.5 余额与统计口径

- 本地累计费用**不冒充供应商余额**。只有供应商提供余额接口、或用户手动登记时，才显示余额，并标来源与更新时间。
- 统计面板分列：模型费用、探测费用、加速费用；再按 `usageKind` 解释开销来源。
- 如实写边界：这一套限制的是**本地可控**的消费，不能保证远端账单绝不超支（供应商可能延迟计量、额外计费、usage 不全）。

---

## 8. 迁移：导出 / 导入

### 8.1 两种包

`MigrationBundle` 产出一个信封，`format: "sacode-migrate/1"`，`kind` 二选一：

| kind | 内容 | 用途 |
| --- | --- | --- |
| `config`（默认） | 供应商（含 `sortOrder/enabled/transport/protocol/baseUrl`）、上游模型与能力与元数据来源、自定义模型与绑定顺序/权重、计价条目与版本、模型额度预算、探测策略、principal 的 `kind`（不含安装 ID 明文） | 备份、复制到另一套环境、跨机迁移后**补填密钥** |
| `secret-bundle` | 上述全部 + 选中供应商的凭据值 | 一次性换机迁移，**必须**用独立迁移口令加密 |

信封头部：`format`、`kind`、`generatedAt`、`schemaVersion`、条目摘要（SHA-256，用仓内现成实现）。

`config` 包**结构上就没有能承载明文的槽位**（继承 `provider_registry.cj:330` 的拒绝清单），不是「写了再擦掉」。

### 8.2 加密形态（按 §1.3 实测的密码学面定，不是按理想选型定）

`secret-bundle` 的凭据段 = **口令派生密钥 + AEAD 封装**，两半分别落在本栈真实存在的东西上：

| 半 | 用什么 | 为什么只能这样 |
| --- | --- | --- |
| AEAD | `stdx.crypto.crypto` 的 **`SM4` + `OperationMode.GCM`**（`aad`/`tagSize`/`ivSize` 在该类上可见），底层是 OpenSSL `EVP_CIPHER_*`（符号里可见 `DYN_EVP_CIPHER_fetch`/`DYN_EVP_CIPHER_CTX_ctrl`） | 全栈 **0 处 AES**；`std.crypto.cipher` 只有 `BlockCipher` 接口。SM4-GCM 是本栈唯一由真实密码库提供的 AEAD |
| 口令派生 | 自建 **PBKDF2-HMAC-SHA256**，构建在 `stdx.crypto.digest` 的 `HMAC(key, SHA256)` 之上；迭代次数与盐长度写进信封头部，**不低于 600k** | 全栈 **0 处 KDF**（无 PBKDF2/scrypt/HKDF）。不派生就直接用口令当密钥是硬伤，所以这一层必须有 |
| 随机材料 | `stdx.crypto.crypto.SecureRandom`（`priv` 私有随机字节）出盐与 IV | 不用时钟或进程内计数器凑随机 |
| 密钥长度 | PBKDF2 输出取前 128 位作 SM4 密钥（SM4 分组与密钥均 128 位） | 算法规格所限，如实写明是 **128 位安全强度**，不宣称 AES-256 等级 |

派生纪律：

- **PBKDF2 只允许构建在已 vetted 的 HMAC 之上**，且必须用 **RFC 6070 的 PBKDF2-HMAC-SHA256 向量**钉住（`c=1/2/4096/16777216`、`dkLen=1/2/8/32/40`、含 `passwordPASSWORDpassword` 与 `pass\000word` 的 NUL 截断用例）。这是自建派生唯一可接受的证明方式；**不允许**手写分组密码或哈希混淆冒充加密。
- 每条凭据条目独立盐与 IV，认证标签逐条存；密文被改动一位即解密失败（GCM 标签），**不得降级为「忽略校验继续导入」**。
- `aad` 绑住信封头（`format`/`kind`/`schemaVersion`/条目摘要），防止把头换成 `config` 或换条目数后仍校验通过。
- 口令不落盘、不进日志、不进记忆；派生与解包只在需要时发生。
- **信封头部必须显式记录算法标识**（`cipher: "SM4-GCM"`、`kdf: "PBKDF2-HMAC-SHA256"`、迭代次数、盐/IV/标签长度）。这样将来 SDK 出现 AES 或真实 KDF 时可以换档，而旧包仍按头部自描述可解——算法敏捷性写进格式，不靠记忆。
- **被否决的替代**：借 `npm/dsh-cli/bin/cli.js` 的 Node 侧 `crypto`（有 AES-256-GCM 与 scrypt）来做封装。否决理由：那会让 CLI 与桌面各用一套加解密实现，直接违反「桌面、CLI 与安装包规则一致」，而迁移包恰恰是跨入口的产物。
- 若 B0 探针证明 `SM4` 的 GCM 构造在本机跑不通（`cjpm` 链接、OpenSSL 版本或 `tagSize` 语义与符号所见不符）：**`secret-bundle` 记 BLOCKED**，写清卡在哪一步、解锁条件是什么，`config` 包照常可用。**不允许**因此取消密钥迁移需求，也不允许用弱替代蒙过去。

### 8.3 导入流程与不变量

```text
选文件 → 校验 format/schema/摘要 → 计算差异 → 用户选合并或替换 → 原子落盘
```

差异预览按**稳定 ID** 对齐，不按名称：

- 同名不同 ID 视为两个不同条目，**不自动合并**；
- 重复导入同一个包不产生重复供应商、重复上游模型、重复绑定（幂等，按 `(providerId, modelId)` 与绑定唯一键）；
- 跨环境时凭据引用重新映射；`config` 包导入后若本机没有对应凭据，条目显示「待绑定凭证」，其路由**不可调度**；
- 覆盖已存在的密钥需要**单独确认**，导入配置永不静默换密钥；
- 导入文件里的归属信息**不能**变成授权依据（本机 principal 由本机决定，不认包里的 owner 声明）；
- 导入走与在线编辑相同的校验与拒绝分诊（协议闭集、https 校验、能力适配、重复绑定）——包不能绕过写面校验。

### 8.4 明确不属于配置迁移的东西

`usage-ledger.log`（账本）、已用额度、在途预留、`route-health.log`（熔断/冷却状态）、`待核算` 记录都**不进** `config`/`secret-bundle`。整套服务搬迁走独立的「数据目录备份恢复」流程，本设计只提供文档级迁移，并如实说明它不恢复运行数据。

### 8.5 交付形态（依赖实测后收敛）

`stdx.crypto.*` **已经在交付产物里**：`scripts/pack-cli.mjs:99-105` 拷 `STDX` 下全部 `libstdx*.dll`（只排除 unittest 与宏），`scripts/pack-host.mjs:18-22` 把传入 DLL 目录里的 `*.dll` 全量拷进 `bin/`；而 `libcrypto-3-x64.dll` 本来就因 TLS 随包（§1.3）。
→ **加密迁移不新增任何分发依赖**，也就没有「为了少拉依赖把它单独关进一个可执行文件」的理由。

因此实现落在 **`core`（`MigrationBundle`）一处**：桌面走宿主动词 `migrate/*`，CLI 走 `dsh migrate export|import`，两者调的是同一段代码——迁移包的格式与算法只能有一份真相。加密不可用（B0 判 BLOCKED 或运行期缺库）时 **fail-loud**，UI 与 CLI 直接显示卡点，不提供「先导出来再说」的路径。

链接侧也已核：`core/cjpm.toml` 与 `apps/host/cjpm.toml` 用 `[target.x86_64-w64-mingw32.bin-dependencies] path-option` 指向**整个** `stdx/.../dynamic/stdx` 目录（现在这样解析 `stdx.encoding.json` 与 `stdx.net.http`），**不存在「按模块逐个声明」这道额外配置**——引入 `stdx.crypto.crypto` 不改构建配置。仍要 B0 编译实证一次（该目录里有 `libstdx.crypto.crypto.dll` 与 `libstdx.crypto.keysFFI.dll.a`，但 `.dll.a` 是否覆盖 crypto/kit 全部导入符号没核到底）。换机器时这条 path-option 仍是硬编码本机路径（AGENTS 已知项），迁移功能不新增这个约束，但也不替它解。

---

## 9. 协议面与双入口一致性

### 9.1 宿主新增动词（有限集合，不提供「发任意方法」通道）

| 组 | 动词 |
| --- | --- |
| 自定义模型 | `custom/describe`、`custom/upsert`、`custom/remove`、`custom/reorder`、`binding/upsert`、`binding/remove`、`binding/reorder` |
| 发现与导入 | `model/pull`（拉取并回候选，**不自动启用、不自动加入调度**）、`model/upstream/upsert`（**手动添加上游模型**：有些供应商没有列表接口或返回不全，拉取通道不能替代它）、`custom/import/new`（每个选中上游各建一个自定义模型，初始单绑定）、`custom/import/into`（加入已有自定义模型，先过能力/协议适配与重复绑定校验） |
| 健康 | `route/health/describe`、`route/probe/run`（手动探测，也走同一把租约与预算） |
| 计量 | `ledger/describe`、`budget/describe`、`budget/set` |
| 加速 | `relay/describe`、`relay/set`、`relay/test` |
| 迁移 | `migrate/export`、`migrate/import/plan`、`migrate/import/apply` |

写侧一律带 `expectedRevision`；读侧一律不带任何能承载明文的字段。**`initialize.capabilities` 必须同步声明新方法**（这条已经踩过：能力声明与实现不一致，见 `docs/evidence/handoff-model-provider-2026-10-04.md` §6 末行）。

### 9.2 桌面 IPC

基线实测（本批直读 `apps/desktop/preload.cjs`）：当前暴露 **32 条通道**——
`projection,userSend,attachmentUpload,toolsList,toolCall,approvalAsk,approvalAnswer,turnStart,taskStart,queueDescribe,queueEnqueue,queueUpdate,turnPoll,turnCancel,usageStatus,usageSetBudget,appearanceGet,globalAppearanceGet,globalAppearanceSetTheme,globalAppearanceSetFontSize,sessionCatalog,sessionCreate,sessionSelect,workspaceGet,workspaceChoose,appearanceSetTheme,modelsDescribe,modelsCatalog,modelsSave,modelsRemove,modelsSetDefault,modelsList`（按 `preload.cjs` 里的出现顺序原样列出），`apps/desktop/test/bridge.test.mjs` 现有 **41** 条 `test()`。

> **注意一处文档漂移**：`AGENTS.md` 仍写着 IPC 面是「按动作命名」的那 9 条集合，与代码差 23 条。**不要以那份清单为准**，改通道前先以 `preload.cjs` 与 `bridge.test.mjs` 的实际形态为基线；AGENTS.md 那句要么按实测更正，要么改成「以 preload.cjs 为准」。

本设计新增通道按同一命名风格补齐（自定义模型 CRUD 与绑定、健康查看、额度预算、加速设置、迁移导出/导入的 plan/apply 两段），仍守两条既有纪律：**逐字段校验**、**不提供「发任意方法」通道**；增删通道必须同步改 `preload.cjs` 与 `bridge.test.mjs`（AGENTS 硬要求），且渲染层不得拼出「路由决策」或「金额累加」——它只显示核心回的数字。

### 9.3 三个入口跑同一套规则的证据

- `core`：`cd core && cjpm test`（新模块各自 `*_test.cj`）。
- `apps/cli`：新增自检模式 `modelcenter`（沿用 `main` 按子命令跑断言的形态），断言过滤链、轮询/权重序列、三次失败转冷却、预留幂等。
- 桌面：`node --test`（含走宿主可执行文件的用例）+ `npm run ui-smoke`。
- **打包态复验**：模型中心改动必须重打宿主再跑一次桌面冒烟，不能只认开发态绿（这条线上一批踩过旧宿主假绿）。

---

## 10. 落地顺序（不拆散最终需求）

| 批次 | 内容 | 出口判据 |
| --- | --- | --- |
| **B0 可行性探针**（半天级） | ① `SM4(OperationMode.GCM, key, iv, ...)` 的真实构造形态与 `aad`/`tagSize` 语义：编译 + 一次加解密回环 + 改一字节必失败；② `stdx.crypto.digest.HMAC(key, SHA256)` 流式接口形态，用它把 **RFC 6070 向量**跑通（PBKDF2 的前置）；③ 时钟注入在冷却/探测计时上的形状；④ relay 转发 SSE 与 usage 透传的手工探针 | 四条各有实测结论；①② 任一不通则 `secret-bundle` 立刻按 BLOCKED 建档并写清卡点，不拖到 B5 |
| **B1 模型目录** | 供应商新字段、上游模型能力面、`CustomModelRegistry`、拉取/手动添加、两种导入操作、能力适配校验 | 目录 CRUD + 重复拉取不重复导入 + 能力不适配保存即拒，均绿 |
| **B2 调度闭环** | `ModelRouter`（过滤链 + 轮询 + 平滑加权）、供应商开关语义、`RouteHealth` 三档作用域与失败分类、冷却 + 低频探测 + 试恢复、跨进程探测租约 | 目标里的每一条自动化验收绿（§11） |
| **B3 计量与预算** | `UsageLedger`（尝试粒度、定点金额、计价快照、预留/结算/作废、待核算）、`budget/*` 动词、统计查询面 | 并发不重复预留/结算；改价不重算历史；取消有 usage 照记 |
| **B4 加速通道** | `TransportChannel` 的 `direct`/`relay`、slug 允许集、流式与取消透传、线路健康与模型健康分档 | relay 下真实模型跑通一条端到端，且线路故障不动模型失败计数 |
| **B5 迁移** | `config` 包与 `secret-bundle`、差异预览、合并/替换、CLI 子命令与桌面接线 | 本机导出 → 干净目录导入 → 路由可用；`config` 包字节级扫不到任何密钥 |
| **B6 面板** | 费用/用量统计、健康展示、探测记录展示 | 展示数字全部来自核心读面，无本地二次计算 |

每批都按现有流程红先、变异反证、双入口复验；**批次顺序不等于范围裁剪**，B6 完成才谈得上「模型中心达成」。

实现计划按批出：本设计先出 B0+B1 的实现计划（B0 的三条结论决定 B5 是否 BLOCKED，必须最先跑），B2 及之后各批在本表出口判据下逐批另出计划，不因后批未排而从前批里删需求。

---

## 11. 验收表（可证伪断言）

| # | 断言 | 反证方式 |
| --- | --- | --- |
| 1 | 重复拉取同一供应商两次，上游模型与绑定条数不增 | 把去重改成追加，指定用例转红 |
| 2 | 拉取失败（坏响应）不写目录、不报「0 个模型」 | 让异常吞成空清单，指定用例转红 |
| 3 | 能力不满足请求的路由**永远不进候选**（含 `unknown`） | 把 `unknown` 当满足，指定用例转红 |
| 4 | 供应商 `enabled=false` 后，配置仍存在的绑定不可调度 | 过滤链里删掉该判据，指定用例转红 |
| 5 | 第 3 次有效失败 → 转 `cooling` 且 `notBefore` 非空；重启进程后状态仍在 | 把计数改成 4，或把状态改成进程内存 |
| 6 | 额度类失败升档 `route-set`：同凭证另一模型也不被调度 | 把作用域固定为 `upstream`，指定用例转红 |
| 7 | 供应商给了 `Retry-After` 时 `notBefore` 取该值；没给才走阶梯 | 忽略证据恒用阶梯 |
| 8 | 用户取消不计入失败，但已收 usage 入账 | 取消计入失败 / 取消抹掉 usage，两条各转红 |
| 9 | 401/403 不消耗三次机会，且不入定时探测队列 | 当成普通失败累加 |
| 10 | 平滑加权轮询在 1000 次选择后的分布逼近权重比（给定容差）；轮询顺序确定可重放 | 换成随机或纯顺序 |
| 11 | 探测租约互斥：两个进程同探同一作用域只发一次请求 | 去掉租约 |
| 12 | 试恢复只放行一条；该条失败则回冷却并抬档 | 成功即永久置 available |
| 13 | 并发两笔预留不突破上限；同一 attempt 重复结算不重复扣费 | 去掉原子预留 / 结算不去重 |
| 14 | 缺 usage 记 `meterSource=unknown`，不记零 | 把 unknown 归零 |
| 15 | 改绑定的价格后，历史 attempt 金额逐字不变 | 结算时按当前价重算 |
| 16 | 定点金额：`0.1 + 0.2` 形态的累加精确；溢出即拒不清零 | 换 `Double` 累加，指定用例转红 |
| 17 | `config` 包全文（含日志与错误串）扫不到任何凭据值字节 | 让 `describe()` 顺带回值 |
| 18 | 导入只按稳定 ID 对齐：同名不同 ID 不合并 | 改成按名称合并 |
| 19 | 导入 `config` 包后凭据缺失的路由显示待绑定且不可调度 | 缺凭据仍发请求 |
| 20 | 导入/改预算都不清零账本与冷却状态 | 导入时重建文档 |
| 21 | relay 拒绝不在允许集内的目标（含内网/回环/元数据地址） | 允许任意 target |
| 22 | relay 线路故障不增加 `upstream` 失败计数 | 混记 |
| 23 | relay 下正文/工具增量/usage/终止序逐帧透传，不被改写 | 网关侧聚合改写 |
| 24 | 已送达或已开始输出的请求不被自动重放 | 默认盲目重放 |
| 25 | CLI `modelcenter`、桌面 `node --test`、打包态冒烟对同一夹具给出同一决策序列 | 桌面走本地简化的选路分支 |
| 26 | PBKDF2-HMAC-SHA256 逐条命中 RFC 6070 向量（含 `c=4096`、`dkLen=32`、NUL 截断那条） | 少一轮迭代或 salt 拼接错位 |
| 27 | SM4-GCM 加解密回环等价；密文或头部改一字节 → 解密必失败，**不产出明文** | 忽略认证标签继续解 |
| 28 | `aad` 绑头部：把头里 `kind` 从 `secret-bundle` 改成 `config` 后解密失败 | `aad` 留空 |
| 29 | 错误口令只报「口令不对/解不开」，不回吐任何部分明文，也不落口令 | 失败路径把已解出的片段写进日志 |
| 30 | 信封头显式记录 `cipher`/`kdf`/迭代数/各长度；未知算法标识直接拒 | 按当前实现硬猜旧包参数 |

### 11.1 最终验收闭环的对位

| 闭环步骤 | 承担批次 | 断言编号 |
| --- | --- | --- |
| 配置供应商 | B1 | 4、17 |
| 创建自定义模型 | B1 | 1、2、3 |
| 发起真实任务 | B2（+B4 走加速时） | 3、10、21、23、24 |
| 查看结果与费用 | B3 / B6 | 8、14、15、16 |
| 故障后自动恢复 | B2 | 5、6、7、11、12 |
| 安全导出 | B5 | 17、26、27、28、30 |
| 新机器导入并继续使用 | B5 | 18、19、20、29 |
| 三入口规则一致 | 每批 | 25 |

目标原文里「第三次有效失败触发**当天熔断**，重启不清零，**次日恢复**」这条已被目标 §2 的表述取代为「退出正常调度 + 冷却 + 低频探测」（避免五小时额度恢复后仍被锁到第二天）；保留的不变部分是**跨重启不清零**（断言 5）与**换自定义模型不能绕过暂停**（断言 6）。

约定：以上每条都要**指名用例落库**，`cjpm test` 读数走剥转义后的 Summary 五计数；`TOTAL: 0` 或过滤器空匹配一律按 FAIL，不当通过。计时敏感用例（冷却、退避、探测）用注入时钟，且**独占跑**，不与并发构建抢时序窗口。

---

## 12. 明确不做

- 不建账号、不做云同步、不做多机共享预算（只留 §2.4 的 principal 缝）；
- 不做「客户端可指定任意上游地址」的开放代理；
- 不做跨区域自动重试/切线路后重发；
- 不宣称像素级复刻上游界面，只验收功能等价 + 安全；
- 不把图像/音频/视频折算成 token 统一计价；
- 不把本地累计费用展示成供应商余额；
- 不因引入 relay 而把模型调度规则搬到服务端第二份实现。

---

## 13. 风险与待运行验证

| 风险 | 处置 |
| --- | --- |
| 本栈只有 SM4-GCM、没有 AES 也没有 KDF；自建 PBKDF2 是必需而非可选 | §1.3 已把符号面钉死；B0 先跑 RFC 6070 向量再谈封装。**对外表述只写 128 位安全强度，不写成 AES-256**；SDK 将来提供 AES 或真实 KDF 时按信封头的算法标识换档，旧包仍可自描述解出 |
| `SM4` 构造形态只有符号证据、没有运行证据 | B0 第①条：编译 + 回环 + 改一字节必失败；不通即 `secret-bundle` BLOCKED，`config` 包不受影响 |
| relay 需要真实服务端才存在，本地只能桩验证 | B0/B4 用受控桩证传输契约（含帧透传与取消），真实网关接入单独记「待运行验证」，不写成已达成 |
| 供应商的额度重置时刻与限流语义各家不同 | 只采信供应商明确证据；无证据走阶梯并在页面标「恢复时刻为估算」 |
| 账本与文档共用目录的写竞争 | 全部经 `WriteLease`；`bridge.test.mjs` 在仓库根用 `dualtest/`，异常残留先 `rm -rf dualtest` |
| 宿主产物过期导致的假绿 | 每批模型中心改动后重打宿主再跑桌面用例，并核 exe 的 mtime |
| 并发会话同仓改源码 | 本设计只新增一份文档，落地时逐文件精确暂存，不吞他人改动 |
