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
| 会话级 token 计量：账从会话日志重算、超档那笔不计入、预算只能收紧 | `core/src/meter.cj:7`（`:62` 收紧、`:52` 结算） | 这是**失控闸门**，不是模型额度；两者在 §7 明确分权。**但目标 §4「失败与取消有 usage 就记账、没 usage 不冒充零消费」这两句现有实现已经满足**：`settleTurn`（`:52`）的注释与代码就是「收到 usage 就记，取消不能抹掉已收到的用量」「尚未收到 usage 且没有 finish 时只报 `absent`，不推断为零」——账本**继承**它，不另建一套 |
| 请求装配：标准消息与工具结果全部从会话日志重建 | `core/src/model_request.cj:7` | 调度器插在装配之前，不改变装配的纯函数性质 |
| 真实请求的装配点，以及**每步续跑的工厂缝** | `core/src/model_agent.cj:105` 的 `start(first: Provider, nextProvider: (String) -> Provider, …)`，与 `:91` 每步都调 `nextProvider(...)`；宿主侧装配在 `apps/host/src/main.cj` 的 `let real = DeferredProvider({ => RealSseProvider(baseUrl, turnKey, reqBody, tk) }, tk)` 与其下一行的 `let continuation: (String) -> Provider`（**该文件不写行号，见 §4.1 的锚点纪律**） | **调度器的插入点已经存在、形状也对**：每步一个工厂。要改的是宿主传进去的那个工厂，不是 `core` 的签名（见 §4.1） |

### 1.2 确认是空白（不是推断，是 0 命中）

| 缺口 | 取证方式 | 结论 |
| --- | --- | --- |
| 价格 / 金额 / 币种 / 十进制定点 | `core/src` 全量 grep `price\|cost\|currency\|Decimal\|pricing` | **0 命中**，金额账本完全未实现 |
| 熔断 / 健康 / 冷却 / 重试 / 故障转移 | `core/src` 全量 grep `circuit\|breaker\|health\|failover\|cooldown\|Retry-After\|retry\|fallback` | 只有无关命中（`SessionWorkspace.fallback`、标题 fallback），**调度期故障处理为 0** |
| 轮询 / 加权选择 / 能力过滤 | 同上 | 未实现；当前只有 `setDefault` 单指针（`provider_registry.cj:296`） |
| 自定义模型（多上游绑定 + 权重 + 预算） | 无对应文档面 | 未实现 |
| 配置导出 / 导入 / 迁移包 | 无对应模块 | 未实现 |
| 加速通道 | 无 | 未实现 |
| 供应商**实例池**（同一供应商加多份、组号池轮询） | 直读 `provider_registry.cj` 的 `addFromCatalog`（`find(id).id.size > 0` 即抛 `settings-rejected`）、`saCodeCatalog`（实测**只有 1 条**）、`updateObject`（对 `declared` 条目一律拒）；`core/src` 再 grep 词 `pool`、`slot`、`instanceCount` | **不是「没做」而是「主动拒绝」**：目录路径加不出第二份同品牌实例。自由写面 `updateObject` 倒是能落任意 `id`（`find` 未命中回 `declared` 为 `false`），但核心里没有实例语义、页面没有入口、也没有任何验收断言——池只能靠手改日志，不算用户可用能力。**同批还实测到渲染层的第二道闸**：`models-page.ts:166` 的提供商下拉写作 `catalog.value.filter(p => !providers.value.some(v => v.id === p.id))`，即**已添加过的目录项直接从选项里消失**——只修核心不修这行，用户在下拉里根本选不到第二份 |

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

4. **B0 运行期探针的修正（2026-10-05 实测，见 §15）**：上面第 3 条是**符号面**证据，运行期并不全部成立——`SM4` 的 `CBC`/`CTR` 能构造、能加密、能逐字节回环，但 **`OperationMode.GCM` 在四种参数组合下一律抛 `Encrypt failed due to create tag error.`**，且把 OpenSSL 3.5.4 的 `libcrypto-3-x64.dll` 钉进 exe 同目录（DLL 搜索序第一位）后仍复现。
   → 所以「本栈有可用的 AEAD」这句**只在符号层成立、运行层不成立**；`secret-bundle` 改用 §8.2 的 **SM4-CTR + HMAC-SHA256 encrypt-then-MAC** 组合，两个原语都已在本机跑通并被外部实现逐字节对照过。**不是降级**：ETM 是认证的加密构造，完整性失败即拒绝解包。

---

## 2. 三层数据模型

### 2.1 第 1 层：供应商（扩展现有 `ProviderRecord`）

现有字段 `id/name/baseUrl/protocol/credentialRef/declared/models[]` 全部保留，新增：

| 新字段 | 语义 | 约束 |
| --- | --- | --- |
| `sortOrder` | 列表展示顺序，同时是新增绑定的默认顺序 | 整数，允许空洞（拖动只改这一列，**不改任何自定义模型的调度序**） |
| `enabled` | 全局硬开关 | 缺省 `true`；关断后所有绑定不可调度 |
| `transport` | `direct` \| `relay` | 见 §6 |

**第 1 层的唯一键是「实例」，不是「品牌」**（2026-10-05 用户澄清补写的硬口径：同一供应商要能加多份，用来组号池轮询；现状是 §1.2 最后一行的「主动拒绝第二份」，B1 要改掉）：

- 同一 `baseUrl`、同一协议**允许存在 N 份实例**，各带各的 `credentialRef`。这就是「号池」的存储形态：`deepseek-a` 与 `deepseek-b` 是两个账号或两把密钥，自定义模型把两份都绑进 `bindings[]`，§4 的轮询与平滑加权在**实例之间**轮转——池不需要新机制，它是 §2.3 绑定 + §4 选择的直接推论。
- 自带目录 `CatalogEntry` 只是**模板来源**（地址、协议、初始模型列表），落库时转成一份**新实例**并分配实例 id；目录 id **不参与唯一性**，同一条目录项可以添加多次。现状 `addFromCatalog` 里那句「已存在即 `settings-rejected`」要换成「按目录项新建一份实例」的语义。
- `credentialRef` 继续由 `deriveCredentialRef(实例 id)` 派生（形如 `SA_CODE_<实例 id>_API_KEY`）——实例 id 不同则天然不同名。**不许**改成按品牌或显示名派生：那会让两份实例解析到同一个环境变量名，后配的密钥静默顶掉先配的，比直接拒绝更坏。
- `name` 只是显示名，**不做唯一键**；列表里同品牌多份时必须可辨（默认在显示名后带实例后缀，用户可改）。
- **可达性也属于这条口径**：号池要两道门都开——核心允许建第二份（上面几条），渲染层还得**选得到**第二份。现状 `models-page.ts:166` 把已添加过的目录项从下拉里滤掉，于是「加过就选不到」；B1 与核心同批改掉（见 §9.2 与断言 60）。只改核心的话，从用户视角看需求仍然没闭。
- 写面必须区分「新建实例」与「按 id 修改已有实例」：新建撞已有 id 一律**显式拒绝**，绝不落进 `provider/upsert` 的替换分支——`reload()` 是 `entries[i].id == rec.id` 就整条替换，一次误覆盖会把第一份实例的 `credentialRef` 与模型列表一起换掉，而旧密钥仍留在 `credentials.env` 里，形成「盘上指向 B、实际还在用 A」的暗账。
- 每份实例各有 `enabled` 与 `sortOrder`；关断一份不影响同池其它份。费用天然按实例归因（§7.1 每次上游尝试独立记账，账本条目本就带 `providerId`），号池不需要新的记账维度。
- **接口名归规格所有**：`public func addInstanceFromCatalog(catalogId: String, credentialRef: String): Unit`（核心公开写面；现有 `addFromCatalog` 降为它的薄封装）。新建实例的 id **从 `describe()` 视图读回，不作返回值**——宿主动词的响应体本来统一是供应商视图，加一条返回值等于给同一个事实造第二份来源。这条名字写进规格而不是只留在计划里，因为 B5 的迁移导入也要建实例，跨批次只能有一份命名真源。

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
| 绑定 | `bindings[]`：`providerId` + `modelId` + `enabled` + `order` + `weight` + **四档费率条目**（输入 / 输出 / 缓存读 / 缓存写，各 `-1`＝未登记，见 §7.1 计量输入三段与断言 76）+ 计价版本 |
| 参数 | `defaultParams`（温度、最大输出等） |
| 预算 | `dailyTokens` / `monthlyTokens` / `dailyAmount` / `monthlyAmount` / `currency` / `maxOutputTokens` / 模态单位预算 |
| 探测 | `probe.enabled`、`probe.maxPerDay`（策略默认值见 §5.3） |
| 调度 | `mode`: `round-robin` \| `weighted`（默认 `weighted`，即平滑加权轮询） |

规则：

- **计价属于每条绑定**，一个自定义模型只有一个 `currency`；跨币种的绑定要么显式登记换算并记快照，要么拒绝保存——不允许用统一单价把金额算错。
- 同一 `(providerId, modelId)` 在一个自定义模型里**不得重复绑定**（沿用 `parseModels` 的去重纪律，`provider_registry.cj:388`）。
- 这条去重的键是**实例**，不是品牌：`deepseek-a` 与 `deepseek-b` 是两个 `providerId`，同一 `modelId` 各绑一次是**号池的正确形态**，不许被这条规则误伤成「一个模型只能绑一份」。反过来，把两条绑定写成同一个 `providerId` 才是重复。
- 能力不适配的绑定**保存即拒**（`settings-rejected`），例如生图模型不能绑进 `requires=[tools, text-output]` 的编程模型。
- 供应商删除后，指向它的绑定转为 `dangling`，显示「供应商已关闭/已删除」，配置保留但不参与调度。
- **日常任务的选择面只列自定义模型**（桌面下拉与 CLI 的模型参数同一份读面）；供应商、`baseUrl`、凭据、价格都不出现在任务输入路径上——这是「用户只需定义自己的模型，不必反复选供应商、不必填密钥」的可执行形式。

**这条上面那句是目标，不是现状。现状通路本批直读源码实测（2026-10-05），今天选模型靠的是「两层默认指针」，五段都要动，规格此前一段没列**：

| 段 | 现状 | 实测位置 |
| --- | --- | --- |
| ① 核心视图字段 | 一颗指针 = `(defaultProviderId, defaultModel)` 两个字段，随视图 JSON 出 | `core/src/provider_registry.cj:114-126` |
| ② 写侧签名 | `setDefault(providerId, model, expectedRevision)` | 同文件 `:296`，动词 `model/registry/set-default` |
| ③ 任务取模型 | `turn/start` 与 `task/start` **各有一处**循环，按 `p.id == registryView.defaultProviderId && registryView.defaultModel.size > 0` 从命中的 provider 记录里取 `baseUrl`/`credentialRef`/`protocol`，再在该 provider 的 `models[]` 里按 `entry.id == defaultModel` 取 `image` 能力 | `apps/host/src/main.cj:1155` 与 `:1364`（`grep -c registryView.defaultProviderId` = **2**） |
| ④ 通道载荷 | `modelsSetDefault(provider, model, revision)` 三个位置参数 | `apps/desktop/preload.cjs`，调用点 `apps/desktop/renderer/app.js:707` |
| ⑤ 渲染层类型 | `Selection {provider, model, reasoningEffort?}`；面板三层 `root / model / effort`，选中即写第 ④ 段 | `apps/desktop/renderer/pages/model-select.ts`（`Snapshot` 里另有持久化的 `retainedEffort`） |

由此得出三条以前没写的结论：

1. **第 3 层是「文档面」还是「决策输入」取决于⑤→③这条链**。只把自定义模型建出来（B1 的全部范围）而不收这五段，`turn/start` 读的仍是两层指针，第 3 层永远不参与决策——断言 44 的「唯一读面」会在生产通路上落空，尽管所有文档面用例都绿。这五段随 **B2** 收（§10）。
2. **推理等级是第二份参数真源**。目标 §1 把生成参数归自定义模型，而现状 `model-select.ts` 把 `reasoningEffort` 写进指针、还持久 `retainedEffort`。归属未定就是两个真源，见 §16.2 第 13 行。
3. **`-32016` 已经一码四义**：同一宿主文件里 **7 处** `-32016` 分别承载 `protocol-not-supported:${planProtocol}`（2 处）、`model-not-configured`（2 处）、`model-credential-unavailable`（2 处）和一处 `e.message` 兜底。这与 §5.2 那条「非状态码一律塌成 `http-request-error`」是同型缺陷，且直接挡掉 §9.2 要求的「把 `settings-rejected` 子因映射成人话」。
- **整条记录的落盘形态在 B1 一次定死，消费分批**（目标 §1「配置上游绑定、顺序、权重、生成参数及预算」的落地口径）。核查时发现的矛盾是：§2.3 上面这张表列了「参数 `defaultParams`」「预算 `dailyTokens`…」「探测 `probe.*`」三组，但 B1 的 `CustomModelRecord` 只落 身份/能力/绑定/调度 四组——参数与预算和探测**没有存储落点**，而 §7.4 的预算修改明明要求「每次修改落一条事件」。字段晚加一个，事件日志就多一条历史盘兼容分支（B2 要读 `probe.maxPerDay` 时读不到、B3 要按 `budget` 预留时同样落空）。定：**B1 存、B2 用探测、B3 用预算**，B1 只负责字段回放与取值校验（非负、上限缺省），不做判定语义。
  - `defaultParams` 存**原文 JSON 文本**（带长度上限，且过 §1.1 `provider_registry.cj:330` 那套明文字段拒绝），**不拆成固定字段**：三种协议的参数名形态本就不同（`temperature`/`top_p`/`max_tokens` 各家叫法不一致），核心不发明上游没有的字段；装配请求时由 `ProtocolAdapter`（§4.1）按协议取用。这条不是偷懒——把参数拍平成固定列，等于宣称「我们已知道所有协议的参数表」，而 §4.1 缺陷 B 刚承认其中两种协议还没实现。
  - 预算与探测字段用可缺省的 `Int64`/`Bool`：缺省 = 不设该维度上限（**不是设 0**，0 会被 §4 的预算过滤读成「立刻耗尽」），页面按「未设置」显示。

### 2.4 数据归属：本地身份（为账号体系留的缝）

新增 `Principal`（`core/src/principal.cj`）：落一个**安装 ID** 在用户设置目录，字段只有 `kind: "local"` 与 `installationId`。**现状如实**：本批直读实测 `core/src` 里 `Principal` **0 命中**，这个类是 B1 Task 3 新建，不是已有件——所以「无需账号」这条在 §16.1 里标 `本轮补齐`（断言 63）而不是「已覆盖」。

所有新文档（`custom-models.log`、`route-health.log`、`usage-ledger.log`、`relay.log`）的写入都必须带当前 principal；调度与账本查询都以 principal 为作用域。

**这条与 §5「导入后继续使用」是一对对偶，只能同时成立一个方向才算漏**：既然查询按 principal 过滤，那么**导入落盘的事件必须由本机 principal 在写侧盖**，包里的任何归属字段都不参与作用域键。否则源机器的戳记跟着包过来，本机就把它判成「别人的条目」而按 §2.4 的隔离机制**如实隐藏**——文档面 grep 得到、`ModelRouter` 拿不到，且没有任何一条断言会因此变红。落盘走与在线编辑相同的写面（§8.3 末条已规定「包不能绕过写面校验」），戳记同样是本机盖的这一事实，本轮第一次被写成断言（77、78），以前只是 §8.3 的一句描述话。

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
| `TransportChannel`（新，薄） | 把一次 provider 请求按 `direct`/`relay` 送出去；只决定「走哪条线」，并**产出 §5.2 的结构化失败对象**（含白名单响应头） | `stdx.net.http` | **不选模型、不改预算、不重试已可能送达的请求** |
| 桌面渲染层 | 呈现与交互 | 有限 IPC | 不调度、不记账、不缓存路由决策 |

不变量：**桌面和 CLI 都只能通过同一组仓颉 API 得到决策**，渲染层与宿主脚本里不允许出现「我自己挑一个 provider」的通路。

### 3.1 装配口径：模型中心是**内置插件**——不是硬编码特判，也不是市场安装项（2026-10-05 用户明确）

产品口径是「一切皆插件」（`docs/product/PRD.md` §5「一切皆插件」与验收项 A12；证据 `docs/evidence/plugin-lifetime-architecture-2026-10-05.md`），用户同时明确**模型中心属于内置功能**。这两句在 PRD 原文里本就接得上——§5 写的是「**默认产品由已装配的内置插件构成**，用户无需先去市场寻找必需能力」。所以本设计的落点收成一句：

> **内置的是规则，可插的是提供方实现。** 三层文档面、调度、健康、预算、迁移、本地身份是内置规则，随产品构建、零市场 / 零账号 / 零注册即可用；而「某一家上游具体怎么说话」（协议适配、清单发现、外部 JS/TS 或 MCP 承接）是插件位。

两种误读都要挡住，各自都给了反证：

| 误读 | 为什么不行（引原文） | 本设计里的反证 |
| --- | --- | --- |
| 「内置」= 可以按硬编码特判做 | A12：「固定硬编码能力或仅工具回调**不得判通过**」；§5：「现有固定分派、自定义工具回调、状态 marker 和直接挂载页面**不构成完整插件架构证明**」 | 断言 65（新增协议不散改决策层）+ 断言 66（能力清单只有一份，且双向核） |
| 「一切皆插件」= 扩展可以自己发模型请求；或反过来「内置」= 第三方接不进来 | §5 把「模型提供方」明确列入插件契约组合的对象，但同一句要求「动态扩展通路也必须保持身份、参数及权限校验」 | 断言 68（外部提供方只能经注册表 + 账本 + 健康视图，不得自开 HTTP、自写凭据、绕开 `reserve`/`settle`） |

