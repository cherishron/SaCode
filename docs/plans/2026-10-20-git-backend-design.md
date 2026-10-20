# F08 Git 后端接入设计（2026-10-20）

> 状态：设计建议，未实施、未构建、未运行 Git 写操作。只读核对当前工作区源码；HEAD 为 `f7cef5f4548c71b32e4ce3398209b0be074af80b`，存在多方在途差异，不代表固定提交或当前候选包已具备这些能力。本文仅写入指定临时目录，不修改产品源码、共享索引或台账。

## 1. 目标与判断摘要

对齐 PRD F08、DV04–DV06：区分任务差异、Git 工作区和暂存区；提供精确路径/hunk 的暂存与取消暂存、提交、历史、推送和显式 stash 管理。提交/推送分别批准；不能吞入用户既有 index，失败不假成功，撤销不覆盖后来改动。

核心判断：

1. 当前专用 Git Host RPC 确实只有三条只读通道，但前端已在准备通过通用 `ExecutionTask` 发起 Git 命令提案，不能说“任何写操作都没有后端路径”。**通用进程路径存在，不等于在源仓库中可靠完成 Git 写入。**
2. 推荐在共享 core 增加有限 Git 动作服务；复用审批、持久屏障、进程监督、取消和输出采集，不复用任意 shell 字符串作为 Git 产品协议。
3. `execution/review-apply` 是受审文件写回，不支持 index/refs/stash/reflog 事务；Git 写操作走独立的 Git 动作提案，复用既有 `ApprovalDesk`，不把 Git 元数据伪装成文件差异写回。
4. 需要 source-repository 作用域的受控执行能力。默认执行若在私有快照中工作，不能把副本的 commit 当源仓库提交，更不能通过复制 `.git` 写回完成同步。能力未就绪时明确 blocked。

## 2. 当前能力盘点与缺口

### 2.1 Host / IPC

`apps/host/src/main.cj:2771–2795` 的 `handleRpc41` 接受：

| 当前方法 | 参数 | 返回/保护 | 不能推导的能力 |
|---|---|---|---|
| `workspace/git-status` | `sessionId,directory` | 校验当前会话及日志中的工作区，返回 porcelain v1 `-z` 原始输出、exitCode、failure、truncated | 不暂存，不返回可靠写入 CAS 凭据 |
| `workspace/git-diff` | 上述 + `path,scope` | scope 为 working/index；相对精确路径；禁外部 diff/textconv | 不证明 patch 属于本轮 AI，不执行写回 |
| `workspace/git-push-target` | `sessionId,directory` | 实际 push 配置解析后的 remote/ref/HEAD OID；不暴露 URL；拒多 push URL、mirror、push-option | 不执行 push，不等于远端已接受 |

`apps/desktop/preload.cjs:105–107` 已有对应三个具名 IPC。没有专用 stage/unstage/commit/log/stash/push 写 RPC。未对能力计数作历史分母推断。

### 2.2 core

| 文件/符号 | 实际实现 | 复用边界 |
|---|---|---|
| `git_workbench.cj:14–63` `gitReadBounded/gitRun/GitQueryResult` | 直接 argv 启动 git，stdout/stderr 并行排空、单流保留 256KiB，约 2 秒只读查询时限 | 不是受控 Git 写服务；不能原样用于 commit/push；输出保留有界不代表子进程总 I/O/时长无限安全 |
| `git_workbench.cj:64–86` `queryWorkspaceGit` | 根目录核对、status/index/working diff | 工作区是父仓库子目录时明确拒绝，不能悄悄扩大作用域 |
| `git_workbench.cj:90–167` `queryWorkspaceGitPushTarget` | 解析真实 push 目标、拒绝目标扩张配置 | URL仅内部处理，配置变化后旧结果必须作废 |
| `worktree.cj:129–175` `wtRunProgram/wtGitRun` | Git argv、cwd、有界输出、超时；供 worktree 生命周期使用 | 不自带此处需要的精确 Git 写审批、index CAS、恢复核对；不是可直接公开的任意 argv 通道 |
| `execution_process_provider.cj` | 已准入请求→进程执行接口，接 `TurnToken` | 可复用监督约束，不假设其默认 provider 可以写源仓库 Git 元数据 |
| `execution_service.cj` | 提案摘要、精确票消费、开始持久屏障与执行状态 | 复用机制；Git 动作另需真实仓库、HEAD/index 绑定和事后核对 |

