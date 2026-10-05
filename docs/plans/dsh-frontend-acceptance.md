# 冻结 DSH 前端与交互验收清单

日期：2026-10-05。基线：`639ed015397290b3745d163aafe02ffee4aa3f84`。

本轮实际前端对照见[官方截图与 SaCode 页面差距](../evidence/frontend-official-comparison-2026-10-05.md)：通用设置目前仅主题/字号已接、语言固定中文；Agent 预设、打开配置文件、完整内置插件清单和轨迹仍缺。74 个内置身份的中文说明已接入列表与详情，开发态整页 745 条/0 失败/rc=0；清单夹具不代表产品 inventory 接通。官方安装版 `0.2.0-rc.2` 不自动替代冻结基线，原生隐藏菜单和保存行为尚未现场操作核验。

本清单补充 [63 子系统能力矩阵](dsh-capability-matrix.md)，不替代它，也不改变模块实现计数。页面、插件包和子系统不是一一对应关系。清单登记范围和缺口，不表示新增实现或验收通过。

## 判定与证据

每个入口必须分别记录：冻结源码及测试出处、SaCode 源码提交、共享核心行为、桌面交互、CLI 等价动作或不适用裁决、失败与恢复、插件装配及卸载、最终产物哈希和实测结果。状态采用「未开始／部分完成／通过／阻塞／不适用（已裁决）」，来源核验另列，禁止用索引命中代替阅读源码。

通过必须包含实际行为，不能以按钮存在、marker 事件、固定示例、核心单测或开发态单次冒烟替代。任何缺证项保持待验收。所有保留功能均覆盖空态、加载、成功、错误、取消、切换会话、历史恢复及资源清理；不适用的状态须说明原因。

## 必须单列的行为

| 能力 | 必须验证 | 当前明确缺口／判定限制 |
| --- | --- | --- |
| 轨迹与瀑布流 | 请求、轮次、步骤、工具及嵌套调用关联；输入输出检查；真实时间和用量；搜索、折叠、历史加载、虚拟列表、滚动跟随 | 尚无完整轨迹视图接通证据；普通消息气泡不能替代。缺时间或 token 时显示不可用，不造数据 |
| 系统提示词 | 展示对应实际请求的完整文本及更新位置；折叠、换行和滚动；压缩后与历史加载后仍关联正确 | Builder 单测不证明 Host 实际使用或前端展示；不得以重新构造的示例冒充已发送内容。配置／编辑入口依冻结契约核验，不自创 |
| 工具 | 发现、注册、Schema 校验、审批、执行、关联结果、错误、取消、卸载清理；真实模型调用 | 手动工具区不证明模型工具闭环；模型运行时接入及插件归属仍需验证 |
| 文件、附件和交付物 | 上传、排队引用、历史展示、模型路由、预览、下载和打开；权限、大小限制、断连与取消 | 上传已接不等于历史、排队卡片及交付物完整；按各插件分别验收 |
| 目标 | 创建／编辑／暂停／恢复／删除、边界生效、轮次准入、真实持续执行及证据收口 | 核心驱动和控制协议不能替代 Host 实际调用与桌面连续执行；未交付目标卡不能记为安装包完成 |
| 计划 | 命令和输入入口、有效状态、提交计划、侧栏展示、审阅批准与退出 | 与 Todo 分开；现有布尔 marker 不满足完整契约 |
| 反馈 | 消息评级、撤回、分类和说明、会话反馈、并发版本冲突及失败保留草稿 | 现有 marker 不满足分类弹窗、CAS 和撤回；本地交付与裁剪上报路径另核 |
| 上下文与压缩 | 真实上下文投影、压缩触发、摘要生成、模型历史替换及轨迹显示 | ContextMeter 无数据不可伪造；计数 marker 不证明压缩已执行 |
| 权限与审批 | 预设、每次请求有效策略、拒绝／过期／复用／取消及沙箱；计划审批另验 | 前端开关必须对应后端决定，不能仅改变文案 |
| 模型与凭据 | 会话模型选择、供应商配置、持久化、不可用错误、用量、请求固定与切换 | 凭据不进渲染层和日志；不得静默切换模型。真实远端和夹具分别记录 |
| 会话日志导出 | Header 与命令入口；完整会话树及引用附件 ZIP；流式下载、重复请求、取消与失败 | 不以普通 JSONL 保存替代冻结导出契约；当前没有完整接通证据 |
| 工作区与历史 | 目录选择、文件树、会话列表／分支／切换、历史翻页、重启恢复 | 当前部分入口已接，但不据此判整组通过 |
| 设置与原生窗口 | 设置各页、快捷键编辑、Agent 预设、菜单、窗口与主题；布局和无障碍状态 | 空壳设置页、开发预览及静态截图不能代替安装包交互 |
| 插件装配 | 内置及自写插件的依赖激活、配置、初始化回滚、停用卸载、重启及贡献自动清理 | 硬编码页面和普通工具回调不等于完整插件架构；市场额外设计暂缓 |