**与现状的诚实差距（不假装已达成）**：通用装配契约 `Loader`/`Scope`/`Service`/`effect` 当前只有 ◐（矩阵 `core`、`extensions` 两行的本轮裁决；那份证据的结尾把「上游 Loader/Scope/Service/effect 的仓颉共享装配契约」列为下一接入前提）。因此 B1–B6 **不新建一份私有 Loader**——那会变成第二套装配机制，正是这条口径要避免的东西；改为要求模型中心从第一天起就长成**将来可原样登记进装配契约的形状**：

- 规则只住在 §3 表格里列出的那些单元里，不渗进 agent loop、宿主方法分派与页面主干（§4.1 的插入点结论与此同向：改的是宿主传进去的那个工厂，不是 `core` 的签名）；
- **每个供应商实例即一个作用域**，作用域键就是 §2.1 的 `credentialRef`，与 §5.1 的 `route-set` 同键——**不新增一套作用域概念**。停用/删除实例按 PRD 的生命期口径「停止接纳调用、结算在途工作、撤销所属贡献」落地，实现上就是 §5.1 已有的作用域失效 + §7.3 的作废，不是新机制；
- 协议是**数据 + 适配单元**而不是 `switch`：§1.3 缺陷 B 现在的形态正是「`protocol` 存下但从不生效」，断言 35 守住「不盲发」，断言 65 守住「加协议不散改调度/账本/健康/分派」。

功能性的多协议实现（`openai-responses`、`anthropic-messages` 适配器）仍按 §16.1 登记为「部分」逐批后补；把形状钉住**不等于**宣称已支持。

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

确定性合同：给定同一文档态 + 同一健康态 + **同一游标起点** + 同一注入时钟 + 同一请求能力，`ModelRouter` 的输出必须逐字可重放——这是 §9 里权重/轮询用例的立身前提，也是 `ModelRouter` 不读真实时钟的原因。

**游标是这条合同的第五项输入，不是可以忽略的内部细节**（本轮补写：先前只写了算法，没写它的可变状态住在哪儿，于是「可重放」这句话从第二次选择起就没人能验）。轮询位置与平滑加权的 `current` 权重都是跨次携带的状态，同一份文档态下换个游标起点就会选出不同路由；用例必须显式给出起点，或从「全零」这个定义良好的初值开始。

| 游标住在哪儿 | 后果 | 判定 |
| --- | --- | --- |
| 进程内（内存） | 选择不在任何日志里留事件、零写放大；断言 10 的比例在**单进程实例内**成立；两入口各转各的游标，重启后回到初值 | **采用** |
| 落 `route-health.log` | 换来全局精确比例与跨重启连续，代价是**每个模型请求在请求路径上多一次同步落盘**（延迟与失败模式会传染给用户请求），并发选择还要处理 revision 竞争 | 本批不做；真要改，只需替换游标来源、算法不动（保留缝） |
| 落配置文档 `custom-models.log` | 每选一次就把用户编辑面的 revision 推高，桌面正在填的表单会假冲突 | **禁止**（断言 83 钉住） |

由此必须写死两条**不宣称**：同机 CLI 与桌面并发发请求时，不承诺「全局精确权重比例」（两个游标各自收敛）；承诺的是**无饥饿**与**单实例内比例**（断言 84、85）。目标 §2 要的是「轮询和平滑加权轮询」，目标 §4 要的跨进程共享是**账本**（已由 `usage-ledger.log` 承担）——从没要求「轮询位置」跨进程共享；把后者写成前者是凭空加需求，把前者当作已满足是虚假交付，两条都不做。

供应商开关的语义（照目标收口，不引入「关开关能撤回远端」的错觉）：

- 关断后：新请求与**尚未发出的后续步骤**立即排除该供应商。
- 已发出的请求默认允许结束；要立即停走显式取消（沿用现有 `turn/cancel`），不提供「关开关顺带撤回」。
- 下游配置保留并显示「供应商已关闭」。

### 4.1 插入点与两处必须先收的真缺陷（本批直读宿主源码）

**锚点纪律（本节只适用于 `apps/host/src/main.cj`）**：这个文件**只认符号，不认行号**。证据是本设计当天三次量同一处：登记时 `:1163-1174`，第一次复核 `:1197-1198`，写完 B1 计划再复核已变成 `:1226-1230`——中间隔着另两个会话的落库（含 `7fa8739`）。定位一律用 `grep -n "let continuation" apps/host/src/main.cj` 这类符号式检索，命中数必须恰好为 1 才动手；`core/src/*.cj` 的锚点当天复核未漂，但仍按同一纪律先核再改。

**插入点**：`apps/host/src/main.cj` 里真实轮次的装配段——由 `let real = DeferredProvider(...)`、`let continuation: (String) -> Provider = { request => RealSseProvider(baseUrl, turnKey, request, tk) }` 和紧随其后的 `ModelAgentRunner().start(real, continuation, ...)` 三行构成。

- 缺陷 A：**目标执行的每一步不会重新过调度**。上游第 2 步挂了仍继续朝同一 `baseUrl` 打，与目标里「一次逻辑请求可能失败后切换上游」直接不符。
  **定位修正（2026-10-05 对 HEAD 复核，本条原先归因错了）**：`ModelAgentRunner` 早已收「每步工厂」——`model_agent.cj:105` 的签名是 `start(first: Provider, nextProvider: (String) -> Provider, …)`，且 `:91` 在每次续跑处**确实调用** `nextProvider(...)`。冻住上游的不是 core 的机制，而是宿主传进去的那一个工厂实现：`{ request => RealSseProvider(baseUrl, turnKey, request, tk) }` 里 `baseUrl` 是外层捕获的常量。
  改法与影响面因此**缩小**：只改宿主那个工厂，让它每步向 `ModelRouter` 要一条路由（含健康过滤与预算预留），路由结果连同 `attemptId` 交给 `TransportChannel`；**`core` 的 runner 签名一个字都不用动**，B2 这一项不是 API 改造而是宿主侧替换实现。
  仓颉侧的现成约束（就写在同一处代码的注释里，`let turnKey = key` 上方那两行注释）：lambda 不得捕获可变变量却被间接调用，所以 `turnKey` 那类值是先 `let` 冻结再进闭包的。工厂里同理不能持有「上一步选中的路由」这类可变捕获——每步都重新问 `ModelRouter`，正好与调度的确定性合同一致。新增断言见 §11 第 49 条。
- 缺陷 A 的补充缝（2026-10-05 另一会话刚落库，对本设计有利）：`core/src/deferred_provider.cj:5` 的 `DeferredProvider(makeProvider: () -> Provider, token)` 把**首步** provider 的构造推迟到第一次读流（`next()`）时才做，并记住结果。B2 把「向 `ModelRouter` 要路由 + 预算预留」放进这个工厂后，天然获得两条免费性质：轮次在起流前被取消时**既不发上游请求也不产生预留**（与 §5.2「用户取消不计入失败」、§7.3「预留必须作废」同一口径），且取消检查（`token.cancelled()`）已在该工厂的调用路径上。注意 `continuation` 那一支**目前没有包惰性壳**、直接构造 `RealSseProvider`——两支都归到同一个 `resolve` 函数才算收口。
- 缺陷 B：**`protocol` 字段被存下但从不生效**。`providerProtocols` 收三种（`openai-completions`/`openai-responses`/`anthropic-messages`，`provider_registry.cj:41`），但 `core/src/sse.cj:11` 的 `RealSseProvider` 只实现一种线格式，全仓 `anthropic`/`x-api-key` 在请求路径上 **0 命中**。后果：把供应商存成 `anthropic-messages` 仍按 OpenAI 形态发出去，认证头与请求体都不对——这是**用错协议冒充支持**。
  改法：加 `ProtocolAdapter` 缝（`core/src/protocol_adapter.cj`），把「线格式 + 认证头形态 + 流式事件映射」按协议各一份；**只登记已实现的适配器**。调度时对未实现协议的绑定返回带类型拒绝并把它排除出候选，同时能力页如实显示「协议适配器未实现」。**不允许**回落到 OpenAI 形态盲发。**名字不能新起一个**：这条拒绝今天已经存在，形态是宿主调用点的 `if (fromRegistry && planProtocol != "openai-completions") → -32016 "protocol-not-supported:${planProtocol}"`（`apps/host/src/main.cj:1166` 与 `:1372`，共 **2 处**）。所以本条的落地是**收口而不是新增**：先定用一个名字（沿用 `protocol-not-supported` 或统一改 `adapter-unimplemented`，二选一），再把判断从宿主调用点搬进 `ProtocolAdapter` 注册表查询。顺带这是断言 65 的**第一个真实受害点**——决策层外面现在就躺着两处按 `protocol` 字面量分支的代码。
  顺序影响：目标 §2.1 要求「按适配器分别支持」，所以 `openai-completions`（已可用）之外两种是需求不是可选项，落在 B2（缝与拒绝语义）与后续批次逐个补实现；补一个就把它的协议从「不可调度」移到「可调度」，不改规则只改注册表。

**取参通道收敛**：同一处还有三条并存的参数来源——注册表 plan、遗留 `ModelSettings`（`configured.baseUrl`）、环境变量兜底。三条分别落在：任务路径的 `let baseUrl = if (fromRegistry) { planBaseUrl } else if (configured.baseUrl.size > 0) … else { getVariable("DSH_PROVIDER_BASE_URL") … }`，以及紧邻的 `key = getVariable("DSH_PROVIDER_KEY") ?? getVariable("STEPFUN_API_KEY")`；**同一条兜底链在 `model/*` 那几个动词的分支里还有一份**（`let url = if (saved.baseUrl.size > 0) … else { getVariable("DSH_PROVIDER_BASE_URL") }` 与 `let environmentKey = … || (getVariable("STEPFUN_API_KEY") …)`）。**四处都要收**，只收任务路径那一处会留下「配置面读得到、`model/*` 动词仍被环境变量影子压住」的假收口（定位一律 `grep -n DSH_PROVIDER_BASE_URL apps/host/src/main.cj`，命中数应为 2）。模型中心上线后必须**只剩一条**：任务输入 → 自定义模型 ID → `ModelRouter` 决策 → 凭据按 `credentialRef` 现解析。环境变量兜底降为「开发态夹具」，在产品路径（`task/start`）里**不再参与**取值，缺配置就 fail-loud（这条现有代码已具备雏形：`task/start` 无 base_url 会硬失败，而 `turn/start` 静默走假 provider——B2 一并收口，别把诊断通道当产品通道）。

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

**三档的键里都没有品牌**（`providerId + modelId` / `credentialRef` / `transport + relaySlug`）。这条是号池的安全性质，必须写死：同一供应商的两份实例各用自己的 `credentialRef`，一份凭证 401 或额度耗尽只暂停那一份，同池其它份继续接流量；反过来，实现者**不许**图省事按 `name` 或 `baseUrl` 聚合健康状态——那会把「一个 key 挂了」放大成「整个品牌不可用」，正是号池要消除的行为（断言 57 钉它）。

### 5.2 失败分类表（有效失败的判定）

**先把输入通路说清楚（2026-10-05 直读 `core/src/sse.cj` 与宿主源码实测，三段全缺，不补则下面这张表无法落地）**：

1. **供应商证据被丢掉**：`RealSseProvider` 的生产构造器在非 200 时**先 `resp.close()` 再 `throw Exception("http-status:…")`**（`sse.cj:47-50`），响应头与错误正文都拿不到。全仓 `core`/`host` 对 `headers`/`Retry-After` 是 **0 命中**。后果：本表「遵守响应里的 `Retry-After`/额度重置时间」和 §5.3「供应商证据 > 退避阶梯」这两条**没有任何取数通路**——写得出断言 7，也只会由夹具喂绿，不是生产通路。`model_catalog.cj:113-118` 是另一种写法、同一个结果：非 200 在 `try` 里抛、`finally` 立刻 `resp.close()`，异常出栈时响应已归还，头一样取不到；`:120-125` 也把非 `http-status:`/`bad-model-catalog` 之外的一切塌成 `model-catalog-request-failed`。
2. **线路与模型分不开**：除 `http-status:` 前缀外，连接被拒、DNS、TLS、读超时**一律塌成 `http-request-error`**（`sse.cj:57`）。后果：本表的「无法归因 → 标 `unknown`」不是保守选择而是唯一可得结果，`channel` 档（§5.1）在直连路径上无从判定。
3. **失败事实不进日志**：`core` 里没有任何失败类事件（`turn/failed` 等 0 命中），异常只出到宿主的错误帧（宿主侧仅 `-32014 over-budget` 一类特判）；provider 已有的 `termination`/`errorCode` 两个只读面（`sse.cj:30-31`）**目前只有 `sse_test.cj` 在消费**。后果：目标 §2「健康状态跨重启保留」缺输入侧——三次失败若只活在进程里，`RouteHealth` 重启后什么也数不出来，断言 5 只在输出侧核状态没丢，并不能证明计数有来源。

因此 B2/B4 开工的**第一步不是写分类器，而是补这三段**：

- provider/`TransportChannel` 产出**结构化失败对象**而不是裸字符串：`kind`（`transport` | `http-status` | `protocol` | `read` | `cancelled` | `credential`）、**`reachedUpstream: Bool`（请求字节是否已进入线路）**、`status: Int64`、`retryAfterSeconds`、`resetEpoch`、`bodyLen` 与正文摘要。**`reachedUpstream` 不是从 `kind` 推出来的**：同是 `transport`，连接被拒/DNS/TLS 握手失败是「未上线」，而读超时与半身后断是「已上线」——两者在 `kind` 里同名单，缺这一维时 §6 交给 `TransportChannel` 的重发白名单只能靠错误文案猜。
  判据来自**先发落盘的标记**（见 §6 重放闸），不是内存标志也不是 catch 分支的写法：`reachedUpstream := 该 attemptId 存在 dispatched 事件`。**只取白名单头**（`Retry-After`、`x-ratelimit-reset*`），HTTP-date 形态按墙钟解析后仍受 §5.3 的 `cooldown.maxHorizon` 裁剪。
- **错误正文永不入日志原文**：只存长度与摘要。理由与 §1.1 的读面纪律同源——上游错误体常回显请求片段，其中可能含我们发出去的键值材料。
- 每次上游尝试把失败落成一条 `attempt/failed` 事件，`RouteHealth` **从事件回放派生**计数与档位（与「会话日志是唯一真源」一致，也让断言 5 的跨重启有输入侧依据）。
- 归因不了就如实写 `unknown` 且**不进任何一档计数**（本表最后一行），不允许把 `http-request-error` 默认算成模型故障——那会让线路故障把健康的模型熔掉。

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

**凭证失效（401/403）与「改了密钥就该重试」的接缝**：仓里已有一份 `core/src/cred.cj` `CredentialRegistry`（log-only 的 `credentials/register|rotate|revoke` 与按 rotate 事件数派生的 `revision(ref)`），它和 `credential.cj` 的**值面** `CredentialStore` 是两个不同的缝，本设计都要用：

- 因 401/403 暂停某 `credentialRef` 作用域时，把**当时的 `revision`** 记进健康事件；
- 之后 `credentials/rotate` 一发生（`revision` 变大），该作用域**立即重新纳入候选**，不用等冷却窗口、也不做定时盲试——这正好接上 `credential.cj:9-13` 已落地的「旋转后下一次请求即生效」；
- `revoke` 则该作用域直接转「待绑定凭证」，与 §8.3 的缺凭据态同一口径。

### 5.3 冷却与低频探测

- 累计 **3 次有效失败** → 该作用域退出正常调度，进入 `cooling`，写 `notBefore`。
- `notBefore` 取值优先级：**供应商证据 > 退避阶梯**。供应商给了 `Retry-After` 或额度重置时刻就照它；没给则按 `30min → 1h → 2h → 4h`（同一作用域连续冷却逐档抬升，上限 4h），全部可配置，默认即此。
- **成功不清零累计失败数**，但恢复正常调度；失败数只做展示与归因。
- 状态持久化在 `route-health.log`，**跨重启不丢**；不再有「次日自动恢复」这条——恢复由探测决定。
- 探测去重：探测任务持有 `WriteLease`（复用 `model_settings.cj:58` 的 `takeoverIfStale()` → `finally release()` 形态），同一作用域同时只允许一个在途探测；CLI 与桌面共享这份租约，因此不会各探一次。
  **但 `core/src/lease.cj` 的实际语义决定了这里有三条必须写死的规则**（2026-10-05 直读源码核对）：
  1. 租约是**按文件路径**的（`init(sessionPath)` → `<path>.lease`），不是按作用域。要做到「按作用域去重」，就得**一个作用域一个租约文件**（如 `<设置目录>/probe-lease-<作用域键>.lease`），不能指望一份 `route-health.log.lease` 同时表达多个作用域——那会把不相干的探测也串起来。
  2. **没有 TTL**。`takeoverIfStale()` 只在「盘上 pid 被 `procwin.cj:29` 的 `isProcessAlive` 判为确认已死」时才接管；pid 被复用的情形它**故意不接管**（源码注释：宁可让人手工清）。后果必须如实写进设计：宿主进程**活着但卡死**（例如探测连接既不返回也不超时）时，该作用域的恢复探测会一直停在「在途」，别的路径进不去。
  3. `acquire()` 是**非阻塞 try-lock**，回 `Bool`。这正好允许「拿不到就立刻给带类型拒绝」，而不是排队等锁。
  所以：探测必须自带**有界超时**（沿用 `model_catalog.cj:101` 的 `readTimeout` 形态）并在 `finally` 里 `release()`；拿不到租约时回 `probe-in-flight`（不静默跳过、不排队）；页面把「该作用域有在途探测」显示出来，并提供显式的 `route/probe/run` 入口让人复核——**清理滞留租约不允许由程序自动做**（`release()` 只认自己的 token，抢写失败的一方无权清持有者的）。新增断言见 §11 第 50 条。
