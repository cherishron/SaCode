# 附件批次：持久化 seam、宿主通道与输入区接通（2026-10-05）

## 1. 上游契约（直接证据，本次直读原文）

冻结快照 `deepseek-ai/deepseek-harness@639ed015397290b3745d163aafe02ffee4aa3f84`，
通道 `api.github.com` contents 端点，`docs/subsystems/attachment.md` 18168 字节、
`attachment.zh.md` 17766 字节，两条均 `status:200 / body:full / secondhand:false`
（登记于 `docs/evidence/upstream-ledger-2026-10-04.json` 的 `reference/subsystems/attachment/en|zh`）。

| # | 契约（zh 原文行号） | 本仓落地 |
|---|---|---|
| 1 | 事件与模型可见附件块只含引用+元数据，「绝不包含浏览器对象 URL、宿主临时路径、提供方 URL 或 base64 数据」（L5） | `attachment/record` 只写引用 JSON；用例断言日志里不含 `iVBOR`、不含宿主目录 |
| 2 | 「宿主接受用户消息后，会先把消息中的图片移到 `attachments/v1` 下，再追加用户事件」（L7） | `AttachmentStore.save*` 先落盘，`commitMessage` 之后才写事件；用例在「一条事件都还没写」的时刻断言对象已在盘上 |
| 3 | `AttachmentId` 不透明，本地后端形如 `sha256:<digest>`，消费方不得解析或据此派生路径（L13） | id 由核心铸造；`digestOfId` 只在本后端内部用，且对外来 id 强制 64 位小写十六进制形态校验（挡住 `../` 穿越） |
| 4 | 图片准入：每消息 20 张 / 合计 200 MiB；单张 20 MiB / 64000000 像素 / 单边 8192（L59） | `AttachmentLimits.localBackend()` 逐条钉住，额度由调用方注入 |
| 5 | 通用文件**没有任何准入额度**：任意内容与长度，落盘对象逐字节等于提交字节（L253-261） | `saveFile` 不校验长度与类型；空文件也收 |
| 6 | 批量图片先校验每个成员再发布整批，拒绝时不留半个对象（L198） | `saveImages` 分「全量校验」与「整体发布」两段 |
| 7 | 服务对留存中立：续跑/分叉会话可共享对象，GC 不绑会话删除（L170 末段） | 目录是会话根下的 `attachments/v1`（不在会话子目录内），同内容跨会话共用一个对象 |

### 曾据二手判断、直读后修正的部分
`docs/evidence/upstream-module-reads-2026-10-04.md:163` 把 20 图/200 MiB/20 MiB 写成了
「附件」的通用限制。直读原文后确认：**这三条只约束图片，通用文件按契约不设准入额度**。
能力矩阵与本文按修正后的口径记录。

## 2. 已知偏离（不假装对上）

| 偏离 | 原因 | 后果 |
|---|---|---|
| 不做规范化阶段（上游：长边 2048、编码 4 MiB） | 需要图像编解码器，本仓没有；引第三方解码库会把运行时依赖带进「产物零 npm 依赖」的红线 | 超限一律**拒绝**而不是缩小后收下；落盘存源图原样，对象比上游大 |
| 只认 png/jpeg/gif，`image/webp` 按不支持类型拒绝 | RIFF 三种子格式（VP8/VP8L/VP8X）的尺寸读法本机没有可核验的真夹具，凭记忆写等于把「读出的宽高」变成假证据 | webp 仍可作为**通用文件**附件上传（不受图片额度约束）；要收 webp 图片需先补真夹具 |
| 引用落成紧邻其前的 log-only `attachment/record`，而不是嵌进 `user/message` 内部 | 模型可见事件类型是不变量 7 冻住的五类，且 `user/message` 正文要维持纯文本（标题投影直接取它） | 信息与顺序同一条规则（一条消息一份引用、先持久化后事件）；投影配对由 `refsForMessage()` 负责 |
| 摘要用核心内纯实现 | `stdx.crypto.digest` 底层绑 OpenSSL 3，stdx 发行包内不带 libssl/libcrypto | 没装 OpenSSL 的机器仍能存附件；代价是自带一份需向量钉住的实现 |
| 附件不进模型请求 | 需要把引用装配进 `user/message` 的模型可见形态，动的是不变量 7 的投影面 | 附件目前是**会话事实 + 界面可见**，模型读不到图；下一条批次做装配（含真模型 vision 核验） |

