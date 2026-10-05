# SaCode 模型中心：13 家内置供应商模板 CatalogEntry 草案

- 日期：2026-10-05
- 定位：**纯文档/数据草案**。不改任何 `.cj` 源码、不跑 `cjpm test/build`、不做 git 提交；本文只把「可落库的数据形状」与「不可落库的边界」写清楚，供 B1 计划修订时直接取用。
- 上游口径：
  - `docs/superpowers/specs/2026-10-05-model-center-design.md` §2.1（第 82–114 行的「供应商发现合同核验进度」全部记录）——本文所有证据等级**只从这批记录抄录**，不做新的联网核验。
  - `docs/superpowers/plans/2026-10-05-model-center-b1-catalog.md` Global Constraints（执行状态：需修订，尚未获实施批准）——本批尚未完整承接 13 家扩展，本文补上「模板元数据」这一面的缺口。
  - `core/src/provider_registry.cj`：`CatalogEntry(id, name, baseUrl, protocol, credentialRef, modelIds)`（`:16-27`）、协议闭集 `providerProtocols`（`:41`：`openai-completions` | `openai-responses` | `anthropic-messages`）、`saCodeCatalog` 现状（`:30-39`，**只有 stepfun 一条**）、`checkStableId`（`:75`，id 形如小写字母开头 + `[a-z0-9-]`、≤64）、`deriveCredentialRef`（`:54`，产出 `SA_CODE_<ID>_API_KEY`）、`addInstanceFromCatalog`（`:411`）、`catalogJson`（`:382`）。
  - `core/src/credential.cj:21` `isValidCredentialRef`：大写/小写字母、数字、下划线，首字符必须是字母——`SA_CODE_<ID>_API_KEY` 形态全部合法。

---

## 1. 证据分级与填写纪律（先定尺子，再列数据）

### 1.1 三档证据等级（本文唯一判据）

| 等级 | 判据 | 对草案的作用 |
| --- | --- | --- |
| `已核实` | 有**原始文档正文**或**运行证据**同时支撑该家的 `baseUrl` + 协议线形 + 认证形态 | 字段可填满，进入「可落库子集」 |
| `待复核` | 只有**摘要线索**（或原文只覆盖三元中的一部分，其余未闭） | 地址有据则填候选值并注明来源；协议/发现未闭处留空；**不进可落库子集** |
| `未核实` | 无可用证据（未开始取证，或只有图标/第三方文章等同音不同源材料） | `baseUrl` 与 `modelIds` 一律留空，标 `BLOCKED`，写解锁条件 |

规格 §2.1 的原话分级与本文的对应关系：规格标「直接证据／文档声明」→ 本文 `已核实`；规格标「摘要线索／待原文复核」→ 本文 `待复核`；规格写「仅见图标资源」「尚无足以确证主体的官方来源」或「尚未开始取证」→ 本文 `未核实`。

### 1.2 baseUrl 的唯一合法来源（防止把猜测写成事实）

只有三个来源可以进 `baseUrl`：

1. **用户给定**：`y-api` 的服务入口 `https://api.y-api.bestvirtualgoods.com`；
2. **规格核验记录里带原文/直接证据的地址**：SenseNova `https://token.sensenova.cn/v1`、ModelScope `https://api-inference.modelscope.cn/v1/`、NVIDIA 托管基址 `https://integrate.api.nvidia.com/v1`（归档文档给出，属待复核线索）；
3. **仓库存量**：StepFun `https://api.stepfun.com/step_plan/v1`。

其余 9 家在已读记录里**没有任何地址级证据**，`baseUrl` 留空并标 `BLOCKED`。严禁用「常见知识」「路径习惯」「名称相似」补地址——规格 §2.1 第 84 行原话：「不能因名称相似就假定全都兼容 OpenAI 的模型列表接口」。

### 1.3 modelIds 纪律

- `modelIds` 是**模板级初始模型列表**，只收有证据点名的 ID。
- 除 StepFun 存量两枚外，其余 12 家一律**空数组**：靠「填 key → 拉取 → 勾选」填充（规格 §2.1 第 85 行用户目标链本来就是这条）。
- 严禁把示例模型名、社区仓库目录里的模型名、网站目录里的条目预置进 `modelIds`——规格红线：不得用预置模型名替代正式发现合同，也不得把预置名字宣称成「填 key 即可拉取」。

### 1.4 两个必须先说清的实现事实（读源码得出，影响草案怎么用）

1. **`CatalogEntry.credentialRef` 当前不参与落库**。`addInstanceFromCatalog(catalogId, credentialRef)`（`provider_registry.cj:411`）只用调用方传进去的 ref；传空则 `deriveCredentialRef(实例 id)`。`catalogJson()`（`:382`）输出的 JSON 里也**没有** credentialRef 字段。所以本文每家的 `credentialRef` 是**命名约定参考值**；实际默认落库名会是 `SA_CODE_<实例 id>_API_KEY`（同一家加第二份实例时变成 `SA_CODE_<ID>_2_API_KEY`）。
2. **空 `modelIds` 的目录项可以落库，但不能当默认**。`parseRecordObject` 只在 `!declared` 时拒绝空 `models`（`:572`），目录项复制出来的记录 `declared=true`，所以空列表合法；但 `setDefault` 要求模型存在（`:510`），发现导入之前该实例无法成为默认供应商。
3. **存量 stepfun 的 credentialRef 是 `STEPFUN_API_KEY`**（`:36`），与仓库全部既有证据、测试、host 兜底链（`apps/host/src/main.cj` 的 `STEPFUN_API_KEY` 回退）和 `docs/product/PRD.md:24` 同名的环境变量一致。本文按任务约定的命名空间草案写 `SA_CODE_STEPFUN_API_KEY`，**两者不一致需要在 B1 修订时做产品决策**（见 §6.3），本文不擅自动存量。