## 冻结前端包覆盖登记

以下包名逐项取自本地冻结文件树 `target/up/tree.json`，其 SHA 已核对。这里只证明路径存在，**不声称本轮已阅读全部包正文**。全量契约阅读、当前接入与最终交互测试仍须逐行回填。此表与 63 子系统表交叉使用；桌面壳、非 client 包贡献和共享核心行为仍在范围内，不把本表数量当成产品总分母。

`ui-brand-official` 按 SaCode 命名承接保留界面；`ui-settings-account` 按 C01–C04 裁剪官方账号部分。二者均不能按整个包名直接删除或判通过，其余保留行为需逐项核验。

| 冻结包 | 冻结证据路径（索引） | 当前验收登记 |
| --- | --- | --- |
| ui-agent-preset | `packages/client/ui-agent-preset/README.md` | 待逐项回填；无全项通过声明 |
| ui-approval | `packages/client/ui-approval/README.md` | 待逐项回填；无全项通过声明 |
| ui-attachment | `packages/client/ui-attachment/README.md` | 待逐项回填；无全项通过声明 |
| ui-brand-official | `packages/client/ui-brand-official/README.md` | 待逐项回填；无全项通过声明 |
| ui-chat | `packages/client/ui-chat/README.md` | 部分完成：冻结 client/apply.ts 已读，聊天实际由槽位注入；消息完整交互仍分项核验 |
| ui-commands | `packages/client/ui-commands/README.md` | 待逐项回填；无全项通过声明 |
| ui-conversation | `packages/client/ui-conversation/README.md` | 部分完成：冻结 client/apply.ts 已读，conversation.view 声明、坍缩与重装已接；全量视图装配未完成 |
| ui-deliverables | `packages/client/ui-deliverables/README.md` | 待逐项回填；无全项通过声明 |
| ui-directory-picker-browse | `packages/client/ui-directory-picker-browse/README.md` | 待逐项回填；无全项通过声明 |
| ui-directory-picker-native | `packages/client/ui-directory-picker-native/README.md` | 待逐项回填；无全项通过声明 |
| ui-dockkit | `packages/client/ui-dockkit/README.md` | 待逐项回填；无全项通过声明 |
| ui-goal | `packages/client/ui-goal/README.md` | 待逐项回填；无全项通过声明 |
| ui-input-trigger | `packages/client/ui-input-trigger/README.md` | 待逐项回填；无全项通过声明 |
| ui-jobs | `packages/client/ui-jobs/README.md` | 待逐项回填；无全项通过声明 |
| ui-layout | `packages/client/ui-layout/README.md` | 待逐项回填；无全项通过声明 |
| ui-message-feedback | `packages/client/ui-message-feedback/README.md` | 待逐项回填；无全项通过声明 |
| ui-model-selection | `packages/client/ui-model-selection/README.md` | 待逐项回填；无全项通过声明 |
| ui-open-in-app | `packages/client/ui-open-in-app/README.md` | 待逐项回填；无全项通过声明 |
| ui-permission-presets | `packages/client/ui-permission-presets/README.md` | 待逐项回填；无全项通过声明 |
| ui-plan | `packages/client/ui-plan/README.md` | 待逐项回填；无全项通过声明 |
| ui-plugin-manager | `packages/client/ui-plugin-manager/README.md` | 待逐项回填；无全项通过声明 |
| ui-primitives | `packages/client/ui-primitives/README.md` | 待逐项回填；无全项通过声明 |
| ui-reference | `packages/client/ui-reference/README.md` | 待逐项回填；无全项通过声明 |
| ui-renderer | `packages/client/ui-renderer/README.md` | 待逐项回填；无全项通过声明 |
| ui-schedule | `packages/client/ui-schedule/README.md` | 待逐项回填；无全项通过声明 |
| ui-session | `packages/client/ui-session/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-account | `packages/client/ui-settings-account/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-agent-loop | `packages/client/ui-settings-agent-loop/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-general | `packages/client/ui-settings-general/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-models | `packages/client/ui-settings-models/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-plugin-inventory | `packages/client/ui-settings-plugin-inventory/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-plugins | `packages/client/ui-settings-plugins/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-session-log | `packages/client/ui-settings-session-log/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-shell | `packages/client/ui-settings-shell/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-subagent | `packages/client/ui-settings-subagent/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings-web-search | `packages/client/ui-settings-web-search/README.md` | 待逐项回填；无全项通过声明 |
| ui-settings | `packages/client/ui-settings/README.md` | 待逐项回填；无全项通过声明 |
| ui-shortcuts | `packages/client/ui-shortcuts/README.md` | 待逐项回填；无全项通过声明 |
| ui-sidebar-browser | `packages/client/ui-sidebar-browser/README.md` | 待逐项回填；无全项通过声明 |
| ui-sidebar-documentpreview | `packages/client/ui-sidebar-documentpreview/README.md` | 待逐项回填；无全项通过声明 |
| ui-sidebar-files | `packages/client/ui-sidebar-files/README.md` | 待逐项回填；无全项通过声明 |
| ui-sidebar-right | `packages/client/ui-sidebar-right/README.md` | 待逐项回填；无全项通过声明 |
| ui-sidebar-terminal | `packages/client/ui-sidebar-terminal/README.md` | 待逐项回填；无全项通过声明 |
| ui-sidebar | `packages/client/ui-sidebar/README.md` | 待逐项回填；无全项通过声明 |
| ui-skill | `packages/client/ui-skill/README.md` | 待逐项回填；无全项通过声明 |
| ui-slots | `packages/client/ui-slots/README.md` | 部分完成：README 与 src/index.ts 已读，普通槽位和 Vue 挂载已接；完整 Factory/Store/客户端模块尚未完成 |
| ui-subagent | `packages/client/ui-subagent/README.md` | 待逐项回填；无全项通过声明 |
| ui-theme | `packages/client/ui-theme/README.md` | 待逐项回填；无全项通过声明 |
| ui-tool | `packages/client/ui-tool/README.md` | 待逐项回填；无全项通过声明 |
| ui-trajectory | `packages/client/ui-trajectory/README.md` | 来源 client/index.ts 已读；实现待接，尚无真实轨迹视图、历史加载与检查器验收，不据来源核验升级状态 |
| ui-user-questions | `packages/client/ui-user-questions/README.md` | 待逐项回填；无全项通过声明 |
| ui-workflow-run | `packages/client/ui-workflow-run/README.md` | 待逐项回填；无全项通过声明 |
| ui-workspace | `packages/client/ui-workspace/README.md` | 待逐项回填；无全项通过声明 |
| session-log-export | `packages/session-query/session-log-export/README.md` | 待逐项回填；无全项通过声明 |