## 3. 实现清单

- `core/src/sha256.cj`（新）— `sha256Hex` / `sha256Digest`，加法一律 `wrappingAdd`。
- `core/src/attach.cj`（重写）— `AttachmentLimits` / `AttachmentRef` / `ImageInput` /
  `AttachmentStore`：内容寻址落盘（复用 `publishNewFile` 原子发布，已存在即不覆盖）、
  按容器头部魔数认类型与固有宽高（PNG IHDR、GIF 逻辑屏、JPEG 逐段走 SOFn）、
  读回必复核摘要、`hostPath` 只对「本后端是宿主文件后端」负责。
  旧的 `record(name,mime,size)` 三字段 `::` 拼接（自带「假设不含 `::`」债）整体作废。
- `core/src/attach_test.cj`（重写，10 例）+ `core/src/sha256_test.cj`（新，2 例）。
- `apps/host/src/main.cj` — `attachment/upload` 方法（`kind/name/mediaType/data` 四格，
  base64 解码后交核心）、`session/append` 可选 `receiptIds` 结算、
  凭证表由宿主铸造并一次性回收、`initialize` capabilities 登记、新错误码 `-32024`。
- `apps/desktop/test/attachment-upload.test.mjs`（新，5 例，打真实宿主）。
- `apps/desktop/preload.cjs` / `main.cjs` — `attachmentUpload` 通道（逐字段校验，
  `data` 上限按单图 20 MiB 的 base64 长度给）；`userSend` 加第二参数 `receiptIds`
  （形态 `/^u[1-9]\d{0,6}$/`，最多 20 张）。
- `apps/desktop/renderer/app.js` — 附件轨状态、`FileReader`→base64→上传→凭证，
  `canAcceptDrop:true`、`AddButton` 不再 `disabled`，发送前挡未就绪附件，
  成功后清空并在切会话时 `clearAttachments()`；`catalogError` 表补齐 12 条中文文案。
- `apps/desktop/renderer/pages/composer-attachments.ts` — 图片卡片补 `data-upload-status`。
- `apps/desktop/test-support/ui-smoke.cjs` — 暴露面清单加 `attachmentUpload`（32 键），
  新增「经宿主落盘后显示为就绪 / 一次选择只生成一张卡片 / 移除会撤下卡片」。
- `apps/desktop/test-support/composer-attachments-smoke.cjs` — 两条从「占位不伪造能力」
  改为「入口可用、拖放被接受」的真实断言。

## 4. 证据