---

## 2. 候选 CatalogEntry 总表（13 家）

> `显示名` 只是展示字段，不做唯一键（规格 §2.1 第 74 行）；同品牌多份实例靠实例后缀（`StepFun (2)`）分辨。
> `—` = 留空。标 `BLOCKED` 的行**不得**直接写进 `saCodeCatalog`（空 `baseUrl`/`protocol` 会在 `checkBaseUrl`/协议闭集校验上把 `addInstanceFromCatalog` 打成 `settings-rejected`）。
> `modelIds` 一律标注来源：`存量` = 仓库现状；`[]` = 空数组（靠发现填充）。

| # | id | 显示名 | baseUrl | protocol | credentialRef（约定值） | modelIds | 证据等级 | 落库判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `deepseek` | DeepSeek | `—` **BLOCKED** | `—` `BLOCKED`（候选 `openai-completions`，未证） | `SA_CODE_DEEPSEEK_API_KEY` | `[]` | `待复核` | 等联调 |
| 2 | `mimo` | MiMo | `—` **BLOCKED** | `—` `BLOCKED`（多种协议并存，未证） | `SA_CODE_MIMO_API_KEY` | `[]` | `待复核` | 等联调 |
| 3 | `stepfun` | StepFun | `https://api.stepfun.com/step_plan/v1` | `openai-completions` | `SA_CODE_STEPFUN_API_KEY`（存量为 `STEPFUN_API_KEY`，见 §1.4-3） | `["step-5-preview", "step-3.5-flash"]`（存量） | `已核实` | **已在库，保留** |
| 4 | `senseaudio` | SenseAudio | `—` **BLOCKED** | `—` `BLOCKED` | `SA_CODE_SENSEAUDIO_API_KEY` | `[]` | `未核实` | 先确证身份 |
| 5 | `sensenova` | SenseNova | `https://token.sensenova.cn/v1` | `openai-completions` | `SA_CODE_SENSENOVA_API_KEY` | `[]` | `已核实` | **可落库（新增第 2 条）** |
| 6 | `baizhi` | Baizhi | `—` **BLOCKED** | `—` `BLOCKED` | `SA_CODE_BAIZHI_API_KEY` | `[]` | `未核实` | 先确证身份 |
| 7 | `tencentmaas` | Tencent MaaS | `—` **BLOCKED** | `—` `BLOCKED` | `SA_CODE_TENCENTMAAS_API_KEY` | `[]` | `待复核` | 等联调 |
| 8 | `aliyuncs` | Aliyun Model Studio | `—` **BLOCKED**（地域/业务空间未定） | `—` `BLOCKED` | `SA_CODE_ALIYUNCS_API_KEY` | `[]` | `待复核` | 等联调 |
| 9 | `modelscope` | ModelScope | `https://api-inference.modelscope.cn/v1/`（候选，原文章节） | `—` `BLOCKED`（协议线形未在原文明示） | `SA_CODE_MODELSCOPE_API_KEY` | `[]` | `待复核` | 等联调 |
| 10 | `bigmodel` | ZHIPU AI (bigmodel) | `—` **BLOCKED** | `—` `BLOCKED` | `SA_CODE_BIGMODEL_API_KEY` | `[]` | `待复核` | 等联调 |
| 11 | `openrouter` | OpenRouter | `—` **BLOCKED** | `—` `BLOCKED` | `SA_CODE_OPENROUTER_API_KEY` | `[]` | `待复核` | 等联调 |
| 12 | `nvidia` | NVIDIA | `https://integrate.api.nvidia.com/v1`（候选，归档文档线索） | `—` `BLOCKED`（不得按 OpenAI 兼容性猜） | `SA_CODE_NVIDIA_API_KEY` | `[]` | `待复核` | 等联调 |
| 13 | `y-api` | Y-API | `https://api.y-api.bestvirtualgoods.com`（**用户给定服务入口，原样记录，不拼接 `/v1`**） | `—` `BLOCKED` | `SA_CODE_Y_API_API_KEY` | `[]` | `未核实` | 等联调 |

**等级家数（13 家）**：`已核实` **2 家**（stepfun、sensenova）｜`待复核` **8 家**（deepseek、mimo、tencentmaas、aliyuncs、modelscope、bigmodel、openrouter、nvidia）｜`未核实` **3 家**（senseaudio、baizhi、y-api）。

---

## 3. 逐家明细：发现合同备注与解锁条件

> 每家四项固定字段：**认证方式 / 模型列表端点 / 分页形态 / 按 key 过滤与否**。全部内容抄录自规格 §2.1 第 89–114 行的核验记录（行号见每条末尾的「规格依据」），未新增任何外部核验。

### 3.1 `deepseek` — 待复核 · BLOCKED

- **认证方式**：未核实（规格原文「认证需继续沿原文核对」）。
- **模型列表端点**：线索为 `GET /models`，响应 `object=list`、`data[]`（摘要线索，来自文档抓取工具摘要，未逐字核对原始正文）。
- **分页形态**：未核实。
- **按 key 过滤与否**：未核实。
- **baseUrl / modelIds**：留空 `BLOCKED`。已读记录里没有任何地址级证据，不猜。
- **解锁条件**：逐字核对 `api-docs.deepseek.com/zh-cn/api/list-models/` 原始正文，取回推理基址、认证头形态、分页参数、是否承诺按当前 key 过滤，并至少一份完整响应证据；之后才允许填 `baseUrl` 与 `protocol`（候选 `openai-completions`，`GET /models` + `data[]` 与 OpenAI 列表形态一致，但按 §1.2 不得据此假定，须原文确认）。
- 规格依据：§2.1 第 89 行（首批页面线索）。

