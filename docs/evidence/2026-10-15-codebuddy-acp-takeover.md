# CodeBuddy ACP 接管与定向验证

## 范围与基线

用户提供 Codex 暂停交接，允许接管列明的 ACP 文件。核对产品仓库 HEAD 为 e10c601，工作区仍有其他会话在途改动。未整文件认领 preload、未修改非 ACP 生产模块，未提交推送。仓颉 1.1.3 / stdx 1.1.3.1；读取本地 CangjieSkills README 和 cangjie-coding 指令，来源 gitcode.com/Cangjie-SIG/CangjieSkills.git，提交 efdf73fec28a97986dbd6a13db0b71c88b707143。

## 已核历史事实

读取交接原生 normal-report.log：initialize=true、sessionNew=false、errorCode=-32603、exitObserved=true、forcedExit=true；isolated-report.log：initialize=true、sessionNew=true、model=hy4-preview、exitObserved=true、forcedExit=true。二者 modelTaskSent=false。不是本轮重跑，不证明默认配置修复或真实模型任务通过。

## 本轮改动

- runtime create 校验请求 peer 与可信装配 peer 一致，错误身份在创建前拒绝。
- OpenCode 禁用/启用优先更新 runtime 绑定设置，避免与 Host 缓存实例分叉；CodeBuddy 保留既有相同路径。
- 页面旧 OpenCode 调用不再追加 undefined 参数，保持旧签名；CodeBuddy 显式带 peer。
- 历史主窗口夹具改用合法 opencode 身份，保留持久事实与不修改历史日志断言。
- 页面补同会话切换提供方的迟到回执与错误提供方查询拒绝测试。
- 核心测试补错误 peer 拒绝；假提供方 fixture 增加可选 peer 参数，补 CodeBuddy 原提案一次性审批与结算用例。这些新增核心测试需重新编译执行，不能据代码存在记通过。

## 已完成验证

Node IPC 定向：CodeBuddy 2/2、既有 ACP 5/5。
页面 acp-live.test.mjs 首轮 11/13，两个失败由旧调用追加 undefined 导致；修正后原 13/13，再加迟到提供方用例后 14/14，exit=0。测试经 esbuild 折叠 TS，在模拟 Vue 控件环境验证，非真实 Electron GUI 验收。
本轮指定文件 git diff --check 通过；只有 LF/CRLF 提示，不将全工作区改动冒认本轮实现。

## 私有编译与其他会话边界

私有候选 apps/desktop/.tmp-test/codebuddy-takeover-20261015，复制当前 core/Host/CLI 源码、清单和 stdx，不使用公共 target。首轮 runtime 测试编译失败（exit=1），知识模块第49/69行旧数组调用不匹配；保留 runtime-tests-utf8.txt。随后工作区知识模块已由其他工作改成 getItems，本轮只同步该文件到私有候选，不改产品知识模块。一次复制相对 cwd 错误已报告，修正绝对路径后启动 runtime-tests-retry2.log 对应测试；当前正在编译，尚无通过结论。新增假 CodeBuddy 测试暂未同步进编译中快照。

当前宽权限可只读列进程，观察到自有候选 cjpm/cjc 与另一知识模块独立测试；未终止任何进程。所有后续构建仍串行使用本轮私有输出。

## 第8轮新增验证

再次读取交接原生探针源码，确认仅 initialize/sessionNew，固定过滤错误类别，不输出错误原文/凭据。复用旧探针二进制分别在当前运行环境、默认用户配置及全新独立配置目录运行，两个命令 exit=0：native-default-current-context.json 仍 sessionNew=false/errorCode=-32603；native-isolated-current-context.json sessionNew=true/model=hy4-preview。两者 initialize=true/modelTaskSent=false/exitObserved=true，均强制收束自有提供方进程。不读取默认配置内容，不复制认证数据库、不变更 ACL。由此确认在当前较宽工具权限环境下默认配置差异仍可复现，但没有证明产品子进程身份一致或根因是认证/完整性等级。复用旧二进制不覆盖本轮最新 runtime 修改。

页面提供方选择除 disabled 外，在 onChange 处理器本身也拒绝活任务/动作中的切换；测试直接触发处理器仍保持 opencode，页面 14/14 再次通过。

私有完整核心测试编译已长时运行，检查自有 cjc CPU 累计持续增长，输出路径仅本轮候选，尚未生成 core.exe；不把运行中当通过，不另起同输出竞争编译。

## 第9轮对照

页面增加 CodeBuddy 控制参数与错误提供方诊断隔离用例，15/15，exit=0。CodeBuddy describe/probe 明确传 codebuddy，opencode 历史诊断回执在 CodeBuddy 面板被拒绝。