| 项 | 命令 | 结果 |
|---|---|---|
| 红先（核心） | `cd core && cjpm test` | 编译器报 `undeclared type name 'ImageInput'`×3、`'AttachmentRef'`×2、`extra arguments given for parameter list '(Class-SessionLog)'`×2、`'saveFile' is not a member of class 'AttachmentStore'` —— 即本批要建的符号未建 |
| 绿（核心） | 同上 | `Summary: TOTAL: 441  PASSED: 440, SKIPPED: 1, ERROR: 0, FAILED: 0`，rc=0 |
| 变异 A（一轮四处） | 施变 `read` 摘要复核 / 魔数-声明相符 / 每消息条数 / PNG 宽高字节序 | `FAILED: 5`，红集 = `ReadVerifiesDigest`、`RejectsTypeMismatch`、`PerMessageCount`、`Batch`、`ImageRefCarries…`；其余 6 条附件用例与 2 条摘要用例不受影响 |
| 变异 B（一轮三处） | 施变 事件顺序对调 / 校验阶段即落盘 / id 形态校验放行 | `FAILED: 4 + ERROR: 1`，红集 = `Commit…`、`Replay…`（因 `paired[0]` 越界落进 ERROR 桶）、`Batch`、`PerMessageCount`、`ForeignId…` |
| 变异还原 | `cp` 备份后 `diff` 空输出 | 逐字一致 |
| 常量表反证 | 本轮实现首跑 | `sha256Hex` 全部向量不匹配；用 `Math.floor(frac(cbrt(p))·2^32)` 机械重算 K/H0 得出 9 处手抄错（K[34] 与 K[56..63]），同时用同运算顺序的 JS 复算空消息得到 `e3b0c442…` 证明结构无误——错的是常量不是算法 |
| 宿主红先 | `node --test test/attachment-upload.test.mjs`（改宿主前） | `# pass 0 / # fail 5` |
| 宿主绿 | 重打宿主后同命令 | `# pass 5 / # fail 0` |
| 桌面单测无回归 | `npm test` | `# tests 137 / # pass 137 / # fail 0`（原 132 + 新 5） |
| UI 冒烟首跑 | `npm run ui-smoke` | `UI FAIL 附件经宿主落盘后显示为就绪`，其余（含 32 键暴露面）全过 |
| 定位 | 同检查项加事实Dump + 一条绕过界面的 IPC 探针 | 探针 `attProbe:"ok:u1"`（渲染层直调 `attachmentUpload` 拿到凭证）而卡片仍 `uploading` → 卡住的不是 IPC 也不是宿主，是渲染层的读文件那一步 |
| 根因 | 读代码 | `readAsBase64` 里写了 `reader.result = null`：`FileReader.result` 是只读访问器，赋值在 `onload` 回调内抛 TypeError，回调中断，Promise 永不结算 → 卡片永远停在「上传中」。已删除该赋值并留注释 |
| UI 冒烟复跑 | `npm run ui-smoke` | `UI_SMOKE PASS`，其中 `UI OK 附件经宿主落盘后显示为就绪（实际 {"status":"ready","notice":"","attProbe":"ok:u2"}）` |
| UI 冒烟 | `npm run ui-smoke` | 见下节（本轮补跑） |

### 测试侧的两处诚实说明
- 抛断写法从 `@Expect(captureThrow(() => …))` 改为「赋值 try/catch」：`@Expect` 宏自己按
  逗号切表达式，遇到 `() =>` 解到 `unclosed delimiter`，红灯落在语法而不是语义。
- `attachmentReadVerifiesDigest…` 首次红灯里混进了探针自身的错：`Directory.readFrom` 对
  不存在的目录是**抛**而不是交回空清单，所以「一条都没落盘」的形态把探针自己打进了 ERROR 桶。
  修的是探针（先 `exists` 再数），不是被测系统；修后那 4 条落进 FAILED 桶且各自对应一个变异。

## 5. 尚未接完（本批明确不做）

- 附件进模型请求（需动不变量 7 的投影面 + 真模型 vision 核验）。
- 历史消息里按条展示附件：投影只给「最后一条已配对消息」的引用（`refsForMessage()`），
  逐条配对与气泡内渲染未做。
- 运行中发消息走队列时的附件：`queue/enqueue` 尚未接受凭证，附件只在直接发送路径结算。
- 打包态复验：本批改了 core 与宿主，`apps/desktop/dist/host` 已重打，但
  `electron-builder` 的 NSIS 产物与安装包内 exe 的 sha256 同步尚未重跑；CLI 平台包同理
  （core 变了，npm 包内的 `dsh.exe` 是旧产物）。
- 上传失败在图片卡片上只有全局提示，卡片本身没有可读的失败标记（只加了状态属性）。