### 3.2 `mimo` — 待复核 · BLOCKED

- **认证方式**：未核实。
- **模型列表端点**：模型列表页取到的是**静态目录**（不是动态接口）；首次调用页展示**多种协议与不同套餐基址**，动态发现仍未核实。
- **分页形态**：未核实。
- **按 key 过滤与否**：未核实。
- **baseUrl / modelIds**：留空 `BLOCKED`。多个套餐基址各不相同，任选一个都是猜。
- **解锁条件**：从 `mimo.mi.com` 原文取得动态模型发现接口合同（端点、认证、分页、按 key 过滤）。若最终确认**没有**动态发现接口：按规格 §2.1 第 86 行登记为 `BLOCKED` 并保留模板标识，模型来源走「用户手动登记」（§2.2 的 `provenance=user-entered`），且**不得**在 UI 上宣称「填 key 即可拉取」——「MiMo 本页未给动态接口不等于整个服务没有该能力」，反过来说，没拿到合同也不许假装有。
- 规格依据：§2.1 第 89、114 行。

### 3.3 `stepfun` — 已核实 · 已在库（保留现状）

- **证据等级依据（运行证据，比文档线索强）**：
  - `GET /models` 在 `https://api.stepfun.com/step_plan/v1` 实测 http=200，返回 10 个模型、含 `step-5-preview`（`docs/evidence/handoff-model-provider-2026-10-04.md` §5，第 81 行）；
  - 同一 base 上 `POST /chat/completions` 非流式与 `stream:true` 均实测可用，流式终止序为「正文块 → `finish_reason:"stop"` → 纯 usage 空 choices 块 → `[DONE]`」（同上，第 82–85 行）；
  - 认证形态：密钥只经环境变量 `STEPFUN_API_KEY` 注入，`core/src/sse.cj:43` 以 `Authorization: Bearer ${apiKey}` 发送，凭据门控的真实 SSE 用例（`core/src/sse_test.cj`、`core/src/model_tool_runtime_test.cj:131-136`）在注入该环境变量时 PASSED（`docs/evidence/attachment-durable-seam-2026-10-05.md` 第 222 行）；
  - 协议线形：`POST /chat/completions` 实测可用 → `openai-completions`。
- **认证方式**：`Authorization: Bearer`（运行证据）。
- **模型列表端点**：`GET /models`（实测 200，10 个模型）。
- **分页形态**：未核实。
- **按 key 过滤与否**：未确认（规格第二批原文：「未确认列表是否按 key 权限筛选，也不能将其直接外推到 `step_plan` 套餐」）。
- **modelIds 处理**：保留存量 `["step-5-preview", "step-3.5-flash"]`。注意：运行证据点名的是 `step-5-preview`；`step-3.5-flash` 只在本地夹具（`core/src/model_catalog_test.cj:9`）里出现，**10 个模型的完整清单没有随证据落档**，所以第二枚是「存量保留、未单独取证」，不是「已核实」。
- **遗留决策（不改存量，只登记）**：存量 credentialRef 为 `STEPFUN_API_KEY`，与任务约定 `SA_CODE_STEPFUN_API_KEY` 不一致，见 §1.4-3 与 §6.3。
- 规格依据：§2.1 第 91 行（第二批页面线索）+ 上述运行证据文档。

### 3.4 `senseaudio` — 未核实 · BLOCKED

- **认证方式 / 端点 / 分页 / 按 key 过滤**：全部**未核实**。已取得的材料只有产品索引里的**图标资源**；规格明示「不能用图标名推导 API 契约」。
- **baseUrl / modelIds**：留空 `BLOCKED`。
- **解锁条件**：从官方实际导航或用户提供入口确证服务主体与 API 合同（端点、认证、分页）。在此之前保留用户给定标识，不从 13 家清单删除，也不拿同音产品/第三方文章替代。
- 规格依据：§2.1 第 102 行。

### 3.5 `sensenova` — 已核实 · 可落库（新增第 2 条）

- **证据等级依据（原文明文，隔离浏览器渲染后直读正文）**：`GET https://token.sensenova.cn/v1/models`，认证 `Authorization: Bearer $SENSENOVA_API_KEY`，响应为含 `data` 数组的 JSON；Model 字段含 `id`、输入/输出模态、`context_length`、`max_output_length`、`pricing`、采样参数及工具/推理特性。
- **认证方式**：`Authorization: Bearer`（Bearer 与 key 由同一环境变量名承载，目录草案取 `SA_CODE_SENSENOVA_API_KEY` 为约定值）。
- **模型列表端点**：`GET https://token.sensenova.cn/v1/models`（原文明文）。
- **分页形态**：未核实（规格：「分页、价格单位、按 key 权限过滤及实际 API 行为仍须进一步核对」）。
- **按 key 过滤与否**：未核实 → 发现成功后 UI 必须显示「供应商返回的模型目录，调用可用性未验证」（规格 §2.1 第 114 行）。
- **协议线（本文最关键的一条）**：紧邻的 Messages 兼容节原文明文是 `POST https://token.sensenova.cn/v1/messages`，**与 OpenAI 兼容接口共用 key、以 `Authorization: Bearer` 传递**。因此：
  - 模板 `protocol` 取 `openai-completions`（已核实的发现端点 `/v1/models` 与主链都在 OpenAI 兼容接口上）；
  - 若后续要把某份实例的协议线切成 `anthropic-messages`（走 `/v1/messages`），**认证仍必须是 Bearer**，不得按 Anthropic 惯例硬写 `x-api-key`——协议线格式与认证策略是**两个配置项**，必须分别配置。