新增仅协议 Node 探针，在与原生同一私有 temp/workspace 父目录运行默认配置，固定 --acp，仅 initialize/session/new，无 prompt，stderr 丢弃、协议报告白名单，不读取用户配置。首次显式关闭 fs/terminal 能力、第二次 clientCapabilities={} 与仓颉一致，两次 sessionNew=true/model=hy3，命令 exit=0，自有子进程退出已观察。记录 node-default-current-context.json、node-default-empty-capabilities.json。结合第8轮原生默认 -32603，当前可复现差异仍为 Node 与原生启动路径/上下文，而非单纯空 clientCapabilities 的差异；不据此推断完整性等级、默认认证或配置损坏根因。Node kill 回执 exitCode=null 表示主动收束，非提供方自然退出0。

核心完整测试编译仍在运行，CPU累计继续增长，不能报告测试通过。

## 第10轮当前页面构建

将当前真实 renderer/pages/client-slots.ts 入口（含 ACP 页面）用与产品相同的 globalThis.Vue 虚拟模块打成私有经典 IIFE，输出仅候选目录 client-slots.iife.js。调用现有 assertStaticRendererBundle 校验，无动态 import/eval 等运行时模块或编译器路径；确认唯一 Vue runtime 标识和 CodeBuddy UI 标识。PRIVATE_SLOTS_BUILD PASS / exit=0，slots-build.json 记录输入清单。该结果证明当前页面可构建与静态脚本门禁，不证明 Electron 加载与安装态。

静态核原生 AcpProcess 使用 std.process.launch，默认 environment=None，非空环境覆盖时显式继承 getVariables；与 Node spawn 存在启动机制差异。未修改共享进程实现，未将机制差异直接定为根因。

## 第11轮编译范围调整

完整核心测试编译超过20分钟仍仅在测试编译阶段。依据进程命令行/父进程核自有 cjc PID23396，停止该单一编译器，收取作业 pwsh-159 exit=1（主动中断，不记代码编译失败）。不处理另一知识模块测试。私有候选将181个非ACP *_test.cj 移到同候选 excluded-tests，保留全部生产源码及 ACP 测试；同步已新增 CodeBuddy 审批用例与可选 peer fixture，启动 acp* 定向编译。其结果只代表 ACP 测试范围，不能代替全核心/workspace回归。产品源码不移除测试。

再补 CodeBuddy 本地协议夹具取消后迟到授予拒绝、无写入及收束观察用例；尚未同步正在编译候选，需下次增量执行。

第11轮 ACP 定向编译运行完成：TOTAL166/PASSED163/SKIPPED3/ERROR0/FAILED0，exit=0。跳过项为未匹配 acp* 的3个 codeBuddy* 用例（需另跑），不是失败。包括错误peer拒绝、CodeBuddy Node夹具原提案审批后写入/结算、runtime shutdown、提供方设置和诊断隔离。日志 acp-focused-tests-utf8.txt。生产核心全部源码参与编译，但只编译 ACP 测试集，不能宣称全核心166或全工作区验收。随后同步取消迟到授予用例开始 runtime 增量验证，尚无结果。

## 第12轮 runtime 最终专项

增量 runtime 用例8/8通过（TOTAL167/PASSED8/SKIPPED159/ERROR0/FAILED0，exit=0），包括新增 CodeBuddy 取消后迟到授予 not-sent、无 artifact 与进程退出观察。runtime-final-summary.txt。该167为私有ACP测试集总数，159为本次过滤跳过。

Host 初次构建命令错误使用 test 专属 --no-color，cjpm build 拒绝自定义 key，exit=1，不属于源码编译失败；日志 host-build-utf8.txt。已去掉该参数启动私有 Host 生产构建，尚待结果。未修改公共编译目录。

## 第13轮 Host/CLI 当前产物

私有 Host 和 CLI 生产构建均 exit=0。用 pack-host 在新 host-runtime 组装91文件自包含 Host，同目录复制本轮CLI为 sacode.exe；不覆盖公共 dist。acp-runtime-host 2通过/1跳过（未指定真实OpenCode路径），CodeBuddy独立开关 1通过/1跳过首次exit=0。再明确指定真实CodeBuddy仅隔离配置探针测试，acp-codebuddy-control-host 2/2通过，无跳过，exit=0：最新Host探针持久诊断、两提供方设置及诊断隔离、keep决定、CLI只读恢复与日志不变均验过；未发送模型任务。

当前真实Electron私有载荷准备完成：复制工作区桌面壳和renderer，替换私有静态槽位产物，配本轮Host；使用独立会话目录运行已有acp-history专项，结果待收取。复制其他模块只为装配现状，不认领其改动，未修改产品main/preload。

Electron验收未通过：首轮继承 ELECTRON_RUN_AS_NODE 导致 app 未定义（终端表面exit0但有异常，不记PASS）；清除该子进程环境后直接启动未生成验收报告，再用 Start-Process -Wait 取得真实退出码 -2147483645（0x80000003），stderr空，无专项报告/截图。故真实窗口加载仍待验，不能用脚本启动表面exit0代替验收。未使用 --no-sandbox 或改系统配置。

