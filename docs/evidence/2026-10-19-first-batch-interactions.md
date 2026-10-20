# 第一批交互增量与验证边界

## 当前结论

2026-10-19，`D:/Project/sa/saai/sa-code` 的 `dev` / HEAD `f7cef5f`，工作区增量未提交。**第一批未验收，版本未交付**。这是 [R4运行时修复记录](2026-10-18-r4-runtime-and-stream-repair.md) 的后续事实，旧记录不改写。第二、三批尚未进入。

接管时已有的 `core/src/agent.cj` 与 Host `failure-path.test.mjs`、`test/support/` 未覆盖，未纳入本轮构建快照；未确认它们的外部会话归属。没有安装、提交、推送、发布、读取磁盘私人凭据或发起真实供应商请求。

## 已实施与取得的证据

| 项目 | 当前事实 | 仍有的边界 |
|---|---|---|
| 流式消息 | 复用同一气泡链与 Markdown；合成完整页面测量宽度/缩进/高度误差小于1px | 真实模型长任务及最终候选未验 |
| 工具折叠 | 核心按标准调用ID/事件身份关联名称、参数与结果；呈现运行、拒绝、取消、失败、未知；展开/收起保留通用附件渲染 | 完整页面附件证据目前为合成文件引用，真实工具截图读取仍须补 |
| 历史侧栏 | 按真实日志修改时间排序，标识当前会话；选择时展开所属组，当前条目不被数量限制藏住 | 最终候选及大量历史切换仍待验 |
| 会话管理 | 最后标题胜出；追加式可恢复归档；修订号/租约保护；生产页面重命名→归档→正常关闭→重启回读→恢复通过 | 诊断副本不是完整同源候选；未声称崩溃恢复 |
| AI选择卡片 | 单选、多选、确认、自定义输入；原模型轮等待/续答；会话绑定、一次性应答、取消、超时；在途发现不只依赖通知帧 | 完整页面卡片运行被用户Escape中断，尚无通过结果；协议用例不替代GUI验收 |

真实 DSH 参考来自本机安装归档 `D:/Program Files/Deepseek/DeepSeek Harness/resources/app.asar` 内的 `@deepseek-ai/dsh-client-ui-session/lib/client.js` 和 `dsh-client-ui-workspace/lib/client.js`，实际阅读了 `orderByRecency`、`sessionVisible` 与会话行状态/更新时间/归档处理。没有把内部方案文档当上游实现。只读导出的代码留在本轮临时根，不纳入源码或文档附件。

## 构建与测试

构建根：`C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-tools-build-20261018/`。`snapshot.json` 记录 `f7cef5f` 底板、每个覆盖文件的 SHA-256 和排除项，当前修订5；仅覆盖本轮仓颉实现，未包含在途 `agent.cj`。Host 单成员构建退出0，同目录80个DLL；Host SHA-256 为 `5f8dab62b417c57049e2942d88239f841d4fb6e5119143a8b0892193f018627e`。它不是完整桌面源码/依赖来源审计或可分发声明。

仓颉知识核对使用本机 `userImport` 技能的已读取API契约；安装副本没有README或可核实的上游版本，未宣称已读取上游技能仓。实际类型/链接以本机1.1.3编译与定向运行核实，既有stdx未重装。

主日志根：`D:/Project/sa/saai/sa-code/target/tmp/desktop-batch1-20261018-codex/`。

- `host-batch1-v5-final.log`：真实新Host配loopback合成供应商，12/12、无跳过。包括工具成功/拒绝/取消/失败、会话元信息，以及7种提问路径。回答后在同一 `turn/start` 内继续读取实际文件；用户取消无后续模型请求。正常退出、不同Host进程重启回放一致。
- `tool-probe/question-test.log`：仓颉定向7/7。测试包以本轮核心库链接，执行新投影、元信息、工单取消、问题校验/回答/取消/超时用例；**不是完整 `core cjpm test`**。
- `question-state-fixed.log`：轮询与选择卡片状态/组件9/9。`metadata-state-final.log`：会话状态/侧栏/渲染参数18/18。不同文件组含重叠，不相加为全套分母。
- `question-ipc-parity.log`：选择卡片接线后有限IPC为152/152，8项门禁通过；须随源码再测，不沿用历史138分母。
- `real-provider-policy.log`：凭据策略1项通过，6项真实供应商用例按未显式启用跳过。旧用例的磁盘密钥兜底已移除；全套回归将显式关闭真实模型测试，不以跳过项充当真实模型已验。

### 失败保留与分类

- 首次工具协议4项中取消路径失败：取消未修改文件，但待答审批票仍阻止切换。已增加指定工单的独立取消终态和迟到授权拒绝；修后四条及正常重启通过。它是实际缺陷，不是环境归因。
- 首次仓颉元信息用例因夹具再次创建已存在的 `target/tmp` 而报错；改为先检查目录存在，修后通过。
- 首次提问协议为6/7，失败是把先后两个RPC误当同一快照：问题在poll之后、projection之前刚发布。夹具再读待答身份后7/7通过；旧日志 `question-host-v5.log` 保留。
- 新轮询测试首次 `resolve is not a function`：夹具未等待刷新进入便释放Promise。改为显式进入屏障，修后9/9；旧日志 `question-state-final.log` 保留。
- `metadata-ui-contract.log` 为14/15：筛选名称意外同时运行了默认旧Host的 `workspace/files` 用例，断言“根目录应含sub目录”失败。仍待同环境基线对照，**不归类为环境问题或本轮回归已排除**。
- 旧“218项失败均属环境”继续撤回统一归因。当前全套测试与逐项分类尚未完成。

## 桌面页面与正常重启