- **modelIds**：空数组。文档里的示例模型、示例零价格**不登记**：规格明示「示例模型、示例零价格不当作实时模型清单或免费额度证据」。
- **价格口径备注**（不阻塞落库，但适配器必须遵守）：`pricing` 字段原文只写「定价信息」，未明确币种与计价分母；保留原始值与来源，不换算、不因示例为零而断言免费。
- **外推边界**：以上结论只对已读的 Token 平台文档成立，不外推所有 SenseNova 产品或 SenseAudio 共用基址（`senseaudio` 因此仍是 `未核实`）。
- 规格依据：§2.1 第 104、112、114 行。

### 3.6 `baizhi` — 未核实 · BLOCKED

- **认证方式 / 端点 / 分页 / 按 key 过滤**：全部**未核实**。搜索结果「尚无足以确证主体的官方来源」，规格明示「不把第三方文章或同音产品当作身份依据」。
- **baseUrl / modelIds**：留空 `BLOCKED`。
- **解锁条件**：先确证服务主体（官方来源），再取 API 合同；确证前保留用户给定标识。
- 规格依据：§2.1 第 102 行。

### 3.7 `tencentmaas` — 待复核 · BLOCKED

- **认证方式**：未核实；且已取得材料是**云管理**类 Action，不是推理 key——规格红线「不得要求用户额外提交云 AccessKey」。
- **模型列表端点**：已取得的是云管理 Action `DescribeModelList`（TokenHub 模型列表查询页），**不是已确认的推理 key 模型发现**；TokenHub 与用户指定的 `tencentmaas` 产品对应关系尚未确证。
- **分页形态 / 按 key 过滤与否**：未核实。
- **baseUrl / modelIds**：留空 `BLOCKED`（确证产品前没有任何推理基址可用）。
- **解锁条件**：确证 `tencentmaas` 对应的腾讯产品与推理基址；用**推理 API key**（不是云 AccessKey）取得模型发现合同（端点、认证、分页、按 key 过滤）。不得擅自用 TokenHub 的 `DescribeModelList` 替换该家的发现实现。
- 规格依据：§2.1 第 98 行。

### 3.8 `aliyuncs` — 待复核 · BLOCKED

- **认证方式**：线索为 Bearer API Key（页面摘要，未逐字核对）。
- **模型列表端点**：线索为 `GET /api/v1/models`，响应 `output.models` / `output.total`，页码分页（页面摘要）。**注意响应包体形状不是标准 OpenAI `data[]`**，映射层不能照抄 OpenAI 解析器。
- **分页形态**：页码分页（摘要线索，参数名未核）。
- **按 key 过滤与否**：未核实。
- **baseUrl**：留空 `BLOCKED`。规格原话：「部分地域基址含 WorkspaceId，须核对原文后明确地域与业务空间设置，**不能统一猜成推理兼容基址加 `/models`**」。
- **modelIds**：空数组。
- **解锁条件**：回 `help.aliyun.com/zh/model-studio/list-models` 原文逐字核对：地域基址、WorkspaceId 设置、Bearer 头形态、分页参数名与上限、是否按 key 过滤；之后才允许填 `baseUrl`，并单独定义 `output.models` 的响应映射。
- 规格依据：§2.1 第 97 行。

### 3.9 `modelscope` — 待复核 · 等联调（baseUrl 有候选值，但协议与发现合同未闭）

- **认证方式**：推理侧线索为 **Access Token**（官方 API-Inference 介绍页，已用隔离浏览器直接读取正文）；OpenAPI 侧明确 **Bearer**（`GET https://modelscope.cn/openapi/v1/models`）。
- **模型列表端点**：两个都必须分开登记，**不得混用**：
  1. `GET https://api-inference.modelscope.cn/v1/` 一线：推理示例使用 Access Token；**推理可调用集合的发现合同（机器可读过滤字段）仍未取得**；
  2. `GET https://modelscope.cn/openapi/v1/models`：OpenAPI `v1.1.0+master.20260921T152300Z`，Bearer 认证，响应 `data.models`、`total_count`、`page_number`、`page_size`，每页最多 50 且 `page_number * page_size <= 3000`——但这是**带下载数、许可证、仓库标签的社区模型目录**，不是已确认的 API-Inference 可调用集合。
- **分页形态**：`page_number` / `page_size`，每页 ≤50，`page_number * page_size <= 3000`（OpenAPI 侧，原文明文）；推理侧未核实。
- **按 key 过滤与否**：未核实。
- **baseUrl**：草案填候选值 `https://api-inference.modelscope.cn/v1/`（原文章节，来源合法）；**protocol 留空 BLOCKED**：推理侧协议线形未在原文明示，不得因 `/v1/` 与常见 OpenAI 兼容习惯就假定（§1.2）。
- **不构成发现证据的材料**（规格明确排除）：网站私有接口 `PUT /api/v1/dolphin/modelsWithCollections`（`{"PageSize":30,"PageNumber":1}`，隔离未登录浏览器观察到 HTTP 200，响应含 `SupportApiInference` 等字段）——它**不证明**有稳定合同、支持 Bearer、能枚举全部模型或按当前 key 筛选；返回的 Cookie/CSRF/追踪字段**不得**进入规格、适配器配置或迁移包，不能要求用户复制网站会话材料来实现「填 key 拉取」；`SupportExperience`/`SupportDeployment` 不等于支持 API 推理。
- **供应商前置**：官方页面声明需注册、绑定阿里云账号并实名认证；SaCode 无账号前提不免除该要求，须在配置与错误提示中明示，但不代用户注册或上传身份材料。
- **解锁条件**：取得 API-Inference 一线「可调用集合」的公开发现合同（或明确的机器可读过滤字段）＋协议线形原文＋凭据联调；同时把「魔粒」积分单位按原始单位保存（0.5/1/2 魔粒每次是服务方积分，不是币种、不是 token 价格）。
- 规格依据：§2.1 第 99、106、108 行。

