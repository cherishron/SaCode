# 仓颉实现对标：自研底座审查（证据校正版）

> **阅读优先级**：以本节校正结论为准。下方第一至第三轮是审查过程稿；第三轮曾把接口/配置存在写成运行验证、把未核查写成缺失，其中未经本节确认的断言全部降为待核，不能直接用作重构施工依据。参考框架均未本机编译或真实模型验收。

## 持续验证已收口（2026-10-15）

上述后续核查已按五项形成源码/生产接线/本次运行分级结论，详见[验证台账收口表](2026-10-15-self-core-verification.md)。当前Host本地整套16项15通过1失败，唯一红测是静默SSE取消；CLI普通会话恢复1通过，daemon授权/转发6通过。请求预算字段未约束实际请求、MCP未生产接桥均有具体证据；不宣称已经修复。下文“本轮仅静态”专指最初校正轮次，不覆盖后续验证。核心整包单测编译主动中止，无PASS计数。生产修复/真实模型验收需另授权。

## 校正结论（2026-10-15，用户同意后续核）

证据分级：A=实际源码实现已读，B=生产入口接线已读，C=本轮运行验证。A不自动推出B，B不自动推出C。文件注释不是验证结果；以下本轮只有静态核查，未重新运行。

| 问题 | 本轮事实 | 边界与行动 |
|---|---|---|
| SaCode是否没有压缩 | A：[compact.cj](../../core/src/compact.cj)只有CompactionLedger.record/entries；[model_request.cj](../../core/src/model_request.cj)全文按事件构造消息，没有在该函数中选择摘要或裁剪历史 | 存在记录，不等于自动摘要。已检索CompactionLedger调用只见测试；尚不能证明全仓绝无其他压缩。先核请求预算与压缩接线，不新建第二份压缩账本 |
| 是否缺模型路由 | A：[model_router.cj:143–218](../../core/src/model_router.cj#L143-L218)已有能力、绑定、凭据、健康、预算过滤；B：[HostModelRoute](../../apps/host/src/model_routing.cj#L39-L100)装配并真实调用RealSseProvider，Host turn/start在[main.cj:1794–1833](../../apps/host/src/main.cj#L1794-L1833)引用 | 不能从零重造provider/fallback。健康筛选、跨步骤重选与同一失败请求自动重试是三回事；open失败记录后抛出，已读路径未见同请求换路重试循环 |
| 协议登记是否等于可运行 | B：HostModelRoute.select第62行及Host main第1829–1833行明确拒绝非openai-completions | 目录允许Responses/Anthropic配置，不代表当前Host任务发送支持。优先将此限制在能力/界面说明中核清，不谎称三协议均贯通 |
| 是否没有真实MCP客户端 | A：[mcp_client.cj:245–368](../../core/src/mcp_client.cj#L245-L368)有launch/initialize、tools/list、tools/call；387–427有取消/单调钟超时等待；502–511终止并wait进程 | 不能重写客户端。全仓检索McpClient实例只见mcp_client_test，apps入口未检出直接构造；下一步找间接装配与模型注册。closeProcess无超时wait，读线程Future未持有，不能照注释宣称有界退出/绝无孤儿 |
| 所有MCP已统一审批吗 | McpClient.connect查服务器注册；callTool做连接和取消前置检查，在已读函数未见ApprovalDesk消费 | 服务器注册不是每次副作用审批。尚未证实模型工具桥存在，不得将“所有MCP都走desk”写成已实现事实 |
| CangjieMagic 13家是否全部能跑通 | DEFAULT_PROVIDER_MAP只证明13个配置键；多个共享OpenAI兼容适配，MAAS默认URL为空 | 撤回13家全部跑通、13套独立实现、11家兼容数量等断言。需追createChatModel分支和协议适配并分别验收；本轮不凭配置数判优劣 |
| 出错根因是否已找到 | 未对具体失败进行请求/响应/构建/环境关联实验 | 撤回“provider广度不足/无压缩就是碰壁直接原因”。可信要求重、多入口复杂只能算工程背景；不能证明现有困难不可避免或架构正确 |

### 后续顺序（不扩功能）

1. **契约和真实发送对齐**：核Host/CLI/daemon各入口对协议、模型能力和凭据的拒绝语义；用本地合成HTTP服务验证SSE结束、工具增量、错误和取消。不需真实密钥。
2. **已有路由贯通**：验证实例隔离、能力过滤、健康暂停、预算及失败后策略；先遵循现有自定义模型规则，不擅自添加跨厂商或更高费用自动切换。
3. **上下文预算接线**：核真实请求大小、contextWindow来源和历史选择，确认缺口后再设计摘要投影；原日志不删，工具调用/结果必须成组，保留最新请求与权限事实。
4. **MCP装配**：复用现有stdio客户端；确认schema保留、工具命名、效果授权、参数JSON安全与关闭有界性，再决定是否补HTTP传输。不是先新增另一客户端。
5. **一条编程闭环**：在自有临时工作区读→改→实际构建/测试→取消→重启回看，逐入口记录证据。前四步静态/合成检查不等同真实模型任务完成，付费或真实外调另获授权。

用户确认：AskDiandian就是本次“小红书”目录项，base URL为`https://note3-prev-api.askdiandian.com/v1`；不另建dots/xiaohongshu重复项。LongCat为`https://api.longcat.chat/openai/v1`。两者目录登记不证明/models或tools能力已实测。

---

## 历史过程稿（受上述校正约束）

## 决策与边界

用户确认仅研究magic-cli、CangjieMagic、CangChain；保持SaCode自研底座，不引入对方Agent运行框架、不研究ACEHarness。仓颉小智仅为可选材料来源。本阶段只读源码与中文报告，不安装、不跑真实模型、不改生产代码。

已读现行PRD前100行、平台与分发前85行、文档导航。F01–F21不删减，跨平台不复制核心，审批/取消/恢复仍须共享。目标编辑为对标审查，但goal resume被工具拒绝，持久目标仍paused，不能声称自动续作已恢复。

## 来源

参考副本均置于apps/desktop/.tmp-test/cangjie-reference-review-20261015，无框架构建或依赖安装。

- magic-cli：https://gitcode.com/Cangjie-SIG/magic-cli.git，e83c49c0a2642879b469d3e4368f0d904e588b56。
- CangjieMagic：https://gitcode.com/Cangjie-TPC/CangjieMagic.git，bc4624fac86ad8498b61d7e5f3b1168659bc72b5。
- CangChain：https://gitcode.com/Cangjie-TPC/CangChain.git，main浅克隆成功，dcdb9f56425ffdc443c7691e6bd090d6989d4c70（docs: add project status badges and MIT license），本地目录CangChain-git-http1，工作树干净。HTTP/1.1仅单命令设置，未改全局Git。前两次无进展作业已停止，不作依据。旧网页提交b272492不在浅克隆对象中，git diff报bad object，不能宣称比较相等；下面结论均重新读取本地HEAD确认。

已重新读本地CangjieSkills README与cangjie-code-review SKILL；不以外部参考项目AGENTS的构建建议作为本次安装或修改授权。

## 初步已读实现（不构成最终选型结论）

### magic-cli

src/sandbox/start_sandbox.cj:10–27：当前固定版本macOS走sandbox-exec，其余走容器后端；错误转FatalSandboxError。不能沿用旧AGENTS中“平台不支持时直接拒绝”的概括而不核当前版本。

src/sandbox/sandbox_macos.cj:14–23：BUILD_SANDBOX冲突与未知profile在启动前拒绝，值得借鉴“前置能力/机制冲突检查”。但同文件34–59将环境和argv拼接进sh -c，未在已读段落见单引号转义，trace还包含拼接环境。不可照搬到SaCode：存在引号安全与敏感日志风险候选，尚未实测，不把参考实现当安全保证。

### CangjieMagic

src/agent_executor/tool_loop/tool_loop_executor.cj:45–75：有限循环+action+done/stopInfo检查，finally task.end；AgentCancelException映射Cancelled。可借鉴精简、明确的执行循环和生命周期出口。但此文件不能证明停止会收束外部进程、审批已消费或事实已持久化；需继续追AgentTask/ExecutionDSL与工具调用链。

### CangChain（本地Git HEAD重新核读）

固定dcdb9f5读取README、src/mcp.cj全文、audit.cj:135–202、rules.cj:170–227、gateway.cj:140–172、devops.cj全文和case/codedev/src/main.cj全文。无编译或真实模型测试；README的76/76、Ubuntu徽章不是本机验证。

1. **分层与显式规则值得参考**：McpSandbox默认Deny，按工具注册权限；HarnessPhase把BeforeStep/AfterStep/OnHalt显式化。SaCode应保持前置能力检查和明确生命周期，但不增加第二个状态真源。
2. **应用级权限不是OS隔离**：mcp.cj:178–206只有HashMap与canCall/canWrite判断，没有在这里强制文件/进程访问，也不证明实际工具派发必经守卫。不能用它替代SaCode执行授权与平台后端。
3. **Halt不是取消结算**：rules.cj:201–207的Halt只返回true；Delete赋空串而非移除，Emit返回false未发送事件。当前文件不足以证明外部进程退出或副作用停止。借鉴接口表达，不照搬语义。
4. **审计链不是可靠持久执行日志**：audit.cj的entries公开可变、append内存追加，computeHash为非密码学FNV风格短哈希；无该类内持久屏障或外部信任锚。不能等价宣称抗恶意重算/截断或崩溃恢复。ExecutionReplay为文本时间线，不是恢复执行器。
5. **模型网关是可替换接口与模拟验证**：已读gateway实现含MockProvider和URL元数据，chat按ERROR:前缀决定重试，stream返回ArrayList而非增量传输。接口简洁可参考，但不足以证明真实七厂商HTTP集成、取消/背压或安全重试。用户合法输出以ERROR:开头也会被视失败，不采用这种错误契约。
6. **编程案例是演示而非真实改码闭环**：codedev:59–68注册三种MockProvider，调用一次gw.chat；79–84手写“生成代码/12个测试通过”到回放记录，没有实际生成登录代码或运行测试。因此不能将这些输出当真实多Agent编程验收。案例结构仍有助于清晰展示模块边界。
7. **生命周期DevOps不是任务生命周期**：devops提供版本、分桶、分数累计和用量记录；recordScore由调用者提供分数，未见该文件调用LLM裁判；不能由“生命周期”字样推断取消/进程监督存在。

### 与SaCode的首批直接对照

core/src/execution_service.cj:7–103以会话日志重放、校验revision和合法状态迁移，publish要求checkpoint成功；158–188消费绑定提案的一次审批并区分starting许可；216–240把取消请求、stopping与unknown分开。比上述CangChain规则/回放示例承担更多执行可靠性责任，**应保留这些语义，不能为代码量少而删掉**。这些是本轮静态核读，不等于当前整条运行已验证。

真正可简化的是展示与扩展层的接线、接口命名和重复状态投影，而不是压掉未知状态/审批消费/持久屏障。是否存在重复守卫仍待进一步追真实工具调用链，不能凭文件数量下结论。

## 第二轮：工具、权限与取消链路（07:40续审）

清理后重新Git获取magic-cli与CangjieMagic并detach到上述完整SHA，未构建、安装或运行模型。CangChain使用第一轮固定提交记录，本轮未重新获取或运行。以下结论是静态实现证据，不是平台行为验收。

### magic-cli实际入口

- general_code_agent.cj:22–39注册FSToolset、ShellTool和子Agent，GitToolset在31行注释；因此git_toolset.cj里存在gitPush不能推导默认主Agent暴露该工具。仓库文件存在、注册存在、可执行必须分开。
- shell_toolset.cj:199–228在执行前调用InputUtils.confirm；非交互命令传180秒超时，交互命令继承终端且不传超时。input_utils.cj:115–151在auto下直接Approve；“allow all edits”实际设置全局CliConfig.auto，随后Shell确认也被跳过。适合学习简洁确认体验，不等价于作用域绑定的一次执行审批。
- ESC经cancel_checker.cj:24–39调用AsyncAgentResponse.cancel(false)。其在终端输入请求或交互锁期间不轮询ESC，不能将交互模式当作同样可取消。
- shell_utils.cj:37–101启动进程后并发读两个管道，等待进程；只在TimeoutException分支terminate(force:true)，随后get两个读取Future。没有在此函数看到Agent取消标志、取消时杀自有进程树或有界退出确认。后代持有管道可能令readToEnd/get不返回是静态风险候选，未运行证实，不能宣称已发生。交互版本同样只有超时异常终止。
- gitPush工具函数143–173直接executeWithOutput，不含该函数内部确认。但默认主Agent未注册GitToolset，不能把它写成默认权限绕过漏洞；未来动态注册需单独检查注册与守卫。

### CangjieMagic实际派发

- agent_task.cj:329–417：invokeTool检查stopInfo，查注册工具，再进入executeToolCall。ToolCallStartEvent可Continue（继续）、Continue(resp)（替代执行）或Terminate(resp)（停止任务）；普通工具最终tool.invoke(args)，AgentAsTool走专用子Agent路径。这个前置事件是可参考的集中扩展点，但框架本身未在该段要求每个工具具有审批工单或OS权限后端。
- async_agent_response.cj:144–149取消仅execution.markCancellation；agent_execution_info.cj:216–223原子Bool标记；agent_task.cj:112–126读取任务栈首任务标志，抛AgentCancelException。属于协作式检查点传播，未在已读普通tool.invoke边界注入取消对象；正在阻塞的工具能否停止取决于工具实现，不由Cancelled状态名称证明。
- 参数修复agent_task.cj:462–509只针对ToolArgumentValidationException，有限重试、只接受同工具单个请求，并重新进入executeToolCall，因而重走Start事件。这优于对全部异常盲目重试；但安全前提是验证异常保证副作用尚未开始。不能把“参数验证失败”用于已经执行后的错误。
- doInvokeTool:378–394把ToolException/其他Exception转为观察文本，返回模型循环；不自带副作用unknown分类或持久化结算。模型纠错与业务执行结算必须分层。

## 三者统一建议（首版）

| 决策 | 借鉴依据 | SaCode行动方向 |
|---|---|---|
| 保留自研执行事实 | 三者已读简化层不替代审批消费、崩溃恢复与退出确认 | 保留ExecutionService状态迁移、一次审批、checkpoint及unknown，不另起框架运行真源 |
| 简化上层循环与接线 | Magic有限tool-loop、注册表和统一Start事件；CangChain阶段规则 | 声明与派发复用契约，集中前置守卫；事件只做扩展/观察，不能绕过核心安全门 |
| 权限按实际效果判定 | CLI局部确认与全局auto不等于精确授权 | 不复制全局“允许编辑即允许Shell”的行为；路径、提案、作用域改变后重新授权 |
| 取消分层落实 | ESC→原子标记→检查点，不等于阻塞工具已退出 | 核任务令牌到工具、模型I/O、平台进程监督；分别记录请求取消、退出确认和未知 |
| 重试只在副作用前 | Magic有限参数修复；Chain字符串ERROR重试 | 用类型化错误区别校验/传输/未知结果，拒绝不确定副作用重放；修复请求重走守卫 |
| 运行证明而非演示回放 | Chain mock与人工测试记录 | 测试断言真实文件差异、真实构建退出码、取消后无残留、重启不重放，不能人工写PASS |
| 直接argv与秘密保护 | CLI shell包装与sandbox环境拼串、错误命令日志 | 仅明确shell工具接受shell脚本；平台启动保持argv/env分离，日志不输出完整凭据环境 |

SaCode本轮读model_tool_runtime.cj:96–100已有持久冻结、注册检查与任务取消入口。因此补缺不是“完全没有”，而是继续验证所有实际派发与阻塞执行均贯通这些机制。下一步改代码前先以调用链与测试证据判断缺口，禁止凭架构图重写。

## 第三轮：整体功能对照（07:48完成）

本轮覆盖所有功能域，不只看安全机制。固定提交同上，未构建或运行参考框架。CangjieMagic共272个.cj，magic-cli共135个.cj，CangChain已读8个模块。SaCode按已读core/src实际实现对照。

### 功能域逐项对照

#### 1. 模型接入

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 提供方数量 | 13家真实provider（openai/anthropic/dashscope/ark/deepseek/siliconflow/zhipuai/maas/google/moonshot/openrouter/ollama/llamacpp），model_manager.cj:32–72有真实URL和key环境变量 | 转发CangjieMagic，cli_model_manager.cj加fallback和token limit | gateway.cj:53–59有7家模板但MockProvider为主 | 自有Provider接口+RealSseProvider+catalog，按配置接入 |
| HTTP实现 | 真实：stdx.net.http非OHOS、ohos.net.http鸿蒙、curl子进程三种后端，http_utils.cj/http_curl.cj/http_ohos.cj | 不自行实现 | 不自行实现 | 自有SSE流式解析，cancel.cj逐帧Provider接口 |
| 流式响应 | AsyncChatResponse包裹chunk迭代器，SSEStream解析SSE，openai/chat.cj:102–191有完整chunk解析含DONE标记 | 同CangjieMagic | stream返回ArrayList非增量 | Provider.next()逐帧返回Chunk，取消可在流中间生效 |
| 错误分类 | shouldFallback按message字符串匹配timeout/5xx/429/401等 | 同CangjieMagic | ERROR:前缀重试 | transport_failure.cj类型化错误，区分reachedUpstream |
| 模型切换 | fallbackModels列表，遇可回退异常换下一个 | 同上 | 网关按注册顺序尝试 | provider_registry支持上游模型注册与切换 |

**判断**：CangjieMagic的13家真实provider和三种HTTP后端是实际工程产出，值得学习其接入广度和SSE解析完整性。但字符串匹配错误分类不如类型化精确；SaCode的Provider逐帧接口和取消可在流中间生效，在取消语义上更可靠。补缺方向是多provider配置和fallback链，不是替换Provider接口。

#### 2. Agent主循环

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 执行器模式 | 三种：tool_loop有限循环、react推理-行动循环、dsl自定义执行函数 | 用tool_loop:1000 | gateway单次chat | ModelAgentLoop有限步(maxSteps) |
| 终止条件 | 步数上限、stopInfo、terminal工具、EventHandler终止 | 同CangjieMagic | 不在此层 | 步数上限、取消、finishReason、interrupted |
| 步事件 | AgentStepEvent，hooks.cj全局handler | hooks.cj:94注册 | 不在此层 | log.append("turn/start")，sink.offer |
| 工具调用结算 | invokeTool返回文本，不区分已执行/已观察 | 同CangjieMagic | 不在此层 | 同批调用全部结算，取消后写关联取消结果，无孤儿 |

**判断**：CangjieMagic的三种执行器模式（tool-loop/react/dsl）提供了选择空间，react的推理-行动分离值得参考。但tool_loop文件本身不证明外部进程退出或审批消费。SaCode的"同批调用全部结算+无孤儿"是更严格的结算语义，应保留。补缺方向是是否需要react模式的推理分离，当前不急。

#### 3. 上下文管理与压缩

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 会话压缩 | SimpleConversationCompactor用模型摘要旧对话 | FileContextCompactor先归档完整对话再摘要 | 不在此层 | 未读独立压缩器；model_request从日志重建 |
| 工具结果压缩 | SimpleToolCompactor用模型摘要大结果，agent_task.cj:420–431 | 同CangjieMagic | 不在此层 | 未读独立压缩器 |
| 文件压缩 | 不在此层 | compressCode对.cj/.py/.java做骨架分析，skeleton_analyzer提取签名+行号 | 不在此层 | 未读等效机制 |
| Token预算 | 不在此层 | ModelTokenLimits按模型名查input/output limit，compressCode按0.05×contextWindow×4chars/token算阈值 | 不在此层 | 未读等效机制 |
| 历史归档 | 不在此层 | FileContextCompactor:35–40把压缩前完整对话存JSON到archive目录 | 不在此层 | 会话日志本身是事实真源 |

**判断**：magic-cli的文件骨架压缩和压缩前归档是两个有价值的工程做法。CangjieMagic的模型摘要压缩有原理价值但消耗额外模型调用。SaCode当前从日志重建请求，如果后续需要压缩，应保留日志为真源、压缩只做投影，不删原始事件。

#### 4. 会话与恢复

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 持久形式 | Conversation对象save/load为JSON文件 | conversation_manager.cj:67–75自动存last-conversation | audit内存日志 | 会话日志(NDJSON)append/flush |
| 恢复语义 | 恢复对话文本，不重放工具 | 同CangjieMagic | ExecutionReplay文本时间线 | replay事件校验revision和状态迁移，不重放副作用 |
| 自动保存 | 不在此层 | 退出时autoSave | 不在此层 | append实例可见，flush跨进程持久 |
| 多会话 | 不在此层 | 按名称list/resume/remove | 不在此层 | 多会话+工作区隔离 |

**判断**：magic-cli的对话存取是CLI层面合理做法。SaCode的"日志是真源、消息是投影、恢复不重放副作用"语义更严格。CangjieMagic恢复对话文本但不区分执行事实，不能照搬。

#### 5. 文件与代码编辑

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 读 | 不在此层 | batch_read.cj并发4线程批量读，head/cat分页 | 不在此层 | read工具分页offset/limit，read-truncated标记 |
| 写/编辑 | 不在此层 | fs_toolset.cj写前confirm，edit.cj替换 | 不在此层 | write需一次性审批，edit要求先读取，拒绝覆盖未读或外部修改 |
| 搜索 | 不在此层 | grep用rg，glob转find命令 | 不在此层 | grep/glob自有实现 |
| 差异 | 不在此层 | diff.cj调git diff | 不在此层 | 未读等效 |
| 路径安全 | 不在此层 | blacklist.cj用git check-ignore | 不在此层 | worktree路径约束 |

**判断**：magic-cli的批量读和骨架压缩是可借鉴的效率做法。但其grep用rg子进程、glob转find命令，SaCode的自有实现更可控。编辑前确认两者都有，但SaCode的"先读+拒绝外部修改"比magic-cli的confirm更精确。

#### 6. 编程闭环

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 分析→修改→构建→测试 | 不在此层(框架不内置) | 子Agent拆分：Explorer/Editor/Reviewer/TestGenerator/Refactoring/Planner | codedev案例用MockProvider手写结果，非真实 | 执行服务+模型工具循环+审批 |
| 构建集成 | 不在此层 | cjc_cjpm_run.cj调cjpm build，解析输出 | 不在此层 | 未读等效 |
| 仓颉专项 | 不在此层 | CangjieToolset(文档检索/编译/构建/运行)，CangjieFixer子Agent | 不在此层 | LSP L1只读verb |
| 差异预览 | 不在此层 | diff.cj | 不在此层 | 未读等效 |

**判断**：magic-cli的子Agent分工和仓颉专项工具集是面向编程闭环的真实设计，结构值得参考。但子Agent仍走tool.invoke，不自带执行结算。CangChain的编程案例是模拟演示，不能当真实闭环。SaCode当前有执行服务和LSP，编程闭环的真实贯通仍是待验。

#### 7. 子Agent与规划委派

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 子Agent | AgentAsTool包装，WithContext/WithoutContext模式 | 6个子Agent注册为主Agent工具 | 不在此层 | team_runner多Agent，send_message/spawn_teammate |
| 规划 | 不在此层 | PlanToolset，plan.cj任务树 | 不在此层 | todo_write，goal/create/update |
| 上下文共享 | invokeAgentAsTool:516–532继承或隔离上下文 | 同CangjieMagic | 不在此层 | team共享工作目录和文件系统 |
| 成本/取消传播 | 子Agent走父execution的cancel标记 | 同CangjieMagic | 不在此层 | TurnToken父子+linked，team_task依赖 |

**判断**：CangjieMagic的AgentAsTool把子Agent当工具调用，简洁但子Agent不独立持久。SaCode的team_model更接近独立Agent协作。两者可互相参考：SaCode可学AgentAsTool的简洁委派用于轻量子任务；CangjieMagic的子Agent取消跟随父标记不如SaCode的令牌传播精确。

#### 8. MCP

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 客户端 | SseMcpClient和HttpMcpClient真实实现，protocol.cj基于MCP spec | mcp_config_manager.cj读settings.json加载 | mcp.cj有McpSandbox权限判断 | mcp_test有公共名称冻结测试 |
| 服务端 | sse_mcp_server.cj可托管工具 | 不在此层 | 不在此层 | 不在此层 |
| 工具适配 | MCPToolWrapper包装外部工具加打印 | 同CangjieMagic | canCall/canWrite判断 | 未读等效 |
| 权限 | 不在此层(包装层无) | 不在此层 | McpSandbox默认Deny | 审批desk+guard |

**判断**：CangjieMagic的MCP客户端是真实协议实现，值得参考其SSE和HTTP两种传输。但MCPToolWrapper只加打印不加审批。CangChain的McpSandbox是应用级判断不是OS隔离。SaCode应保持审批desk对所有工具（含外部MCP）的统一门控。

#### 9. LSP

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 客户端 | 不在此层 | LSPClient:512行，JSON-RPC over stdio，initialize/capabilities/semanticTokens | 不在此层 | LspRouter+LspRouters，L1只读verb |
| 文件缓存 | 不在此层 | file_cache.cj | 不在此层 | 未读等效 |
| 取消 | 不在此层 | json_rpc_client.cj:115检查hasPendingCancellation | 不在此层 | lspToken.cancelled() |
| 能力发现 | 不在此层 | 从initialize结果取capabilities | 不在此层 | lspVerbNames契约生成 |

**判断**：magic-cli的LSP客户端是较完整的实现，值得参考其初始化和能力发现。但512行单文件，与SaCode的契约化L1 verb设计不同路线。SaCode可学其initialize和能力获取，保持自己的verb契约和只读约束。

#### 10. 记忆与检索

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| Memory | 接口仅update/search两个方法 | 不在此层 | 不在此层 | 未读等效 |
| RAG | Document/Retrieval/Retriever/VectorDatabase接口+SQLite实现 | cangjie_doc_agent.cj检索cangjiedoc.jsonl | 不在此层 | 未读等效 |
| 向量 | vector.cj+vector_database.cj | 不在此层 | 不在此层 | 未读等效 |

**判断**：CangjieMagic的RAG是接口+SQLite实现，有真实检索能力。magic-cli的cangjie文档检索是专项应用。这些是可选增强，不是SaCode当前核心缺口。如果后续需要文档检索，可参考接口设计，不引入其SQLite实现。

#### 11. CLI与交互

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 输入路由 | 不在此层 | process_input.cj按前缀路由(!///@) | 不在此层 | CLI命令分派 |
| 确认 | 不在此层 | InputUtils.confirm三选项(Yes/Yes-all/No) | 不在此层 | ApprovalDesk一次性工单 |
| 进度 | 不在此层 | status_indicator.cj线程轮询，markdown渲染 | 不在此层 | sink.offer逐帧 |
| 配置 | Config.cj静态变量 | CliConfig+cli_setting.cj | 不在此层 | model_settings+catalog |
| 自定义扩展 | 不在此层 | custom_agent_manager.cj从.magic-cli/agents加载，custom_command_manager.cj从commands加载 | 不在此层 | 插件系统 |

**判断**：magic-cli的自定义Agent和命令加载是面向用户扩展的真实设计。其"Yes-all"实际设全局auto有安全风险。SaCode的ApprovalDesk更精确。可学其Agent/命令发现机制，不学其全局放行。

#### 12. 测试与工程结构

| 维度 | CangjieMagic | magic-cli | CangChain | SaCode |
|---|---|---|---|---|
| 单测 | 多个_test.cj在源码包内 | 多个_test.cj在源码包内 | 76/76声明但未本机验证 | *_test.cj在core/src+桌面test/ |
| 集成测试 | examples/下有可运行示例 | 无独立集成测试 | codedev演示案例 | Host/CLI/桌面跨入口测试 |
| 模块边界 | core/agent/tool/model/rag/mcp/parser/dsl/compactor | app/core/io/lsp/utils | src单包8模块 | core/apps(extjs/scripts) |

**判断**：CangjieMagic的examples是可运行示例，比CangChain的mock演示更可信。两者的_test.cj都在源码包内，与SaCode当前仓颉测试布局一致。

### 整体建议汇总

#### 保留（不因参考存在而删减）

1. **执行状态机和持久屏障**：ExecutionService的awaiting-approval→admitted→starting→running→stopping→exited/unknown，publish要求checkpoint成功。三者已读简化层都不承担这些。
2. **Provider逐帧接口**：Provider.next()返回Chunk，取消可在流中间生效。CangjieMagic的AsyncChatResponse也逐chunk，但取消只到AgentTask检查点，不保证阻塞工具退出。
3. **同批工具调用全部结算**：取消后写关联取消结果，无孤儿。CangjieMagic的invokeTool返回文本，不区分已执行/已观察。
4. **会话日志为真源**：消息/UI是投影，恢复不重放副作用。CangjieMagic恢复对话文本但不区分执行事实。
5. **审批desk统一门控**：所有工具含外部MCP走审批。CangjieMagic的MCPToolWrapper只加打印。
6. **TurnToken父子传播**：cancel到child/detached精确控制。CangjieMagic的取消只设原子标记，子Agent跟随父标记。

#### 简化（可借鉴参考减少代码）

1. **AgentAsTool轻量委派**：CangjieMagic把子Agent当工具调用，适合不需要独立持久的轻量子任务。SaCode的team_model更重，可加一条轻量路径。
2. **工具注册表集中前置钩子**：CangjieMagic的ToolCallStartEvent/EndEvent是集中扩展点。SaCode可参考统一前置事件，减少各工具各写守卫。
3. **代码骨架压缩**：magic-cli的skeleton_analyzer对大文件提取签名+行号，减少token消耗。SaCode当前无等效，可借鉴。
4. **文件骨架分析器**：magic-cli有Cangjie AST实体提取（ast_entity_extractor.cj），可参考用于仓颉专项工具。

#### 原补缺候选（已降级：必须先核现有实现，不能视为缺失清单）

1. **多provider配置与fallback链**：CangjieMagic有13家真实provider配置和fallback列表。SaCode有catalog但fallback链待验。优先级：高，直接影响"接起来处处碰壁"。
2. **流式SSE完整解析**：CangjieMagic的openai/chat.cj有完整chunk解析含DONE标记和角色一致性检查。SaCode的RealSseProvider需对照确认完整性。优先级：高。
3. **对话压缩与token预算**：magic-cli有ModelTokenLimits和压缩阈值计算。SaCode当前从日志重建请求，长会话无压缩可能超context。优先级：中。
4. **仓颉专项构建/运行工具**：magic-cli有cjc_cjpm_run.cj调cjpm。SaCode的LSP L1只读，无构建/运行集成。优先级：按需求定。
5. **MCP客户端真实接入**：CangjieMagic有SSE和HTTP两种MCP客户端。SaCode有mcp_test但真实客户端待验。优先级：中。
6. **自定义Agent/命令发现**：magic-cli从.magic-cli/加载用户Agent和命令。SaCode有插件系统但发现机制待验。优先级：低。

#### 暂不引入

1. **CangChain的模拟验证模式**：MockProvider手写结果不能当真实验收。
2. **magic-cli的全局auto放行**："Yes-all"设全局auto跳过所有确认，安全风险。
3. **CangjieMagic的字符串错误分类**：shouldFallback按message字符串匹配，不如类型化精确。
4. **magic-cli的shell包装拼串**：buildCommandArgs拼接命令到sh -c/cmd /c，有引号安全风险。
5. **CangChain的内存审计链**：FNV风格哈希不抗篡改，不替代持久执行日志。

### 回答"为什么实现起来处处碰壁"

**本段根因归纳已撤回**：以下为当时假设，未建立因果证据；包括“无压缩”“provider广度不足”“magic-cli不碰Windows安全”等未经充分核验的概括，禁止用于实施优先级或架构正确性证明。保留过程便于追溯，现行结论见文首。

原假设为：

1. **可信语义更重**：SaCode要求审批消费、持久屏障、退出确认、无孤儿，这些在参考项目里是简化的或缺失的。实现更重自然更难接通，但这是产品定位要求的。
2. **多入口统一更难**：SaCode的CLI/Host/daemon/桌面共享同一核心语义，比magic-cli单CLI入口复杂。参考项目大多单入口，接起来快但不等于多入口能复用。
3. **仓颉生态限制**：仓颉中心仓无Windows安全API绑定、stdx路径需按平台配置、cjc/cjpm并发争用target。这些是工具链约束，不是设计问题。magic-cli也用仓颉但只面向macOS/Linux沙箱+OHOS，不碰Windows安全。
4. **真实provider接入广度不足**：CangjieMagic有13家provider的真实HTTP实现，SaCode当前接入和fallback链待验。这是"接起来碰壁"的直接技术原因。
5. **上下文压缩缺失**：长会话无压缩可能超context，导致模型请求失败。magic-cli有完整压缩链，SaCode当前缺失。

**结论**：不换底座、不降安全语义。优先补多provider接入与fallback、SSE解析完整性验证、对话压缩与token预算，这三项直接解决"碰壁"。其余按需求推进。


核三个仓库源码中真实权限钩子、取消传播、重试与审计，随后对照SaCode当前核心。未完成逐项对照前不下“替换/重写/全部正确”结论。