- **谁发起探测**：由活着的宿主进程（桌面 spawn 的 `dsh-host`）跑探测定时器；CLI 的单发子命令**不**起后台定时器，只在 `route/probe/run` 被显式调用时探一次。软件全部关着时不继续产生探测费用，也不假装恢复。
- 探测预算：`probe.maxPerDay` 默认每个作用域每日 **3 条**，探测费用计入 `usage_kind=probe` 且受模型额度预算约束；上限可改，改法同其它写面（带 `expectedRevision`，落一条事件）。
- **池会把探测条数线性放大**，所以除每作用域上限外再加一道全局闸：`probe.maxPerDayGlobal`（跨作用域共享，按落盘**条数**计，与钟无关，默认见 §16.2 第 10 行）。理由很直白——号池让作用域数从「几个模型」变成「几个模型 × N 份实例」，而 §5.3 阶梯第 2 档的探测是**最小真实请求、会产生费用**；没有全局闸时，用户加第 10 份 key 就等于未经许可把每日计费探测上限乘了 10。触顶后新的作用域一律回 `probe-budget-exhausted` 且**不发请求**，页面如实显示（断言 59）。
- 探测成功 → 状态转 `trial`：只放行**一条**正常请求做确认，该请求成功才回 `available`，失败则回 `cooling` 并抬一档。
- 探测形态阶梯（能省则省，且不许越档宣称）：
  1. 供应商明确的**额度/健康只读接口**（零推理成本，优先）；
  2. 该接口不存在时，用**最小真实请求**探一次——明确会产生费用，计入 `usage_kind=probe` 并受探测预算约束；
  3. 模型列表拉取成功**不等于**推理可用；文本探测成功**不等于**生图可用——探测必须打在即将使用的那条路由与那个能力上。
- **探测发出去的线路 = 被测路由自己的线路**：该上游所属供应商是 `direct` 就直连，是 `relay` 就必须经 `TransportChannel` 的 `probe` 形态（§6）。借加速线路去探一条裸连路由、或反过来，得出的结论都不能用于那条路由的恢复判定——这会让「线路故障」伪装成「模型恢复」。
- **两类时钟的分工（B0 ③ 实测结论，见 §15）**：
  - 进程内时长（轮次超时、审批 TTL、单次等待）沿用既有的 `clock!: () -> Int64` 注入缝——`core/src/approval.cj:23-26` 的 `monotonicSeconds()`，其基准是**本进程启动时刻**（`MonoTime.now() - base`）；
  - `notBefore`、下次探测时刻、按日聚合的费用窗口这类**要被另一个进程或下一次启动读到**的时间点，**只能落墙钟 epoch 秒**：单调钟每进程各有一套零点，把单调值写进 `route-health.log`，对宿主之外的读者等于写了个随机数。
- 墙钟不可信，所以持久冷却带三道护栏：写入的 `notBefore` 与写入时刻之差一律 clamp 到 `cooldown.maxHorizon`（默认 24h）——被供应商证据（`Retry-After` / 重置时刻）撑出界时按裁剪值落盘，并另记一条「恢复时刻已裁剪」事件、页面如实显示「恢复时刻为估算」；读侧维护**单调不减的时间水位**（本机见过的最大时间戳），把水位当作「现在」的下界，于是**把系统时钟往回拨只会让冷却更早到期，绝不会更长**；探测频率还有与钟无关的第二道闸——`probe.maxPerDay` 按落盘**条数**计，钟被改坏也探不出预算外。
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
- **三种用途必须共用同一个通道决策**（目标 §3 第一条的字面要求：加速通道「用于模型请求、**模型发现**和**健康探测**」）。这条在 2026-10-05 的对照核查里是**缺口**，因为现状发现与探测各有独立出口：`core/src/model_catalog.cj:101` 的 `fetch` 自己在 `:105` `ClientBuilder()` 直连 `baseUrl`，宿主的 `model/list` 直接调它；§5.3 的探测将来是第三条出口。各走各的结果是「供应商切成 `relay` 后只有推理走加速，发现与健康探测仍裸连」——而清单拉取恰恰是最没有额度证据、最该借加速线路的一步。
  收法：`TransportChannel` 对外给三种发送形态——`chat`（流式推理）、`discover`（`GET …/models`）、`probe`（§5.3 阶梯里的只读接口或最小真实请求），三者**从同一处读 `transport` 与 `relaySlug`**、受同一份 slug 允许集约束（`relay-target-rejected` 对三种一视同仁）、按同一形态拼 `{relayBase}/upstream/{relaySlug}/…`；`usageKind` 各自落 `chat` / `connection-test` / `capability-test`\|`probe`。
  走 relay **不改变任何计数与预算规则**：探测仍受 `probe.maxPerDay` 约束、仍不占 `upstream` 三次机会（§5.1），发现失败仍不写目录也不报「0 个模型」（断言 2 的口径）。新增断言见 §11 第 40、45 条。
- **信任边界必须显式写在页面上**：走 relay 时，请求内容与上游凭据会经过 SaCode 服务。默认不持久保存用户上游密钥（每次请求现取现用）；UI 在把某供应商切成 `relay` 时给出一次明确提示，不做默认开启。
- 流式与取消：relay 必须原样透传正文、工具调用增量、`usage`、终止序与 `[DONE]`；客户端取消尽力取消上游。 SSE 解析契约按 `core/src/sse.cj` 已实测的形态走，**relay 不得改写帧语义**（改写过的 provider 侧证据见 `docs/evidence/handoff-model-provider-2026-10-04.md` §5）。
- **不盲目重放**：请求已可能送达上游、或已开始吐字时，绝不自动换线路重发；状态不明写 `待核算`（§7）。只有在能确认请求未发出、或供应商提供可靠幂等凭据时，才允许重试，且重试次数不进 `ModelRouter`（路由一次只给一条，重发是 `TransportChannel` 的显式白名单行为）。

**「能确认请求未发出」必须有可写下的东西，否则这句只是愿望**（2026-10-05 补）：每次上游调用**之前**，先在 `usage-ledger.log` 同一条写路径上落一条 `attempt/dispatched`（带 `logicalRequestId` + `attemptId` + 选中的路由键），**再把字节交给传输**；重放闸的判据是「该 `attemptId` 有无 dispatched 事件」——有标记一律不重发（除非供应商给可靠幂等凭据），无标记才可能进入白名单分支。三条配套纪律：

- **标记写不下去就不发**（fail-closed）：拿不到租约、落盘失败一律返回带类型拒绝，绝不「先发出去、回头补记」——否则在最需要证据的场合恰好没有证据；
- **两次持锁都不跨网络**：`reserve` 与 `dispatched` 各是「取租约 → 写一条 → 归还」的短临界区，不许为了省事合并成一次持有把网络圈进去（断言 51 同样适用，且这里更容易犯，因为中间真的隔着一次发送）；
- **存在性从 B2 起就要有**：账本挂费用是 B3 的事，但 `attempt/dispatched` 事件本身随 §5.2 那批（B2）落，否则 B2 到 B3 之间的窗口里重放闸是空的——那段时间已经在发真实请求了。

另有一条以前没写的：**同一步内不换绑定重发**。`nextProvider` 工厂是**每步**调一次（`core/src/model_agent.cj:91`），这只意味着「下一步再问一次路由」，不授权「这一步失败了就地换一个再试」；一步内失败即终态收束。把每步调用读成步内循环，会同时把费用、失败计数与 usage 记账的分母按尝试数放大，而 §4 的过滤链与 §7.1 的「每次上游尝试独立记账」都没有为它记账的位置。
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

**先把计量的输入通路说清楚（2026-10-05 直读 `core/src/sse.cj`、`core/src/agent.cj`、`core/src/meter.cj` 实测，三段全缺；不补则下面这张字段表只能由夹具喂绿，与 §5.2 是同型缺陷）**：

1. **分档用量在解析点就被丢掉。** `sse.cj:249-263` 读 `usage` 时优先取 `total_tokens`，否则把 `prompt_tokens` 与 `completion_tokens` **相加**存进单个 `var usage: Option<Int64>`（`:28`），再以**一个数**发进 chunk 流（`:215` `Chunk("usage", "${n}", "")`）。往后每一层都只容得下一个数：`Assembly.usage: String`（`agent.cj:46`，且 `:64-65` 只在 `finishReason` 为空时接受）、`TurnResult.usage: String`（`cancel.cj:127`）、`parseCount` 只收纯数字（`meter.cj:125-137`）、事件体 `turn/usage ${v}:${total}`。**后果**：本节要求「输入/输出/缓存读写 token」分别记，可生产通路上从 provider 出来就只剩合计量；更要命的是**分档计价根本无从算**——输入价与输出价不同是行业常态，拿总量乘任一单价都会算错，而断言 41 与 §12 明令禁止的正是「用统一单价把金额算错」，只不过这次发生在**同一币种内部**，41 管不着。
2. **usage 字段名不合 OpenAI 形态会让整轮失败，而不是降级。** 同一段解析里，`usage` 存在但既无 `total_tokens` 也无 `prompt_tokens`+`completion_tokens` 时走 `fail("protocol-error")`（`:258`）。这是硬失败：一颗把用量写成 `input_tokens`/`output_tokens` 的上游（Anthropic 即此形态，见 §1.3 缺陷 B）会让**已经正常返回正文的那一轮**整体报错。目标要的是「没有 usage 不冒充零消费」，其前提是**没认出来 ≠ 请求失败**。
3. **第三种情形没有档位。** `settleTurn` 在 `finishReason` 非空而 usage 为空时照样调 `record("")`（`meter.cj:52-55`），落 `usage/bad-usage` 且 `badCount += 1`（`:89`）——把「上游这轮没回用量」（合法且常见）与「用量格式非法」（契约违例）塌进同一档。§7.3 的 `待核算` 本正是为前者准备的，现在它没有输入通路。

补法（**B3 开工的第一步不是写账本，而是这三段**）：

- provider 面对外给**结构化 usage**（`input` / `output` / `cacheRead` / `cacheWrite` / `reasoning` 各 `Option<Int64>`，外加识别到的原始字段名一并保留），不再只给合计数；`total` 只在展示时由分项求和，**求和结果不得作为计价基数回写账本**。
- 认不出的字段名**降级不失败**：正文与终态照常交付，用量记 `meterSource=unknown` 并进 `待核算`；`protocol-error` 只留给真正的帧结构违例。
- 计价按**维度登记费率**：绑定条目从单一单价改为四档费率，缺省 `-1`＝该维度未登记；某维度有用量而未登记费率 → 该笔落 `待核算`，**绝不用已登记维度反推未登记维度**（形态见 §2.3 绑定行与断言 76）。

每条尝试记：`attemptId`、`logicalRequestId`、`session`、`goal`、`turn`、`usageKind`（`chat` / `goal-execution` / `prompt-enhancement` / `connection-test` / `capability-test` / `probe` / `relay`）、`customModelId`、`providerId`、`modelId`、起止时间与耗时、结果分类、输入/输出/缓存读写 token、模态计量（图片张数、音频秒数）、金额与币种、计价版本、`meterSource`（供应商 usage / 本地按价推算 / 用量未知）。

**失败和取消也可能收费**：有 usage 就记；没有 usage 记 `meterSource=unknown`，**不许记成零消费**（这条与 `meter.cj:52` 的 `absent` 语义一致——现有实现已拒绝把「没收到」推断成「没花钱」，账本继承它）。

### 7.2 金额表示

- **固定精度十进制定点**：整数微单位（1 货币单位 = 10^6 微单位）+ ISO 币种码，不做浮点累加。
- **上界要算准，别写大概**：`Int64` 最大值 `9223372036854775807` 除以 10^6 得 **约 9.2234×10^12 元**（本轮 Node 复算），这才是溢出边界。规格里原先那句「跨 10^13 元才溢出」把余量高估了约 8%——B3 的溢出用例如果照那个数取边界，断言会落在真实溢出点**之外**，等于钉不住。凡这类由常量推出来的数字，一律写成「算式 + 结果」，不写口算的量级。
- 计价按绑定，单位由该上游的 `meterUnit` 决定（token / 张 / 秒 / 请求 / 文档），**不把图像音频折算成 token**。
- 每次结算写入**计价快照**；改价只影响之后的请求，历史账单永不重算。
- 本仓自有的 SHA-256 与账本无关；定点加法全部显式走 `Int64` 并带溢出检查——超出即拒绝结算并标 `待核算`，不允许静默回绕。

### 7.3 预留 / 结算 / 作废

```text
检查预算 → 原子预留本次额度 → 发起请求 → 按实际用量结算 → 释放剩余预留
```

- 预留与结算都在 `usage-ledger.log` 上持 `WriteLease` 落盘，**同机 CLI 与桌面共享同一本账**（跨机器不共享，见 §8）。
  **租约的临界区只许覆盖落盘写入，绝不跨网络调用**——§5.3 核到的三条租约语义（按路径、无 TTL、崩溃接管只认 pid 判死）在这里更致命：`usage-ledger.log` 是全机唯一的账本文件，若把「预留 → 发请求 → 结算」整段圈进一次持有，一次 15 秒的探测或一轮几分钟的目标执行会**冻住另一个入口的每一次记账**，而卡死的持有者别人接不进来。现成用法（`model_settings.cj:58`）之所以安全，就是它只圈住一次临时文件改名。预留与发请求之间只能是「取租约 → 写一条 `reserve` 事件 → 归还 → 再发请求」，结算同形（断言 51）。
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
- **号池下还要能按实例回看**：同一自定义模型的 N 份实例要分得清「哪把 key 花了多少、哪把先撞额度」，所以除 `usageKind` 维度外，核心读面还得保留 `providerId`（实例）维度的分组——数据本就在账本条目里（§7.1 每次上游尝试独立记账），这条只要求**别在聚合时把实例维度抹掉**，渲染层仍然只显示核心回来的数字（与断言 43 同源）。
- 如实写边界：这一套限制的是**本地可控**的消费，不能保证远端账单绝不超支（供应商可能延迟计量、额外计费、usage 不全）。

---

## 8. 迁移：导出 / 导入

### 8.1 两种包

`MigrationBundle` 产出一个信封，`format: "sacode-migrate/1"`，`kind` 二选一：

| kind | 内容 | 用途 |
| --- | --- | --- |
| `config`（默认） | 供应商（含 `sortOrder/enabled/transport/protocol/baseUrl`）、上游模型与能力与元数据来源、自定义模型与绑定顺序/权重、**四档费率与计价版本**（§2.3 与断言 76）、模型额度预算、探测策略；`kind` 若出现**只作信息展示，永不参与作用域键**（§2.4 对偶、断言 78），安装 ID 明文不出包 | 备份、复制到另一套环境、跨机迁移后**补填密钥** |
| `secret-bundle` | 上述全部 + 选中供应商的凭据值 | 一次性换机迁移，**必须**用独立迁移口令加密 |

信封头部：`format`、`kind`、`generatedAt`、`schemaVersion`、条目摘要（SHA-256，用仓内现成实现）。

`config` 包**结构上就没有能承载明文的槽位**（继承 `provider_registry.cj:330` 的拒绝清单），不是「写了再擦掉」。

### 8.2 加密形态（B0 运行期实测后定，不是按理想选型定）

`secret-bundle` 的凭据段 = **口令派生密钥 + 认证的加密封装**。选型不由「哪种构造更体面」决定，而由 §15 的 B0 实测决定：本栈唯一可用的分组密码模式是 `CBC`/`CTR`（`GCM` 运行期一律失败），所以封装用 **encrypt-then-MAC（ETM）**——两个都已在本机跑通的原语组合出认证加密：

| 半 | 用什么 | 为什么只能这样 |
| --- | --- | --- |
| 保密 | `stdx.crypto.crypto` 的 **`SM4` + `OperationMode.CTR`**（16 字节 IV，实测密文长度=明文长度，SDK 不额外填充） | 全栈 **0 处 AES**；`std.crypto.cipher` 只有 `BlockCipher` 接口；`OperationMode.GCM` 有符号证据但**运行期不可用**（§1.3 第 4 条、§15） |
| 认证 | **`HMAC-SHA256`**（`stdx.crypto.digest`）覆盖 `信封头 ‖ IV ‖ 密文`，标签 32 字节逐条存 | 没有 AEAD 可用时，ETM 是用已 vetted 的哈希-消息码补出完整性的标准做法；把 MAC 覆盖范围放到头部，才使「把头换成 `config` 或改条目数」不能蒙混过关 |
| 口令派生 | 自建 **PBKDF2-HMAC-SHA256**，构建在 `HMAC(key, SHA256)` 之上；迭代次数与盐长度写进信封头部，**不低于 600k** | 全栈 **0 处 KDF**（无 PBKDF2/scrypt/HKDF）。不派生就直接用口令当密钥是硬伤，所以这一层必须有 |
| 子密钥分离 | 同一 `(口令, 盐)` 跑 **两次** PBKDF2，上下文串不同：`sacode-migrate/1\|enc` 出 16 字节 SM4 密钥、`sacode-migrate/1\|mac` 出 32 字节 HMAC 密钥 | 一把密钥同时做加密和 MAC 是已知误用面。派生结果已被 openssl CLI 独立复现（§15），换档到真正的 KDF 时按头部算法标识走 |
| 随机材料 | `stdx.crypto.crypto.SecureRandom`（`priv` 私有随机字节）出盐与 IV | 不用时钟或进程内计数器凑随机 |
| 密钥长度 | SM4 分组与密钥均 128 位，HMAC-SHA256 标签 256 位 | 如实写明是 **128 位安全强度**，不宣称 AES-256 等级 |

派生与封装纪律：