### 3.10 `bigmodel` — 待复核 · BLOCKED

- **认证方式**：**HTTP Bearer**（`components.securitySchemes.bearerAuth`，本机 curl 取得原始 OpenAPI JSON 完整解析：782,761 字节，`info.title=ZHIPU AI API`、版本 `1.0.0`、100 个路径）。
- **模型列表端点**：**该规范路径里没有模型目录列表端点**——匹配 `list` 的是 voice/assistant/document 等列表，不能拿来冒充模型发现。
- **分页形态 / 按 key 过滤与否**：未核实。
- **baseUrl / modelIds**：留空 `BLOCKED`（已读规范未给出可引用的服务基址；不凭记忆补）。
- **解锁条件**：以其他官方证据或有凭据运行验证取得动态发现端点。**否定结论只限这份规范**——整个服务的动态发现仍可能存在于规范之外。若最终确认无动态接口：按 `BLOCKED` 保留模板标识，模型来源走手动登记并在 UI 明示「非填 key 拉取」。
- 规格依据：§2.1 第 100 行。

### 3.11 `openrouter` — 待复核 · BLOCKED

- **认证方式**：未核实（线索页未在记录中给出认证原文）。
- **模型列表端点**：模型列表页包含模态、价格与分页线索（页面摘要）；**完整跨模态发现不能默认只拉文本模型**。
- **分页形态**：有分页线索，参数与上限未核。
- **按 key 过滤与否**：未核实；「key 可调用范围」须回原始规范逐项核对——未确认前不得显示「当前凭据可调用」。
- **baseUrl / modelIds**：留空 `BLOCKED`（已读线索未给地址级信息）。
- **解锁条件**：回 `openrouter.ai` API 原始规范逐项核对：列表端点基址、分页参数、key 可调用范围、**价格单位**（价格单位不核清，§7.1 的四档费率无从登记）。
- 规格依据：§2.1 第 91 行。

### 3.12 `nvidia` — 待复核 · 等联调（候选地址来自归档文档，托管发现未确认）

- **认证方式**：Bearer API key 调用线索（归档文档给出）。
- **模型列表端点**：必须**分流登记**：
  - 托管一线线索：`https://integrate.api.nvidia.com/v1`（Guardrails 页面 301 到 `archive.docs.nvidia.com/nemo/microservices/25.9.0/...` 后取得的托管基址与 Bearer 调用线索）——**托管模型发现、响应与分页仍未确认**，且「不能按 OpenAI 兼容性猜路径」；
  - NIM Proxy 一线：`${NIM_PROXY_BASE_URL}/v1/models` 属于**已部署的 NIM Proxy**，发现的是部署环境中的 NIM/微调模型，**不是托管服务全目录**；不得把代理端点、示例模型或未说明认证外推给 `nvidia` 托管模板。
  - 已读取的本地 NIM 指南页（text-reranking）是本地部署文档，不是托管 API 的发现合同。
- **分页形态 / 按 key 过滤与否**：未核实。
- **baseUrl**：草案填候选值 `https://integrate.api.nvidia.com/v1`（归档文档线索，来源合法但等级为待复核）；**protocol 留空 BLOCKED**（规格原话：不能按 OpenAI 兼容性猜路径）。
- **modelIds**：空数组（示例模型不得预置）。
- **解锁条件**：以官方现行（非归档）文档或运行证据确认托管 `/models` 端点、认证、分页与按 key 过滤；归档版本、代理部署范围与托管供应商三者分开登记。
- 规格依据：§2.1 第 91、110 行。

### 3.13 `y-api` — 未核实 · 等联调（只记用户给定服务入口）

- **baseUrl**：`https://api.y-api.bestvirtualgoods.com`——**用户给定的服务入口，原样记录**。不据此猜测模型发现路径，**不自动拼接 `/v1`**，不因「多数供应商用 `/v1`」而补全。
- **认证方式 / 模型列表端点 / 分页形态 / 按 key 过滤与否**：全部**未核实**，`protocol` 留空 `BLOCKED`。
- **已登记线索（仅作复核入口，不作为草案依据）**：规格第一批记录其公开文档（`y-api.bestvirtualgoods.com/docs`）「明确列出需要 key 的 `GET /v1/models`，另有匿名网站目录，二者不得混用，完整响应与分页仍待核」。
  - 该线索**没有**被采纳进草案：草案不拼接 `/v1`、不把 `GET /v1/models` 写成模板的发现合同——它是待原文复核的线索，不是已核实事实；
  - 匿名网站目录**不得**当作发现证据或模型清单来源。
- **modelIds**：空数组。
- **解锁条件**：用户提供入口或原文复核确认三件事——协议线形（三选一）、认证形态（Bearer 或其他）、发现端点与分页；确认前该家在 `saCodeCatalog` 里**不存在**，用户仍可走「自定义供应商模板 + 地址入口」手动添加（规格 §2.1 第 82 行：清单是最低交付集合，自定义入口保留）。
- 规格依据：§2.1 第 82、89 行。

---

## 4. 协议选择原则（按规格 §2.1 核验结论执行）

