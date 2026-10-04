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
- 打包态复验：见第 6 节。CLI 平台包已从改动后的 core 重打并剥 SDK PATH 离线复验；
  桌面包在同一轮重打（安装包内宿主 exe 的 sha256 对账见 6.4）。
- 上传失败在图片卡片上只有全局提示，卡片本身没有可读的失败标记（只加了状态属性）。

## 6. 交付面复验（同日追加批次）

上一批只证明了 core／宿主／渲染层三个面，装机产物里没有一条断言会碰附件线：`apps/cli`
的 `main` 是 CLI 平台包的自检面，而它没有附件子命令。本批补这一段，并把两个入口的
打包态一起复验。

### 6.1 CLI 交付面新增 `att` 子命令（20 条离线断言）

覆盖：内容寻址（引用 id 就是内容的 sha256）、对象按摘要名落 `attachments/v1`、读回逐字节
相等、按容器头部认出的固有宽高、通用文件不设额度（空文件照落盘）、引用只留末段名、
类型不符拒且不留半个对象、单边超上限拒（本仓不做规范化缩放）、批量「先全量校验再整体
发布」、外来 id 一律拒不派生路径、对象被篡改后读回被拒、引用事件排在它服务的用户消息
之前、引用事件不含 blob、投影配对、以及 `append` 不跨进程 / `flush` 才跨进程的边界。

### 6.2 变异反证（两轮合跑，红集合恰好等于预期受害集）

| 轮 | 变异 | 独占受害断言 | 实测 |
|---|---|---|---|
| M1-A | `persist` 改成 no-op（只建目录不发布） | 对象按内容名落在 attachments/v1 下 / 读回逐字节等于提交字节 / 通用文件不设准入额度：空文件照落盘 | 3 条 FAIL |
| M1-C | `commitMessage` 两条事件顺序倒置 | 引用事件排在它服务的那条用户消息之前 / 投影把引用配回它服务的那条消息 | 2 条 FAIL |
| M2-B | 落盘挪进校验循环（边校验边发布） | 批量先全量校验再整体发布 | 1 条 FAIL |
| M2-D | `read` 不复核摘要 | 对象被篡改后读回被拒 | 1 条 FAIL |

M1 一轮 5 条 FAIL（`PASS=15`）、M2 一轮 2 条 FAIL（`PASS=18`），两组受害集互不相交；
每轮还原后用 `diff <(git show HEAD:core/src/attach.cj) core/src/attach.cj` 证逐字一致
（输出 `RESTORE-IDENTICAL`），复跑回 `PASS=20 FAIL=0 rc=0`。

**测试侧一处改造披露**：权威读那条断言原本直接写 `attBytesEq(store.read(id), png)`，
M1-A 下 `read` 抛 `attachment-missing-object` 把整个 `att` 段打断——只打印了 2 条 PASS
就退出，红集合无法归因。改成把读回包进 try/catch 再断言布尔值，才拿到完整的 5 条红表。
改的是断言的容错，不是被测语义。

### 6.3 提交前整套复跑计数

| 面 | 命令 | 实测 |
|---|---|---|
| 仓颉核心 | `cd core && cjpm test` | `Summary: TOTAL: 441 / PASSED: 440, SKIPPED: 1, ERROR: 0 / FAILED: 0`，`cjpm test success`，rc=0。那 1 条 SKIPPED 由框架计数报出、日志未打出用例名（`FAILED`/`ERROR` 均为 0，非本批引入） |
| 桌面全套 | `cd apps/desktop && npm test` | `# tests 137 / # pass 137 / # fail 0`，rc=0 |
| CLI 合并面 | `dsh all` | `PASS=97 FAIL=0`，rc=0（`att` 的 20 条并入 `all`） |