未发现生产专用 git add/reset/commit/log/stash 服务。测试里创建仓库、暂存或提交的夹具，不算产品入口。worktree 管理存在 Git 写操作，但不等于 Git 工作台能力已接通。

### 2.3 前端在途现状（只读，不接管 CodeArts）

- `git-action-state.ts:41–90` 已生成 stage/unstage/commit/push 的 argv 提案；stage 拒绝覆盖部分暂存，commit 提示提交整个当前 index，push 绑定 remote/ref/OID。
- `git-workbench.ts:36–58,128–130` 经 `ExecutionTask` 显示提案；`execution-task.ts:21–31` 使用 `execution/propose`，不是调用尚不存在的 `workspace/git-commit`。
- `git-workbench.ts:124–127` 历史仍明确“待后端补充”；未见 stash 专用界面。
- 因通用执行默认可能映射私有快照（`execution-task.ts:59–62`），当前按钮开放不能证明源仓库 index/refs 已改变。本轮不运行、不修改这些文件。

| 动作 | 专用 Host 分派 | 当前替代路径 | 产品缺口 |
|---|---|---|---|
| 暂存/取消暂存 | 缺 | 前端生成 add/reset 进程提案 | index并发、首次提交、hunk、作用域与真实源仓库执行 |
| 提交 | 缺 | 前端生成 commit 进程提案 | 精确 index 审阅、hook/签名、commit核对、unknown恢复 |
| 历史 | 缺 | 无页面历史通道 | 结构化有界分页、锚点失效 |
| stash | 缺 | 未见专用路径 | 精确选择、冲突、条目OID绑定、禁止自动pop/drop |
| 推送 | 只读目标已有，写分派缺 | 前端生成 push 进程提案 | 精确目标重核、源仓库执行、远端事实与未知处理 |

## 3. 架构决策（均为 Proposed）

### ADR-GIT-01：有限 core GitActionService，不新增 shell 任意命令入口

结构：`UI/CLI → Host薄适配 → core GitActionService → 既有授权/持久屏障/受控进程提供方 → Git CLI`。

core 按动作枚举生成 argv，不接调用者提供的 executable、任意 argv、shell 字符串、git-dir、index 文件路径、环境覆盖或任意 patch。Git 状态仍以 Git 和实际文件为准，SessionLog 只保存提案、授权、准入与核对事实。

备选：直接放行当前前端通用执行提案。优点是接线少；缺点是前端校验不能保护恶意 RPC、缺仓库观察绑定，且副本作用域错误，故不作为最终专用契约。现有通用执行能力保留但不假称等价。

### ADR-GIT-02：Git 原生 CLI，不新增 libgit2/原生 FFI 依赖

复用系统 Git 的配置、hooks、签名和凭据助手语义；实现前冻结最低版本及 Windows/Linux/macOS 的实际可执行文件来源。Git 缺失→`git-unavailable`，不自动安装、不更改用户配置。

代价：需处理版本差异、Git会执行外部程序、路径与输出编码差异。只读的 2 秒时限不复用到写动作；建议写动作默认120秒、push300秒，均受有限资源策略约束。Git扩展和外部命令的隔离不成立时拒绝执行，不退回裸shell。

### ADR-GIT-03：独立 Git 审批，不走 execution/review-apply

该通路的 `applyId` 绑定执行产物、所选文件与文件写回，不能表达真实 index/refs 的 Git 事务。复用其“不可变提案→精确一次票→持久准入→实际核对→恢复不重放”的原则；**不**把 commit/stash 通过 review-apply 执行。

Git审批绑定动作名称和提案摘要，例如 `workspace/git-commit` + `actionId/proposalDigest`；现有 `ApprovalDesk.consumeExactForCall` 的实际签名在实施时复核。代码写回批准、计划批准、模型权限模式不能替代提交/推送票。Git hooks 也是外部代码，不能用其 Allow 自动批准下一项 Git 动作。

### ADR-GIT-04：index 写采用受控索引事务，不用预检冒充 CAS

暂存/取消暂存需在真实 Git index 锁协议下重核提案；独占私有候选 index，按精确路径/hunk计算，仅在原 index 版本未变时发布，遵守 Git 的 `index.lock` 协议及平台原子替换保证。不得删除他人锁、把私有 index 路径开放给 RPC，或把整个 index 无条件写回。

commit 保留真实 index 与 hooks/签名行为；不能简单长持 index.lock 后再调用会获取同锁的 Git。受控 commit adapter 必须验证 index→commit tree 的绑定及 source-repo 隔离条件；若无法防止并发 index/hook 改写导致提交范围漂移，**本能力保持 blocked**，不能靠两次 hash 检查宣称原子性已成立。