1. **不因名称相似假定 OpenAI 列表兼容**。13 家一律先取「官方或供应商提供的接口、认证与分页合同」再定 `protocol`；证据未闭就是 `—`，候选值只在备注里出现。
2. **已核实的协议线只有两条**：`stepfun`（`POST /chat/completions` 运行可用 → `openai-completions`）、`sensenova`（OpenAI 兼容接口 + `GET /v1/models` 原文明文 → `openai-completions`）。
3. **SenseNova 的协议线与认证策略必须分别配置**：Messages 兼容节是 anthropic 形态（`POST /v1/messages`）但认证是 `Authorization: Bearer`；`anthropic-messages` 这个协议名**不蕴含** `x-api-key`。适配器若同时支持两种协议线，认证策略要按实例单独配置，不能由协议名推导。
4. 协议闭集只有三个值（`provider_registry.cj:41`）；任何「看起来像但不完全像」的形态，落库前必须先有响应映射证据。

---

## 5. 仓颉 CatalogEntry 草案

### 5.1 可落库部分（真实代码形状，2 条）

```cangjie
// 草案来源：docs/superpowers/specs/2026-10-05-model-center-catalog-13-providers.md
// 落库后 saCodeCatalog 由 1 条变 2 条。既有断言 catalog.contains("stepfun") 不受影响
// （core/src/provider_registry_test.cj:238 只判 contains，不判条数）。
let saCodeCatalog = [
    // stepfun：仓库存量，原样保留。credentialRef 沿用存量名 STEPFUN_API_KEY 还是改
    // SA_CODE_STEPFUN_API_KEY 是待决事项（§6.3），本条不改存量。
    CatalogEntry(
        "stepfun",
        "StepFun",
        "https://api.stepfun.com/step_plan/v1",
        "openai-completions",
        "STEPFUN_API_KEY",
        ["step-5-preview", "step-3.5-flash"]
    ),
    // sensenova：新增。原文明文（隔离浏览器直读 platform.sensenova.cn/docs 的
    // List Models 节）支撑 baseUrl + Bearer + GET /v1/models（data[]）。
    // modelIds 为空：示例模型不登记（规格 §2.1 第 104 行），初始模型靠发现填充。
    // 注意：协议线与认证策略分别配置；若切 anthropic-messages（POST /v1/messages），
    // 认证仍是 Bearer，不得硬写 x-api-key。
    CatalogEntry(
        "sensenova",
        "SenseNova",
        "https://token.sensenova.cn/v1",
        "openai-completions",
        "SA_CODE_SENSENOVA_API_KEY",
        []
    )
]
```

### 5.2 其余 11 家（BLOCKED 草案——**不可粘贴**，先补字段并复核）

> 下面每一家都给出**形状**而非可落库代码。空 `baseUrl`/`protocol` 一旦真写进 `saCodeCatalog`，`addInstanceFromCatalog` 会在 `checkBaseUrl`/协议闭集上抛 `settings-rejected`；这里是故意留空，等解锁条件闭合后按 §3 的明细回填。

```cangjie
// BLOCKED: deepseek —— 待复核。线索：GET /models、object=list、data[]；认证未核、基址未核。
//   解锁：逐字核对 api-docs.deepseek.com 模型列表原文（基址/认证/分页/按 key 过滤）+ 完整响应。
//   CatalogEntry("deepseek", "DeepSeek", "", "", "SA_CODE_DEEPSEEK_API_KEY", [])

// BLOCKED: mimo —— 待复核。模型列表页只有静态目录；首次调用页多种协议与多套餐基址，动态发现未核。
//   解锁：mimo.mi.com 原文取得动态发现合同；确无动态接口则保留标识走 user-entered，不得宣称"填 key 可拉取"。
//   CatalogEntry("mimo", "MiMo", "", "", "SA_CODE_MIMO_API_KEY", [])

// BLOCKED: senseaudio —— 未核实。只有产品索引图标资源，不能用图标名推导契约。
//   解锁：官方实际导航或用户提供入口确证服务主体与 API 合同。
//   CatalogEntry("senseaudio", "SenseAudio", "", "", "SA_CODE_SENSEAUDIO_API_KEY", [])

// BLOCKED: baizhi —— 未核实。无足以确证主体的官方来源；不把第三方文章或同音产品当身份依据。
//   解锁：先确证主体，再取合同。
//   CatalogEntry("baizhi", "Baizhi", "", "", "SA_CODE_BAIZHI_API_KEY", [])

// BLOCKED: tencentmaas —— 待复核。已取得的是云管理 Action DescribeModelList（TokenHub），
//   不是推理 key 发现；产品对应未确证；不得要求用户交云 AccessKey。
//   解锁：确证对应产品与推理基址，用推理 key 的发现合同。
//   CatalogEntry("tencentmaas", "Tencent MaaS", "", "", "SA_CODE_TENCENTMAAS_API_KEY", [])

// BLOCKED: aliyuncs —— 待复核。摘要线索：Bearer API Key、GET /api/v1/models、
//   output.models/output.total、页码分页；部分地域基址含 WorkspaceId，不能猜成推理基址 + /models。
//   解锁：回 help.aliyun.com 原文核对地域/业务空间/分页参数，并单独定义 output.models 映射。
//   CatalogEntry("aliyuncs", "Aliyun Model Studio", "", "", "SA_CODE_ALIYUNCS_API_KEY", [])

// BLOCKED: modelscope —— 待复核。baseUrl 候选 https://api-inference.modelscope.cn/v1/（原文章节），
//   但协议线形未明示、推理可调用集合的发现合同未取得；社区 OpenAPI 目录（modelscope.cn/openapi/v1/models，
//   data.models/total_count/page_number/page_size，每页≤50、page_number*page_size≤3000）不是推理集合；
//   网站私有 PUT /api/v1/dolphin/modelsWithCollections 与浏览器 Cookie 均不构成发现证据。
//   解锁：API-Inference 一线的可调用集合合同 + 协议线形原文 + 凭据联调。
//   CatalogEntry("modelscope", "ModelScope", "https://api-inference.modelscope.cn/v1/", "", "SA_CODE_MODELSCOPE_API_KEY", [])

// BLOCKED: bigmodel —— 待复核。OpenAPI（info.title=ZHIPU AI API）确认 HTTP Bearer，
//   但该规范无模型目录列表端点（匹配 list 的是 voice/assistant/document 等）。
//   解锁：其他官方证据或运行验证取得发现端点；确无则保留标识走 user-entered。
//   CatalogEntry("bigmodel", "ZHIPU AI (bigmodel)", "", "", "SA_CODE_BIGMODEL_API_KEY", [])

// BLOCKED: openrouter —— 待复核。线索含模态、价格与分页；跨模态发现不能默认只拉文本模型；
//   分页、价格单位、key 可调用范围须回原始规范逐项核对。
//   解锁：openrouter.ai API 原始规范逐项核对（端点基址/分页/key 范围/价格单位）。
//   CatalogEntry("openrouter", "OpenRouter", "", "", "SA_CODE_OPENROUTER_API_KEY", [])

// BLOCKED: nvidia —— 待复核。托管基址候选 https://integrate.api.nvidia.com/v1（25.9.0 归档文档线索），
//   托管发现/响应/分页未确认，不得按 OpenAI 兼容性猜路径；NIM Proxy 的
//   ${NIM_PROXY_BASE_URL}/v1/models 是部署环境发现，不是托管全目录，不得外推。
//   解锁：官方现行文档或运行证据确认托管端点/认证/分页/按 key 过滤。
//   CatalogEntry("nvidia", "NVIDIA", "https://integrate.api.nvidia.com/v1", "", "SA_CODE_NVIDIA_API_KEY", [])

// BLOCKED: y-api —— 未核实（发现合同）。baseUrl 只记用户给定服务入口本身，
//   不猜发现路径、不拼接 /v1。已登记线索（公开文档列出的 GET /v1/models、匿名网站目录）
//   仅作复核入口，不作草案依据；匿名网站目录不得当发现证据。
//   解锁：用户提供或原文复核确认协议线形 + 认证形态 + 发现端点与分页。
//   CatalogEntry("y-api", "Y-API", "https://api.y-api.bestvirtualgoods.com", "", "SA_CODE_Y_API_API_KEY", [])
```