## 第14轮真实 Host 假提供方链路

在私有目录用本地 clang 构建固定 Node 夹具启动器，不安装依赖、不接受请求启动向量、不连接网络。最新真实Host通过可信测试环境装配该假提供方。host-fake-check.cjs / host-fake-report.json：HOST_FAKE_CHECK PASS，exit=0。覆盖CodeBuddy活任务期间切OpenCode拒绝 acp-provider-tasks-in-flight、关闭CodeBuddy后新准入拒绝 acp-disabled、显式取消、对应prompt回复结算cancelled、迟到审批not-sent、无文件写入、关闭原进程后切OpenCode成功、OpenCode关闭后新准入拒绝。Host由finally收束，未处理他人进程。审批允许后写入/完成结算另由第11/12轮核心Node夹具通过，本轮Host夹具主测取消拒绝链。

## 第15轮补齐与边界

复用已编测试产物 codeBuddy*：3/3通过，TOTAL167/PASSED3/SKIPPED164/ERROR0/FAILED0，exit=0；codebuddy-discovery-summary.txt。全生产源码参与的ACP私有测试集已分轮覆盖全部167用例（163 acp* + 新增取消1 + codeBuddy*3），不是单次全核心通过。

最小Electron诊断仅 app.whenReady、不加载SaCode或ACP、不降低沙箱，仍退出-2147483645/0x80000003，未写ready报告，stderr空。说明本次环境/二进制最小启动也失败，不能归咎ACP页面或宣称其无问题；不以 --no-sandbox绕过。真实窗口验收明确未完成，建议在可正常运行此Electron二进制的交互环境复验。不影响已通过页面静态与组件测试。

## 验收分层结论

| 层 | 已观测 | 不宣称 |
| --- | --- | --- |
| 配置 | OpenCode/CodeBuddy会话开关独立、CAS落盘恢复、诊断决定隔离 | 默认用户配置已修复/模型或插件配置已核完整 |
| 协议 | 当前Host/CLI独立CodeBuddy配置initialize/sessionNew和持久诊断通过；Node默认hy3成功；旧原生默认-32603可复现 | 默认产品链已就绪；-32603等同认证错误 |
| 模型 | 未发送真实CodeBuddy prompt；价格与真实效果未知 | 模型任务成功/免费/真实取消验收 |
| 产品 | 当前私有core/Host/CLI生产编译、167个ACP范围测试分轮覆盖、IPC7/7、页面15/15、经典脚本门禁、真实Host假提供方链通过 | 全workspace回归、Electron窗口、安装态、发布或跨平台通过 |

未提交/推送/安装/读取秘密/改默认配置，未修改main/preload非ACP内容，未停止他人进程。终止过一个已核自有长时cjc并如实登记中断；相关作业均已收取。

## 第16轮最终源码审查

精确路径 diff --check通过，逐项审查runtime/Host提供方装配、门控和工作区身份，不覆盖其他会话文件。只格式化本轮修改的两份生产.cj（acp_runtime_api/acp_runtime_rpc），未格式化测试或非ACP模块。同步私有候选后启动最终 acp* 与 codeBuddy* 回归，尚待收取；之前构建/runtime证据为格式化前内容，不能将后续新构建状态提前记PASS。

最终Node IPC7/7、页面15/15再次通过，私有真实槽位静态构建再次PASS，均exit=0。最终Host/CLI重建与Host链路复验在核心回归后串行执行。

## 第17轮交付最终读数

格式化后核心最终定向：acp* 164通过/3跳过，codeBuddy* 3通过/164跳过，均TOTAL167/ERROR0/FAILED0/exit0；两个互补过滤覆盖私有ACP测试集167个，不等于全核心测试。最终Host/CLI生产重建均exit0；更新私有自包含二进制后，真实Host假提供方链再次PASS，CodeBuddy真实独立配置Host/CLI协议及持久诊断2/2再次PASS，无跳过，均exit0。最终IPC7/7、页面15/15与静态脚本门禁在第16轮通过。

本次授权接管、修复、独立验证、差异调查和分层登记完成；下列产品验收缺口仍然存在，交付不将它们标为通过，不自动扩权发送模型任务或改变配置。

## 后续产品验收缺口（非本次通过项）

已完成范围见最终读数，不再将其列为待验。仍待：默认用户配置原生session/new -32603根因与修复；可正常运行Electron的交互环境中真实窗口验收；统一完整workspace回归、安装态与跨平台/发布验证。真实CodeBuddy session/prompt未授权、不执行；模型效果/费用/真实任务取消结算未知。不得读取秘密、改变用户配置或关闭隔离以制造通过。