诊断根 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-metadata-gui-20261019/` 的 `runs.jsonl`：PID39840与19812分别22项通过，先保存 `metadataArchived:true`，正常关窗并退出后重启回读并恢复为false。`lifecycle.jsonl` 两次均有 `window-closed`、`will-quit`，未强杀，非崩溃恢复。使用生产main/preload/renderer与本轮Host，沙箱配置为true且没有绕过开关；控制台错误数组为空。

操作由真实Chromium页面DOM事件驱动，经生产IPC和Host落盘，不是隔离组件或单纯协议断言。原生Windows截图/激活链仍曾失败，不能据此声称所有原生输入与显示问题已解除。旧诊断首次隐藏当前会话行导致缺节点，修复选中组展开及当前条目可见性后通过；失败报告单独保留。

选择卡片诊断根 `.../target/tmp/batch1-question-gui-20261019/` 已准备默认安全入口、loopback提供方和分阶段截图驱动；启动时用户按Escape停止Computer Use，未取得 `runtime-result.json` 或供应商请求记录。本项保持待验，不从准备成功推导运行成功。

## 下一步

### 2026-10-19 后续取证追加

上文卡片启动中断为当时事实，随后一次独立运行取得局部GUI证据：`C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-question-gui-20261019/` 中 `runtime-result-first-pass.json` 登记PID29396的28项完整页面检查通过，沙箱配置true、控制台错误为空；`question-fixture-first-pass.json` 登记合成供应商4次请求、失败为空。`question-multi.png`、`question-confirm.png`、`question-settled.png`、`question-cancelled.png` 保留实际页面截图。操作经生产页面DOM、IPC与本轮Host执行；不等于真实模型或全部原生键鼠验收。生命周期记录正常关窗与退出，随后重启操作被Escape中断，卡片正常重启回放仍待验。截图发现侧栏横向溢出后补了CSS，尚待重新运行页面验证。

受控桌面回归已完成一轮：`C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-suite-20261019-a/` 保留逐文件日志、`results.json` 与 `summary.json`。发现204个测试文件，178文件通过、18文件失败、8文件因沙箱绕过预检未运行；执行统计959项，911通过、42失败、6跳过。未运行文件不计通过，失败原因仍须逐项分析与必要的同环境基线对照，本读数不支持统一环境归因或第一批通过。

### 全套计数更正与失败文件分类（2026-10-19追加）

上段959项只汇总了有TAP尾部的文件，漏计超时的 `bridge.test.mjs` 已输出46通过、14失败。原始报告保留，追加 `reconciled-counts.json`：**已观察1019项，957通过、56失败、6跳过**；桥接文件超时，不能把观察计数称作全套完整执行成功。回归驱动已补缺尾部统计及不完整文件标识，`suite-counts.test.mjs` 1/1通过。

基线根 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-baseline-20261019-a/`：`source.zip` 由dev的f7cef5f导出，无源代码覆盖，复用现有依赖而未安装。`static-results` 是9个纯JS失败文件对照；`host-new-results` 为同一基线测试配本轮Host；`host-r4-results` 为同一基线测试配原R4 Host。后两组只对照所列用例，不声明整个核心同源基线构建。

| 失败文件（均在apps/desktop/test下） | 已核实事实与处理 |
|---|---|
| approval-mode-cli-host.test.mjs | 未提供SACODE_CLI，前置断言失败；未执行跨入口验证，须同源CLI后再跑。 |
| execution-history-host.test.mjs | 同为缺少SACODE_CLI，不计Host/CLI恢复通过。 |
| bridge.test.mjs | 工作区未配置、目录断言、租约错误及当前身份缺失共12项，在C目录基线测试配新Host复现；仍需根因定位。另2项是本轮新增API漏更新清单，已同步152个动作，定向通过。文件超时保留，未整体关闭。 |
| catalog.test.mjs | 本轮新增archived/updatedAt，旧全对象断言未更新；补完整字段及实际可解析时间断言，两项通过。 |
| execution-ipc.test.mjs | handler数11与旧期望6冲突，f7cef5f副本复现；尚未修订该历史契约。 |
| gate-verdict.test.mjs | check-release-manifest.cjs与门禁登记集合不一致，基线复现；待定位索引/匹配规则。 |
| host-routing-ledger.test.mjs | 15项capability-unsatisfied；同一基线测试配新Host和R4 Host均为2通过/15失败，未证明是本轮回归，也未证明环境根因。 |
| model-system-prompt.test.mjs | 系统提示缺read工具断言；新Host与R4 Host同样失败，工具注册/夹具前提待核实。 |
| models-save-stage.test.mjs | 期待credential/set，实际model/registry/save-credential；基线复现。 |
| models-validate.test.mjs | 临时模块解析不到vue；基线复现，测试模块生成/依赖定位待修。 |
| models/model-pull-electron.test.mjs | 默认沙箱Electron退出2147483651，保留输出路径；未绕过沙箱，不能据此判业务通过。 |
| permission-menu.test.mjs | CSS类断言不兼容mode-plan active，以及失败初读后打开触发重读导致旧期望冲突；基线同为12通过/2失败，非本轮改动文件。 |
| provider-adapter-revision.test.mjs | 临时模块启动失败，基线复现；须修生成模块依赖，未宣称适配器通过。 |
| provider-credential-retry-state.test.mjs | pullBlocks未定义，两项在基线复现；须核实测试截段依赖，不能直接推为页面运行时错误。 |
| remote-transport-tls-pin.test.mjs | spawn openssl ENOENT，三条未建立TLS夹具；仅证实缺可执行前提，未验pin行为。 |
| session-management.test.mjs | 旧夹具未设置工作区且用非精确写参数，新Host/R4均复现；修为工作区配置、读取、精确参数审批、写入核对后，8/8通过。 |
| team-panel-entry.test.mjs | 测试用旧注释“三个持久化偏好”截源码，而现源码为“持久化偏好”，8项未进入装配；基线复现，尚未替换脆弱截段。 |
| worktree.test.mjs | VM中require相对位置错误，找不到./paths.cjs；基线复现，未判工作树生产功能失败。 |