---

## 6. 可落库子集清单

### 6.1 现在就能安全落进 `saCodeCatalog`

| 家 | 动作 | 依据 |
| --- | --- | --- |
| `sensenova` | **新增第 2 条**（§5.1 代码可直接用） | `baseUrl` + `Bearer` + `GET /v1/models`（`data[]`）均为原文明文（隔离浏览器直读）；`modelIds` 空不违反任何校验（§1.4-2） |
| `stepfun` | **已在库，保留现状，本批不动** | 运行证据（`GET /models` 200/10 个模型含 `step-5-preview`；`chat/completions` 非流式与流式均可用；Bearer）；存量 `modelIds` 两枚保留、不重新取证 |

合计：**可落库 2 家**（其中 1 家为新增，1 家为存量保留）。落库后 `saCodeCatalog` 条数 1 → 2。

「可落库」的边界必须写清：它只意味着**模板数据没有编造、地址/协议/认证有证据**，**不等于**「填 key 可拉取」已验收——规格 §2.1 末尾：**0/13 家有凭据联调验收完成**。`sensenova` 落库后，发现成功时 UI 仍必须显示「供应商返回的模型目录，调用可用性未验证」（分页、按 key 过滤、实际 API 行为均未闭）。

### 6.2 必须等联调 / 等原文复核（11 家，按等待性质分三组）

- **等原文复核（6 家，证据已定位到具体页面）**：`deepseek`、`mimo`、`aliyuncs`、`tencentmaas`、`openrouter`、`bigmodel`。
- **有候选地址但协议与发现合同未闭（2 家）**：`modelscope`（推理一线可调用集合合同未取得）、`nvidia`（托管一线发现未确认，须用现行文档替换归档线索）。
- **等用户输入或身份确证（3 家）**：`y-api`（协议线形 + 认证 + 发现端点三缺）、`senseaudio`（仅图标资源）、`baizhi`（无确证主体的官方来源）。

这 11 家在 `saCodeCatalog` 里**保持不存在**；用户可用「自定义供应商模板 + 地址入口」手动添加（规格 §2.1 第 82 行保留的入口）。届时手动登记的模型走 §2.2 的 `provenance=user-entered`，UI 如实标来源，**不得**把它显示成「填 key 即可拉取」。

### 6.3 落库时必须连带处理的三件事

1. **命名空间决策**：任务约定的 `SA_CODE_<ID>_API_KEY` 与存量 `STEPFUN_API_KEY`（以及 `apps/host` 的 `STEPFUN_API_KEY` 环境兜底、全部既有证据文档）分裂。因为 `catalogJson()` 不输出 credentialRef、既有实例的 ref 在 add 时已复制，改目录项**不影响**存量实例，但会让目录约定与仓库其余部分各说各话。建议：要么把 `STEPFUN_API_KEY` 作为该家 legacy 例外写进规格，要么全仓改名并同步复核所有引用点——本文只登记冲突，不擅自动存量。
2. **目录 credentialRef 是死字段**：§1.4-1 已证 `addInstanceFromCatalog` 不读 `CatalogEntry.credentialRef`。B1 若要让它生效（例如让 `addFromCatalog` 传空时回落到目录项 ref），必须显式改代码并在用例里钉住；本文草案按「约定参考值」处理。
3. **号池命名**：同一家加第二份实例时，实例 id 走 `-2`/`-3` 后缀，credentialRef 派生为 `SA_CODE_<ID>_2_API_KEY`；`sensenova` 落库后同理。目录模板不需要为号池预置多条。

