# F18 语音与提示词增强后端设计

- 日期：2026-10-20。
- 状态：设计稿，未实施、未构建、未运行验收；F18 与 D08 状态不在本轮升级。
- 范围：只读核对当前代码，设计 `voice/record|transcribe|enhance|describe`；本轮只生成本文件。不修改 core、Host、桌面、正式文档索引及其他执行方文件，不提交、推送。
- 本文件属于用户指定的 `target/tmp` 临时设计交接件，不是新增正式 `docs/` 方案。正式归档及产品台账登记由后续获授权的集成批次办理，不在本轮扩大写入范围。
- 主线：本设计不改变“同源候选真实编程任务先交付”的近期顺序，不构成语音功能立即施工、收费请求或安装依赖的授权。

## 1. 源码盘点与结论

以下行号为本轮读取时点定位，工作区有并发修改；实施前须重读，不据旧行号覆盖公共文件。

### 1.1 core 的真实结构

| 文件与符号 | 已有事实 | 不具备的保证 |
|---|---|---|
| `core/src/voice.cj:8–43`，`VoiceSession` | begin/end 只改实例内 `open`；utterance 要求开启且非空；append `voice/utterance` 原文；utterances 扫描日志 | 不是设备录音，没有音频流、文件、权限、提供方、跨进程开闭恢复；utterance 不等于 user/message，也不自动持久化 |
| `core/src/voice_exec.cj:21–42`，`VoiceResult` | ok/text/exitCode/timedOut/cancelled/failureKind/message/elapsedMs | 无 operationId、录音身份、文件摘要、资源释放状态；成功未校验文本非空 |
| 同文件 :44–50，`VoiceLedger.transcribe` | append `voice/transcribe`，内容为 wav 路径与语言 | 只是记账，不是 ApprovalDesk；无租约、持久 checkpoint，且路径会进入普通日志 |
| 同文件 :56–92，`VoiceExecutor.transcribe` | 默认无 ASR；检查 token、非空路径、普通文件、已配置 binary；记账后执行 | 不录音、不做编码识别/转换，不限制来源目录/大小/时长，不是云 ASR 客户端；无审批与执行隔离 |
| 同文件 :94–145，spawnAsr/launchAsr | 无 shell 拼串，固定 argv `--wav <path> --lang <lang>`；stderr 在另一个任务读取，stdout 当文本；之后 wait/terminate | 固定参数不是 whisper.cpp/vosk/sherpa 的通用协议；未验证任何实际工具兼容性；任意传入二进制不等于可信 ASR |
| `core/src/prompt_enhance.cj:25–64` | enhanceRequestJson 只构造固定 system + 一条草稿 user 消息；无历史/工具；8000 上限；拒绝工具调用、截断、空结果；取消不返回可用文本 | 不属于 VoiceExecutor 的链；转写后没有自动增强接线，也不应默认串联 |
| 同文件 :103–132 | EnhanceHandle/EnhanceRunner 用独立 TurnToken 和后台任务提供异步状态 | 当前不带业务 operationId、草稿身份和录音关联 |
| `core/src/enhance_charge.cj:14–33` | EnhanceCharge 绑定原日志/租约/预算表，终态用量结算；失败可保留待结算 | 不可推导为请求发送前已具备持久准入屏障；flush 失败不是费用未发生 |

**转写器接通前的明确缺口：**

1. `voice_exec.cj:105` 先同步 `readAllStream(stdout)` 到 EOF，才进入 :111–116 的取消/超时轮询。`core/src/shlex.cj:79–94` 的 readAllStream 是无界逐行读取，进程不关闭 stdout 时可能一直阻塞；现有实现不能保证注释所称“等待期间取消”。deadline 也是读完后才创建，不覆盖全过程。
2. `maxOutputBytes` 仅保存，未用于 stdout/stderr 读取；两路均可无界增长。
3. 只对当前 SubProcess terminate，无已核验的整树所有权、后代收束和两路 reader join；正常、取消、超时、启动失败的审计并不完整。
4. `ledger.transcribe` 是 append，副作用前无持久屏障。不能直接把该类接到 Host 就声称审批已保护。
5. 音频规范、模型资源、sandbox/network 能力、提供方版本、编码和错误帧均未定义。不能把 stdout 上的诊断文字误认作转写成功。