## 本轮增量证据

客户端普通槽位与实际聊天插件装配已提交 `53170e7`；工作区冒烟的加载边界反证提交 `4d77a93`、`59363d8`；插件延迟挂载后的滚动观察器修复提交 `fcc9b4b`。槽位单测 10/10、主目录槽位与静态 bundle 合计 11/11、隔离开发态界面 254/254。前两次打包态分别 1 项失败，保留并修复时序证据；最终打包态完整 255/255、0 FAIL、rc=0，不能据此升级整项能力。最终产物与实测细节以 [客户端槽位证据](../evidence/client-slots-2026-10-05.md) 的后续实测为准。最终源码完整桌面测试 186 总数／184 PASS／2 SKIP／0 FAIL；SDK 环境隔离曾定位缺 pthread 运行库，`ea35c12` 修复；独立整页验收先复现真实滚动问题，修复后打包态 736 检查／0 FAIL。完整插件架构、轨迹、系统提示词和工具生命周期仍有缺口，不提升全项通过数。

模型工具管线已由 `09bf0c1` 接入注册表、审批、关联结果及续请求；核心 518/518 含指定真实模型调用，Host 协议回归和 CLI 自检通过，见 [模型工具管线证据](../evidence/model-tool-runtime-2026-10-05.md)。仍未接任意插件分派及完整桌面文件工具审批，不能以该切片替代工具全生命周期验收。