支持边界需逐项冻结：linked worktree（git-dir/common-dir 分离）、unborn HEAD、SHA-1/SHA-256 OID、冲突项、split/sparse index、submodule、过滤器。未支持的格式明确拒绝，不能破坏原 index。

## 4. Host 方法契约（拟议，当前不增加接口）

### 4.1 公共身份与两阶段规则

先增加只读 `workspace/git-observe` 获取服务端签发的 `observationId`。绑定 sessionId、workspaceRevision、canonical repo/git-dir/common-dir 身份、HEAD（初始空仓为null）、index指纹、所选文件状态/内容观察及可用性。`directory` 是核对值，不是可自由指定的目标。

写方法 `phase=prepare` 不执行，返回 `{actionId,revision,proposalDigest,approvalBody,observedScope,warnings}`；`phase=apply` 只收 `{sessionId,actionId,revision,approvalId}`。客户端不能在 apply 时再次替换 paths/message/stashOID；重复 actionId 只回读既有事实，不重复运行。

| 方法 | prepare / 只读参数 | 返回要点 | 审批 |
|---|---|---|---|
| `workspace/git-stage` | 公共身份+observationId、精确 `paths` 或服务端diff签发的 `hunkIds`，二选一 | 预览原index→候选index；应用后逐路径结果 | 每次用户显式确认；模型调用走精确票；不复用commit票 |
| `workspace/git-unstage` | 同上；精确已暂存路径/hunk | 只变index，worktree不变；首次提交无HEAD时专门处理 | 同stage |
| `workspace/git-commit` | 公共身份+observationId、`message`；提交完整被审阅index | index tree摘要、父HEAD、hooks/签名提示；核对新commit OID/tree/parents | 必须独立一次票，不自动push |
| `workspace/git-log` | `sessionId,directory,anchorOid?,cursor?,limit=50,path?` | `{anchorOid,commits:[{oid,parents,subject,authorName,committedAt}],nextCursor,truncated}` | 只读，无写票；作者邮箱非默认展示 |
| `workspace/git-stash` | `action=list/show/push/apply/drop`；list/show只读；写动作走两阶段 | push绑定精确paths与状态；apply/drop绑定stash OID及其当前ref观察 | push/apply/drop分别独立确认；无自动pop/clear |

补充生命周期方法：`workspace/git-action-describe`、`workspace/git-action-stop`。推送另设 `workspace/git-push` 两阶段（已有 `git-push-target` 保持只读），否则五条新方法仍不构成完整推送闭环。

示例（约定样例，不是已实现 RPC）：

```json
{"jsonrpc":"2.0","id":21,"method":"workspace/git-commit","params":{"sessionId":"current","directory":"<workspace>","phase":"prepare","observationId":"obs-17","message":"fix(core): 修复边界处理"}}
```

```json
{"jsonrpc":"2.0","id":21,"result":{"actionId":"git-act-23","revision":1,"proposalDigest":"<sha256>","approvalBody":"提交已审阅的整个暂存区，不自动推送；hooks与签名保持","observedScope":{"head":"<old-oid>","indexTree":"<tree-oid>","stagedPaths":["a.cj"]},"warnings":[]}}
```

```json
{"jsonrpc":"2.0","id":22,"method":"workspace/git-commit","params":{"sessionId":"current","phase":"apply","actionId":"git-act-23","revision":1,"approvalId":37}}
```

开始返回 `running` + actionId，不同步等待hook。describe最终返回例如 `{phase:"settled",outcome:"succeeded",exitCode:0,newCommit:"<oid>",verified:true}`。协议成功不等于动作成功；失败示例 `{outcome:"failed",reason:"git-hook-rejected",exitCode:1,verified:false}`；结果丢失为 `outcome:"unknown"`，保留核对能力与草稿。

### 4.2 各动作语义