### 1.2 Host：语音没有分派，增强已有分派

本轮在 `apps/host/src` 搜索 voice/Voice/transcribe，未发现语音设备、VoiceExecutor 装配或 `voice/*` 方法分支。不要把 `record*` 通用函数当作录音。

| 现有方法 | 源码 | 实际行为 |
|---|---|---|
| prompt/enhance | `apps/host/src/main.cj:2653–2718`，handleRpc38 | draft 非空；拒绝另一个在途增强；注册表默认模型→单路配置→环境兜底；目前仅 openai-completions；冻结端点/模型/凭据，独立 token/90 秒读期限，启动 EnhanceRunner 并绑定 EnhanceCharge |
| prompt/poll | 同文件 :2723–2748，handleRpc39 | active/running/settled、结果文本/错误/用量/模型；会调用 charge.settle，因此并非严格无写入查询 |
| prompt/cancel | 同文件 :2753–2766，handleRpc40 | 只请求取消；终态由 poll 返回；不取消主 Agent turn |

**校正背景而不改台账：**D08 所指语音执行层未接通仍成立；但“F18 全域未接通”不能解释为增强零代码。增强已有 Host/桌面接缝，完整 F18 录音→转写→编辑→增强→发送与恢复仍未验收。

### 1.3 桌面/F05 接缝事实

- `apps/desktop/renderer/app.js:632–661`：draftRevision/updateDraft 与增强装配；:1143 为禁用语音按钮。
- `apps/desktop/renderer/enhance.js:48–101`：增强冻结原草稿修订、会话代数与本地操作身份；成功直接建立可撤销替换，不自动发送；:104–110 的本地取消不等于远端终态。
- `apps/desktop/preload.cjs:73–77`、`apps/desktop/main.cjs:412–423`：promptEnhance/Poll/Cancel 为有限桥接，未携带业务 operationId 或 sessionId。
- `apps/desktop/renderer/send-queue-state.js:174–197`：普通发送先 userSend，再独立 taskStart；`main.cjs:243–254` 转为 `session/append {eventType:"user/message",data,receiptIds?}`。Host `main.cj:1648–1710` 在 flush 成功后答复 append；忙碌输入另经 queue/enqueue。转写完成不得直接调用其中任何发送方法。
- `core/src/voice_test.cj:10–83` 只测 VoiceSession 开关、utterance 与日志回放；回放测试明确 voice/utterance 不进入 deriveMessages。未见该文件覆盖真实 ASR、麦克风或增强链。
- 当前桌面未检出 MediaRecorder/getUserMedia、应用级麦克风权限处理或 voice RPC 桥接。此结论只限本轮源码检索，不代表平台硬件能力判断。
- F05 当前实现并非统一结构化引用：附件单独走 receiptIds；文件/菜单技能主要插入文本；知识快照序列化进草稿。增强整段正文可能改写文本化引用，是待处理兼容缺口，不能声称已有引用片段保护。

## 2. 架构决策

### ADR-18-01：采集在受限桌面适配层，语音业务状态在共享 core

推荐 Electron 自带媒体采集能力，由本地可信工作台的采集适配层管理音轨；Host 不直接调用 Windows 麦克风 API，不给 renderer 文件系统权限。core 管授权、记录身份、音频资产、转写、取消与结果状态；Host 只做严格 RPC 分派与窗口/会话归属校验。

设计流：

```text
用户点击录音
 → 创建一次性审批工单并显示用途/时限/本地或远端去向
 → voice/record start：核票、持久准入，返回受限 captureId
 → Electron 核验真实工作台窗口与 captureId，再请求 OS 麦克风权限
 → 仅音频采集，分块经有限 IPC → voice/record append
 → voice/record stop：音轨停止、分块封存、校验，生成 recordingId
 → 用户点击转写 → voice/transcribe start（独立审批）
 → voice/describe 查询终态 → 文本回到所属草稿的可撤销编辑事务
 → 用户可选增强 → voice/enhance（复用 PromptEnhancer）
 → 用户主动发送 → 原 F05/userSend/queue/task 链
```