本次定向日志 `catalog-ipc-regression.log` 4/4、`session-management-current.log` 8/8保存在主日志根；其通过不覆盖表内其他失败。未执行的8个文件和具体绕过行见首轮manifest，不降低防护凑通过。本轮未启动新的GUI或真实模型请求，第一批仍未验收。

### 正常重启与桥接夹具修复（2026-10-19后续追加）

后续经Computer Use默认启动已有诊断EXE，PID34904正常重启成功。问题卡片诊断根保存 `runtime-result-restart-34904.json`、`runtime-restart-34904.png`，`runs.jsonl` 新增23项完整页面通过；包括标题/归档回读、两张已回答及一张已取消卡片回放，以及最新CSS的侧栏横向溢出检查。沙箱true、nodeIntegration禁用、控制台错误为空。`question-fixture-34904.json` 请求0、失败为空，未自动重发模型任务。生命周期记录window-closed与will-quit，非强杀、非崩溃恢复。上文“重启待验/CSS待重验”是此前时点，至本条由此证据补齐；不升级同源完整桌面候选、真实模型或产品内开发任务状态。

桥接定向 `bridge-workspace-lifecycle.log` 3/3：文件列表测试修正从序号1起的无效日志并显式设置工作区；损坏租约held应拒为session-owner-unknown，现同时断言凭据与日志均未变化；新会话尚无落盘目录行时，流式订阅使用本夹具已知的current身份，且finally正常停止Host，避免失败遗留进程导致文件级超时。这些是测试前提/清理修复，未放宽生产工作区或租约保护。桥接其余旧文件工具与租约用例未全部修复/重跑，不声明整文件通过。

### 开发任务失败结算与打包安全入口（2026-10-19追加）

新增可重复 `apps/host/test/session/development-task.test.mjs` 与合成提供方 `apps/desktop/test/support/development-task-fixture.cjs`。夹具只提出read→edit→pwsh调用，不在外部代跑命令；生产Host真实读取sum.cjs，精确审批后把a-b改为a+b，再经独立工单请求执行node --test sum.test.cjs。实际文件内容核对成功，两个审批均与真实调用参数一致，模型请求有界4次。命令实际返回 `{"error":"io-error:shell-pwsh"}`，投影工具为failed，续答明确未取得测试通过结算。最终回归日志 `development-task-failure-settlement.log` 1/1是**失败如实结算验证通过**，不是开发闭环通过、测试命令成功或GUI任务验收。

每轮临时项目与 `verification.json` 保存在 `target/tmp/development-task-20261019/run-*/`，包括实际回执、调用投影、审批参数和正常Host退出事实。首次 `development-task-safety.log` 0/1保留：夹具原先期待SANDBOX_UNAVAILABLE，但运行时只交回泛化io-error。修为断言实际错误和失败结算，不伪造更具体原因。源码核实Windows模型shell使用默认platformSandbox无提供方，confine异常在ShellExecutor被折叠为None；这是执行未走通及诊断丢失原因的证据，未关闭沙箱、未改ACL/系统PATH。另一条Windows私有执行通路存在不等于模型shell已接通，本轮未启用或改写它。

核查发现生产 `after-pack.cjs` 仍自动附带R4临时关闭沙箱脚本。已移除自动写入启动脚本与TEMPORARY-NO-SANDBOX.txt的行为；新打包保留默认安全入口，历史R4目录与原脚本源码未改。`packaging-safe-entry.log` 7/7，实际执行打包钩子后验证Windows/Linux临时输出没有旁路入口、默认程序字节未变、main仍sandbox:true/contextIsolation:true/nodeIntegration:false。尚未据此声明完整候选已重新打包或启动通过。

### 冻结源码与目录候选c1（2026-10-19追加）

