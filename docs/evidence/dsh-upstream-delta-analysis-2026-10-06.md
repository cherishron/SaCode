# DSH 上游完整增量清单与源码影响分析（2026-10-06）

本报告回答冻结版本之后上游改了什么，以及哪些变化适合进入 SaCode。它是源码影响分析，**不是 SaCode 完成报告，也不是上游运行验收**。本轮没有修改实现代码，没有运行上游或 SaCode 的模型、插件、安装包验收。

## 1. 时间点和范围

| 项目 | 记录 |
| --- | --- |
| 官方仓库 / 分支 | `deepseek-ai/deepseek-harness` / `master` |
| 继续使用的复刻基线 S0 | `639ed015397290b3745d163aafe02ffee4aa3f84` |
| 本次观察 HEAD | `5badb15009ae1756c3afe0ae0cef1faafc290ccc` |
| HEAD 提交时间 | 2026-10-03 11:48:13 +08:00 |
| 收尾重新查询时间 | 2026-10-06 19:21:46 +08:00 |
| 相对此前观察 | 与 2026-10-04 已记录 HEAD 相同，没有发现更晚的 master 提交 |
| 增量区间 | S0 → 上述 HEAD；不是“10 月 4 日之后新增 266 条” |
| 当前版本标签内容 | 发布准备 `0.2.1-alpha.1`；预发布号不等于稳定版本验收 |
| SaCode 分支 | `refactor/dsh-learning`；分析期间共享树仍有其他成员在途改动 |