- **PBKDF2 只允许构建在已 vetted 的 HMAC 之上**，且必须用 **RFC 6070 的 PBKDF2-HMAC-SHA256 向量**钉住（`c=1/2/4096/16777216`、`dkLen=1/2/8/32/40`、含 `passwordPASSWORDpassword` 的 `dkLen=40` 多块用例与 `pass\000word` 的 NUL 截断用例）。这是自建派生唯一可接受的证明方式；**不允许**手写分组密码或哈希混淆冒充加密。
- **校验顺序是硬约束**：解包必须 先算 MAC → 定长时间比较 → 通过后才解密。反序（先解密再校验）会把密文改动交给 padding/明文处理路径；比较用逐字节异或累积、不提前返回，避免按位置泄露。
- 每条凭据条目独立盐与 IV，标签逐条存；密文、IV 或头部任一处被改动一位即整条拒绝，**不得降级为「忽略校验继续导入」**。
- **信封头部必须显式记录算法标识**（`cipher: "SM4-CTR"`、`mac: "HMAC-SHA256"`、`compose: "ETM"`、`kdf: "PBKDF2-HMAC-SHA256"`、迭代次数、盐/IV/标签长度）。将来 SDK 出现可用 AEAD（含 `SM4-GCM` 修复）或真实 KDF 时按头部换档，旧包仍自描述可解——算法敏捷性写进格式，不靠记忆。
- 口令不落盘、不进日志、不进记忆；派生与解包只在需要时发生。
- **被否决的替代（一）**：借 `npm/dsh-cli/bin/cli.js` 的 Node 侧 `crypto`（有 AES-256-GCM 与 scrypt）来做封装。否决理由：那会让 CLI 与桌面各用一套加解密实现，直接违反「桌面、CLI 与安装包规则一致」，而迁移包恰恰是跨入口的产物。
- **被否决的替代（二）**：`SM4-CBC + HMAC` 的 ETM。否决理由：CBC 需要填充，多出一条 padding 处理路径与 padding-oracle 面；CTR 是流式用法、实测不填充，密文长度还顺带不泄露明文的块对齐。
- **B0 结论：`secret-bundle` 不 BLOCKED。** §10 原写的「GCM 跑不通则记 BLOCKED」是当时的分支，实测走了另一支——用可运行的原语组合出等价的认证加密，需求一条没减。运行期缺 `libstdx.crypto.*` 或 `libcrypto` 时仍按 §8.5 fail-loud。

### 8.3 导入流程与不变量

```text
选文件 → 校验 format/schema/摘要 → 计算差异 → 用户选合并或替换 → 原子落盘
```

差异预览按**稳定 ID** 对齐，不按名称：

- 同名不同 ID 视为两个不同条目，**不自动合并**；
- 重复导入同一个包不产生重复供应商、重复上游模型、重复绑定（幂等，按 `(providerId, modelId)` 与绑定唯一键）；
- **号池在同地址多实例时最容易被动塌**：`deepseek-a` 与 `deepseek-b` 是两个 `providerId`、同一个 `baseUrl`，按稳定 ID 对齐即天然保住两份；**不许**按 `baseUrl` 或显示名做「智能合并」，那会把池归并成一份并让其中一把密钥失去指向（断言 58）；
- 跨环境时凭据引用重新映射；`config` 包导入后若本机没有对应凭据，条目显示「待绑定凭证」，其路由**不可调度**；
- 覆盖已存在的密钥需要**单独确认**，导入配置永不静默换密钥；
- 导入文件里的归属信息**不能**变成授权依据（本机 principal 由本机决定，不认包里的 owner 声明），**也不能变成作用域键**：导入落盘的是本机重新盖写归属的新事件，而不是原样搬运包内事件体——这是 §2.4 隔离机制的对偶，缺它就会出现「导入成功但本机看不见自己的导入结果」（断言 77、78）；
- 导入走与在线编辑相同的校验与拒绝分诊（协议闭集、https 校验、能力适配、重复绑定）——包不能绕过写面校验。

### 8.4 明确不属于配置迁移的东西

`usage-ledger.log`（账本）、已用额度、在途预留、`route-health.log`（熔断/冷却状态）、`待核算` 记录都**不进** `config`/`secret-bundle`。整套服务搬迁走独立的「数据目录备份恢复」流程，本设计只提供文档级迁移，并如实说明它不恢复运行数据。

### 8.5 交付形态（依赖实测后收敛）

`stdx.crypto.*` **已经在交付产物里**：`scripts/pack-cli.mjs:99-105` 拷 `STDX` 下全部 `libstdx*.dll`（只排除 unittest 与宏），`scripts/pack-host.mjs:18-22` 把传入 DLL 目录里的 `*.dll` 全量拷进 `bin/`；而 `libcrypto-3-x64.dll` 本来就因 TLS 随包（§1.3）。
→ **加密迁移不新增任何分发依赖**，也就没有「为了少拉依赖把它单独关进一个可执行文件」的理由。

因此实现落在 **`core`（`MigrationBundle`）一处**：桌面走宿主动词 `migrate/*`，CLI 走 `dsh migrate export|import`，两者调的是同一段代码——迁移包的格式与算法只能有一份真相。加密不可用（运行期缺 `libstdx.crypto.*` 或缺 `libcrypto`）时 **fail-loud**，UI 与 CLI 直接显示卡点，不提供「先导出来再说」的路径。

链接侧已核并已**编译+运行实证**（§15）：`core/cjpm.toml` 与 `apps/host/cjpm.toml` 用 `[target.x86_64-w64-mingw32.bin-dependencies] path-option` 指向**整个** `stdx/.../dynamic/stdx` 目录（现在这样解析 `stdx.encoding.json` 与 `stdx.net.http`），**不存在「按模块逐个声明」这道额外配置**——引入 `stdx.crypto.crypto` 不改构建配置；一次性探针包只用同一条 path-option 就链接成功并跑出了 §15 的结论，`.dll.a` 是否覆盖全部导入符号这个疑问随之消解。换机器时这条 path-option 仍是硬编码本机路径（AGENTS 已知项），迁移功能不新增这个约束，但也不替它解。

---

## 9. 协议面与双入口一致性

### 9.1 宿主新增动词（有限集合，不提供「发任意方法」通道）

| 组 | 动词 |
| --- | --- |
| 自定义模型 | `custom/describe`、`custom/upsert`、`custom/remove`、`binding/upsert`、`binding/remove`、`binding/reorder`（**原先这组还列了 `custom/reorder`，2026-10-05 撤掉**：目标只要求「供应商排序」与「绑定顺序」两级顺序，自定义模型自身的展示序不是需求；`sortOrder` 字段仍随记录落盘、可由 `custom/upsert` 改，B6 面板若要做拖排再补一个单列动词，不构成需求裁剪） |
| 发现与导入 | `model/pull`（拉取并回候选，**不自动启用、不自动加入调度**）、`model/upstream/upsert`（**手动添加上游模型**：有些供应商没有列表接口或返回不全，拉取通道不能替代它）、`custom/import/new`（每个选中上游各建一个自定义模型，初始单绑定）、`custom/import/into`（加入已有自定义模型，先过能力/协议适配与重复绑定校验） |
| 健康 | `route/health/describe`、`route/probe/run`（手动探测，也走同一把租约与预算） |
| 计量 | `ledger/describe`、`budget/describe`、`budget/set` |
| 加速 | `relay/describe`、`relay/set`、`relay/test` |
| 迁移 | `migrate/export`、`migrate/import/plan`、`migrate/import/apply` |

写侧一律带 `expectedRevision`；读侧一律不带任何能承载明文的字段。**`initialize.capabilities` 必须同步声明新方法**（这条已经踩过：能力声明与实现不一致，见 `docs/evidence/handoff-model-provider-2026-10-04.md` §6 末行）。

### 9.2 桌面 IPC

**基线实测（本批直读 `apps/desktop/preload.cjs`）：登记时提交态 **32 条通道**；2026-10-05 上午复测 **33 条**（多的那条是 `attachmentImageRead`）；同日在 HEAD `d54a967` **再复测为 42 条，且工作区态与 HEAD 的双向差集为空**——原先标成「工作区在飞」的那 10 条已整条落库（`attachmentImageRead` + `goalDescribe,goalCreate,goalEdit,goalPause,goalResume,goalClear` + `promptEnhance,promptPoll,promptCancel`）——**这个数会随别的批次漂，本批任何「N→N+k」都以开工当日重测为准**，重测法见下面代码块**：`exposeInMainWorld` 的对象字面量里有嵌套函数体，非配对的花括号会在第一个 `}` 处截断，本次第一版就这么把 33 数成了 2，必须按「深度 1 处的顶层 `key:`」数**——
`projection,userSend,attachmentUpload,toolsList,toolCall,approvalAsk,approvalAnswer,turnStart,taskStart,queueDescribe,queueEnqueue,queueUpdate,turnPoll,turnCancel,usageStatus,usageSetBudget,appearanceGet,globalAppearanceGet,globalAppearanceSetTheme,globalAppearanceSetFontSize,sessionCatalog,sessionCreate,sessionSelect,workspaceGet,workspaceChoose,appearanceSetTheme,modelsDescribe,modelsCatalog,modelsSave,modelsRemove,modelsSetDefault,modelsList`（按 `preload.cjs` 里的出现顺序原样列出）。

**HEAD `d54a967` 的完整名单（42 条，按出现顺序）**——上面那份 32 条是 `8a7dc77` 时期的，留着作对账基线，新增的 10 条**插在名单里而不是追加在尾部**，所以只比尾部会漏：`projection,userSend,attachmentUpload,attachmentImageRead,goalDescribe,goalCreate,goalEdit,goalPause,goalResume,goalClear,toolsList,toolCall,approvalAsk,approvalAnswer,turnStart,taskStart,queueDescribe,queueEnqueue,queueUpdate,turnPoll,turnCancel,promptEnhance,promptPoll,promptCancel,usageStatus,usageSetBudget,appearanceGet,globalAppearanceGet,globalAppearanceSetTheme,globalAppearanceSetFontSize,sessionCatalog,sessionCreate,sessionSelect,workspaceGet,workspaceChoose,appearanceSetTheme,modelsDescribe,modelsCatalog,modelsSave,modelsRemove,modelsSetDefault,modelsList`。

`apps/desktop/test/bridge.test.mjs` 现有 **40** 条 `test()`（HEAD 与工作区各数一次都是 40）。**先前登记的 41 是假数**：松散 `grep -c "test("` 会把 `bridge.test.mjs:547` 里那条正则的 `.test(m)` 也算成一条用例，必须用 `grep -c "^test("`；这条纪律与 §16.3 第 5 条同源——**计数模式本身要先反证**。

> **注意一处文档漂移**：`AGENTS.md` 仍写着 IPC 面是「按动作命名」的那 9 条集合，与代码差 **24** 条（HEAD 42 条 vs 那句里的 9 条，差 **33**）。**不要以那份清单为准**，改通道前先以 `preload.cjs` 与 `bridge.test.mjs` 的实际形态为基线。

重测通道数（HEAD 态与工作区态各数一次；**只认 `exposeInMainWorld` 块里缩进两空格的顶层 key**）：

```bash
cd /d/Project/sa/saai/sa-code
for SRC in apps/desktop/preload.cjs ; do
  awk '/contextBridge.exposeInMainWorld/{f=1} f&&/^  [A-Za-z][A-Za-z0-9_]*:/{print $1}' "$SRC" | tr -d ' :' | sort -u | wc -l
done
git show HEAD:apps/desktop/preload.cjs | awk '/contextBridge.exposeInMainWorld/{f=1} f&&/^  [A-Za-z][A-Za-z0-9_]*:/{print $1}' | tr -d ' :' | sort -u | wc -l
```

> 这条命令是实测跑通的：2026-10-05 上午给出 **HEAD 33 / 工作区 42**，同日下午在 HEAD `d54a967` 复测为 **HEAD 42 / 工作区 42**（两个集合做双向差集为空，说明那条在飞线已整条落库）。反面教训记一句——**别拿「正则找冒号前标识符」的简易办法数**：本批先后试出 2、29、37 三个错数，前一个是花括号不配对被嵌套函数体截断，后一个是字符扫描时把 `(`、`[` 与字符串里的括号一起算了深度。数完必须做一次**名单级对账**（把上面数出的集合与本文那份通道名清单做双向差集），只核总数核不出漏数。

本批与在飞那一线**命名不冲突**：`AGENTS.md` 那句已按实测改成「以 `preload.cjs` 为准」（同批），B1 新增通道全部走 `custom*`/`binding*`/`modelPull` 一族，与 `goal*`/`prompt*` 不重叠。

**桌面模型页已存在且已接线**（`apps/desktop/renderer/pages/models-page.ts` 179 行：列表、编辑草稿、拉取候选弹窗、密钥输入带 `credentialWritable` 只读态、删除确认；`model-select.ts` 69 行是任务输入侧的选择器）。所以 B1 在渲染层是**扩展**不是新建。但本批读出一个必须先收的真缺陷：

- `models-page.ts:29 validateDraft` 在渲染层**重写了一份核心校验规则**，而且**比核心松**：`:32` 只要 `['http:','https:']` 就行，而 `provider_registry.cj:436` 要求 https 或 `http://127.0.0.1:` / `http://localhost:`。后果是页面上填 `http://任意域名` 能过前端、被核心 `settings-rejected` 打回，用户只看到「保存失败」——**并且这是安全规则被前端削弱**（明文 HTTP 带上游密钥）。
- 处置（B1 内）：渲染层**不再重述规则**，校验只在核心一处；页面改为提交前不做「更松」的判定，只把核心回的错误码映射成人话（沿用 `mutationError` 那条通道，把 `settings-rejected` 的具体子因带回来）。新增断言见 §11 第 31 条。

- `models-page.ts:166` 的那道 `filter` 是号池的**第二道闸**（第一道在核心的同 id 即拒，见 §2.1）：目录项一旦被添加就从选项里消失，用户根本选不到第二份。B1 的改法是去掉这个「已添加就隐藏」的判据，改成「同一条目录项可反复选中，每次建一份新实例」，列表里靠实例显示名（`StepFun (2)`）分辨两份。**这条不动通道数**（目录列表与保存都已有通道在承载），所以 §9.2 的 `N→N+k` 不因它变化。至于渲染层「采纳目录项」这一段最终落到 `model/registry/add-catalog` 还是既有保存通路，**以 Task 7/8 开工时读到的调用点为准，本设计不凭印象写死**——两种形态都必须满足「第二次采纳同一条目录项 = 新建一份实例，而不是覆盖第一份」。

本设计新增通道按同一命名风格补齐（自定义模型 CRUD 与绑定、健康查看、额度预算、加速设置、迁移导出/导入的 plan/apply 两段），仍守两条既有纪律：**逐字段校验**、**不提供「发任意方法」通道**；增删通道必须同步改 `preload.cjs` 与 `bridge.test.mjs`（AGENTS 硬要求），且渲染层不得拼出「路由决策」或「金额累加」——它只显示核心回的数字。

### 9.3 三个入口跑同一套规则的证据

- `core`：`cd core && cjpm test`（新模块各自 `*_test.cj`）。
- `apps/cli`：新增自检模式 `modelcenter`（沿用 `main` 按子命令跑断言的形态），断言过滤链、轮询/权重序列、三次失败转冷却、预留幂等。
- 桌面：`node --test`（含走宿主可执行文件的用例）+ `npm run ui-smoke`。
- **打包态复验**：模型中心改动必须重打宿主再跑一次桌面冒烟，不能只认开发态绿（这条线上一批踩过旧宿主假绿）。

### 9.4 双入口的分工：闭环里哪几步必须在 CLI 上可用

「桌面与 CLI 使用同一套仓颉核心规则」讲的是**决策规则只有一份**，不是「两个入口各做一套管理界面」。这句话现在没人写死，实现者会按自己的理解二选一——要么在 CLI 重做一遍 CRUD，要么反过来把 CLI 做成只能用出厂默认路径。钉成清单：

- **CLI 必须能完成**（缺任何一条，最终验收的闭环就在 CLI 上断）：
  1. 选到桌面配好的同一条自定义模型并发起真实任务——读同一份 `custom-models.log` 与 `providers.log`，不写任何本地副本；
  2. 看到这次任务的结果与费用——读核心账本，CLI 侧不做二次累加（与断言 43 同源）；
  3. 显式跑一次恢复探测（`route/probe/run` 的子命令形态；§5.3 已定 CLI 不起后台定时器）；
  4. 迁移导出 / 导入（§8.5 已定 `dsh migrate export|import`，与桌面调同一段 `MigrationBundle`）。
- **允许只在桌面有图形写面**：供应商实例的新建与排序、绑定的增删与权重、导入差异预览的勾选。CLI 不做这套 CRUD 的复制品。
- **两侧都不许有第二套规则**：CLI 与渲染层都不能自己挑 provider、不能本地算金额（§3 不变量，断言 25、36、44）。
- 所以「配置供应商」这一步在 CLI 上的满足形式是**读得到桌面配好的同一份文档**，而不是在 CLI 再走一遍添加流程。

待你拍板（§16.2 第 11 行）：CLI 要不要一份**最小非交互式写面**（例如脚本化建号池用的 `dsh model provider add`）。本设计的建议是 B1–B6 都不做——上面四条已覆盖闭环，而加一份 CLI 写面等于把 §9.1 的动词面再实现一遍，收益主要在无 GUI 的机器上配池。**如果你打算在某台无桌面环境的机器上建号池，这条就从「可选」变成必要项，需要单独排一批**，届时 §9.1 的动词集与 §9.2 的通道数都要重算。

---

## 10. 落地顺序（不拆散最终需求）