**一条并发负载造成的抖动**：第一次 `npm test` 跑到 `bridge.test.mjs:292`
「全新会话第一个 turn 能在流中被取消并结算」拿到 `frames: []`（期望 2 帧，轮询窗口
约 400 ms）。那一轮正与 `cjpm build`／打包／DLL 探针并发，且它随后被前台超时打断，
不是挂死。机器空闲时独立重跑同一套：137/137 全绿。断言与窗口都没有改动，所以这条
记为环境抖动而非通过证据——它同时是「400 ms 窗口在低配机器上偏紧」的观测记录。

### 6.4 CLI 平台包离线复验（装机态）

`node scripts/pack-cli.mjs` → `packed 45 个文件`；`npm pack --offline` 两个 tarball
（主包 1375 B / 平台包 11534487 B）→ 离线装进仓内一次性目录 → 剥掉 4 项仓颉 SDK PATH
（`command -v cjpm`/`cjc` 均不可见，`node` 可见）→ 逐子命令按 `^PASS`/`^FAIL ` 计数：

| 子命令 | rc | PASS | FAIL |
|---|---|---|---|
| all | 0 | 97 | 0 |
| stream | 0 | 21 | 0 |
| tool | 0 | 11 | 0 |
| ext | 0 | 8 | 0 |
| cancel | 0 | 9 | 0 |
| extjs | 0 | 12 | 0 |
| headless | 0 | 36 | 0 |
| att | 0 | 20 | 0 |
| seed / projection | 0 | 数据输出型子命令，不产 PASS 行 | — |

DLL 拒绝面单独复验：`RUNTIME_DENY` 那 4 颗（ast / unittest / testmacro / prop_test）
在装机目录里逐颗确认**缺席**；把真依赖 `libcangjie-runtime.dll` 移走后 `dsh att` 当场
`rc=127 error while loading shared libraries`，放回后 `rc=0 PASS=20`。绿不是静默降级换来的。

### 6.5 桌面包

`apps/desktop/dist/host/bin/dsh-host.exe` 由还原后的 core 重打（91 个文件，OpenSSL 两颗
随包）。`electron-builder` 第一次重打报
`EBUSY: resource busy or locked, unlink '…\dist\electron\win-unpacked\v8_context_snapshot.bin'`，
`dist/electron/` 里留下的是 10-03/10-04 的旧产物——按「产物时间戳不变就不能当新证据」的
老规矩，旧产物的任何断言都不作数。锁源经查是 7 个仍存活的
`dist\electron\win-unpacked\resources\host\bin\dsh-host.exe` 孤儿进程（此前打包态冒烟留下，
未经确认不代用户结束进程）。因此本轮把输出目录改到 `dist/electron-att/` 重打，
不动那些进程；对账与打包态冒烟见 6.6。

### 6.6 安装包内宿主对账 + 装包态端到端

| 项 | 实测 |
|---|---|
| 三方 sha256 对账 | 源 `dist/host/bin/dsh-host.exe` = `win-unpacked/resources/host/bin/dsh-host.exe` = **从 `SaCode Setup 0.1.0.exe` 里抽出**的 `resources\host\bin\dsh-host.exe`，三者同为 `dc3d9f9780c2cbd15e31b394565a2cca13f21bccc754b0551a86f75b82fdacc4`。抽法：`7z e 'SaCode Setup 0.1.0.exe' '$PLUGINSDIR/app-64.7z'`，再 `7z e app-64.7z -r '*dsh-host.exe'`（`-r` 是必须的，不加会 `No files to process`——按子路径匹配要递归） |
| 安装包指纹 | `SaCode Setup 0.1.0.exe` 86,962,654 B，sha256 `9447c0d22e7ed7d33fb55aa271d57e745031ee6eda0597258ee8ae70ee431999`；`sacode-portable.exe` 86,810,618 B |
| 装包态帧冒烟 | `win-unpacked/SaCode.exe --frame-smoke --session-dir=…` → `FRAME 汇总 {"groups":247,"checks":710,"failed":0}` |
| 装包态 UI 冒烟 | `win-unpacked/SaCode.exe --ui-smoke …` → `UI_SMOKE PASS`，203 条 `UI OK` / 0 条 `UI FAIL`，其中 `UI OK 附件经宿主落盘后显示为就绪（实际 {"status":"ready","notice":"","attProbe":"ok:u2"}）` |