- **stage**：限定精确文件；禁 `add .`、无路径 `add -A`、目录隐式递归、`.git` 路径及路径越界。允许Git必要的精确文件删除暂存，不代表允许全库add。已有部分暂存不能被全文件add覆盖，首步应拒并提示hunk审阅；hunk能力后续仍须补齐，不删除PRD要求。
- **unstage**：目标是index恢复到审阅基线，不还原worktree。常规 `reset HEAD -- paths`/`restore --staged` 仅作语义参考，实际走索引事务；unborn HEAD不能盲用HEAD命令。禁 reset --hard、clean、自动丢弃。
- **commit**：不传 `-a`、`--amend`、`--no-verify`、关闭签名参数；不自动写 user.name/email。完整 index 预览包含用户既有暂存，用户未批准则不提交。hook改变文件/index或签名失败需真实显示，不能覆盖回原快照“恢复现场”。
- **log**：固定anchor OID与受限分页游标，最大每页100、输出总量/时间有上限；用固定格式/长度或结构化分帧，不按任意提交文本换行猜记录；禁止用户提供 Git revision 表达式/选项。仓库对象消失或游标失效明确返错，不能悄悄重置首页造成遗漏。
- **stash**：默认push只收已选tracked路径；includeUntracked需另显式展示并批准，不支持includeIgnored。apply先核工作区与index观察版本，冲突标`conflicted`、保留stash条目，不自动drop；drop是独立破坏动作。用户继续改动后禁止旧stash自动apply覆盖。初版未支持的部分暂存、冲突索引或unborn情况拒绝，不静默改为全仓stash。
- **push**：复用现有真实目标解析，提案绑定源OID、单一remote/ref与不含秘密的端点指纹；执行前重核配置，禁force/mirror/all/自动tags/自动设upstream。认证助手、hook及网络行为需展示且受相同准入。请求失联不自动重推；核对远端ref需要获准只读网络探测，远端已进展则不能仅凭当前ref不同断言旧push失败。

### 4.3 失败/取消/恢复

状态建议：prepared→awaiting-approval→admitted→running→settling→settled；outcome单列 succeeded/failed/conflicted/cancelled-before-start/unknown。`cancelRequested`、进程实际退出和Git效果分别报告；停止后不能自动反向reset、revert或pop。

审批/开始事实持久失败在副作用前阻断；副作用后落日志失败保留unknown并只读核Git事实，不重复commit。应用重启不能复活票据。核心返回 closed error reason：git-unavailable、not-a-repository、workspace-changed、git-observation-stale、git-index-busy、git-index-format-unsupported、git-conflict、git-provider-unavailable、not-authorized、persistence-failed、git-timeout、git-outcome-unknown。

## 5. 安全与一致性

1. **任务差异不等于Git差异**：AI执行产物带executionId/任务归属，Git页来自真实仓库全量状态。不能自动选择“全部Git变更”当本轮AI改动，不自动add或commit其他会话工作。
2. **提交与推送各自授权**：一次提交票不授予推送、stash或后续commit。其他终端/MCP/PTC绕行Git的实际副作用仍受PRD独立授权；不能只检查第一个命令名就声称复杂shell已被全面拦截，未覆盖路径披露边界。
3. **缓冲区冲突可见**：Git操作读磁盘，不读编辑器未保存草稿。前端对涉及的dirty buffer显示冲突，用户保存/放弃/排除后重建观察；不自动保存。Host不能信任客户端一句`buffersClean=true`代替磁盘/index核验。
4. **外部改动可见**：请求前与准入前核HEAD/index/所选内容；变更使旧提案失效。应用内互斥不等于挡住外部Git，须验证锁/事务边界。不要把mtime单独当内容版本。
5. **保留hooks与签名**：Git add也可能运行clean/process filter；commit/push运行hook、签名或credential助手。审批覆盖所需脚本及风险，但不授予脚本任意本机/网络权限；执行隔离未满足则blocked，不禁hook凑通过。
6. **结果核对**：commit exit0需结合新OID/tree与目标仓库；刷新状态不等于旧动作已成功。hook/签名非零保留真实修改与提交信息草稿；若HEAD已变但无法确认归属/范围则unknown，不再提交一次。
7. **撤销非整体还原**：unstage不是回滚文件；AI写回撤销需当前内容仍等于该任务写入后版本，否则冲突停止。已推送历史不提供自动reset/force，revert是未来另审批能力。
8. **字面路径与凭据**：路径经过组件边界、目录身份、symlink/reparse核验；Git pathspec 用一种一致的literal方案，不能在 `--literal-pathspecs` 模式下又把 `:(literal)` 当语法拼入路径。远端URL、helper诊断脱敏，不能在回报中输出token。

## 6. 依赖、接入与验收