出处：[官方 HEAD](https://github.com/deepseek-ai/deepseek-harness/commit/5badb15009ae1756c3afe0ae0cef1faafc290ccc)、[完整比较区间](https://github.com/deepseek-ai/deepseek-harness/compare/639ed015397290b3745d163aafe02ffee4aa3f84...5badb15009ae1756c3afe0ae0cef1faafc290ccc)。复刻时间、裁剪与后续更新规则仍以 [冻结登记](dsh-upstream-freeze.md#9-本次复刻时间点与上游增量跟踪2026-10-06) 为准。

### 清单完整性

GitHub compare 默认结果的 250 commits / 300 files 上限已经补齐：

- 分页查询得到 100 + 100 + 66 条、266 个唯一提交；本地 Git `rev-list S0..HEAD` 同为 266。包括合并提交，不能按 266 项功能计算。部分支线提交原始日期早于 S0，但此前尚未进入 S0；区间按可达性定义，不按日期过滤。
- 两端 recursive tree 均 `truncated=false`，包含 16,070 / 16,225 个树条目。条目包含目录，不能当源码文件数。
- 两端 blob 按路径比较，再与 Git `diff --name-status --no-renames S0 HEAD` 对账，均为 **4,760 个变化路径**：新增 1,163、修改 2,538、删除 1,059。归档移动按新增/删除分别计数。
- 从官方两端源码归档读取变化路径，**7,298 份实际存在的端点 blob** 按 Git blob SHA-1 重新计算，全部与树索引吻合。新增/删除只核一端，修改核两端。
- 已形成实现/构建资源的 104 组差异并审查主题调用链、迁移说明和关联测试。测试路径清单完整登记，但没有逐条运行；文档与代理记录不声称每篇正文均已深读。

| 路径分类（互斥、按路径规则） | 数量 | 含义 |
| --- | ---: | --- |
| `.agents/` 记录 | 2,267 | 大量归档与元数据整理，不是功能增删 |
| 文档 | 1,252 | 含 Markdown、网站与 i18n 文档 |
| 构建、配置、资源 | 160 | 含脚本、资源和配置 |
| 包清单 / 锁文件 | 339 | 其中 261 份 JSON 包清单只改变自身 version |
| 测试、快照、基准 | 451 | 上游回归依据，不是 SaCode 已通过 |
| 实现路径 | 291 | 含源码、样式和被删除的 invariant；不是 291 个功能 |

机器清单：[266 个提交与各自第一父差异路径](dsh-upstream-delta-commits-2026-10-06.json)、[4,760 个路径与端点摘要](dsh-upstream-delta-files-2026-10-06.json)。提交主题按路径规则生成；人工行为结论在下表，不能只看自动归类。合并提交的第一父差异可能重复支线变化，实施应依据最终端点契约，不能逐提交机械 cherry-pick。

## 2. 分析原则与责任

所有项目均为**候选增量、尚未因本报告实施**。W 编号沿用现有实施计划，仅表示建议归属，不能代替成员接单。Host/CLI 公共入口仍由其主责串行集成，不抢写在途文件。

沿用用户裁决：DSH 已有且满足要求则复刻；SaCode 已完整接入则只补验收；不足则保留契约后扩展；没有则单列新能力。本轮关注的是 S0 之后的差异，不能用这份增量清单替代现有 **63 子系统 / 54 前端包** 的冻结版完整验收。

技术栈保持仓颉共享核心 + Electron + Vue runtime / `h()` + OpenTiny；官方 React、Cordis 和 Node 内部实现不能原样替代。显示说明使用中文，稳定插件 ID 保留；模型配置集中到模型中心；官方商业账号与默认官方上报继续裁剪。

## 3. 逐项源码影响与验收要求

以下路径均指本次 HEAD 的官方仓库路径；被删除路径指 S0。每项列出代表提交，不是该主题只有这些提交。

### U01–U06：插件平台（优先处理）

| 项目 / 代表提交 | 最终源码行为与影响 | SaCode 处置、责任与定向验收 |
| --- | --- | --- |
| U01 创建入口与预设可见性 `ed50a72f`、`3c26fdd2`、`7a078907` | 插件页贡献 `plugins.add.actions`；Creator 可按单次任务启动，关闭 coding tools 仍可使用 Standard / Creator；PTC / Minimal 等高级选择被约束；失败明确展示。后续提交收紧了最初过宽的 UX 改动。 | 承接“安装现有插件 / 自己创建插件”两个入口及选择失败行为（W20/W50/W60）。检查草稿建立、当前预设不被一次性 Creator 请求永久改写、缺预设不静默换档；创建结果必须进入真实安装/激活链，按钮或示例不算完成。源码：`packages/client/ui-agent-preset`、`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`。 |
| U02 元数据迁移 `f30aec98`、`ecedbbc2`、`8339f16c`、`f8a274b7` | 根包仍可读 package.json 显示信息；子路径插件改从 locale 的 `meta.title/meta.description` 和 `<subpath>/icon` 读取，不再探测子路径 package.json。显式 manifest 图标优先；资源归属和路径越界校验保留。 | 中文元数据应落到插件自己的显示契约，保留稳定 ID 与来源（W20/W60）。对根包/子路径/别名/显式图标/缺失图标/越界路径做正反测试；不能把所有描述硬编码到页面。源码：`packages/util/package-meta`；迁移指南：`docs/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.zh.md`。 |
| U03 安装来源与异常卸载 `b96959ec`、`6d1e12b2`、`9b79f970`、`00b36307`、`bab69fbe` | 来源处理保留 npm alias、Git/URL、本地 file/link 路径；展示 URL 去掉 userinfo，排除 shadowed/shipped 副本；没有可解析包的残留配置也能移除。记录实际安装版本，只有单 registry 安装场景才解释 minimumReleaseAge 导致的旧版本并给精确 spec。 | 承接并补来源脱敏策略（W20/W60）。**去 userinfo 不等于查询参数已全脱敏**，需另核 token query；测试别名、本地相对目录、缺包卸载、版本不符、重试和安装失败回滚。源码：`packages/boot/plugin-manager/src/install-spec.ts`、`index.ts`、前端 `manager-store.ts`。这证明多来源安装，未证明有统一官方市场。 |
| U04 解析表与热更新 `869afc49`、`abf8b760`、`6fe4a2e1`、`b1c5f861`、`a59beb8a` | 安装/启用重新发布 resolution；没有 HMR 的停用/卸载保留仍在运行的解析映射。manifest 变化刷新 CJS/ESM 请求解析，同时保留已加载 entry namespace 身份；Office 解析也同步处理。 | 复刻运行时 revision、已激活实例、停用排空和重启提示契约（W20），不直接移植 Node 私有 cache 补丁。测 exports 改变、运行中卸载、同名多实例、失败回滚、CJS/ESM 与 Office engine；真实热更未实现时明确 restartRequired。源码：`packages/boot/app-boot`、`boot/hmr`、`util/package-manifest`、`vendor/loader`。 |
| U05 装配由 registry 实例持有 `2e3ab619` | 预设 generation/mount 从进程全局转到 registry service；inspect 返回实际保留修订与泄露服务信息；模型插件 inventory 从当前 agent 的 registry 读取。 | 防止不同运行时、会话或预设修订串用（W20/W50）。用两个 registry 同 ID、旧修订排空、子智能体继承、销毁再建验收。源码：`packages/preset/agent-preset-registry/src/index.ts`、`packages/llm/plugin-package-inventory-deepseek/src/index.ts`。 |
| U06 插件 CSS 所有权 `aa5334f1`、`015349e4` | factory 前记录未标记 style，factory 后只认领新注入元素；失败也收走本次新增样式，不抢别的模块样式。 | 对 Vue 插件装配采用相同所有权（W20/W60）。A 激活→B 失败→B 卸载时 A 和全局样式必须保留；重复启停无样式泄露。源码：`packages/client/modules/src/client/system.ts` 等该包差异。 |

### U07–U16：调度、输入和主界面

| 项目 / 代表提交 | 最终源码行为与影响 | SaCode 处置、责任与定向验收 |
| --- | --- | --- |
| U07 schedule 拆包及子会话限制 `6c1a590a`、`699f1a8d`、`1b1b09e1`、`9633724b` | 撤销 experimental schedule-bundle；服务/页面进 Web composition，工具进 preset-scoped `schedule/tool-schedule`；常用预设接 clock/提醒工具，Minimal 不接。service 和 tool 层拒绝子智能体目标/委托调用。profile 清掉旧 bundle 选择。 | 候选迁移（W20/W50/W60）：保留既有任务与送达记录，只迁移装配；测试旧 profile 冷启动、工具权限发现、直接伪造请求仍拒绝、停用后不误投递。迁移指南：`docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.zh.md`；源码：`packages/schedule/tool-schedule/src/index.ts`、`schedule/src/index.ts`、`boot/app-boot`。 |
| U08 目标续轮撤队与编辑 `9a8d21df`、`c02925ed`、`66e10182`、`b1a69a9b` | Stop 后撤回停在 inbox 的自动续轮预约，避免堵住后面的用户消息；修订闸防暂停/恢复竞态。目标/排队消息共用多行 InlineEditor，IME Enter 防误提交，修正暂停标签。 | 承接撤队、修订闸、编辑器（W50/W60）。**官方暂停取消当前轮在 S0 已存在，不是本次新增；与 SaCode 用户要求冲突。** SaCode 继续“轮次边界重读，暂停不强杀当前轮”。验收：当前轮完成、下一轮不启动、快速恢复旧结果不再暂停、仅撤自动消息且人类补充留存。源码：`packages/goal/goal-round-driver/src/index.ts`、`packages/client/ui-goal`、`ui-primitives/src/InlineEditor.tsx`。 |
| U09 结构化草稿 `e400349e`、`e6783c20`、`2c93df56` | 草稿由纯字符串拓展为 text + 语义 references；兼容旧字符串。引用区间必须有序、不重叠，跨度和 clipboardText 一致；不持久化编辑器临时 occurrence ID。缓存 input shell 后初始化 lexicon；新会话 prompt 仅文本。 | 优先核对输入框和提示词增强已有实现（W10/W60）。会话切换、重启、@ 文件引用、同文字但不同编辑修订、增强/撤销均不得丢引用或覆盖用户编辑。已有完整接入则补测试，不再重写。源码：`packages/client/ui-conversation/src/client/draft.ts`、`input/{facade,hub}.ts`、`stores.ts`、`ui-workspace`。 |
| U10 工具参数增量视图 `2ba4144a`、`a33bd1a8`、`91818992`、`b7f06692`、`f80df042` | `PartialArguments` 增量解析可见字段；preparing、settled、轨迹视图共享参数读面。限制长参数摘要/前缀工作，处理 sealed delta、Unicode 边界；文件大小跨阶段保留。conversation event registry 按事件类型路由，减少无关分派。 | 契约复刻（W40/W60），完成/审批/执行仍用核心完整参数。验收碎片 JSON、转义、emoji/代理对、大文件、封口后迟到 delta、实时与回放一致；未完整参数绝不提前执行。源码：`packages/util/values/src/partial-json.ts`、`ui-chat`、`ui-conversation/src/client/conversation`、`ui-trajectory`。 |
| U11 参数生成顺序与 shell 提权 UI `4166dbd1`、`a63d8979`、`fce0a41d`、`c74f39b4` | schema/提示指导先 description 再 code/command，先 file_path 再 contents；shell diff card 按 Host 已接受字段展示，不在客户端重复验证提权。 | 承接展示/提示契约（W40/W60），不能把 JSON 键顺序变成执行授权条件。审批仍由仓颉核心裁决；PTC 的真实 tools 桥、取消/沙箱需独立闭环。验收顺序不同但合法 JSON、未批准 shell、Host 接受扩展字段与展开详情。 |
| U12 活动/用量统计独立 dock `21900828`、`1f8cdc08`、`68ead9fc` | 单 stats 贡献拆成 activity 与 usage 两个贡献，明确静态优先级、替换顺序、点击外部和 Escape 关闭。 | 按“一切皆插件”拆槽位贡献（W30/W60），已有贡献则补行为验收。上下文压力不是累计用量；该更新不证明 ContextMeter 的真实核心投影已接。验收替换单个 pill 不影响另一个，关闭/焦点/无数据状态正确。源码：`packages/client/ui-chat/src/client/chat/StatsPills.tsx`。 |
| U13 侧栏归属与底部槽位 `8463abc5`、`88341c2a` | 修复 Session Tab 生命周期和 pane-local page；新增 root-scoped `shell.bottom`，主布局适应底部内容，不借用会话槽位。 | 候选承接（W60/W20）。测两个会话切换、左右栏开关、插件 bottom 卸载、内容高度/滚动互不串。源码：`packages/client/ui-sidebar-right`、`ui-layout`。 |
| U14 YAML frontmatter `0cad3a01`、`39c614a1`、`2ca5f648` | Markdown 文档预览按字段展示首行 frontmatter，保证合法/异常 YAML 的展示忠实；只识别文件首行。 | 复刻预览行为（W60/W70），文档内容是数据。测首行与正文 `---`、复杂值、坏 YAML、原文可读且不触发工具。源码：`packages/client/ui-sidebar-documentpreview`。 |
| U15 附件回执实例隔离 `aa2ae5c7` | 回执按确切 Session 对象隔离，避免同 ID 重建后旧上传回执进入新会话；移除不合适的 agent-scope assertion。 | 核对现有附件服务的会话 generation（W10/W60）。旧实例上传迟到、同 ID 重开、取消和 staged/committed 引用均需测试。源码：`packages/client/file-upload/src/index.ts`。 |
| U16 列表响应与基准 `ecc01b54`、`4402fa47`、`d70efffb` | Session 列表在完整 summary 之间让出执行权；work slice 默认 16ms，检查 AbortSignal；新增大语料 list/search/fork 和 reconnect 性能回归。 | 仓颉/IPC 模式按相同响应性目的实现（W10/W60/W80），不直接复制 Node 时间调度。用大目录、取消、并发新增、稳定排序验收；CI p99 校准值不是本机通过证据。源码：`packages/api/session-controller/src/list.ts`、`benchmarks`。 |

### U17–U25：实验扩展、诊断、数据与发布

| 项目 / 代表提交 | 最终源码行为与影响 | SaCode 处置、责任与定向验收 |
| --- | --- | --- |
| U17 可选 session inspector `38c45638`、`732dd913`、`ad22e6c8` | 新增 raw-log / grouped-chat 诊断、JSON 展开、DOM reveal/pick，optional inspector-profile；Chrome DevTools 改从固定 npm 源码构建。 | S0 后新增候选能力（W20/W60/W70/W90），不自动纳入已实现。验收开关/销毁、会话归属、日志脱敏、CSP、离线载荷与第三方 notices；不能让诊断页直接读凭据。源码：`packages/experimental/{session-inspector,inspector-profile,inspector}`。 |
| U18 Claude Code mods `35873604`、`f1715c67`、`57126d8b`、`233032b8` | 最终版作为普通 DSH 插件，提供有限 `$` API、hooks、工具链和 AbovePrompt band/Remote。早期持久格式变化已经撤回。不是 Claude 插件 manifest/hook JSON 的通用加载器；Pane 等 API 不支持，部分参考事件不会发出，普通 Node 不能直接跑未编译 TS。 | **新能力候选，先决定范围**（W20/W50/W60/W70）。不能宣称兼容 Claude 市场或任意 mods。可运行示例只证明支持的 API；逐 API 宣布兼容/拒绝。模型工具 hook 在权限批准后不能替换工具名/已批准参数，next 只一次且结算；测试超时、拒绝、generation、卸载定时器、store 配额。源码：`packages/experimental/claude-code-mods` 与 `client-ui-claude-code-mods`；详见下一节。 |
| U19 runtime invariant 移除 `f028f256`、`96371534`、`e1c49269` | 删除 invariants registry、各包 invariant companions 与若干脚本/SDK 装配；原来仅 companion 触达的路径补直接测试。部分凭据/LLM listener 移除专门 INVARIANT 异常穿透，按常规 observer 错误隔离。 | **破坏性候选迁移，不能照删 SaCode 守卫**（W10/W20/W40）。审批、schema、持久一致性、安全边界仍保留。S0 的 invariant 子系统不从矩阵分母删除；只有明确升级基线时才登记替代机制。源码：`packages/runtime-diagnostics/invariants`（删除）、各 `/src/invariant.ts`、`credentials-local` 等；迁移指南 `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.zh.md`。 |
| U20 Office 引擎 `d0916a8f`、`541fcec0`、`a59beb8a` | LibreOffice Kit 升至 0.1.5；Office 解析刷新同时清 request/实际 target 相关 manifest 缓存。 | W70/W90 候选依赖升级，验收转换、预览、取消、路径/输入授权与剥 SDK 安装态。它不是 Excel 加载项或结构化单元格编辑能力。Kit MPL-2.0 源码/NOTICE 义务单列，不能只凭 DSH 根许可证为 MIT 判定整个包。源码：`apps/desktop-host/src/office-engine.ts`。 |
| U21 public URL、随机端口、跨包错误 `a7c3ad99`、`ecd9bf92`、`f37f19ab`、`e6c6ec66` | publicURL 规范化并拒绝空白/control、缺 authority、userinfo、query/fragment；公布 URL 不增加 trusted hosts。桌面宿主默认端口 0 交 OS 分配。终端/SSH 按错误 name 识别跨模块 executable-not-found，避免 instanceof 失配。 | W40/W70 按 SaCode 真正入口评估。stdio Host 不因上游端口变更强加 HTTP。验收 URL 拒绝、公布地址不放宽远程授权、端口冲突、可执行文件缺失与真正网络错误区分。源码：`packages/bundle/web-app/src/public-url.ts`、`apps/desktop-host`、`api/terminal-controller/src/shells.ts`、`ssh`。 |
| U22 构建与发布 `f3013b2d`、`500614c0`、`185b9c59`、`a809d928`、`71086449`、`ec48669f` | build 用 process.features.typescript 检查当前 Node 的 type-stripping 能力；tsdown native config loader。支持独立 npm dist-tag，整批预检并防占用通道替换，不依赖 latest；vendor 与 DSH 发布预版本。Windows coverage 先准备 Electron。 | W80/W90 承接发布契约，保留仓颉 DLL / extjs / Electron 版本约束；不照搬官方包名、发布 family 或 Node 私有行为。验收错误构建环境、通道占用、部分发布重试/integrity、CLI 无 SDK 和安装升级。源码：`scripts/build.ts`、`scripts/release/publish.ts`、`.github/workflows`、`vendor`。 |
| U23 官方账号与反馈 `f3168f2b`、`dff4dfbe`、`bd0ff9f3` | 登录无响应错误增明确反馈；问卷精简字段并把分辨率合入 device_info。 | 官方登录/商业账号部分继续排除。保留第三方 provider credentials 与本地错误提示；反馈/诊断信息只按用户授权和可替换服务接入（W30/W60/W70）。不得恢复默认 Session Log 上传。源码：`packages/client/ui-settings-account`、账号平台/desktop API。 |
| U24 日志、提示词、持久格式 | `SESSION_FORMAT_VERSION` 两端均为 4；`session-projection-cache/src/spec.ts` 本次是说明引用整理，session surface / agent-instructions 保留 producer-owned framing。核心 session 类型说明现在明确 end-seed 并非拒绝任意插件 writer。 | W10 的持久屏障、受保护追加、恢复 closers、迁移仍按既有专项落实；不能把“版本没变”解释成插件写日志安全或 SaCode W10 已闭环。测未知事件保留、禁止未授权控制事件、恢复幂等、截断/崩溃、旧格式。mods 草案持久变化撤回可由最终端点与 `f1715c67` 复核。 |
| U25 文档、测试和配套整理 | 大量 notes 归档、生成 catalog/graphs、snapshot golden 更新、fixture 等待替代固定 sleep，以及版本号滚动。StateDot 在 animationstart 重新 pin；多处 README 替代过期 notes 引用。 | W00/W80/W60 登记到证据与定向回归，不按文件数升级产品进度。不能用上游测试记录代替 SaCode 测试；每份实现变更清单都有归属，未细分路径仍保留在完整 ledger 中。 |

## 4. 两个容易高估的新能力

### Claude Code mods 不等于免费市场全面兼容

已核实际桥接和官方 `docs/subsystems/claude-code-mods.md`：

- `defineMod` 把 mod 挂成 Cordis 插件；不读取 `.claude-plugin/plugin.json` 或通用 hooks JSON。支持清单应按 API、事件和 UI 区域列出，不能按“Claude 插件”统称。
- UI 只支持 AbovePrompt band 的有限 Box/Text/Button 表达；不支持 Pane 的调用应明确拒绝。Remote action 与 generation 留在后端裁决。
- 可运行 Token Weather、Blast Radius、Replay Theater 等示例，不代表参考 diff、agents-md、sec-default、telemetry 示例全部可运行；缺事件/API 的示例需逐项解释。
- hooks 有完整 Node 权限，进程环境也共享；它不是沙箱。若 SaCode 承接，可信插件或外部执行隔离要作为明确边界。
- 工具链在已批准调用之后不得改名/改参数；需严格 once、等待底层结算和超时行为。每插件持久 store 有 4MiB 限制，内存 state / timer 生命周期独立。

因此本轮没有依据宣布“直接安装所有 Claude/VS Code/MCP 市场插件”。MCP provider、技能、Cordis 插件和 mods 是不同契约；SaCode 可统一安装展示，但实际执行兼容性必须分别登记。

### Inspector 是可选诊断，不替代用户轨迹与系统提示词功能

原始日志/DOM 诊断的新增不表示日常轨迹、系统提示词、工具目录、计划或反馈已完整接通。继续以冻结矩阵和前端验收清单核查用户入口；需要高级诊断时作为可选插件追加，不替换已有日常功能。

## 5. 兼容性、许可和范围结论

三个需要明确迁移的上游变化是 **schedule-bundle 撤销、子路径显示资源契约变化、runtime invariant 插件移除**。另有插件解析/HMR、预设 mount 所有权和结构化草稿读写契约变化；这些不能只改 UI 后判完成。

候选包增删：新增 `schedule/tool-schedule`、`experimental/{claude-code-mods,client-ui-claude-code-mods,inspector-profile,session-inspector}`；删除 `experimental/schedule-bundle` 与 `runtime-diagnostics/invariants`。新增测试 fixture 的 package.json 另算夹具。S0 模块/前端分母保持不变，新模块另列扩展，不用删旧加新使总数相同掩盖范围变化。

两端根 `LICENSE` 内容未变；`THIRD_PARTY_NOTICES.md`、生成脚本、DevTools LICENSE 和依赖锁有变化。根 MIT 不覆盖所有依赖条款：Office 的 MPL-2.0 对应源码与 notices、DevTools 新构建来源、第三方 mods 示例许可都必须在最终依赖/载荷清单复核。**未运行完整依赖许可扫描，不宣布新依赖全部可分发。**

不修改既定裁剪：官方账号、商业权益、账号绑定云服务和默认官方遥测不上线；第三方模型凭证、授权、诊断、用量继续保留。SaCode 目标暂停保持轮次边界语义。不能因为官方删除 invariant 就删除权限与持久守卫。

## 6. 建议实施顺序与收口闸

1. **先闭冻结版基线的现有缺口。** 对照 git 已提交实现和在途所有权，完成 W10 持久契约、W20 真实插件生命周期/装配、W40 统一执行管线、W50 产品跨轮入口、W60 每个页面真实行为。不能用新增实验能力挤占安装即用验收。
2. **优先吸收兼容性修复。** U02/U03/U04/U05/U06/U09/U15 是插件和输入正确性风险；每项先核 SaCode 现状，完整则补验收，缺失则定向实现。三项破坏性变更分别写迁移方案；沿用 S0 的部分不自动迁移。
3. **收口已承接主功能的 UI。** 多行编辑、工具 preparing/轨迹、列表取消、统计 dock、侧栏生命周期逐项验证；从共享核心/Host 真实数据到两个交付入口，不以控制式适配器完成代替产品完成。
4. **最后决定新增扩展。** mods / 高级 inspector 单独定范围、许可证和执行边界；浏览器扩展与 Excel 加载项不能从本次更新推导为已有。
5. **变更进入产物后才升级状态。** 记录源码 SHA、候选上游 SHA、构建时间、CLI/安装包载荷摘要；完成定向正反测试、真实模型、打包态、无 SDK、安装/升级/卸载/数据保留。完成证据独立追加。

下次发现 HEAD 更新，应先做“本次观察 HEAD → 新 HEAD”的增量，再维护“S0 → 候选 HEAD”的累计差异。观察时间、分析完成时间、实施提交和实际验收分别记录；**本报告不升级 S0，不改变能力完成标记，不开启自动监控。**

## 7. 本轮验证与可复查方式

清单 JSON 记录完整 SHA、父提交、提交日期、第一父变动路径、来源 URL、主题、状态与实现状态；文件 JSON 记录 base/head blob SHA、路径分类、文本 diff SHA-256（notes 与二进制除外）、版本单改标记。分类规则是清单导航工具，不是逐文件运行证明。

复查命令（针对独立官方 Git 副本）：

```text
git rev-list --count 639ed015397290b3745d163aafe02ffee4aa3f84..5badb15009ae1756c3afe0ae0cef1faafc290ccc
git diff --name-status --no-renames 639ed015397290b3745d163aafe02ffee4aa3f84 5badb15009ae1756c3afe0ae0cef1faafc290ccc
```

本次官方源码/原始 API 缓存放在仓库外 `D:/Temp/SaCode-upstream-full-audit-20261006/`，不依赖该临时目录才能阅读报告或查询来源。提交只包含本报告、两份清单和冻结记录追加，不纳入共享树其他成员的源码、暂存文件或测试状态。