| 批次 | 内容 | 出口判据 |
| --- | --- | --- |
| **B0 可行性探针**（半天级；①② 已于 2026-10-05 跑完，结论见 §15） | ① `SM4` 的真实构造形态：编译 + 一次加解密回环 + 改一字节必失败——**实测 `CBC`/`CTR` 通过、`GCM` 四种参数组合全部运行期失败**；② `stdx.crypto.digest.HMAC(key, SHA256)` 流式接口形态，用它把 **RFC 6070 向量**跑通（PBKDF2 的前置）——**实测四条取值与 Node `crypto` 逐字节一致**，并额外证成 SM4-CTR 密钥流与 `openssl enc -sm4-ctr` 逐字节一致；③ 时钟注入在冷却/探测计时上的形状——**已闭合，证据是现成源码**（`approval.cj:23-26` 的单调基准是进程启动时刻，故持久状态只能落墙钟，见 §5.3）；④ relay 转发 SSE 与 usage 透传的手工探针 | ①② 已出实测结论并据此改写 §8.2（`secret-bundle` **不 BLOCKED**）；③ 已据此补上两类时钟分工与三道墙钟护栏（断言 37–39）；④ 在 B4 开工前补，未证前不得把透传契约写成已达成 |
| **B1 模型目录** | 供应商**实例化语义与下拉可达性**（§2.1：同品牌可多份、目录项降为模板、新建撞 id 显式拒、`credentialRef` 逐实例派生；§9.2：渲染层去掉「已添加就隐藏」）、供应商新字段、上游模型能力面、`CustomModelRegistry`（**含条目自带的参数/预算/探测字段的落盘形态**，§2.3）、拉取/手动添加、两种导入操作、能力适配校验 | 目录 CRUD（含**同一目录项建两份实例都成功**）+ 重复拉取不重复导入 + 能力不适配保存即拒，均绿；断言 41、46、56、60、63、66、67 绿，断言 65 本批只收形态半（`ModelRouter` 到 B2 才存在，见 §10 末段与本批计划的出口判据第 6 条）（44 只收「第 3 层是唯一读面」这半，另半「CLI 参数拒收 `providerId`」随 B2 的取参收敛一起收） |
| **B2 调度闭环** | **先补失败输入通路**（§5.2 那三段：结构化失败对象、`attempt/failed` 事件、白名单头），再上 `ModelRouter`（过滤链 + 轮询 + 平滑加权）、**`attempt/dispatched` 先发标记与一步内不换绑定**（§6 重放闸；标记先落、账本后挂）、供应商开关语义、`RouteHealth` 三档作用域与失败分类、冷却 + 低频探测 + 试恢复、跨进程探测租约；**CLI 读同一份配置文档发起任务**（§9.4） | 目标里的每一条自动化验收绿（§11）；断言 53 只有在 429 **响应头**里带 `Retry-After` 的夹具上跑绿才算，注入常量不算；断言 62 绿；**任务侧选模型的五段通路收口（断言 69–72，含 `-32016` 拆码与推理等级归属）随本批**——B1 交付后「日常任务只选自定义模型」仍是未达成状态，不许因为第 3 层的文档面绿了就记成达成；断言 79、80、81 随本批（重放闸的标记与分类维是调度语义的一部分，不能等到 B4），82 的调用计数半随本批 |
| **B3 计量与预算** | **先补计量输入三段通路**（§7.1：结构化 usage、命名不识别改降级、「未回用量」单独成档），再上 `UsageLedger`（尝试粒度、定点金额、计价快照、预留/结算/作废、待核算）、`budget/*` 动词、统计查询面 | 并发不重复预留/结算；改价不重算历史；取消有 usage 照记；断言 73 只有在 usage 帧**分档给**的夹具上跑绿才算，喂合计数不算；断言 64 绿；断言 82 的「未结算 dispatched 进 `待核算`」那半随本批（作用域键不含机器/网络标识是同机限定的可检形式） |
| **B4 加速通道** | `TransportChannel` 的 `direct`/`relay`、slug 允许集、流式与取消透传、线路健康与模型健康分档、**`chat`/`discover`/`probe` 三形态共用同一通道决策**（把 `model_catalog.cj:101` 的自建直连收进来） | relay 下真实模型跑通一条端到端，且线路故障不动模型失败计数；断言 40、45 绿 |
| **B5 迁移** | `config` 包与 `secret-bundle`、差异预览、合并/替换、**凭据覆盖的单独确认闸**、**导入落盘由本机 principal 盖写归属**（§2.4 对偶）、CLI 子命令与桌面接线 | 本机导出 → 干净目录导入 → **路由可用＝断言 77 绿（候选集非空且能选中，不是「条目存在」）**；`config` 包字节级扫不到任何密钥；断言 42、78 绿 |
| **B6 面板** | 费用/用量统计（**含按实例 `providerId` 的分组回看**，§7.5）、健康展示、探测记录展示 | 展示数字全部来自核心读面，无本地二次计算；断言 61 绿 |

每批都按现有流程红先、变异反证、双入口复验；**批次顺序不等于范围裁剪**，B6 完成才谈得上「模型中心达成」。

断言 **65** 在 B1 只能收形态半（那三个决策单元 B2/B3 才存在），全半随 B2、B3 各自批次补绿；**66、67** 随 B1 全绿；**68** 依赖 extensions 那条线的承接面，在通用装配契约落地前保持为**形状约束**——现阶段的判据是「核心没有新增任何让扩展自头发模型请求 / 自写凭据 / 绕开账本的通路」，这一条现在就成立。如实登记：68 **不是**已有绿色用例覆盖的断言，也不因它还没有独立绿而从 §11 删除。

实现计划按批出：本设计先出 B1 的实现计划（B0 的 ①② 已跑完并已据此改写 §8.2，`secret-bundle` 不再挂在 BLOCKED 上；③④ 归到 B2/B4 开工前），B2 及之后各批在本表出口判据下逐批另出计划，不因后批未排而从前批里删需求。

---

## 11. 验收表（可证伪断言）

| # | 断言 | 反证方式 |
| --- | --- | --- |
| 1 | 重复拉取同一**实例**两次，该实例的上游模型与绑定条数不增（作用域是实例，见 §2.1；**不许**据此实现成「同一品牌只允许一份实例」——那与号池口径冲突，由断言 56 反向钉住） | 把去重改成追加，指定用例转红；或把去重键从实例升到品牌，断言 56 转红 |
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
| 27 | ETM 封装回环等价（SM4-CTR 加密 + HMAC-SHA256 认证）；密文、IV 或信封头任一改一字节 → 解包必失败，**不产出明文**；口令错 → 同样失败 | 先解密后校验、MAC 比较提前返回、或忽略认证标签继续导入 |
| 28 | `aad` 绑头部：把头里 `kind` 从 `secret-bundle` 改成 `config` 后解密失败 | `aad` 留空 |
| 29 | 错误口令只报「口令不对/解不开」，不回吐任何部分明文，也不落口令 | 失败路径把已解出的片段写进日志 |
| 30 | 信封头显式记录 `cipher`/`kdf`/迭代数/各长度；未知算法标识直接拒 | 按当前实现硬猜旧包参数 |
| 31 | 渲染层不再重述校验：非回环 `http://` 在**前端就拒**，且前端接受的形态是核心规则的真子集（核心 `provider_registry.cj:436`） | 把 `validateDraft` 的 URL 判据放宽回 `http:` 通吃（现状缺陷） |
| 32 | 401/403 暂停的作用域，在 `credentials/rotate` 使 `revision` 变大后**立即重新纳入候选**，不等冷却窗口 | 忽略 revision，硬等到 `notBefore` |
| 33 | `credentials/revoke` 后该作用域转「待绑定凭证」，与缺凭据态同口径、不可调度 | revoke 当无事发生 |
| 34 | 目标执行多步时**每一步重新过调度**：第 2 步上游失败后可切到另一条路由，续跑闭包不捕获具体上游（§4.1 缺陷 A） | 保持现在冻在闭包里的单上游续跑 |
| 35 | 未实现协议适配器的绑定被排除出候选并回带类型拒绝，**绝不按 OpenAI 形态盲发**（§4.1 缺陷 B）；拒绝名**沿用或统一**现有 `-32016 protocol-not-supported`，不得再另起一个同义码名（§4.1 补写） | 把 `anthropic-messages` 当 `openai-completions` 发；或新旧两个名字并存，前端两套映射 |
| 36 | 产品路径（`task/start`）的取参只剩一条通道：自定义模型 → 路由 → `credentialRef` 现解析；`DSH_PROVIDER_*` 兜底不参与，缺配置 fail-loud | 环境变量影子压过用户配置，或静默回落假 provider |
| 37 | 落进 `route-health.log` 的 `notBefore`/下次探测时刻**只能是墙钟 epoch 秒**：进程 A 写的冷却状态，由刚启动的进程 B 读，判定不受 B 自身单调零点（`approval.cj:23` 的 `MonoTime.now() - base` 每进程重算）影响 | 把单调值落盘，等于跨进程写了个随机数——冷却要么永不过期要么立刻过期 |
| 38 | 系统时钟往回拨**不得延长**冷却：读侧以「本机见过的最大时间戳」为现在下界；`notBefore` 超出写入时刻 + `cooldown.maxHorizon`（默认 24h）时按裁剪值落盘，并另记「恢复时刻已裁剪」事件、页面标为估算 | 改一次时钟把路由永久冻结；或供应商一个超长 `Retry-After` 就无限期停用 |
| 39 | 钟被改坏时探测仍不越预算：`probe.maxPerDay` 按落盘**条数**计，与墙钟/单调钟都无关 | 探测频率唯一依赖时间差，时钟异常即变成密集探测烧钱 |
| 40 | 加速覆盖三种用途而非只覆盖推理：某供应商切成 `relay` 后，`model/pull`（发现）与 `route/probe/run`（探测）实际请求的地址是 `{relayBase}/upstream/{slug}/…`，**不是** `provider.baseUrl`（§6；现状 `model_catalog.cj:101` 的 `fetch` 在 `:105` 自建 client 直连，必须收进通道） | 只把 `chat` 接进 `TransportChannel`，发现与探测仍各自直连 |
| 41 | 跨币种不许用统一单价抹平：同一自定义模型内出现两种非空 `currency` 且未登记换算时，保存即 `settings-rejected`；登记了换算则换算快照随 attempt 落盘，历史账单不重算（§2.3、§7.2） | 把币种当纯显示字段不参与校验，或结算时按当前汇率折算历史 |
| 42 | 导入永不静默换密钥：`migrate/import/apply` 未收到「覆盖已有凭据」的显式确认标志时，对**本机已有值的 `credentialRef`** 一条都不写，其余条目照常导入且回执如实区分「已导入 / 因需确认而跳过」 | 拿到 `secret-bundle` 就把全部密钥覆盖写 |
| 43 | 费用可追溯且不因换线路断链：任一笔账目能沿 `logicalRequestId → attemptId` 回溯到目标/会话/轮次与当次所选上游；同一次逻辑请求换过一次线路时**两条尝试都在账上**、金额与计价版本各自独立（§7.1，目标里的「可追溯的费用统计」） | 换线路后只留最后一条尝试，或把多次尝试合并成「一轮一笔」 |
| 44 | 任务输入侧只认自定义模型：CLI 的模型参数与桌面下拉的候选**只出自第 3 层**，传入 `providerId` 或上游模型 ID 直选要被拒（§2.3 末条） | 下拉把第 2 层条目也列出来，或 CLI 悄悄接受供应商 ID |
| 45 | 经 relay 的发现与探测不改变归类：线路不可达只记 `channel` 档、不动 `upstream` 三次计数；发现失败仍不写目录、仍不报「0 个模型」（§6 末段，继承断言 2、22 的口径） | 把 relay 不可达算成模型故障；或发现失败清空上游模型 |
| 46 | 自定义模型条目的**参数/预算/探测字段随 B1 落盘并可逐字回放**；缺省语义是「未设置」而**不是 0**（§2.3）：`defaultParams` 原文 JSON 无损回读、且拒绝承载明文凭据字段；预算列缺省时 §4 的过滤不得判成「已耗尽」 | 把缺省预算存成 0（路由立刻全部被预算闸掉），或参数文本落盘后被重新序列化改写字段顺序 |
| 47 | 导入后「设置」逐类等值（目标 §5 第三条的字面清单）：供应商与上游模型、自定义模型与绑定顺序/权重、计价条目与版本、模型额度预算、探测策略（`probe.enabled`/`maxPerDay`）与 `defaultParams` **逐项比对相等**，而不是只证「条目数没变」 | 只比条目数，把预算与探测策略在导入途中丢掉 |
| 48 | 调度面与凭据/网络在**形态上**隔离（目标 §6 第二条）：`ModelRouter` 的字段集与入参里不出现 `CredentialStore`、`Client`/`HttpRequestBuilder` 或任何读时钟的调用，凭据只在装配点按 `credentialRef` 现解析（§3 的「明确禁止」列由此变成可检的东西） | 路由器里顺手 `resolve` 凭据或直接发请求——功能照样绿，但分离边界没了 |
| 49 | 每一步续跑都重新过一次调度且**不改 `core` 签名**：宿主传给 `ModelAgentRunner.start` 的 `nextProvider` 工厂每步向 `ModelRouter` 要路由，第 2 步失败可换到另一条 `baseUrl`；`model_agent.cj` 的 `start`/`run` 签名保持原样（§4.1 定位修正） | 把工厂改回 `request => RealSseProvider(常量 baseUrl, …)`——即当前 HEAD 的形态，指定用例转红 |
| 50 | 租约三条语义都被钉住：**一个作用域一个租约文件**（A 作用域在途不挡 B 作用域）、拿不到租约立刻回 `probe-in-flight` 而不是静默跳过或排队、持有者进程确认已死才可接管（`isProcessAlive` 判活为真时绝不删别人的租约） | 共用单一 `route-health.log.lease`（跨作用域互斥）；或拿不到锁就静默返回；或按「租约存在太久」直接删 |
| 51 | 账本租约的临界区不跨网络：`UsageLedger` 的 `reserve`/`settle` 在**归还租约之后**才允许出现 provider 调用（形态断言，照 48 的检法），且 `release()` 在 `finally` 里成对出现 | 把「预留 → 请求 → 结算」整段圈进一次持有——另一个入口在请求期间一次也写不进账本 |
| 52 | 双入口**功能面对称**：B1 交给宿主的每个写侧动词都有对应的桌面 IPC 通道，逐一对映（10 动词 ↔ 10 通道），缺一即桥接回归红——否则出现「核心能改、桌面改不了」的半成品（本批实测抓到过一例：`binding/reorder` 有动词、有核心实现，却不在通道清单里，用户在桌面上无法调整绑定顺序，而目标 §1 正是要「配置上游绑定、顺序」） | 少加一条通道，或反过来加一条宿主没有实现的通道 |
| 53 | 供应商证据走的是真实通路：429 且**响应头**带 `Retry-After` 时 `notBefore` 取该值（夹具必须是头里真有的 429，常量注入不算这条的绿）；头缺失才落到阶梯（§5.2 第 1 段现状是先 `close` 再抛、全仓无读头代码） | 继续丢弃响应头，只把状态码塞进异常文案 |
| 54 | 失败事实进会话日志且可跨重启回放：三次有效失败落三条 `attempt/failed`，新进程读同一份日志得到同一冷却态（§5.2 第 3 段；断言 5 核的是输出侧，这条补输入侧） | 失败只作为异常出到宿主错误帧、不落日志——重启后计数静默归零 |
| 55 | 线路故障与模型故障在**直连路径上也能分开**：连接被拒 / DNS / TLS / 读超时归 `channel` 且不增 `upstream` 计数；分不清就标 `unknown` 且不进任何计数（§5.2 第 2 段，现状一律 `http-request-error`） | 保留单一 `http-request-error` 文案，或把传输失败默认算成模型故障 |
| 56 | 同一供应商可有多份实例：用同一条目录项建两份、各自 `credentialRef`，两份都在读面里、可各自开关，第二份的密钥不覆盖第一份（§2.1；现状 `addFromCatalog` 对已存在 id 直接 `settings-rejected`，这条钉它被改掉） | `credentialRef` 改按品牌/显示名派生；或新建撞 id 时静默走替换分支，把第一份顶掉 |
| 57 | 号池隔离性：同一 `baseUrl` 的两份实例，一份进 `cooling` 时另一份仍可被选中；健康状态的键里不含品牌与 `baseUrl`（§5.1 三档键） | 按 `name` 或 `baseUrl` 聚合熔断——一个 key 挂了整池不可用 |
| 58 | 迁移往返保住池：含 N 份同品牌实例的配置包在新机导入后仍是 N 份实例、各自指向自己的凭据引用（§8.3 按稳定 ID 对齐） | 导入时按地址或名称做「智能合并」，两份塌成一份 |
| 59 | 池不放大计费探测：N 份实例是 N 个作用域，但每日探测总条数受 `probe.maxPerDayGlobal` 约束，触顶后不再发请求并回 `probe-budget-exhausted`（§5.3，取值见 §16.2 第 10 行） | 只按作用域计数、无全局闸——加 key 就等于加计费请求 |
| 60 | 号池对用户**可达**：某条目录项已添加一份后，桌面下拉里它**仍然可选**，再选即建第二份实例，列表里两份靠显示名可辨（§2.1、§9.2；现状 `models-page.ts:166` 的 filter 就是这条的红灯来源） | 只改核心不改渲染层——核心能建两份，用户选不到，需求在用户视角仍未闭 |
| 61 | 统计面不把实例维度聚合掉：核心读面能按 `providerId` 回看某自定义模型下各实例的用量与费用，页面只显示回来的数字（§7.5） | 只按 `usageKind` 汇总——号池里「哪把 key 先撞额度」看不出来，池退化成盲轮询 |
| 62 | 双入口读**同一份配置**：桌面建的实例池与自定义模型，CLI 侧发起任务时选到的是同一条目、同一份健康与账本状态，且 CLI 不写本地副本（§9.4） | 给 CLI 造一份自己的模型表或缓存；或 CLI 只跑得起出厂默认那条单上游路径——「规则一致」就退化成「桌面独占功能」 |
| 63 | 「无需账号即可使用」是**结构性的**而非文案：`Principal` 只有 `kind: "local"` 与 `installationId` 两个字段；核心与宿主不存在 `login`/`register`/`auth/*` 一类动词或 IPC 通道；将来接账号必须**新立批次**，不许给现有写面加一个可选的 `userId` 参数（§2.4、§12） | 给 `custom/upsert` 悄悄加 `userId`，或新增一个 `auth/login` 却不声明批次——「当前不建账号」就变成装饰话。**取证陷阱**：现状 grep `register` 有 72 处命中，全是工具注册面（`unregistered-tool` 一类）的词面碰撞，**不许**拿词面命中当作「已有账号体系」的证据，也不许拿它反证「没有」——判据是动词/通道清单本身 |
| 65 | 模型中心不做成硬编码特判：**新增一种 `protocol` 只动 provider 适配单元与目录数据**，`ModelRouter`、`UsageLedger`、`RouteHealth` 与宿主方法分派里不出现按 `protocol` 分支的字面量（形态断言，照 48 的检法；PRD A12「固定硬编码能力…不得判通过」在模型中心上的对偶，见 §3.1） | 在调度或账本里写 `if protocol == "anthropic-messages"`，把协议泄漏进决策层——将来接装配契约时要整段拆掉 |
| 66 | 能力清单只有一份：`initialize.capabilities` 声明的动词集与实际可分派的动词集**双向相等**（声明未实现 → 红；实现了未声明 → 同样红），且桌面通道由这份清单派生而非另写一份（§3.1；断言 52 只核「少一条通道」，这条核「各写一份」） | 宿主手写一张 `if method ==` 表、桌面另写一张通道名单，两张各自漂移，声明面变成广告 |
| 67 | 「内置」按 PRD 的字面义成立：**装配与使用模型中心全链路不依赖注册、登录、市场或发布**（§5「用户无需先去市场寻找必需能力」）；B1–B6 的文档面与决策面用例在断网下全绿（真实模型请求那类本就在凭据门后，不在此列） | 把模型中心做成「先装某个插件/先登录才能选模型」，或让核心在启动时够远端清单 |
| 68 | 第三方提供方走同一扇门：经适配宿主承接的模型提供方只能通过核心注册表 + `UsageLedger` + `RouteHealth` 发请求，**不得**自开 HTTP、自写凭据、绕开 `reserve`/`settle`（§3 信任边界与 §4 账本在插件面上的对偶；§5「动态扩展通路也必须保持身份、参数及权限校验」） | 给扩展开一条「自己发模型请求」的旁路，预算、账本与健康计数同时被绕过 |
| 69 | 「日常任务只选自定义模型」按 §2.3 那张表**五段逐段收口**：发起任务时进入决策的只有 `customModelId`，`baseUrl`/`credentialRef`/`protocol`/能力全部由路由结果派生，而不是再从 `(defaultProviderId, defaultModel)` 匹配一遍（实测这类匹配循环在 `apps/host/src/main.cj` 里有两处，是必须消失的形态；按 §4.1 纪律该文件只认符号不认行号，定位一律 `grep -n "registryView.defaultProviderId && registryView.defaultModel.size" apps/host/src/main.cj`，HEAD 实测命中数恰好 2） | 页面上多了一个自定义模型下拉、核心也多了一份文档，但 `turn/start` 仍按两层指针取参——第 3 层变成装饰，断言 44 的「唯一读面」在生产通路上落空 |
| 70 | 两层指针 → 自定义模型标识的切换落成**日志里一条显式事件**，原指针值迁移后仍可回读，不做静默改写或就地删除（形态见 §16.2 第 12 行） | 迁移时直接覆盖用户既有选择；或旧机器导入后默认选择凭空变化，与迁移包对不上账 |
| 71 | 拒绝不再一码多义：`protocol-not-supported` / `model-not-configured` / `model-credential-unavailable` / 兜底异常各回自己的类型化码（实测现状 7 处共用 `-32016`），渲染层才能按 §9.2 把子因说成人话 | 继续同码不同文案，桌面只能显示「操作失败」；或新码名与旧码名并存 |
| 72 | 生成参数只有一个真源：任务侧推理等级面板与自定义模型自带 `params` 不得各自持久化一份（归属见 §16.2 第 13 行）；无论选哪种，两次任务的参数差异都必须能由日志解释 | 面板存 `retainedEffort`、模型条目再存 `params`，同一颗模型两次任务参数不同且账本快照解释不了 |
| 77 | 导入后**立即可调度**：干净目录里导入配置包并补上凭据后，新进程的 `ModelRouter` 对该自定义模型给出的候选集**非空**且能选中一条路由（这是 §2.4 principal 作用域的对偶；B5 出口判据里「路由可用」那句的可执行形式）。只核「条目数对得上」「日志里 grep 得到」不算这条的绿 | 导入事件沿用源机的归属戳记，本机按「别人的条目」如实隐藏——文档面全对、调度面空集，且没有别的断言会红 |
| 78 | 包内归属字段既不被信任也不被写入：构造一份声明 `owner=外来值` 的夹具，导入后本机的作用域键必须是本机安装 ID，外来值既不授权也不落盘（§8.3 那条描述话的断言化） | 把包里的 owner 声明当作用域键的一部分，换机后所有条目挂在一个本机并不持有的身份下 |
| 79 | 重放闸读的是**日志里先发落盘的 `attempt/dispatched` 标记**，不是内存标志：任何「要不要再发一次」的判定都以该 `attemptId` 有无 dispatched 事件为准（§6；这是「能确认请求未发出」的可执行形式） | 发送完才写标记——崩溃正好落在发送与补记之间时，重启后毫无痕迹，于是把可能已送达上游的请求重发一遍，用户付两遍钱 |
| 80 | 标记写不下去就**不发**（fail-closed）：租约拿不到或落盘失败时返回带类型拒绝，绝不先发再补记；且 `reserve` 与 `dispatched` 是两次短临界区，不许把网络调用圈进任何一次持锁（与断言 51 同族） | 用「补记」换取可用性，恰好在最需要证据的场合没有证据；或为省一次租约往返把整段圈进一次持有，另一个入口全程被冻 |
| 81 | 失败分类带得出「请求是否已上线」这一维：`transport` 里的连接被拒/DNS/TLS 握手失败与读超时/半身后断必须分档（`reachedUpstream`，且**不得**由 `kind` 反推），`TransportChannel` 的重发白名单只能按这一维判，不许按错误文案猜（§5.2、§6） | 保留单一 `transport` 名单，重发时靠字符串匹配错误文案——换一条上游文案就把已送达的请求重发出去 |
| 82 | 崩溃恢复不产生第二次上游调用：跑到一半 kill 进程，新进程读到 dispatched 未结算 ⇒ 该笔进 `待核算`，且夹具 provider 的**调用计数不增加**（断言 24 核的是失败后不自动重发，这条核的是崩溃后；记账那半随 B3，调用计数那半随 B2 就能测） | 恢复时按「上一轮没成功」再试一次，或把未结算的 dispatched 当成没发生过 |
| 73 | 分档用量走的是真实通路：夹具的 usage 帧必须写成上游真实形态（`prompt_tokens`/`completion_tokens` 分开给，或带 `cache_read_input_tokens` 一类扩展字段），账本里能读出**各维度独立数值**；只喂一个合计数的夹具不算这条的绿（§7.1 第 1 段，现状在解析点就 `p + c`） | 解析时合成一个数，计价层再声称分档——分档根本不存在 |
| 74 | 认不出的 usage 字段名**降级不失败**：正文与终态照常交付，用量记 `meterSource=unknown` 并进 `待核算`；`protocol-error` 只留给帧结构违例（§7.1 第 2 段，现状 `usage` 缺 `total_tokens` 且缺 p/c 时，对已正常返回的轮次整体报错） | 把「上游用量字段换了名字」变成整轮失败，或反过来把它记成零消费 |
| 75 | 「本轮未回用量」与「用量格式非法」分档，不共用 `usage/bad-usage`（现状 `settleTurn` 在 `finishReason` 非空且 usage 为空时仍调 `record("")`，`badCount` 会被合法情形污染）：前者进 `待核算`，后者才计违例 | 一档同时容纳「常见且合法」与「契约违例」，于是违例计数再也用不了于判断上游是否异常 |
| 76 | 计价按维度登记，禁止**币种内**抹平：绑定费率表里未登记的维度（`-1`）遇到该维度用量时使该笔落 `待核算`，不得用已登记维度反推、也不得用总量乘单一单价（断言 41 在同一币种内部的对偶；§2.3 绑定条目已据此从单一 `priceMicro` 改为四档） | 用 blended rate 把输入/输出算成一个数：账面自洽、断言 41 也不违反，但每一笔都是错的 |
| 64 | 「当前不宣称跨机器协调」可证：账本与租约的**作用域键里不含任何机器或网络标识**（只有本机路径 + 同机作用域键，形态断言照 48 的检法），且展示面把本地累计费用标成「本地累计」而不是「余额/已同步/多设备」（§7.3 括注、§7.5、§12） | 往作用域键里塞 `deviceId` 或远端主机名；或把本地累计显示成账户余额——那是把「同机限定」偷偷说成跨机能力 |
| 83 | 选择器不产持久写：连续选择 K 次后 `custom-models.log` 与 `route-health.log` 的**条数与 revision 逐字不变**（选择本身不落任何事件） | 让 `select()` 顺手写一条游标事件即红；这条同时把「把游标塞进用户编辑面」那条被禁止的路钉死 |
| 84 | 比例与饥饿**分开**成立：3 个 available 候选配 `1:1:100`，连续 `sum(weight)` 次选择内每个候选各被选中 ≥ 1 次；权重 100 者在 1000 次里占比 ≥ 容差下界 | 换成随机（比例不可解释）或纯顺序（比例失效）都会红；把游标初值固定成「总从最高权重开始」也在这里红 |
| 85 | 游标复位是允许行为、但不是饥饿的借口：每次「冷启动」后的前 `sum(weight)` 次选择内每个 available 候选仍各被选中 ≥ 1 次；页面不得把「本轮没轮到」显示成「该实例被排除」 | 断言 5、37 管的是**健康状态**跨重启，这条管的是**游标**——把两者合成一条「状态都持久」就会漏掉「高频重启让低权重实例长期打不出去」 |