内部候选根 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-candidate-20261019-c1/`，有效目录包为 `package-corrected/win-unpacked/`。`source.zip` 为f7cef5f完整归档，`source-manifest.json` 记录dev基线、本轮64项覆盖文件哈希、显式排除的agent.cj/Host在途测试、已装依赖版本与锁文件哈希；未安装依赖或提交。Host复用修订5真实构建产物前，逐文件核对其构建清单全部核心/Host覆盖源码与本冻结快照一致，二进制哈希一致；不将旧R4 Host混入新页面。

vendor从source目录重新生成并退出0，日志vendor.log。electron-builder使用本机现有Electron33.4.11目录、禁止依赖重装与发布，完整目录打包退出0，日志package-corrected.log。首轮外部配置没有自动继承package.json build清单，生成错误EXE名并漏打包钩子，已被审计拒绝；原package目录及builder-config-attempt-a.json保留，不作为有效入口。第二轮显式合并项目完整清单并使用新输出目录，未覆盖错误尝试或历史R4。

package-audit.json核对125个包内JS/CSS/HTML与冻结源码/本轮生成物逐字节一致；app.asar SHA256为ee6a8f214e12d79e276d72b605138fccefc63e66218b5e864603e5ce17f6a6fd；Host仍为5f8dab62b417c57049e2942d88239f841d4fb6e5119143a8b0892193f018627e，携带80个DLL。新输出没有start-sacode-no-sandbox.cmd或TEMPORARY-NO-SANDBOX.txt。清单记录的是本机精确产物身份，不是第三方依赖或运行库官方来源认证，既有来源风险未撤销。

Computer Use直接启动此SaCode.exe，窗口133652的可访问性树可读到完整导航、输入区、模型菜单及权限模式，URL确为候选app.asar页面；但原生截图黑屏，点击新建会话报failed to activate captured window，重新选择同一返回窗口后激活仍失败，按工具恢复规则停止输入。startup-observation.json保存进程参数和本次阻塞；**本独立候选GUI未验、正常关闭未验、真实模型未验、产品开发闭环未验**。之前诊断副本的23/28项结果不迁移成此包验收结论。保留窗口供观察，不强杀或改防护凑通过。

### 工具图片持久读取与折叠（2026-10-19追加）

新增 `apps/host/test/session/tool-image-projection.test.mjs`：用真实Host上传完整可解码2×1 PNG，将返回的持久引用挂到合成tool/call与生产格式tool/result日志夹具。验证调用ID、完成态、结果行引用配对，读取字节与PNG一致，跨会话读取拒绝，正常停止/重启后仍可读取。`tool-image-projection-fixed.log` 1/1通过；PNG对象与verification.json在主仓 `target/tmp/tool-image-20261019/run-*/`。这是合成工具日志与真实图片存储/读取，不是实际computer_screenshot执行。

首次 `tool-image-projection.log` 0/1保留：夹具误把assistant wire当成tool/call事件，并试图经面向用户文本的session/append透传内部控制前缀，未产生预期投影。修为在本测试独占目录写入脱敏内部事件夹具，再由生产Host回放；没有改变生产解析规则或伪造实际工具执行。

扩展完整页面诊断驱动，以明确参数导入该夹具的日志和图片对象。诊断根 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-tool-image-gui-20261019/`：runs.jsonl登记PID25384和25064各28项通过，imageVerified=true，sandboxConfigured=true、nodeIntegration禁用、errors为空。生产PersistedImage经有限IPC读取Host对象、创建Blob并由浏览器实际解码（naturalWidth=2/naturalHeight=1）；展开/折叠均保留已解码图片；第二进程重启后重选原会话仍可读取，同时恢复归档会话。两次lifecycle均window-closed/will-quit，无强杀，非崩溃恢复。

分阶段 `tool-image-expanded.png`、`tool-image-collapsed.png` 与带PID版本保留图片及工具身份，首轮报告另存runtime-result-first-25384.json。该入口使用c1运行库和同一Host、生产main/preload/renderer，以DOM事件操作完整页面；仍属诊断入口，不替代c1独立包原生操作验收。仅测试驱动和新测试发生变化，未就此改写已冻结c1源码/产物或升级实际截图工具、真实模型验收状态。

### 修复后全套重跑b与剩余租约问题（2026-10-19追加）

`C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-suite-20261019-b/` 保存使用c1包内Host的第二轮完整清单、逐文件日志、results.json与summary.json：205文件，181通过、16失败、8因旁路预检未运行；已观察1020项，965通过、49失败、6跳过。bridge文件无完整TAP尾部，脚本本轮已计入其51通过/9失败，不再漏计。该轮仍失败且未证明第一批验收。

该轮结束后的定向修复另记，不回写原汇总：团队测试将截段终点从旧中文注释改为实际generalPrefs声明，执行真实装配后 `team-panel-entry-anchor.log` 11/11。桥接的8个文件/审批用例补显式workspace/set-directory，复用独立夹具且失败时停止Host，`bridge-files-configured.log` 8/8；没有修改生产工作区校验或审批规则。未知工具反向测试增加finally，避免前置断言失败遗留子进程。

残留租测试把虚构大PID换成本测试真实创建并确认退出的Node进程，但仍收到session-owner-unknown，未将其判为通过或把拒绝放宽。全桥接最新 `bridge-current-complete.log` 正常结束：60项、59通过、1失败，已不再文件级超时。该剩余问题须继续查进程三态判活/租约接管，不从正常重启证据推出崩溃恢复已验。

核对现有Windows私有执行原生层：windows_workspace.c在CreateDirectoryW时为新私有目录提供专用安全描述符；未启用该通路。已向用户澄清“不修改ACL”是否也禁止这个新目录行为，答复前保持禁用；不更改原项目或系统ACL。模型shell的失败结算测试继续保持局部证据，不因这一候选通路存在而升级实际测试执行状态。

### Windows死亡租约判活修复与Host v6（2026-10-19追加）

用户已明确答复“保持禁止，暂不启用该通路”；新私有目录专用ACL也不启用。此限制继续约束安全执行闭环，不将等待授权当作已获授权，不改ACL或系统PATH。

隔离探针根 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/lease-liveness-20261019-a/`：同一不存在PID27872，C原生探针输出opened=0/error=87；现核心两次FFI分别调用OpenProcess/GetLastError时输出core=unknown/null=true/immediate=0。先前真实已退出但内核对象尚存时可取得退出码并判dead，故最初探针与Host差异不能归因于租约PID读取错误。证据说明跨FFI读取线程局部LastError不可靠；未进一步把它宣称为已证实的SDK实现根因。

修复 `core/src/procwin.cj`：OpenProcess无句柄时，改用K32EnumProcesses成功且完整的PID枚举证明“不存在”。缓冲区填满则有界扩容，枚举失败、字节数异常、容量上限或PID仍在时均不判dead；有效句柄仍用真实退出码。API映射/完整性按[微软EnumProcesses契约](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-enumprocesses)核对；不扩大进程权限，不加载新增本地DLL，不改变未知归属的拒绝策略。仓颉本机技能批量核对数组指针获取/释放与inout出参，逐文件cjfmt完成，未动既有stdx配置或在途agent.cj。

新增 `core/src/process_liveness_snapshot_test.cj`。fixed-probe.log：absent=dead/self=alive，0/负数/溢出均unknown；同生产procwin源码的独立编译单测fixed-tests.log为2/2，非全core测试。C原生对照与编译日志均留探针根。

新私有Host快照 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-host-20261019-v6/`：以c1完整源码为底板，仅覆盖procwin与新增定向测试，snapshot.json记录哈希。Host单成员构建退出0（host-build-result.json），产物SHA256 82845184cc896ab2a717420393ebcd64c6af6ae9cad528c5f2620dfd1f1a5c70，同目录80 DLL。c1冻结源码与包保持不变，没有偷偷换Host。