---

## 7. 硬规则回执（逐条核对）

| 规则 | 本文执行 |
| --- | --- |
| y-api 只记服务入口，不猜发现路径、不拼 `/v1` | §3.13：`baseUrl` 原样记录；`GET /v1/models` 线索仅列为复核入口；`protocol` 留空 |
| 不编造地址或模型 ID | §1.2 限定三个合法地址来源；§1.3 只收证据点名的模型 ID；11 家 `baseUrl`/`modelIds` 留空并标 `BLOCKED` |
| 不把社区仓库目录当发现证据 | §3.9：ModelScope 社区 OpenAPI 目录与推理集合分开登记 |
| 不把网站 Cookie 当发现证据 | §3.9：`dolphin` PUT 的 Cookie/CSRF/追踪字段不进规格、适配器或迁移包 |
| 不把预置名字当发现证据 | §1.3 + §3.5：示例模型、示例零价格不登记为 `modelIds` |
| 不因名称相似假定 OpenAI 列表兼容 | §4 第 1、4 条；`modelscope`/`nvidia` 协议留空即为执行结果 |
| SenseNova 协议线与认证策略分别配置 | §3.5 与 §4 第 3 条：`anthropic-messages` 形态 ≠ `x-api-key`，认证仍为 Bearer |
| 不重新联网核验，按规格已写结论抄录 | §3 每条标注规格依据行号；唯一例外是仓库内已存在的 StepFun 运行证据文档（本仓材料，非新联网） |
| BLOCKED 不删家、写清解锁条件 | §3 每家都有「解锁条件」段；13 家全部保留 |
| 不做代码改动、不跑构建、不提交 | 本文仅新建一个 markdown 文件 |

---

## 8. 与规格 §2.1 核验记录的索引（追迹用）

| 规格行 | 记录内容 | 涉及家 |
| --- | --- | --- |
| 82 | 13 家清单与 y-api 用户给定服务入口 | 全部 13 家 |
| 84 | 不得因名称相似假定 OpenAI 列表兼容 | 全部 |
| 86 | 无发现接口则登记 `BLOCKED` 并写解锁条件；不得用预置名字冒充 | 全部 |
| 87 | 按 13 家逐家验收；无凭据夹具不冒充有凭据联调 | 全部 |
| 89 | 首批页面线索：DeepSeek `GET /models`；MiMo 静态目录 + 多协议多基址；Y-API 公开文档 `GET /v1/models`（待核）+ 匿名目录不得混用 | `deepseek`、`mimo`、`y-api` |
| 91 | 第二批页面线索：StepFun `/v1/models` Bearer `data[]`（未确认按 key 过滤、不能外推 step_plan）；OpenRouter 模态/价格/分页线索；NVIDIA 本地 NIM 页不是托管发现合同 | `stepfun`、`openrouter`、`nvidia` |
| 97 | `aliyuncs`：Bearer API Key、`GET /api/v1/models`、`output.models/total`、页码分页、地域含 WorkspaceId | `aliyuncs` |
| 98 | `tencentmaas`：云管理 `DescribeModelList`，非推理 key 发现；产品对应未确证；不得要云 AccessKey | `tencentmaas` |
| 99 | `modelscope`：推理 Access Token + `api-inference.../v1/`；社区 OpenAPI Bearer `GET /openapi/v1/models`（分页参数/上限），社区目录 ≠ 推理集合 | `modelscope` |
| 100 | `bigmodel`：OpenAPI curl 完整解析、HTTP Bearer、无模型目录列表端点 | `bigmodel` |
| 102 | SenseNova 入口导航链；SenseAudio 仅图标；baizhi 无确证主体来源 | `senseaudio`、`baizhi`、`sensenova`（导航链） |
| 104 | SenseNova List Models 原文明文：`GET https://token.sensenova.cn/v1/models` + Bearer + `data[]`；示例模型/零价格不作证据 | `sensenova` |
| 106 | ModelScope 支持范围（仅部分 LLM/MLLM/文生图）与「魔粒」积分单位 | `modelscope` |
| 108 | ModelScope 网站私有 PUT 观察，不构成发现合同；Cookie 不入规格 | `modelscope` |
| 110 | NVIDIA 托管基址 `https://integrate.api.nvidia.com/v1`（归档文档线索）；NIM Proxy 模板端点不得外推 | `nvidia` |
| 112 | SenseNova 字段映射；Messages 兼容节 `POST /v1/messages` 共用 key、Bearer；协议线与认证策略分别配置 | `sensenova` |
| 114 | 发现成功 ≠ 调用权限已验证；0/13 家有凭据联调完成 | 全部 |

> 运行证据（非规格 §2.1，来自本仓证据文档，用于把 `stepfun` 提到 `已核实`）：`docs/evidence/handoff-model-provider-2026-10-04.md` §5 第 81–85 行（step_plan 的 `GET /models` 与 `chat/completions` 实测）、`docs/evidence/attachment-durable-seam-2026-10-05.md` 第 222 行（凭据门控真实 SSE 用例 PASSED）、`core/src/sse.cj:43`（`Authorization: Bearer` 发送形态）。