注意 `--frame-smoke` **不**包含 `--ui-smoke` 那一套（`main.cjs` 里 `UI_SMOKE = FRAME_SMOKE || …`
只是给帧冒烟内部用的开关，两个套件各自独立入口），所以附件那条要在装机布局下取证
必须单独跑 `--ui-smoke`——本批就是这么拿到的。

### 6.7 装包态金路径的夹具路径缺陷与修法（本批实际改动）

第一次装包态帧冒烟在金路径组红：`FRAME FAIL Error: 本机 SSE 夹具启动超时`，子进程
原文是 `Error: Cannot find module '…\dist\electron-att\win-unpacked\scripts\sse-contract-server.cjs'`
（`code: 'MODULE_NOT_FOUND'`）。根因：`test-support/golden-path-smoke.cjs` 用
`join(__dirname, '..', '..', '..', 'scripts', …)` 定位夹具，而打包态下 `__dirname` 落在
`app.asar` 内，往上三级推到的是安装包装配目录，那里没有仓库的 `scripts/`。

改法是给这一条路径加一个显式入口：`process.env.SACODE_SSE_FIXTURE || 原仓库相对路径`。
这不是把检查缩掉——打包态由驱动方把环境变量指到仓库里那份**同一个**夹具文件，
金路径组在安装包布局下照样实跑。实测：
`FRAME 金路径发送前 {"port":27694,"reachable":{"status":200},…}`、
`FRAME 金路径探针 {"sawReply":true,"error":"","state":"状态 已完成","busy":"false"}`，
随后整轮 `checks:710, failed:0`。开发态默认值不变，行为不受影响。

顺带记录一个观察：帧冒烟抛错时应用不会退出（本轮 3 个 `SaCode.exe` 停在
`dist/electron-att` 下需要手动收）。已按 PID 精确收掉本批自己拉起的那 3 个；
`dist/electron/win-unpacked` 下 17 个更早的（非本轮拉起）未动，交用户裁决。

### 6.8 一条并发负载教训（两次都踩到）

`bridge.test.mjs:292` 的 400 ms 轮询窗口、以及装包态帧冒烟的
「整页状态未就绪」等待，都在**同一时间还有别的 CPU 活**（cjpm build / 86 MB 归档解压）
时变红；机器独占时复跑分别回到 137/137 与 710/0。两轮都没有改动阈值，
记为负载抖动，但这两处的时间预算偏紧是有据可查的观测。

### 6.9 真模型凭据面复跑（当前构建）

6.3 那条 `SKIPPED: 1` 的身份已核实：`core/src/sse_test.cj:354` 在无凭据时把
`realModelSse` 标记跳过。把凭据从 gitignore 的 `target/step.key` 读进环境变量
（命令行与日志都不落密钥本体）再跑同一套：

| 面 | 命令 | 实测 |
|---|---|---|
| 核心 | `cd core && STEPFUN_API_KEY=$(…) cjpm test` | `Summary: TOTAL: 441 / PASSED: 441, SKIPPED: 0, ERROR: 0 / FAILED: 0`，`cjpm test success`；其中 `[ PASSED ] CASE: realModelSse (1896565600 ns)` 就是那条凭据门控用例 |
| 桌面→宿主→真模型 | `cd apps/desktop && node --test test/real-provider-e2e.test.mjs` | `# tests 1 / # pass 1 / # fail 0 / # skipped 0`，rc=0 |

装机布局本身没有再打一次真模型请求：安装包内的宿主 exe 与上面这两条实测所用的宿主
`dc3d9f97…facc4` 逐字相同（6.6 三方对账），而装包态已单独跑过 710 项帧检查 + 203 项
UI 检查含真夹具的一轮完整往返。所以「安装包里的东西能出真答复」这条目前的依据是
**同一二进制 + 已证的 provider 往返 + 已证的装包态接线**，不是安装包直接打过真 API。