`host-v6-first-batch-regression.log`：真实v6 Host配合成供应商，桥接全文件60项，加元信息/工具成功拒绝取消失败/选择卡片/失败开发结算/图片隔离与重启，共74/74、无跳过、正常结束。死亡租约实测已恢复，未知/活进程租约仍拒绝；该结果不等于完整崩溃恢复、全套桌面测试、独立候选GUI或产品内测试执行成功。新Host尚待纳入下一完整同源候选及重验，第一批未验收。

### 完整候选c2、测试预检错误与纠正（2026-10-19追加）

内部候选根 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/batch1-candidate-20261019-c2/`；有效目录为package/win-unpacked。完整f7cef5f归档加68项已确认归属的覆盖，继续排除agent.cj及Host在途测试。source-manifest.json记录依赖版本和哈希；host-source-audit.json逐项核对233个生产仓颉源码及构建配置与v6真实构建一致。vendor/打包退出0，package-audit.json核对125个包内文件、Host哈希82845184cc896ab2a717420393ebcd64c6af6ae9cad528c5f2620dfd1f1a5c70、80DLL、无旁路启动入口；app.asar SHA256为d63c7b7af05792251e6fb05df95ef4fff175f542eeae401999dfe808e92a75e1。未重装、提交、发布或覆盖c1/R4。

c2冻结测试源码配包内Host的专项host-regression.log为14/14，含文件修改、取消/拒绝/失败、提问续跑、会话隔离和PNG持久读取。开发任务测试仍是“命令失败如实结算”，不是实际测试执行成功。c2独立包原生GUI未验，之前诊断结果不迁移为其验收。

**执行边界错误必须保留：** 首轮c2全套desktop-suite-c2-20261019为981通过/33失败/6跳过、8文件未运行，但知识页面Electron测试实际带--no-sandbox启动。扫描器错误地忽略任何含assert的整行，而该文件把spawn和assert压在同一行，造成漏检。此前a/b轮也包含这一遗漏。因此上述原始日志和计数保留作诊断事实，**其“受控全套安全执行”口径撤回，知识页面条目作废，不能作为默认沙箱GUI通过证据**。已确认无残留electron.exe；未修改系统安全或ACL，但这不能抵消本次违反启动参数边界的事实。

修复run-batch-suite.mjs：不再忽略断言所在整行，新增同一行spawn/assert两种顺序和sandbox:false预检回归；suite-counts.test.mjs共2/2。逐项审计所有测试与test-support中的沙箱旁路文字，sandbox-test-audit.txt保留原始匹配。hardened-policy-audit.json记录修正扫描器哈希及9个拦截文件，包含知识页面；这是对已审计源码的预检，不宣称能证明任意动态生成代码安全。

为保持c2冻结源码不变，修正的外部驱动增加明确desktop-root参数，从c2源码执行测试。最终 `C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-suite-c2-safe-20261019/`：205文件，182通过、14失败、9因旁路预检未运行；1019项、981通过/32失败/6跳过，没有缺TAP尾部文件，知识页面明确not-run-sandbox-bypass。结果仍未清零，也不升级第一批验收。其余失败与既有分类对应；初轮新增的知识页面超时不再归为业务回归，而是危险测试被错误执行的结果。

完成选择卡片真实桌面操作/截图与正常重启、真实工具图片读取；执行受控全套测试并逐项分类；固定同源桌面候选，在临时小项目里完成读取→精确审批→修改→产品内运行测试→结算。没有这些证据前不进入第二批，不请用户替代自动验收。

### c2测试夹具修复、最新QA及原生会话操作（2026-10-19追加）

本轮仅修正测试及证据，c2产品包保持冻结。qa-source以c2完整源码为底板，仅覆盖desktop/test；qa-test-manifest.json记录214个测试/支持文件哈希。修复类别：供应商mock补真实能力及工作区前提；结算失败断言遵守公开错误脱敏与保留未结算事实；模型保存跟随现行作用域CAS；IPC断言核对实际11项白名单；页面VM用esbuild加载真实依赖并共享同一Vue；worktree使用锚定模块的createRequire；界面源码断言跟随当前入口。对应定向日志routing-configuration-contracts.log 23/23、provider-fixture-dependencies-fixed.log 20/20、remaining-static-contracts.log 32/32。没有放宽生产权限或改写失败记录。

同源v6快照的CLI单成员构建退出0，SHA256 be74fef47e727830242e204ee069578ea7110e83c954853106c5e21599148796；与c2 Host组合的cli-host-same-source.log 2/2。TLS使用本机既有Git OpenSSL显式路径；合成密钥仅经stdout内存传递，专用公开配置位于target/tmp，检查无密钥文件，不读取现有私人密钥、不打印生成内容。匹配pin、错误pin、不受信及主机名拒绝tls-pin-memory-fixture-fixed.log 4/4。

最新完整结果位于C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-suite-c2-qa-20261019/：205文件，195通过/1失败/9因旁路预检未运行；1036项，1029通过/1失败/6跳过，取消0，无缺失TAP尾部。失败仅models/model-pull-electron.test.mjs：默认沙箱Electron退出2147483651（0x80000003），完整输出保留。未笼统归为环境，也未宣称全套通过。c2包重新核对125文件与Host/asar哈希一致。

原生sky操作直接启动c2/package/win-unpacked/SaCode.exe，无旁路参数；窗口1116776实际新建会话，右键重命名为“原生验收会话”，侧栏真实显示名称和时间；再次右键归档后条目消失。点击系统关闭按钮，随后list_windows确认该窗口已退出；重开同一EXE得到窗口8915520，正常列表保持无归档条目。在本地目录切换已归档后实际读到原名称、3条已保存事件及session-tmpFilea04192-0；点击“恢复到列表”后界面显示“会话已恢复”，侧栏重新出现名称。原生工具输出保留对应截图和可访问树；部分截图捕获到前台Codex窗口，因此不将那些截图当作SaCode画面。此证据只覆盖会话管理及正常重启，非崩溃恢复、完整消息交互或真实模型任务验收。

用户再次明确“保持禁止，暂不启用该通路”，新目录AppContainer ACL仍禁止。只读查询发现wsl.exe但wsl --list --quiet退出1，错误Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG；未发现Docker/Podman。未安装、启用或修改安全设置。安全执行主阻塞继续登记，第一批未交付。

### 原生启动对照、独立包卡片成功路径与消息上下文缺陷（2026-10-19追加）

上一轮为有证据的进展，不是等待或无进展。剩余model-pull-electron失败进一步对照：在target/tmp/model-pull-native-20261019-a中复制c2既有运行库，使用完全相同的QA页面检查、生产preload/IPC/Host及默认沙箱，由原生入口启动。该测试本来show:false，因此sky报告无可定位窗口；result.log实际得到ok:true，12项取消/精确查询/丢回执防重发检查通过，Host正常退出0且未强杀，sandboxConfigured/contextIsolation为true、nodeIntegration为false，requests.json为3。只改变启动编排，不修改检查断言。原命令行测试的0x80000003仍保留，不能用此次独立诊断改写全套结果，也不算可见原生点击验收。

私有独立包卡片验收根target/tmp/batch1-packaged-question-20261019-a：复制c2产品文件，排除旧data，仅通过生产Host初始化私有回环供应商、明确能力与合成凭据fixture-only，未读私人配置或真实模型。原生启动SaCode.exe，实际set_value输入任务、点击发送，真实Host产生单选、多选及文本卡片。原生坐标/输入操作选择甲、多选甲乙、补充“自定义补充”和“GUI 合成输入”，提交后第一卡已回答且输入禁用，再出现确认卡；选择确认后提交，工具结果明确selectedIds:[yes]，助手显示“选择已收到，原任务继续完成”。question-fixture.json为3请求、failures空；native-settled-tree.txt及native-settled.png保存工具返回的原生证据，仅为用户要求存档，没有重复显示或编辑截图。页面仍是冻结c2 app.asar，无测试脚本注入renderer。

准备取消路径时黑屏且页面可访问树消失，系统存在LockApp进程；这不足以证明业务崩溃。停止GUI输入并请求用户方便时手动解锁，未操作锁屏界面。取消路径尚未完成，不能记为通过；先前独立页面与Host取消证据仍按原范围有效。

新发现缺陷：实际c2普通消息区出现system/message的“you are SaCode”及工具说明，属于内部模型上下文混入用户对话。源码msgfold新增conversationMessages，按真实user/assistant/tool角色筛选展示；原始日志、投影、事件身份与附件不变，不按正文关键词猜内部消息。app.js计算属性接入该筛选；新增反例覆盖用户同文仍显示、工具附件及会话身份保留，msgfold/session-state/turn-poll-state定向37/37。本次尚未打入冻结c2或取得新GUI证据，状态为源码已修、自动测试通过、GUI待验；下一完整候选须重新冻结和验证。第一批仍未交付。

### c3冻结、全套回归与原生取消正常重启（2026-10-19追加）

内部候选batch1-candidate-20261019-c3：完整f7归档+82项已确认归属的覆盖，仍排除在途agent.cj及Host测试支持；vendor及完整目录打包退出0。package-audit.json核对125文件、80DLL，Host仍82845184…；asar SHA256 a23d4b546a294379f4a3a3184cfd71508024d968857bd36f78d3a03a14e5f01d，无旁路入口。c2/R4未覆盖。冻结测试配包内Host重跑desktop-suite-c3-20261019：205文件，195通过/1失败/9未运行；1037项1030通过/1失败/6跳过，无缺TAP尾部。剩余仍model-pull-electron启动0x80000003，不升级为全套通过。

私有同字节c3副本batch1-packaged-cancel-20261019-b中candidate-identity.json核对exe/asar/Host哈希。首次取消尝试实际得到yes回答并续请求，原单请求夹具因其限制主动失败；原cancel-fixture.json的2请求/断言保留，不能算取消通过或产品取消故障。更换纯回环夹具后另起用户轮次，窗口134372实际显示待答卡，坐标点击“取消本次任务”；真实投影显示卡片及工具已取消，结果{error:cancelled}，输入只读、会话解锁。cancel-retry-report.json只有1请求，未因取消续跑。native-cancelled.png与tree保存原生工具返回画面和可访问树。

点击系统关闭按钮，list_windows确认窗口消失，再原生重开同一EXE为窗口199900。已回答及已取消卡片均保留且禁用输入；native-restart.png/tree保存证据，restart-verification.json核对正常重开日志字节/哈希及提供方请求数。没有称为崩溃恢复。c3的普通消息区不再出现内部system/message，日志仍含系统上下文，仅展示筛选，故该修复已有原生局部GUI证据。完整真实开发任务及真实模型仍未验，第一批未验收。

### DSH实际客户端源码对照（2026-10-19追加）

读取研究者提供的target/tmp/dsh-extract-20261019/DSH-UI-MODEL-ANALYSIS.md后，另外检查真实解包dsh/node_modules/@deepseek-ai各包package.json与lib/client.js。版本均0.2.0-rc.2：tool客户端193951字节/SHA256 35c18064de246f92bd374787e96e67d0126b0c90024de83bc9157023210bfab1；workspace客户端200124字节/29c34ce1c2a437cf8a50ba35d1ae44741114439e37a17153dfd4b1aa942aa955；chat客户端565053字节/a33cbb8130b6e17cf1f7d5d1d7392567694050ca9ab5960ced66e264ea72fbbb。lib/index.js只是Host入口，不能误作浏览器UI实现。

实际命中toolRowModel结构状态、errorSummary按error状态取firstLine、collapsed row exit pill注释；workspace的reconcileManualOrder、accounting slots保留归档位置、completionUnread；chat的latestCompletedParagraphFirstLine及统一内容宽度变量。SaCode当前已有真实调用ID/状态、统一气泡正文渲染、可恢复归档；错误首行样式、终端退出码常显、手动顺序保留、非当前完成未读等尚不宣称实现，不作为本轮顺手扩展。研究文档的目标projection前端语义不足以单独证明DSH执行调度器，第二批须另查实际驱动链，不能直接采信“projection自动跨轮执行”结论。旧56项失败读数不作为当前状态，也未运行第二份重复全套调查。仅借鉴交互模型，不复制第三方实现。

### 移除测试启动旁路及九文件实际补跑（2026-10-19追加）

前轮有实质进展：冻结c3、完成原生取消与正常重启。当前临时开发任务准备于target/tmp/batch1-packaged-development-20261019-c，复制c3产品文件并通过生产Host初始化仅回环合成供应商和task-project；sum.cjs仍为a-b，未发起模型请求。原生窗口3803700存在，但set_value激活失败，刷新截图为锁屏背景，故停止GUI输入；不能记为开发任务已运行或产品崩溃，未操作LockApp。继续代码工作，无需为已授权任务再次请求批准。

将9个危险测试的显式no-sandbox及disable-gpu启动参数移除，保留功能断言和默认Chromium沙箱；知识测试旧“夹具禁用沙箱”注释同步纠正。修改仅在测试源码，冻结c3产品及测试快照不变。safe-electron-test-changes.json记录每文件修改前后SHA。未关闭沙箱、改ACL、改系统PATH或安装任何软件。

实际补跑位于C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-safe-nine-20261019：9文件全失败，20项中5通过/15失败/0跳过/0未运行，无缺TAP尾部。failure-classification.json逐项列测试名、完整错误与日志链接；15项均明确观察到Electron启动退出2147483651（0x80000003），没有页面验收回执，原因尚未证实，不推断业务回归或环境无关。5项通过属于pack-next-sdk的非浏览器检查，不冒充GUI通过。

9文件分别为approval-mode-electron-host、inline-editor-render、knowledge-electron、model-credential-electron-host、model-pages-render、pack-next-sdk、plugin-inventory-lifecycle、provider-credential-retry-render、window-visibility。不得把本轮20项和冻结c3的1037项描述为同一次完整运行；后续统一测试快照须重跑。此前危险测试未运行的历史记录及错误执行旁路的说明均保留。第一批仍未验收，未进入第二批。

### 默认沙箱统一全套新读数（2026-10-19追加）

为避免混并冻结c3全套与九文件补跑，另建batch1-candidate-20261019-c3/qa-safe-source：完整c3源码副本，仅覆盖更新后的测试。qa-safe-manifest.json记录215测试/支持文件哈希，并核对main/preload/app/msgfold/tool-card/user-question-card六个产品入口与c3逐字节一致；包内产品文件不变，不称重新构建候选。

desktop-suite-c3-safe-20261019/summary.json终态：205文件，195通过/10失败/0未运行；1057项，1035通过/16失败/6跳过，取消0，无缺TAP尾部。全部9个已移除旁路的测试实际执行，不通过skip消除失败。manifest/results逐文件记录输入SHA、进程ID、退出事实和完整日志；failure-classification.json列16项各自证据，全部观察到2147483651（0x80000003）启动退出，原因尚未证实，未取得页面检查结果，不能判业务通过或统一宣称环境无关。真实模型6项仍显式跳过，不读取磁盘私钥。该统一读数取代当前卡片的1030/1/9未运行，历史读数仍保留。

第一批验收矩阵：运行时基础已实现、自动定向通过、c3原生默认启动及卡片局部GUI已验；流式对齐已实现、诊断页面几何局部通过、独立c3连续流式GUI待验；工具真实调用关联与附件已实现、Host与诊断图片局部通过、独立c3实际工具展开/截图附件任务待验；历史侧栏已有DSH真实源码对照、标题/时间/当前标识和会话切换接线、原生c2重命名归档恢复正常重启已验；选择卡片自动成功/失败/取消/隔离通过、原生c2单选多选输入确认续跑与c3取消回放已验，完整候选全路径仍须统一验证。真实模型均未验；临时项目产品内测试成功仍阻塞，不进入第二批。

### 临时项目原生读取、过期拒绝及夹具归因修复（2026-10-19追加）

本轮重新激活开发窗口3803700后恢复完整页面与输入控件；此前只有原生框架树不能证明渲染崩溃。实际原生set_value输入任务、点击发送；c3生产Host读取task-project/sum.cjs，工具卡显示read/已完成/path=sum.cjs及原文a-b。下一edit调用实际展示path/old_string/new_string，待审批图标出现。首次准备点击时工具报告检测到人工输入，按要求重新观察；工单此时已expired，未授予修改。显式重试的第二轮也未及时完成审批，再次expired。两轮日志approval/asked与expired均保留，文件仍a-b。

随后原生展开第二轮read卡，显示完整参数{path:sum.cjs}及真实文件正文，截图native-read-expanded.png/tree留在batch1-packaged-development-20261019-c；native-task-verification.json核对原始文件内容和SHA，editSucceeded/productTestsRan均false。不是完整开发闭环成功，不把读取成功替代修改或测试验收。

核对core ApprovalDesk默认30秒真实单调钟及Host等待上限，未放宽TTL或取消过期拒绝。开发夹具此前仅接受edit的ok结果，遇拒绝/过期会触发断言并断开供应商连接，导致界面request-provider-failed；这属于夹具错误归因，原报告保留。修正development-task-fixture.cjs为修改未成功时直接结算“文件修改未成功执行，测试未运行”，不再派发pwsh。新增session/development-fixture.test.mjs对denied/expired各检验真实回环请求、未派发命令、文件不变及3次有界请求，2/2；生产Host开发结算定向development-task-fixture-recheck.log 1/1。该1/1仍是文件获批后命令失败如实结算的协议测试，不冒充GUI审批或测试执行通过。

本次仅夹具与测试/文档变化，c3冻结包不变，统一全套1035/16/6仍为上一快照读数，新2项不混并。实际安全执行和独立包成功修改仍缺证据，第一批未验收。

### 模型精确审批进入当前对话（2026-10-19追加，源码阶段）

临时项目原生验收暴露审批可见性：仅顶部小图标指向侧栏，完整参数与按钮不在任务对话中，30秒工单未能及时处理。保持过期规则及Host不变，side-panels.js抽出共用renderApprovalCard；模型工单仅在当前运行会话的对话底部渲染一次，手动工具工单仍在原侧栏。按钮沿用answerTool的一次性工单应答，不增加IPC或执行入口；不自动批准，不延长TTL，不因卡片展示改变授权范围。完整参数原样呈现，跨会话/非运行提案不展示。

新增inline-approval.test.mjs及既有model-approval定向共15/15，覆盖完整参数、相同应答入口、允许拒绝、错误与迟到会话隔离。本次GUI尚待新候选c4，c3冻结包不替换，不升级第一批状态。

### c4同源候选与LongCat真实模型增量（2026-10-19追加）

c4完整归档加95项已确认归属覆盖，继续排除在途文件；vendor及目录打包均退出0，package-audit核对125包内文件、80DLL、Host82845184…，asar SHA256 daeb8a1b872fd18c9ba6320eaa4dc07757677845174bcfb50affcf4174fd5801，无旁路入口。c3/R4不覆盖。冻结c4全套desktop-suite-c4-20261019终态：207文件197通过/10失败/0未运行；1060项1038通过/16失败/6跳过，取消0，无缺TAP尾部。逐项分类和完整日志保留，16项仍观察Electron启动0x80000003，原因未证实。新增审批卡源码测试及夹具拒绝/过期测试均纳入本轮。

用户明确更换测试供应商为LongCat、模型LongCat-2.5-Preview。凭据仅从用户本轮输入注入内存与Host子进程环境，不写测试源码、证据或本次真实测试凭据文件，不读取磁盘私人密钥。HTTP连通探针返回200、模型标识一致、回复LONGCAT_OK并附usage；只登记这些白名单字段，未输出凭据或认证头。

实际生产Host真实模型读取证据target/tmp/longcat-host-20261019-a/verification.json：工作区随机nonce文件由read完成，最终正文匹配实际磁盘，2个request/header，正常结算stop、interrupted=false，Host退出0且未强杀，日志检查不含凭据。GUI未验。

第一次真实精确修改target/tmp/longcat-edit-20261019-b：工具确实提出edit，驱动迟到时工单expired，文件保持a-b；3个request/header，过期拒绝事实保留。第二次独立临时项目longcat-edit-20261019-c：有界事件驱动在原工单有效期内，仅当工具edit、path=sum.cjs、old_string=a - b、new_string=a + b且无额外参数才回答allowed-once，其余均拒绝；没有延长TTL或放松权限。真实模型先read再edit，两工具completed，工单accepted=true，磁盘实际a+b；3个request/header，最终stop、interrupted=false，模型明确“测试未运行”。verification.json保留实际内容、工具ID与状态、审批结果、无凭据日志判据；Host退出0且未强杀。该结果是实际生产Host+真实LongCat的协议路径，guiVerified/productTestsRan均false，绝不冒充GUI或产品受控测试通过。

c4私有GUI副本启动后当前模型显示step-5-preview，与私有注册表回环预设不符；只读元信息探针确认该副本配置目录中确有gui-fixture/127.0.0.1默认条目。没有向不明当前模型发送任务，没有读取凭据文件，也没有直接覆盖可能正被人工修改的配置。模型目录显示/实际数据根仍须GUI核对；原生工具随后报告foreground window did not report a process id，未继续盲点。此处不凭推测定性根因。用户提供LongCat后真实验证在另一明确隔离会话完成，不将其迁移为c4 GUI已验。

当前真实模型状态改为“LongCat读取与精确修改协议路径已验”，GUI完整开发任务、安全测试执行仍未验。ACL通路仍禁用，第一批仍未验收，不进入第二/三批。