### 11.1 最终验收闭环的对位

| 闭环步骤 | 承担批次 | 断言编号 |
| --- | --- | --- |
| 配置供应商 | B1 | 4、17、31、56、57、60 |
| 创建自定义模型 | B1（44 的「CLI 参数拒收」半随 B2 取参收敛） | 1、2、3、41、44、46 |
| 发起真实任务 | B2（+B4 走加速时） | 3、10、21、23、24、40、45、49、62、69、70、71、72 |
| 查看结果与费用 | B3 / B6 | 8、14、15、16、43、51、61 |
| 故障后自动恢复 | B2 | 5、6、7、11、12、32、33、37、38、39、40、45、53、54、55 |
| 安全导出 | B5 | 17、26、27、28、30 |
| 新机器导入并继续使用 | B5 | 18、19、20、29、42、47、58、77、78 |
| 三入口规则一致 | 每批 | 25、52 |
| 边界隔离（目标 §6 第二条，非闭环步骤） | B2 立形、后续每批不得回退 | 48 |

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
| 本栈没有 AES 也没有 KDF；自建 PBKDF2 是必需而非可选 | §1.3 已把符号面钉死；§15 已用 RFC 6070 向量 + Node `crypto` 外部对照面把 PBKDF2/HMAC 逐字节钉住。**对外表述只写 128 位安全强度，不写成 AES-256**；SDK 将来提供 AES 或真实 KDF 时按信封头的算法标识换档，旧包仍可自描述解出 |
| ~~`SM4` 构造形态只有符号证据、没有运行证据~~ → **已闭合，且结论与符号面相反** | §15 实测：`CBC`/`CTR` 可用、`GCM` 四种参数组合全灭（含把 OpenSSL 3.5.4 钉进 exe 目录复现）。已据此把封装改成 ETM（§8.2），`secret-bundle` **不 BLOCKED** |
| relay 需要真实服务端才存在，本地只能桩验证 | B0/B4 用受控桩证传输契约（含帧透传与取消），真实网关接入单独记「待运行验证」，不写成已达成 |
| 供应商的额度重置时刻与限流语义各家不同 | 只采信供应商明确证据；无证据走阶梯并在页面标「恢复时刻为估算」 |
| **失败分类的输入通路三段全缺**（§5.2 实测：响应头被丢、非状态码错误一律塌成 `http-request-error`、失败不落日志） | B2 第一步就是补这三段并出断言 53–55；**补之前不得把断言 7、22 的绿当成生产通路达成**——那两条此时只能靠夹具喂 |
| 账本与文档共用目录的写竞争 | 全部经 `WriteLease`；`bridge.test.mjs` 在仓库根用 `dualtest/`，异常残留先 `rm -rf dualtest` |
| 宿主产物过期导致的假绿 | 每批模型中心改动后重打宿主再跑桌面用例，并核 exe 的 mtime |
| 并发会话同仓改源码 | 本设计只新增一份文档，落地时逐文件精确暂存，不吞他人改动 |
| 重放闸只有「能确认请求未发出」这句话，没有可写下的标记，`kind` 里也没有「是否已上线」这一维 | 断言 79–81：先发落盘 `attempt/dispatched`、写不下去就不发、失败对象带 `reachedUpstream`；**没有标记时不得实现任何自动重发** |
| principal 作用域与迁移互斥：隔离机制如实隐藏带外来戳记的导入结果 | 断言 77（导入后候选集非空）+ 78（外来 owner 值不授权也不落盘）；这两条与 §2.4 那条指名用例是**同一机制的两个方向**，只跑单向会一路绿灯到底 |
| 计量的输入通路缺三段（分档被相加、命名不识别即整轮失败、未回用量塌进 `bad-usage`），实测见 §7.1 | B3 第一步就是补这三段并出断言 73–76；**补之前不得把断言 15、43 的绿当成生产通路达成**——那时它们只能由夹具喂 |
| 只加自定义模型下拉、不收 §2.3 那五段通路 | 断言 69 按段核（`grep -c registryView.defaultProviderId apps/host/src/main.cj` 必须从 **2** 收到 **0** 才算决策面收口）；B1 出口判据里如实写「日常任务仍走两层指针」为未达成 |
| 「内置」被读成「可以硬编码特判」，模型中心的判定散进宿主分派与页面主干 | §3.1 + 断言 65/66 是形态断言，B1 内即可红；通用装配契约那一批落地时**若要求重写模型中心**，按 B1 的形态违规处理，不记作「契约变更」——这条是本设计替后面那批守的 |

---

## 14. 冻结分母（提交级取证，后续批次的算术基准）

在**只含提交**的隔离副本上取（`git worktree add --detach ../verify-head-modelcenter HEAD`，取的是 `e35f599`），工作区里其它会话未落库的 `core/src/goal_scheduler.cj`、`prompt_enhance.cj` 不在内：

| 入口 | 命令 | 实测计数 | rc |
| --- | --- | --- | --- |
| 核心 | `cd core && cjpm test` | **TOTAL 463 / PASSED 462 / SKIPPED 1 / FAILED 0 / ERROR 0**（SKIPPED 1 是凭据门用例，本机无凭据） | 0，且打印 `cjpm test success` |
| CLI | `cd apps/cli && cjpm build` → 副本根逐模式 | `all` **100**、`stream` 21、`tool` 11、`ext` 8、`cancel` 9、`extjs` 12、`headless` 36、`sig` 6 → **203 PASS** | 0 |
| CLI `sig` 的 4 条红 | 同上 | `中断确实送达处理器`、`在途 turn 因中断收束`、`中断类型是 Ctrl+C 或 Ctrl+Break`、`取消的 turn 留下 turn/cancelled` → 按**已知本机中断投递阻塞**记 BLOCKED，不记回归（见 [[project-windows-ctrl-c-delivery-blocker]]） | — |
| 桌面 | 未冻结 | 隔离副本没有 `apps/desktop/node_modules`，跑不了 `npm test`；**工作区态的计数不能当 HEAD 分母**。B1 若要写「N→N+k」，先在同副本 `npm install` 后单跑一次 | — |

对照 `docs/evidence/handoff-model-provider-2026-10-04.md` §4：`all` 由 77 → **100**，其余六个模式计数不变。

### 14.1 四个取证陷阱（本批实测踩到，写下来免得再踩）

1. **干净副本里 `cjpm build` 不会把 stdx DLL 拷到 exe 同目录**，而主仓 `apps/cli/target/release/bin/` 里有 37 颗（历史打包留下的）。直接跑副本产物会 `rc=127`、**stdout 空**，逐模式 `grep -c '^PASS'` 得 0——看着像「零断言通过」，其实进程根本没起来。真因要分开捕获：`> out 2> err` 才看得见 `error while loading shared libraries: libstdx.net.tls.dll`（把 stdx 目录加进 PATH 在这台机器上仍不生效，必须拷到 exe 同目录）。
2. **CLI 各模式的输出形态不统一**：`all/stream/tool/ext/cancel/extjs/headless/sig` 用 `^PASS`/`^FAIL`，而 `seed`/`projection` 用 `ok\t<词>\t<数>` 形态。按 `^PASS` 计数会把这两个模式读成 0 条断言，等于漏分母。
3. 颜色码会插在 token 中间（与 `cangjie-cjpm-test-result-verification` 记的同一类陷阱），计数前必须先剥 ANSI 再匹配。
4. **`cjpm build ... | tail` 会把构建退出码换成 `tail` 的 0**，于是 `&& ./main.exe` 照跑**上一轮遗留的 exe**——B0 里就出现过一次「编译失败但运行输出看似新结论」（实际是旧二进制）。修法：先 `rm` 产物、构建重定向到日志文件、单独取 `$?` 判 rc，再决定是否运行；`rc != 0` 时打印 `NOT RUN`，绝不让运行发生在构建失败之后。

## 15. B0 密码学探针实测记录（2026-10-05，结论已据此改写 §8.2）