Mic 的 OS 权限状态由桌面适配层探测；Host 不应因自己不能探测而猜测 granted。CLI 无采集适配层时 describe 明示 recording unsupported，但可在以后获授权的音频导入适配后支持转写，不暗中启用桌面。

### ADR-18-02：四个方法足够，生命周期使用有限 action

只提出四个外部 Host 名称，不顺手新增通用 rpc/任意执行通道。describe 兼任准确查询终态；record/transcribe/enhance 使用有限 action 处理取消等控制。record append 是可信采集传输动作，不是让模型上传任意路径。四方法初期仅本地桌面，默认不登记为模型工具、不开放 daemon/ACP 远程采集。

### ADR-18-03：增强只有一个实现与一份账

`voice/enhance` 是统一草稿增强服务的新命名入口，适用于口述和键入文本，复用 enhanceRequestJson/PromptEnhancer/EnhanceRunner/EnhanceCharge，不复制模型循环。现有 prompt/* 有真实消费者，不立即删改；将来经独立集成授权迁移消费者并废止旧接口。过渡期间两个入口共用并发槽、取消身份、预算与幂等记录，不允许双启动/双计费。现有无 ID 的 prompt/poll/cancel 不能操作其他窗口发起的新 voice 请求。

## 3. 通用 RPC 契约（提案，非现有接口）

### 3.1 身份、结果与限额

- 所有请求带 `sessionId`；Host 用 IPC 可信来源绑定 owner/windowInstanceId，不能信任 renderer 自报窗口。跨会话、跨窗口、旧 captureId 一律拒绝。
- start/append/stop/pause/resume/cancel/discard 携带调用方预先生成的 `requestId`；Host 保存该 owner 范围内 requestId + 规范参数摘要。相同请求返回同一结果；同 ID 异参拒绝。不能因桥超时自动重发新 ID。
- start 的 `approvalId` 只接工单号，不接受 `approved:true`、权限字符串、任意 command/binary/URL/凭据；providerId 对应已配置且受控的版本与能力。
- `draft` 上下文统一为 `{draftId,revision}`，均为不透明身份/非负修订；sessionGeneration 是桌面本地迟到保护，不充当 Host 授权凭证。
- 异步 start 返回 `{operationId,sessionId,state,revision,draft?,resultAvailable:false}`，不把 accepted/running 当成功。operation 的 state 为 admitted/running/cancel-requested/succeeded/failed/cancelled/interrupted/unknown；另有 `resourceState: pending|released|unknown`、`settlementState: pending|settled|unknown`。
- 只有 succeeded 且资源/必要持久结算完成，结果才标 `resultAvailable:true`；取消已发云请求不承诺供应商停止计费。原请求是否已发送、结果未知与清理失败分别报告。
- 设计默认上限（实施前冻结）：单录音 120 秒、单活动采集/窗口、256 KiB 原始分块、总音频 25 MiB、转写总期限 120 秒、转写文本 UTF-8 1 MiB、普通诊断 64 KiB；增强保持现有 8000 输入上限及真实总期限，不把读期限当总期限。达到上限安全停止并给出限制原因，超额分块不写盘。
- NDJSON 采用有界 base64 分块；限额按解码后字节计算，另设编码帧上限。禁止把整段无限音频塞进单帧。

### 3.2 voice/record

| action | 参数（除通用字段） | 返回/语义 | 审批 |
|---|---|---|---|
| start | approvalId、draft、deviceRef?、requestedMimeType、maxDurationMs（不大于上限） | operationId、captureId、下一块序号、实际获准格式/限额；state=admitted，**不是已在录音** | 一次性 microphone.capture 工单；OS 许可独立 |
| append | captureId、sequence、chunkBase64、mimeType、captureStatus（started/recording/paused） | acceptedSequence、累计字节、服务端状态 | 不再弹票，仅已准入 captureId 的可信窗口；序号重复且摘要相同幂等，异内容拒绝 |
| pause/resume | captureId | 请求控制状态；必须经采集适配层确认后才显示 paused/recording | 同一录音许可内，不额外审批；resume 超出获准时限需新录音许可 |
| stop | captureId、lastSequence、captureStopped=true | 停止确认且完整封存后返回 recordingId、format、bytes、durationMs、digest、expiresAt；缺块不伪报 ready | 安全收束，不加票 |
| cancel | captureId | 请求停轨并废弃本轮未封存音频；已收到确认后才 released | 不加票，不得审批阻止停止 |
| discard | recordingId | 自有且未被在途任务读取时删除；在读则先标记 delete-pending | 不加票，不能删除其他用户文件 |

start 不接受客户端落盘路径；deviceRef 仅工作台获得的不透明设备句柄，不回显设备个人标签。采集权限拒绝/设备断开后通过受限桌面适配回执将 operation 结为 failed；最小实现可用 append 的 `captureStatus=failed` + 白名单 failureKind、空数据进行确认，不允许任意状态跳转。可信 IPC 适配须验证采集上下文，不能接受网页 frame 调用。

pause/resume 的 Host 回执只代表控制请求接收；桌面在完成平台动作后通过同一受限采集回执确认。stop 顺序为请求停轨→接收最后数据→音轨 stop→lastSequence 封存；captureStopped 也不是可被任意来源自报的可信事实。Host 断连后适配层立即停轨；Host 的未知态不能维持麦克风录制。

### 3.3 voice/transcribe

- `action:start` 参数：`{sessionId,requestId,approvalId,recordingId,providerId,language:"zh"|其他已声明语种|"auto",draft:{draftId,revision},timeoutMs?}`。
- Host 只解析自己已封存的 recordingId；本期不接受 wavPath、URL、shell 参数，也不复用图片附件读取接口来读取音频。
- 审批绑定 recordingId + digest + bytes + provider 配置修订/模型/本地或远端模式/端点身份 + language + 期限 + owner/session。远端上传的提示明确接收方、音频大小、费用与供应商留存未知项。录音许可不包含上传许可。
- 本地 ASR 仍是外部进程副作用，需审批并满足执行监督与隔离；模型/运行库缺失明确 blocked，不自动下载或装依赖，不降级到云端。
- start 返回 operationId；成功的 describe 结果为 `{text,language,providerId,recordingId,sourceDigest,elapsedMs,draft,usage?,usageVerdict}`。仅提供方真实报告才给 confidence/segments，不能编造。
- `action:cancel` 参数为 sessionId/requestId/operationId，无新审批。只取消本笔 token，保持账单与子进程结算；返回 cancelRequested，不承诺已结束。
- 空输出、非法编码、超额、部分/截断输出一律不可用；非零退出的 stdout 不作为成功文本应用。失败保留原草稿和可恢复音频，直到明示期限或用户丢弃。

### 3.4 voice/enhance

- `action:start` 参数：`{sessionId,requestId,approvalId,draft:{draftId,revision},text,sourceTranscriptOperationId?}`；text 非空且限长。
- `sourceTranscriptOperationId` 只作来源关联，不允许因此读取另一会话正文或自动拉入历史。键入文本同样支持，不要求先录音。
- provider/model/credentialRef 从 Host 已保存配置解析并冻结，返回非敏感 providerId/model；不允许 renderer 传 endpoint/key/system prompt/tools。
- 需要独立 `prompt.enhance` 工单，绑定原文摘要、草稿修订、接收方、模型及费用语义；批准不等于批准发送正式对话、工具执行或改码。不要假定现有 prompt/enhance 已做到这一审批策略。
- 返回 operationId；describe 成功结果为 `{text,draft,sourceTextDigest,model,usage,usageVerdict,finishReason}`。结果直接应用可撤销，不新增预览弹窗；审批确认不展示“增强前后对照”。
- `action:cancel` 与 transcribe 相同，使用独立 token。失败/取消不替换原文，已知用量仍结算。禁止未经再次用户动作的“转写成功自动增强”。

### 3.5 voice/describe

请求：`{sessionId,operationId? ,recordingId?}`，后二者互斥；都不传时返回本 owner 能力和脱敏活动操作摘要，不返回所有录音/文本。

- 能力查询：`record:{supported,formats,maxBytes,maxDurationMs,permission:"granted|denied|prompt|unknown",reason?}`、`transcribe:{providers:[{id,mode,ready,languages,formats,reason?}]}`、`enhance:{ready,providerId,model,reason?}`、留存参数与服务 epoch。
- operationId 查询：通用状态、操作类别、失败原因、清理/计费状态；仅所属 owner 且 resultAvailable 时返回相应文本。
- recordingId 查询：格式、大小、摘要、过期时间、ready/delete-pending/deleted 状态；不返回本地绝对路径、base64 音频或 transcript。
- 严格只读、无审批、不启动设备/网络、不驱动结算；后台结算器持有原会话归属主动结算。**不能直接把 prompt/poll 原样改名，因为现有 poll 会尝试写账。**
- 查询丢失的 ID 返回 operation-not-found/expired 或 unknown，不用“没找到”解除未知副作用并重发。Host 重启 epoch 变化不重录、不重传、不重试收费请求。

### 3.6 错误与接口命名

JSON-RPC 参数错误使用 -32602；缺 provider/权限/业务冲突走现有 Host 错误体系，实施时冻结具体业务错误码，避免在本设计私造与全局冲突的数字。

稳定 `error.data.reason` 建议：permission-denied、approval-required、approval-mismatch、approval-consumed、persistence-failed、not-owner、stale-draft、capture-unavailable、device-lost、format-unsupported、audio-too-large、recording-expired、source-changed、provider-not-configured、sandbox-unavailable、output-too-large、empty-transcript、timeout、cancelled、result-unknown、cleanup-pending。

voice/record 是 RPC，现有 voice/transcribe/voice/utterance/voice/exec 是日志事件；即使同名字也不可由 session/append 伪造授权事实。未来新增内部 voice/* 控制事件须保留为受限类型并纳入既有事件准入门禁，不擅改当前通用事件分派。

## 4. 授权与持久化边界

### 4.1 三层权限，不能相互替代

1. 用户意图：可信工作台显式点击，不能由网页内容、ASR 文本或模型输出触发录音/上传/增强。
2. 应用工单：复用 ApprovalDesk 的精确一次性票据，绑定动作与数据摘要。审批拒绝、待定、票据过期均不触发副作用；plan/auto/yolo 档位不隐式授予麦克风或远端上传许可。
3. 系统权限：Electron/OS 麦克风授权仅表示设备可访问，不表示允许转写上传或收费。录音许可也不意味着可截屏/摄像头/系统回环音频。

审批适配必须核对当前 approval/ask、approval/answer 的实际持久化契约，不能借计划批准 exitDurable 的修复推导所有工单都已具备屏障。拟议顺序：固定提案→精确核票/消费→与准入事件一起在原会话租约下 durableCheckpoint→确认未冻结、原 owner 有效→才启动采集/进程/网络。失败 freeze、返回 persistence-failed，绝不 started=true；消耗后的票不因重试而复用，使用同 requestId 查询原准入。

开始后至真正发出网络/进程前再次检查 token、来源 digest、配置修订和 owner。取消/崩溃后的发送状态不明不得自动重发。终态写入失败报告 settlement pending/unknown，不能撤销已经发生的远端成本。

### 4.2 Electron 权限门禁

仅允许本地可信工作台顶层 frame、绑定窗口和当前 captureId 的 audio 请求；拒绝 video、display、网页/内置浏览器子 frame、远程 origin 及无手势录音。check/request 两类权限路径均实施最小允许策略，不使用全局“所有媒体允许”。

音轨必须在停止、取消、窗口关闭、renderer 崩溃、Host 断连、会话切换开始和权限撤销时释放；不用 UI 按钮颜色推断设备已停。页面切后台保留可见状态，不隐藏录音；窗口关闭自动停录，不让后台继续。精确 Electron API、MediaRecorder 编码支持及 OS 行为须依据固定 Electron 版本另行核实，本轮未进行浏览器 API 运行验证。

## 5. 音频存储、格式、恢复与清理

### 5.1 存储根与数据最小化

产品使用平台私有可写缓存根 `voice/<owner>/<randomRecordingId>/`，不写项目源码、仓库根、安装目录或当前 cwd；本轮设计文件路径不是产品录音目录。安全权限只约束新建的自有私有目录，不递归修改用户目录 ACL，不为录音关沙箱。

- 随机不可预测 ID、创建即不覆盖；不跟随符号链接/重解析点；校验根归属和真实类型，拒绝路径穿越。Host 返回 ID，不回绝对路径。
- 采集中写 `.part`，依序校验后封存；内容格式必须按实际字节验证而非只信 MIME/扩展名，摘要覆盖最终字节。
- 采集首期可用平台实际支持的容器（例如 webm/opus），但仅当转写 provider 声明直接接受该格式时可 ready。现有 VoiceExecutor 的 WAV 入口不能直接接受 webm 改扩展名。
- 若需 PCM/WAV 转换，使用独立受控适配器并计入依赖、隔离、资源上限及清理；不自动下载 ffmpeg。没有受验证的格式交集即 format-unsupported，不宣称录音→转写走通。
- 不在普通日志存路径、原音频、转写/增强全文、凭据、认证头或 stdout/stderr 原始敏感内容。voice/utterance 现有正文落日志方式不作为新链默认；仅真正发送后的 user/message 属会话事实。
- 必要日志仅 operationId、来源摘要、大小/时长、provider 非敏感身份、许可/准入/终态、用量与清理状态；临时录音索引不是审批事实真源。

### 5.2 建议默认留存（需要产品冻结）

- 成功转写并被用户应用：默认随本笔操作资源释放删除原音频；用户可在开始前明确选择“保留以重试”，最长 24 小时。
- 转写失败或结果因编辑冲突未应用：保留自有封存音频最多 24 小时，显示 expiresAt 和丢弃动作；不因普通失败立即删掉唯一可恢复内容。
- cancel 录音/显式 discard：立即尝试删自有载荷；在途读取先取消并等句柄释放，删除失败标 cleanup-pending 并限额重试，不误报已删除。
- 崩溃遗留 `.part`：重启先停止任何旧采集身份；可核验的完整片段仅作为恢复候选，损坏则报告不可恢复；不自动转写。过期自有残留由安全清扫器处理。
- 临时转写/增强结果默认仅操作内存，窗口/进程重启不承诺恢复未发送草稿；需求若要跨重启恢复需独立的加密草稿/恢复设计，不把原文偷偷追加普通日志。本期可恢复内容主要指失败后仍在界面/受限音频缓存中可重试。
- 按总容量限制清理已过期且不在用数据；不能静默淘汰仍在录制/转写的文件。配额不足拒新录音并说明原因。删除不承诺物理安全擦除；备份、崩溃转储与供应商留存须另述。

## 6. 转写进入模型请求的唯一接缝与 F05 关系

### 6.1 草稿编辑，不直接注入 Agent

```text
转写终态文本（低信任输入）
 → UI 比较 sessionId + window instance + draftId + revision + operationId
 → 将文本插入开始录音时冻结的选区/光标，建立单次可撤销事务并推进草稿修订
 → 用户编辑并主动发送
 → 现有 F05 引用校验/附件 receiptIds + userSend/queueEnqueue
 → session/append user/message 持久成功
 → 独立 task/start，使用既有共享模型请求装配
```

Host 转写结果不 append user/message、不调用 task/start、不恢复执行权限；voice/utterance 也不当作发送代理。只在正常用户发送的文本位置进入 user 内容，不提升为 system/developer，不携带工具定义/审批。

- 任一修订/会话身份不匹配，结果保留在所属操作的“待插入文本”状态，由用户主动选择插入当前草稿，不能覆盖新编辑；不自动弹增强预览、不抢焦点。
- 转写使用插入/选区替换而非整稿重建，保留已有 F05 内容；增强在已确认纯文本部分按 PRD 直接替换，并支持按钮及 Ctrl+Z 回退。
- 增强返回时执行同样 CAS；用户继续编辑后原增强专用回退失效，但原生撤销顺序保留。发送等待期间的新输入不能被旧发送/转写/增强回执清空。
- 切换会话的发起时刻即撤销本地应用资格并停轨，不等 sessionSelect 成功后 generation 才变化；远端取消/计费结算继续归属原会话，不写新会话账。

### 6.2 不替代斜杠、技能、知识引用

- 口述“斜杠 review”“@某文件”“使用某技能”只是文本，不自动执行斜杠、不安装/激活技能、不检索/授权 MCP、不构造知识引用或上传文件。需要用户走 F05 已定义的显式选择动作。
- 即使 ASR 真输出 `/name` 或 `@file`，也不能模拟命令菜单点击；发送时如后端有既有解析规则，仍按正常文本来源与确认规则处理，不能让语音绕过。
- 语音结果不是文件/知识来源的修订凭证；已有 receiptIds、scope、revision 与 stale 校验必须原样保留。
- 现有知识 JSON 等引用混在正文中，不能宣称增强自动保真。首期对可识别引用-bearing 草稿阻止整稿增强并说明原因；无法可靠识别时不要承诺安全改写，需先评审最小的“文本区＋不可变引用片段”契约。该契约属于后续协作确认，本轮不修改 F05。
- 增强不得把“请先审批”“只读”“不要执行”改成已授权指令；模型拒绝工具调用只是基础防线，语义保持仍要真实验收。模型输出不构成任何批准票据。

## 7. 取消、结算与恢复状态机

- 录音：idle → admitted → permission-pending → recording ↔ paused → stopping → ready；拒绝/断连/取消走收束。尚未收到采集开始确认不能显示 recording。
- 转写/增强：admitted → running → succeeded/failed；取消先 cancel-requested，资源释放与费用结算各自独立，不能 UI 隐藏后丢掉任务。
- 本地 ASR stdout/stderr 并发有界读取，单调时钟总期限从准入后启动计时；独立取消监控可终止自有进程树，join 读取者后再结算。不能继续直接调用现有阻塞 readAllStream 路径。
- 云端取消关闭自有连接但不能承诺远端没处理；usage 缺失标 unknown，不记零成本成功。转写/增强 token 与主模型 turn 独立。
- 启动前持久化失败不发出动作；动作后持久化失败保留必要资源身份和 pending 状态，UI 显示结果/结算区别。不得通过重复启动来“修复”未知。
- 重启只恢复元数据与待清理/可恢复录音清单，不自动重录、上传、增强或发送。进程已死不自动等于供应商未计费；不可取得完整结果时 interrupted/unknown。

## 8. 文件与依赖建议（未来实施，非本轮改动）

| 归属 | 最小建议 | 复用与限制 |
|---|---|---|
| core | 新 `voice_runtime.cj`（operation/录音资产与归属）、`voice_contract.cj`（有限请求/结果） | 复用 SessionLog/WriteLease/ApprovalDesk/TurnToken，不复制通用日志框架 |
| core | 必要时新 `voice_recording_store.cj`、`voice_provider.cj` | 文件过大再拆，不预造多层抽象；ASR 格式/取消协议必须明确 |
| core | 修整现有 voice_exec.cj | 有界双流、全程取消/期限、可信 provider/监督、完整终态；不把 VoiceLedger 当审批器 |
| core | 复用 prompt_enhance.cj/enhance_charge.cj | 一个增强执行器，一次用量结算；补 operation 身份与准入屏障，不新建“语音 Agent” |
| Host | 新 `voice_rpc.cj`，main.cj 仅必要分派/装配 | 与公共文件负责人串行协调；实现时同步方法契约/initialize/测试，不在设计轮接线 |
| desktop | 未来新增有限 voice IPC 与采集/草稿适配 | main/preload/bridge 测试等公共文件先交接；不暴露通用 host.call、任意文件路径/命令 |

依赖决策：

1. 录音优先复用 Electron/Chromium，不新增桌面运行时 npm 包，不预设需要 C/H。仍需各平台设备、权限、格式实测。
2. 本地 ASR 可用受控提供方适配，工具可选但必须显式配置、检测并说明模型文件大小/来源/许可证；完整安装态不得要求用户装 SDK/不明运行库来凑通过。未经验证不在 whisper/vosk/sherpa 中自动切换。
3. 云 ASR 需真实支持音频上传的协议适配，不能假定现有 RealSseProvider 的聊天接口等于转写端点；凭据走现有安全引用，网络限制与 TLS 按当前项目策略。
4. 若将来选 extjs 承载 ASR 适配，必须明确随包 Node、锁定依赖/许可证、格式库与资源收束；“在 extjs npm install”不等于已满足零环境安装态。本方案首期不强依赖 extjs。
5. Windows/Linux/macOS 桌面分别验证录音/OS 权限/音轨 stop/默认沙箱；macOS 签名和麦克风用途声明、Linux 音频服务、Windows 隐私设置均是验收前提而非可用承诺。OHOS 后续由 ArkTS/ArkUI 采集适配同一业务契约，不能据 Electron 设计推导设备支持。
6. 本期不设计 TTS、唤醒词、后台常听、系统音频采集、自动执行口述命令，避免越界。

## 9. 验收清单（只提出，不执行）

| 场景 | 必须结果 |
|---|---|
| 麦克风应用工单拒绝/OS 拒绝/无设备 | 不采集；状态与原因真实；无可见假录音，无自动云端兜底 |
| 伪造窗口、子 frame、跨会话 captureId、重复票、同 requestId 异参 | 拒绝；不能开启设备、读取录音或取消别人任务 |
| checkpoint 失败、租约丢失、日志冻结 | 副作用前阻断，不报 started；动作后失败显示待结算，不重发 |
| 开始/暂停/恢复/停止/取消/关闭/崩溃/切换会话 | 真实音轨状态，停止后设备释放；旧片段/结果不串新会话 |
| 重复块/乱序/缺块/超额/伪 MIME/路径攻击 | 幂等或明确拒绝；不发布半音频、不写任意目录 |
| ASR 不退出且 stdout 不关闭、大量双流输出、退出非零 | 总期限/取消仍生效；资源有界，自有整树收束；不把诊断当转写 |
| 本地 ASR 缺模型/格式转换缺依赖/隔离不可用 | 明确 blocked，不安装、不裸跑、不改扩展名假转换 |
| 云端已发后取消/连接中断/响应未知 | 不应用半文本，不报零费用；不自动重复上传，原会话结算 |
| 转写成功/失败/新编辑后迟到 | 可编辑/撤销；失败保原文和期限内可恢复录音；旧结果只待用户插入 |
| 增强成功/失败/取消/工具调用/截断 | 成功直接可撤销替换；其余保原文，无工具/历史泄露、不自动发送 |
| 口述 /、@、技能、知识及审批话术 | 只产文本，不伪造引用/授权；F05 验证不被绕过 |
| 重启/过期清理/句柄占用/权限失败 | 不自动录音/收费请求；只清自有数据，cleanup-pending 可见，不声称安全擦除 |
| 三桌面安装态、CLI 无采集端 | 默认沙箱、无构建环境条件实测；无采集端明确 unsupported；局部测试不升级全域完成 |

IO01/IO02 为需求验收锚点：`docs/product/PRD.md:749–752`。源码单测、假 provider、协议回执、设备录音、真实服务、完整桌面、安装态分别留证；本轮没有新增/运行测试，不将以上表格当通过记录。

## 10. 待确认与交接门槛

1. 首期 ASR 本地或远端、提供方/版本/模型来源、许可证、收费与留存政策；不得依工具名猜 API。
2. 每平台录制格式与 ASR 接受格式交集，是否需要受控解码器；无验证交集先 BLOCKED。
3. 采集适配层的精确 IPC/权限实现、私有缓存根与系统保护能力；本轮仅设计，不抢桌面/平台负责人工作。
4. 24 小时恢复音频、总容量和转写/增强结果留存是否符合产品隐私政策；未发送草稿跨重启恢复不在当前已有能力内。
5. 通用审批票消费与持久屏障的实际契约；voice/enhance 相比当前 prompt/* 新增独立审批，需评审其交互与统一迁移策略。
6. F05 文本化引用的最小保护契约，以及共享增强槽从 prompt/* 迁移到 operationId 的串行归属；本轮不修改这些文件。
7. 新外部协议与业务错误码评审、日志受限事件登记及后续 docs/PRD-tracking 同批归档；设计稿不更改当前 F18/D08 状态。

**交接结论：**可复用的是增强请求/执行/结算、现有草稿编辑与用户发送接缝；不可直接复用为成品的是 VoiceExecutor 当前取消、录音授权/采集、音频格式/存储与持久准入。先冻结 provider 与格式、授权与生命周期契约，再在独立授权批次接线；本轮到设计文档为止。