- 外部依赖：官方 Git for Windows / Linux发行版Git / macOS已安装Git；不把开发机路径硬编码到产品。最低版本、pathspec-from-file/NUL支持、SHA256仓库、linked worktree支持须探针后冻结；缺Git提前告知，不自动安装。
- core：有限动作/观察/index事务/Git结果核对模块新增；复用现有进程监督接口、WriteLease/持久屏障和ApprovalDesk。不新增libgit2或Node业务核心，不经过任意shell拼串。
- Host/CLI：同一core服务；Host薄分派和独立CLI Git命令同时受授权。main.cj/IPC/CodeArts页面变更等统一交接，不并发抢写。
- 前端交接：以本设计拟议方法和旧ExecutionTask路径差异明确协商；未接方法显示“待后端补充”，不通过编造receipt更新index/commit标签。

最低验收矩阵（均待实施，本文未执行）：

| 组 | 场景 | 必须事实 |
|---|---|---|
| G01 | 精确路径/hunk暂存，用户部分暂存 | 无关index不变，选中内容与提案相符 |
| G02 | 取消暂存、初始空仓、删除/重命名 | worktree内容保持、无HEAD行为明确 |
| G03 | 用户index含非AI改动 | 审阅整个index，未经批准不吞入commit |
| G04 | HEAD/index/文件在批准期间改变，外部锁 | 拒陈旧提案，不删锁、不覆盖后改 |
| G05 | hook拒绝/修改index、签名失败/缺身份 | 不跳hook/签名、不改配置，不假提交 |
| G06 | commit成功与副作用后断连/落盘失败 | 真实OID/tree核对，unknown不重放 |
| G07 | 历史分页、中文/恶意路径和提交正文 | 有界且无选项注入，游标绑定anchor |
| G08 | stash push/apply冲突/drop及迟到操作 | 精确范围、冲突可见、不自动pop/drop |
| G09 | 推送目标配置变化/多URL/远端拒绝/断连 | 单ref、独立授权、未知不假成功 |
| G10 | dirty buffer、外部变更、撤销后续编辑 | 未保存可见、旧操作不盖新数据 |
| G11 | 私有快照 vs 源仓库、linked worktree | 真实目标核对，不复制.git写回冒充commit |
| G12 | Win/Linux/macOS、取消/退出/重启 | 逐平台真实服务与双入口证据；缺平台标待验 |

仅在 `target/tmp/` 独立合成仓库和本地bare远端验收，不使用本项目或真实远端，不借当前任务授权执行git add/commit/push。

## 7. 待确认与拆分顺序

1. source-repo受控进程provider能否满足Git元数据写入与hooks所需权限？不满足先blocked，不将通用快照执行强改成裸跑。
2. index事务/commit并发隔离在三平台如何真实验证？split/sparse index、冲突与submodule支持范围需冻结。
3. 与CodeArts确认：现有ExecutionTask按钮保留为显式诊断还是切专用Git RPC？不得同时生成两份实际动作。
4. 五个要求方法、观察/describe/stop及push扩展的字段名和错误编号由接口负责人统一审定；当前没有实际增加任何RPC/IPC。
5. Git hooks/签名/credential助手交互依赖与取消能力；是否另走已实现的安全交互终端，不做静默降级。
6. 文件级首步、hunk/stash后续的交付顺序待确认，最终PRD范围不删除。

建议顺序：契约确认→独立只读log与Git观察→源仓库provider/index事务验证→stage/unstage→commit→stash/push→Host/CLI与CodeArts页面串行交接→双入口/平台验收。本文不构成上述实现或构建授权。

## 8. 证据与参考

- PRD F08及DV04–DV06；`docs/plans/2026-10-12-git-write-integration.md`：已有有限动作/索引事务/审批设计，本文承接，不另创相反授权策略；旧“页面写操作未开放”为历史时点。
- `core/src/git_workbench.cj:40–167`；`core/src/worktree.cj:129–175`；`core/src/execution_service.cj:226–253`；`core/src/execution_process_provider.cj`。
- `apps/host/src/main.cj:2771–2795`；`apps/desktop/preload.cjs:105–107`；`git-action-state.ts:41–90`；`git-workbench.ts:36–58,124–130`；`execution-task.ts:21–31,59–62`。行号为只读取证时点，在途文件后续可能漂移。
- `docs/interfaces/execution-review-apply-2026-10-17.md:5–20,31–35`：文件写回契约、不是Git元数据操作。
- 官方Git文档通过Context7 `/git/htmldocs` 核对：[reset](https://git-scm.com/docs/git-reset)、[restore](https://git-scm.com/docs/git-restore)、[hooks](https://git-scm.com/docs/githooks)、[stash](https://git-scm.com/docs/git-stash)、[literal pathspec](https://git-scm.com/docs/git)。具体命令按实施冻结Git版本复验；本轮没有执行示例命令。