**方法**：一次性探针包 `target/b0/`（gitignore 产物目录，不进产品源码、不进 workspace），只用 `core/cjpm.toml` 同一条 `[target.*.bin-dependencies] path-option` 指向 `stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx`；`cjpm build` 通过后把该目录全部 `*.dll` 与探针 exe 同目录放置（§14.1 第 1 条），按 `^PASS`/`^FAIL` 计数。外部对照面两个：**Node `crypto`**（HMAC-SHA256 与 PBKDF2-HMAC-SHA256）和 **`openssl enc -sm4-ctr`**（密钥流）。工具链：cjc/cjpm 1.1.3（cjnative，x86_64-w64-mingw32）。**现场已入库**：`docs/evidence/model-center-b0-2026-10-05.md`——探针目录在 gitignore 的 `target/` 里，评审的人不该依赖某台机器上的临时目录才能复核，所以那份文件带逐字复跑命令、原样输出、与 Node `crypto` 的逐字节比对表，以及 OpenSSL 两张表的区别（取错表会得出相反结论）。

**本轮总账：11 PASS / 4 FAIL**（4 条 FAIL 全部是同一条 `SM4-GCM` 路径的四个参数变体）。

| # | 断言 | 实测 |
| --- | --- | --- |
| 1 | `SM4(OperationMode.CBC, 16B key, iv:16B)` 可构造可加密 | PASS，`enc=32`（明文 31 字节，SDK 按 PKCS7 补 1 块内字节） |
| 2 | CBC 解密逐字节回到原文 | PASS |
| 3 | `SM4(OperationMode.CTR, ...)` 可构造可加密 | PASS，`enc=31 == plain=31`（流式用法，实测不填充） |
| 4 | CTR 解密逐字节回到原文 | PASS |
| 5 | GCM `iv=12 + aad + tagSize=16` | **FAIL `Encrypt failed due to create tag error.`** |
| 6 | GCM `iv=12 + 无 aad + tagSize=16` | **FAIL 同上** |
| 7 | GCM `iv=16 + aad + tagSize=16` | **FAIL 同上** |
| 8 | GCM `iv=12 + aad + tagSize=12` | **FAIL 同上** |
| 9 | ETM 密文形态（`ct == plain`，`tag=32`） | PASS |
| 10 | ETM 正确口令回环等价 | PASS |
| 11 | ETM 改密文 1 字节 → 拒绝解包 | PASS |
| 12 | ETM 改信封头（`secret-bundle`→`config`）→ 拒绝 | PASS |
| 13 | ETM 错口令 → 拒绝 | PASS |
| 14 | ETM 改 IV 1 字节 → 拒绝 | PASS |
| 15 | `SecureRandom().nextBytes(Array<Byte>)` 产盐/IV | PASS |

**GCM 失败归因（不是环境版本问题）**：

- `openssl list -cipher-algorithms` 里 **`SM4-GCM @ default` 是存在的**（OID `1.2.156.10197.1.104.8`）；它只缺席于 `cipher-commands`（那是 CLI 子命令名单，不代表 provider 能力）——**先前据 `cipher-commands` 判「本机 OpenSSL 无 SM4-GCM」是取错了表**。
- 本机同时存在两颗 `libcrypto-3-x64.dll`：`/mingw64/bin` 是 **OpenSSL 3.5.4**，`C:/Program Files/Huawei/BasicService` 是 **3.0.9**（低于文档要求的 3.2）。把 **3.5.4 复制进 exe 同目录**（Windows DLL 搜索序第一位，消除 PATH 歧义）后重跑，**四个 GCM 变体仍全部同一错误**。
- → 结论：失败在 **stdx 1.1.3.1 的 GCM 调用路径**上（错误文案 `create tag` 指向取认证标签那一步），不是本机缺库、也不是参数取值。这条我们改不了，所以按 §8.2 换构造，而不是把 `secret-bundle` 挂成 BLOCKED。

**逐字节对照值**（换机器或复核时可直接重放；盐=`16×0x07`、IV=`16×0x09`、口令 `migration-passphrase`、明文 `sk-upstream-secret-长度不定` 的 UTF-8 共 31 字节）：

| 项 | 值 |
| --- | --- |
| HMAC-SHA256(`key`, `The quick brown fox...`) | `f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8` |
| PBKDF2 c=2 dkLen=32（pass/salt） | `3e915a8b575707d72fe3dfd731e8fb5d050ac4922d31fd8bd05cd592df666e9e` |
| PBKDF2 c=4096（password/salt） | `c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a` |
| PBKDF2 c=1 dkLen=40（多块） | `051e945b44155846de9d879b8c062eee1f5fc6ef37e33c8a8ee0a770d45be8da441d1113172e4b85` |
| 派生 encKey（上下文 `\|enc`，c=2） | `a29978a5494a4a948542f0f3efe32d58` |
| 仓颉 SM4-CTR 密文 | `b1ebc0d73303e40c3fd93a36c5ca4d9074cf1e5fa6a067aa01ad089ec808ba` |
| `openssl enc -sm4-ctr -K a299…d58 -iv 0909…09` | **与上一行逐字节一致**（独立实现复现） |
| ETM 标签 HMAC-SHA256(macKey, header‖iv‖ct) | `31f73b01ecb866c3697674841a9d60c8091be0e1f225ffdd55d6adef5d0c36c5` |

**B0 余项**：③ **已闭合，证据是现成源码而非新代码**——`core/src/approval.cj:23-26` 的 `monotonicSeconds()` 返回 `MonoTime.now() - base`，base 是**本进程启动时刻**，且 `ApprovalDesk.init(log, clock!: () -> Int64 = monotonicSeconds())` 就是既有注入形态；这条缝可直接给 `RouteHealth` 用，但**单调值一次都不能落盘**（跨进程/跨重启读它等于读随机数），于是 §5.3 补了两类时钟分工与三道墙钟护栏，§11 补断言 37–39。④ relay 的 SSE 与 usage 透传桩测仍**未跑**，归 B4 开工前；未证前不得把透传契约写成已达成。探针代码留在 gitignore 的 `target/b0/`，不进产品源码；①② 的**现场已入库**为 `docs/evidence/model-center-b0-2026-10-05.md`（本轮 2026-10-05 重跑复现：按 token 计数 **PASS 11 / FAIL 4 / SKIP 1，总 16**；4 条 FAIL 全属 `SM4-GCM` 构造本身，1 条 SKIP 是 GCM 拿不出密文所以篡改分支无从执行——不是漏测），复现依赖的是入库文件里的命令，不是这台机器还留着目录；`secret-bundle` 的正式实现要在 `core` 里按 §8.2 红先重写一遍，探针不构成防回归。

---

## 16. 目标逐条覆盖对照（「整体需求不缩减」的机械证明）

做法：把目标原文按条款拆开（标题段的十条总要求 + §1–§6 的每一条 + 最终验收），逐条对到规格章节与 §11 断言号，再对**没有落点的那几条**当场补规格与断言。状态只有四种，**不用「大致覆盖」这种含糊话**：

- `覆盖`——规则写了、且有一条指名的可证伪断言（或已指名的指名用例）。
- `本轮补齐`——核查时发现规格里有规则但**没有验收落点**（或 B1 的落盘字段里没有它），本轮已补断言/补字段口径，编号写在下表。
- `部分`——规则的某一半本批不成立、已写明缺的那半与承接批次。
- `待你拍板`——不是代码能闭的东西（只剩一处，见 §16.2）。

### 16.1 对照表

| 目标条款（原文措辞摘引） | 规格落点 | 断言 | 批次 | 状态 |
| --- | --- | --- | --- | --- |
| 「当前无需账号即可使用」 | §2.4、§12 | **63** | B1 | 本轮补齐——**这行原先是假覆盖**：它写着「覆盖（`Principal.kind="local"`）」，但实测 `core/src` 里 `Principal` **0 命中**，该类属 §2.4 规划、B1 Task 3 才新建。改标 `本轮补齐` 并给出断言 63，等 63 绿了才回来写覆盖 |
| 「用户自主管理（供应商/模型/密钥）」 | §2 全章 | 1–4 | B1 | 覆盖 |
| 「支持安全换机迁移」 | §8 | 17–20、26–30、42、47 | B5 | 覆盖 |
| 「后续接入用户体系的边界」 | §2.4、§6 末条 | 48 | B2 立形 | 覆盖（缝 + 不许按名称合并） |
| 「桌面与 CLI 使用同一套仓颉核心规则」 | §3 不变量、§9（含 §9.4 分工清单） | 25、52、62 | 每批 | 覆盖（52 管两侧能力面对称；62 管「同一套规则」的物理前提——两个入口读同一份配置与账本，本轮把这句含糊话钉成可检的东西） |
| 获得**真实**模型结果 | §4、§4.1、§2.3 | 34、35、36 | B2 | **部分**：三种协议只登记了一种的实现（§4.1 缺陷 B），`openai-responses`/`anthropic-messages` 的适配器逐个后补；补之前那两类绑定被如实排除，不盲发 |
| 「统一海外加速」 | §6 | 21–24、40、45 | B4 | 部分：规则齐，真实网关待部署，本地只能桩证（§13） |
| 「故障恢复」 | §5 | 5–12、32、33、37–39 | B2 | 覆盖 |
| 「预算控制」 | §7.3、§7.4 | 13、14 | B3 | 覆盖 |
| 「**可追溯**的费用统计」 | §7.1、§7.5 | 43 | B3/B6 | 本轮补齐（原规格记了字段、没有一条断言证明链路可回溯） |
| §1「三层结构」 | §2.1–§2.3（含实例语义与号池）、§9.2 | 1–3、56、57、58、60 | B1 | 本轮补齐：用户 2026-10-05 澄清「同一供应商要能加多份以组号池轮询」，而实测现状 `addFromCatalog` **主动拒绝**第二份（§1.2 末行），规格此前也没写实例语义 |
| §1「管理地址」 | §1.1、§2.1、§9.2 | 31、60 | B1 | 本轮补齐 60（实例可达性卡在渲染层那道 filter，只核核心会漏） |
| §1「管理协议」 | §2.1、§4.1 缺陷 B | 35 | B1 存 / B2 判 | 部分（同上：登记三种、实现一种） |
| §1「管理密钥」 | §1.1 `credential.cj`、§2.1（逐实例 ref）、§8.3 | 17、19、42、56 | B1/B5 | 覆盖（56 钉的是「两份实例两把密钥互不顶掉」——密钥面按实例才谈得上池） |
| §1「排序」 | §2.1 `sortOrder` | B1 Task 2 指名用例（单列事件 + 稳定序） | B1 | 覆盖 |
| §1「启用状态」 | §2.1 `enabled`、§4 语义 | 4 | B1 存 / B2 判 | 覆盖 |
| §1「拉取及手动添加上游模型」 | §9.1 `model/pull`、`model/upstream/upsert` | 1、2 | B1 | 覆盖 |
| §1「记录能力、限制和计价规则」 | §2.2、§2.3 绑定计价 | 3、41 | B1 | 本轮补齐 41（跨币种保存原本无验收落点） |
| §1「配置上游绑定、顺序、权重、**生成参数及预算**」 | §2.3「落盘形态在 B1 一次定死」 | 46 | B1 | **本轮补齐**：核查发现 B1 的 `CustomModelRecord` 只有 身份/能力/绑定/调度 四组，参数与预算与探测**没有存储落点**，而 §7.4 要求预算修改落事件 |
| §1「日常任务只需选择自定义模型，不必反复选供应商或填密钥」 | §2.3 末条 + §2.3 五段现状表、§4.1 取参收敛 | 36、44、69、70、71、72 | B1/B2 | 本轮补齐——实测今天选模型走的是两层默认指针，五段通路不改完，第 3 层就只是文档面；B1 交「第 3 层是唯一读面」的文档半，决策半随 B2 |
| §2「轮询和平滑加权轮询」 | §4 | 10、83–85 | B2 | 本轮补齐：算法早先写了，但它的可变状态（游标）归属与「可重放」的第五项输入本轮才定，同机两入口的比例边界也写成不宣称 |
| §2「能力、开关、健康状态与预算过滤」 | §4 过滤链 | 3、4、5、13 | B2/B3 | 部分：B2 用**注入的**账本视图证纯函数与优先级，接真账本在 B3 |
| §2「三次有效失败后退出正常调度，进入冷却与低频恢复探测，而不是无条件停用到次日」 | §5.1、§5.3 | 5、12、50 | B2 | 覆盖（与目标原文「当天熔断/次日恢复」的替换关系已在 §11.1 下方写明） |
| §2「区分线路/模型/限流/额度耗尽/凭证失效，按实际受影响范围暂停」 | §5.1（含「三档键无品牌」）、§5.2（含输入通路三段与 `reachedUpstream` 维） | 6、8、9、32、33、55、57、81 | B2 | 本轮补齐——实测三段输入通路全缺，不补则这张表只能靠夹具落地；57 管暂停范围别按品牌放大 |
| §2「优先遵守供应商恢复时间，否则可配置低频退避」 | §5.3 + §5.2 第 1 段 | 7、38、53 | B2 | 本轮补齐（响应头目前被丢弃，取数通路要先建；阶梯取值见 §16.2） |
| 健康状态跨重启保留、CLI 与桌面不重复探测、成功后有限放行 | §5.3（含 2026-10-05 对 `lease.cj` 三条语义的补写）+ §5.2 第 3 段 | 5、11、12、37、50、54 | B2 | 覆盖（54 是输入侧：失败不落日志的话「跨重启保留」根本无从保留） |
| §3「加速通道用于模型请求、**模型发现**和**健康探测**」 | §6「三种用途共用同一通道决策」 | **40、45** | B4 | **本轮补齐**：原 §6 只写了模型请求；现状证据是 `model_catalog.cj:101` 在 `:105` 自建 client 直连，与通道抽象无关，不收口则「切了 relay 但发现仍裸连」 |
| §3「只负责受控传输，不另建一套模型调度规则」 | §3 禁止列、§6 定位、§12 | 25、48 | 每批 | 覆盖 |
| §3「流式、工具调用、usage 传递和取消，不盲目重放」 | §6（含 2026-10-05 补写的重放闸判定形态） | 23、24、**79**、**80**、**81**、82 | B2/B4 | 本轮补齐——原先「能确认请求未发出」没有可写下的标记、白名单也没有可依据的分类维，23/24 只能由夹具喂；标记随 B2 落，白名单与 relay 判定随 B4 |
| §3「信任边界、不做开放代理、不默认持久保存上游密钥」 | §6 | 21 | B4 | 覆盖 |
| §3「访问授权独立设计，不要求先建账号体系」 | §6 末条 | — | B4 | **待你拍板**（见 §16.2 第 8 行） |
| §4「按每次上游尝试记录用量、结果、费用及计价快照」 | §7.1（含 2026-10-05 新补的计量输入三段缺失） | 15、43、73、74、76 | B3 | 本轮补齐——分档 usage 目前在解析点就被相加丢掉，不补这三段，15/43 只能靠夹具喂 |
| §4「固定精度十进制；不同币种、不同模态分别处理」 | §7.2、§2.2 `meterUnit`、§2.3 四档费率 | 16、41、76 | B1/B3 | 覆盖（76 是「统一单价抹平」这条禁止在**同币种内**的对偶，本轮补上才闭环） |
| §4「同机 CLI 与桌面共享账本、原子预留、幂等结算、待核算」 | §7.3（含租约临界区不跨网络） | 13、14、51 | B3 | 覆盖 |
| §4「失败与取消有 usage 就记，没有 usage 不冒充零消费」 | §7.1 | 8、14、74、75 | B3 | 覆盖——「取消抹不掉已收到的用量」「`absent` 不推断为零」**现有 `meter.cj` 已实现**，账本继承；74/75 补的是另两个塌缩（命名不识别会整轮失败、未回用量塌进 `bad-usage`） |
| §4「分开展示模型/探测/加速费用；本地费用不冒充余额」 | §7.5 | 14、43、61 | B6 | 本轮补齐 61（号池要按实例回看，聚合掉就看不出哪把 key 花的） |
| §5「默认导出不含密钥的配置包」 | §8.1 | 17 | B5 | 覆盖 |
| §5「独立迁移口令加密、含供应商密钥的迁移包」 | §8.2 | 26–30 | B5 | 覆盖（构造已运行实证，§15） |
| §5「导入后恢复供应商、自定义模型、绑定、价格、预算和探测设置」 | §8.1、§2.3、§2.4 对偶 | 47、**77**、58 | B5 | **本轮补齐**：47 核「设置逐类回得来」，77 才核「回得来且本机调度得到它」——原先两者都没有，B5 出口判据那句「路由可用」无断言可指；逐类设置的等值没落点；且它依赖 B1 先把 46 的字段存下来 |
| §5「差异预览、合并或替换、重复导入不重复、**凭证覆盖需确认**」 | §8.3 | 18、**42**、58 | B5 | 覆盖补齐 58（号池的 N 份同品牌实例是导入时最容易被「智能合并」塌掉的一类） |
| §5「配置迁移与运行数据备份分开，不清零账本与故障状态」 | §8.4、§7.4 | 20 | B5 | 覆盖 |
| §6「稳定的本地身份、数据有明确归属」 | §2.4（含 2026-10-05 补写的对偶段） | B1 Task 3b 指名用例 `entriesOfAnotherOwnerAreInvisibleButNotDestroyed`、78 | B1/B5 | **部分**：隔离方向（别人的条目看不见且不毁）有指名用例，**归属对导入的方向原先无断言**——而查询按 principal 过滤时，缺 78/77 恰好会把导入结果隐藏，所以只标「覆盖」是把单向当双向 |
| §6「身份认证、配置存储、凭证存储与调度业务分离」 | §3 职责表 | **48** | B2 | 本轮补齐：§3 的「明确禁止」列原先只是文字，48 把它变成形态可检的断言 |
| §6「未来绑账号/云同步/服务端凭证托管，但不因登录自动上传密钥」 | §2.4、§6 末条、§12 | 63 | 缝在 B1 / 主体在未来 | 部分：本批只交**保留缝**（principal、存储接口、身份与调度分离，加上 63 那条「接账号必须新立批次」的结构约束）；账号绑定、云同步、服务端托管三段本身**在当前不可运行验证**，等账号批次，届时 §16.2 第 9 行的前置生效。缺的就是这三段，不写作「已覆盖」 |
| §6「账号级共享预算由服务端权威预留结算；当前不宣称跨机协调」 | §7.3 括注、§7.5、§12 | **64** | B3 | 本轮补齐——原先这行是「覆盖（明确不宣称）」，但「不宣称」本身没有可检对象。64 把它变成两件事：作用域键里不含机器/网络标识（形态可检），展示面不出现余额/已同步/多设备这类跨机承诺（文案可检） |
| 最终验收「七步闭环」 | §11.1 对位表 | §11.1 | B1–B6 | 覆盖——本行的可证伪形态就是 §11.1 里七步各自指名的断言集，不另立编号；对位表任一步的断言集为空即视为本行不成立 |
| 最终验收「桌面、CLI 与安装包规则一致」 | §9.3、§9.2 | 25、52 | 每批 | 覆盖（52 是本轮抓到的：动词面与通道面各自演进，只核一侧会漏——`binding/reorder` 一度有核心实现却没有桌面通道） |
| 「整体需求不缩减」 | 本节 | §16.1 | 每批 | 覆盖——**本节就是它的核查**：核查抓到 5 处缺口（真实协议实现只 1/3、加速只覆盖一种用途、参数/预算/探测无存储落点、逐类设置等值与密钥覆盖闸没有断言），全部已补规格或断言，没有一条靠删需求来对齐 |

### 16.2 待你拍板的取值（代码闭不了的那些，逐条给了默认值与改法）

| # | 取值 | 本设计定的默认 | 影响 | 改的话要动哪 |
| --- | --- | --- | --- | --- |
| 1 | 冷却退避阶梯 | `30min → 1h → 2h → 4h`，同一作用域逐档抬升，上限 4h | 恢复快慢 vs 烧钱与撞额度次数 | §5.3 一处常量，全链路走注入时钟，用例不断言具体分钟数而断言单调抬升 |
| 2 | 每作用域每日探测条数 | `probe.maxPerDay = 3` | 探测费用（`usageKind=probe`）与「额度窗一开就恢复」的及时性 | §5.3；按落盘条数计，改它是写一条事件（断言 39） |
| 3 | 持久冷却的时间上限 | `cooldown.maxHorizon = 24h`（超长 `Retry-After` 裁剪并标「估算」） | 供应商给 3 天重置时的显示与冻结时长 | §5.3 第三道护栏（断言 38） |
| 4 | 金额定点刻度 | Int64 微单位（1 元 = 10^6） | 溢出阈值与最小计价粒度；上界 ≈ **9.2234×10^12 元**（`Int64` 最大值 / 10^6，本轮复算；原写作 10^13 系高估，已更正） | §7.2 一处常量（断言 16 钉溢出，边界值按 §7.2 那个算式取） |
| 5 | 迁移包加密构造 | SM4-CTR + HMAC-SHA256 的 ETM、PBKDF2 迭代不低于 600k、对外称 128 位强度 | 换机包的安全强度与解包耗时 | §8.2；算法标识写进信封头，将来换 AEAD 旧包仍可自描述解出（断言 30） |
| 6 | 熔断作用域三档 + 冷却替代「当天累计三次即停用」 | `upstream`/`route-set`/`channel`，额度类升 `route-set` | 换自定义模型能否绕过暂停（断言 6 就是钉这个） | §5.1；这是相对目标原文的一处**加强**，不是裁剪 |
| 7 | 导出默认不含密钥 | `kind=config` 为默认，含密钥包必须口令加密且显式选择 | 误导出成明文包的风险 | §8.1（断言 17、42） |
| 8 | **加速服务的部署与访问授权** | 接口形态定死（可撤销访问凭据 + `relaySlug` 允许集 + `{relayBase}/upstream/{slug}/…`），**但服务本身由谁部署、免费额度、凭据发放与撤销渠道未定** | 唯一一条代码闭不了的：没有可连的网关时，断言 21/23/40/45 只能对桩成立，真实端到端记「待运行验证」（§13） | §6；你定了部署形态后 B4 才谈得上「真实网关下跑通」，之前按桩交付并如实标注 |
| 9 | 未来账号批次的开工前置 | 「不因登录自动上传密钥」「账号绑定=显式重映射 owner」 | 现在不建，但 §16.1 里标「未来」的两行要等账号批次才验 | §2.4、§6 末条 |
| 10 | 号池下的每日探测总条数 | `probe.maxPerDayGlobal = 10`（跨作用域共享，按落盘条数计） | 探测费用上限随池大小线性放大的那道闸；第 2 档探测是最小真实请求，会产生真钱 | §5.3 全局闸（断言 59）；只改常量不改语义 |
| 11 | CLI 要不要最小非交互写面 | 建议 **B1–B6 不做**：§9.4 的四条已覆盖闭环（选模型跑任务、看费用、显式探测、迁移导入导出），CLI 只做读面 + 单发命令 | 无 GUI 机器上能否建号池。要在服务器上配池，就得把 §9.1 动词面在 CLI 再实现一遍，§9.1/§9.2 的动词与通道计数需重算 | §9.4 末条；若改判「要」，新增一个批次而不是塞进 B1 |
| 12 | 两层默认指针（`defaultProviderId` + `defaultModel`）的退役方式 | 建议**保留字段、降为「尚未配置自定义模型时的兼容读面」，并另落一条显式迁移事件**；不建议直接删（`model/registry/set-default` 通道、`apps/desktop/renderer/app.js:710` 的 `window.dsh.modelsSetDefault(...)` 调用点与 `setDefault` 校验都在用它，删了会让 B1/B2 之间的版本读不回旧配置） | 决定是否新增 `custom/set-default` 动词与通道（**会动断言 52 的动词↔通道对称计数**），以及迁移包导入后老机器默认选择是否延续 | 断言 69、70；若改判「直接删」，§9.1/§9.2 清单与 §9.4 的 CLI 四条要重算 |
| 13 | 生成参数的归属：任务侧推理等级面板 vs 自定义模型自带 `params` | 建议**默认值住在自定义模型条目里，面板只做「本次覆盖」且不持久**（现状 `model-select.ts` 的 `reasoningEffort` 写进指针、`retainedEffort` 还会持久化，等于第二份参数真源） | 决定 §2.3 的字段集是否收 `reasoningEffort`、断言 72 的判据形态，以及通道载荷要不要带 effort | 断言 72；若改判「面板可持久」，§2.3 必须显式写覆盖优先级，否则账本计价快照与实际发出去的参数解释不上 |
| 14 | 计费维度是否全档登记 | 建议四档费率（输入 / 输出 / 缓存读 / 缓存写）各自可 `-1`＝未登记，**未登记维度一旦有用量，该笔就落 `待核算`**；不提供「用总量乘一个 blended 单价」的兜底 | 决定 §7.3 `待核算` 的命中率，以及 §2.3 绑定条目的字段数（本轮已据此把计划的单一 `priceMicro` 改成四档） | 断言 76；若改判「允许 blended」，必须同时改掉断言 41 与 §12 的统一单价禁令——那是**减需求**，本设计不接受 |
| 15 | 轮询游标的归属，以及「同机两入口并发时是否承诺全局精确权重比例」 | 建议**游标留在进程内**：承诺「单实例内比例 + 无饥饿 + 复位不饥饿」，**不承诺**全局精确比例（三条方案的后果对照见 §4 那张表） | 若改判「必须全局精确」，选择要在请求路径上同步落盘，§4 的确定性合同与 §9 的权重用例都得改成带并发游标的形态，且每个模型请求多一次持久写 | 断言 83、84、85；换方案则 §4 选择算法段与这三条要重算 |

### 16.3 这张表怎么复核（不是只读一遍就算核过）

1. 条款列必须与目标原文一一对应：标题段十条总要求 + §1 十条 + §2 六条 + §3 五条 + §4 五条 + §5 五条 + §6 四条 + 最终验收三条 = **48 行**。本表实测 `48` 数据行、五列齐全（脚本核：表格行数、每行列数、转义竖线先剥再数列）。**但别拿第一列的 `§N` 前缀当分组复核依据**：按前缀机械分组得到的是 标题段 12 / §1 10 / §2 5 / §3 5 / §4 5 / §5 5 / §6 4 / 最终验收 2，与上面的条款数 10 / 6 / 3 对不上——差的是几行**无前缀或异前缀的派生条款**（如「健康状态跨重启保留…」属 §2 第 5 条但没写 `§2「`）。总数 48 与每行 5 列才是可机械复核的量，分组分布只作线索。
2. 每个 `覆盖` 都要能指到**三种指针之一**：(a) §11 的断言编号；(b) 一个已指名的用例名（英文标识符，如 `entriesOfAnotherOwnerAreInvisibleButNotDestroyed`）；(c) 一个 `§` 章节指针，且该章节里逐条列出了断言集（本轮只有一处用它：最终验收「七步闭环」→ `§11.1`）。**不接受 `—`**——唯一豁免：`待你拍板` 行允许 `—`，因为那一行本来就不是代码能闭的东西（现仅一处：加速服务的部署与访问授权）；其余状态指不到就应改标 `部分` 或 `本轮补齐`。这条规则本轮第一次机械执行就抓到 5 行不合格，其中 1 行是**假覆盖**（拿还没新建的 `Principal` 当已覆盖依据），已改正——写规则而不执行规则等于没写。
3. 每个 `部分` 都写明了缺的那半与承接批次，不允许出现「部分」但看不出部分在哪。
4. 断言总数 **85**（§11 实测编号 1..85 连续、无重复、无缺号），本轮新增 **40–85** 四十六条（其中 49–51 来自对 `model_agent.cj`/`lease.cj` 的 HEAD 直读复核：一条纠正了缺陷 A 的归因，两条把租语义补成可检的东西）；`§11.1` 对位表与 §10 批次表已同步。机械对账另核出一条方向也成立的性质：**§11 里没有任何一条断言从未被引用**（1..82 每个编号都出现在 §10/§11.1/§16.1 某处），所以不存在「写了断言但没人认领」的悬空项。未闭环的两处（协议实现 1/3、真实网关）在表里是 `部分`/`待你拍板`，不在任何一行里被写成「已覆盖」。
5. **状态列本身也要机械核，不能只读一遍**。定死四条禁令，每条各配一个注入探针（先证门禁会红，再认它的绿）：状态必须落在四种口径之内；`覆盖` 行的断言列必须有三种指针之一（§11 编号 / 指名用例名 / `§` 章节指针），唯一豁免是 `待你拍板` 行允许 `—`，因为那一行不是代码能闭的；批次列必须能解析出 `B\d` 或 `每批`；`部分` 行必须用「：」写明缺的那半。四条探针全部被抓、基线违规为 0 才算核过——本轮实测 **GATE-OK 4/4**，基线状态分布 **覆盖 24 / 本轮补齐 17 / 部分 6 / 待你拍板 1**（合计 48；分布每改一次都要按列名重算，不许手数——第十五轮按**表头列名**定位状态列重算——先用按下标取列跑过一次，结果把批次列当成状态列，算出「B1 有 10 条状态」这种根本不存在的分布，正是这条规则要防的错）。这条规则第一次执行就抓到一处**假覆盖**（拿尚未新建的 `Principal` 当「已覆盖」的依据）和四处空指的 `—`，可见「写了规则不执行」与「没写规则」一样危险。
   **第十六轮的补充教训（探针自己会哑）**：改完 §16.1 的一行状态后，四条探针里有一条从 `CAUGHT` 变成静默失效——因为它把锚点绑在**整行**上，而那一行的状态列正好被改写。脚本自己打印「跳过（锚点没中，检查器需更新）」并要求 `caught == 4` 才判 `GATE-OK`，这一次才没让「基线违规 = 0」被当成通过。两条纪律由此定下：**探针不许绑正文文字**——第十七轮把这条推到底：那一轮只改了 §16.1 的一行状态，四条探针里立刻有两条静默失效（`caught=3/4`），说明「只绑被破坏那段文字」仍然会 rot，于是自检改成用**与被检代码同一套解析**按「行 + 列」定位变异（选择器只按状态口径挑行，如「取第一条覆盖行」），正文怎么改都不会把探针弄哑；该轮复跑 **GATE-OK 4/4**，并由自检直接打出状态分布（分布从此不再需要另算，也就没有手数与列下标两类错）；**`基线违规=0` 配不上一个哑探针**，自检输出里出现「跳过」就当红处理。
6. **跨文档契约名对账**：把规格与批次计划里反引号包裹的符号名各取一次做集合差，凡是「计划当接口用、规格里查无此名」的都要判定——要么补进规格（它属于契约），要么明确标成计划私有（实现细节）。本轮第一次执行抓到一处：`addInstanceFromCatalog` 只出现在计划里，而 B5 的迁移导入同样要用它，属跨批次契约，已补进 §2.1 并钉死「新实例 id 从视图读回、不作返回值」。这个差集天然带大量实现细节名（本批实测 117 个），**逐条判、不做机械否决**；能机械化的只有后半句——凡被别的批次 `Consumes` 的名字，必须能在规格里查到名字。
7. **源码引用行号本身要体检**（`node target/citation-audit.cjs`，可选 `--list` 打印每条引用真正落在哪一行）。它把两份文档里 `路径:行号` 形态的引用全抽出来（本轮实测 **原始 83 条 / 去重 50 条**），逐条读文件核五件事：文件在不在、行号越界、是不是空行或纯符号行、**承重引用（`HINTS` 表 25 条）那一行是否仍含指定符号**、裸文件名是否与仓内同名兄弟歧义。基线现 **83/83 有效、四类违规各 0**。这条门禁不是空转：第一次执行就抓到 **4 处真缺陷**——(a) `model_agent.cj` 的签名缝 `:102`→`:105`、每步工厂调用 `:88`→`:91`（HEAD 与工作区一致，是引用旧了不是代码漂了）；(b) `bridge.test.mjs` 的 `:546` 那条 `.test(m)` 已被并发提交推到 `:547`（而 `^test(` 严格计数 40、松散计数 41 两条都复验未变，§9.2 的数字仍然成立）；(c) 断言 69 里的 `main.cj` 的 `:1155`/`:1364` 两处既与 `apps/cli/src/main.cj` **同名歧义**、又违反 §4.1「该文件只认符号不认行号」，已改为符号式并写明 `grep` 命中数应为 2；(d) §16.2 第 12 行的 `app.js` 的 `:707` 同样歧义，且**指错了行**——那一行是 `const generation = ++seq;`，真正的两层指针唯一生产写点 `window.dsh.modelsSetDefault(...)` 在 `apps/desktop/renderer/app.js:710`。**歧义不是假想敌**：工作区里现在就存在一颗未被 git 跟踪、也未被 `.gitignore` 覆盖的 `apps/desktop/app.js`（1412 行，与 `renderer/app.js` 差 6 增 17 删，形态像并发会话的在飞副本——本规格既不吞并也不删除它，只登记现场），任何只写裸名的引用都可能被读者解析到那颗文件上；因此本规格的源码引用一律写全路径。
   三条边界要如实写明：裸 `:NN` 简写（同文件内续指，如 §7.1 的 `（:28）`）不在抽取范围内，只有带路径名的引用会被核；区间 `路径:NNN-MMK` 只核**起始行**；`HINTS` 是人登记的承重子集（25/50），其余引用只享有三类机械检查。还有一条是写这条规则时当场踩到的**元层自指**：正文里举「旧的、已废弃的行号」时，只要写成 `路径:行号` 邻接形态就会被自己的正则当成现行引用收进分母——本条第一次落笔即因此报出歧义 2 + 越界 1，全部来自新写的第 7 条自己；历史行号一律断开邻接写成「`main.cj` 的 `:1155`」。**`HINTS` 必须由 `--list` 的实测行生成、不得凭记忆登记**——本规则首跑时我自己登记错 3 条（把 `resp.close()` 记到区间起始行 47 而非 48、把 `TurnResult.usage` 记成 `class TurnResult` 那行、把 `pack-host.mjs` 的变量名当成断言对象而它实际叫 `RUNTIME_DLLS`），三条都是**文档没错、表错了**，若按记忆直接改文档就会把对的改成错的。反证也做了：`node target/citation-gate-selftest.cjs` 拿规格副本各注入一处违规（空行 / 越界 / 文件缺 / 歧义裸名），四桶全部点名且「引用体检通过」不再出现，**GATE-OK 4/4**，同批基线报 PASS。
8. **§16.2 这张待拍板表也要机械核**（`node target/pending-values-audit.cjs`）：本轮实测 **15 数据行 × 5 列、第一列 1..15 连续无缺**。切列必须先剥转义竖线——第 5 行的迁移包构造里写着 `\|enc`/`\|mac`，按裸 `|` 切会把一列切成两列、凭空造出「列数不符」。这个脚本同时把每行的「待拍板项 ⇒ 建议默认值」打成一页，评审时照它逐条判即可，不必在文档里另抄一份取值表（那份会漂）。
   **一条必须如实声明的前提**：上面三条规则点名的 `target/citation-audit.cjs`、`target/citation-gate-selftest.cjs`、`target/pending-values-audit.cjs`（以及第 5、6 条用到的状态列与契约名对账脚本）**都在 `.gitignore` 的 `target/` 下、未入库**——受「先不写代码，等评审」这条门约束，本批不新增已跟踪文件。因此在干净检出上直接跑这些命令会得到「文件不存在」，这是**前提未满足而不是检查失败**；解锁动作只有一个且需要你批准：把这几颗体检脚本收进 `scripts/`（它们是取证工具，不属于 B1 的任何交付面），此后 §16.3 才可被逐字执行。
