# 目标栏视觉对齐（2026-10-12）

用户要求继续产品页面与认可原型的对齐。本批仅修改 goal-bar.ts、goal-bar.css、goal-bar.test.mjs；不改共享 app.js、frame.css、product-design.css、Host 或核心，不覆盖其他会话在途改动。

目标正文进入行首，状态、轮数与明确命名的运行时长随后显示，暂停/继续、编辑、删除保留为行尾图标。正文默认单行省略，通过按钮展开完整正文；运行时长仍来自 Host，不自行推算执行事实。未接通自动驱动的原有提示保留，不因视觉对齐宣称业务闭环。

验证：node --test test/goal-bar.test.mjs test/inline-editor-render.test.mjs，8/8 通过，无跳过、取消或失败，实际退出码 0。包含真实 Electron 的共享编辑器/CSP 夹具，以及正文展开、迟到回执、CAS 和卸载保护。夹具不是正式 Host 产品入口，不能替代正式桌面全页、窄窗和亮暗主题的视觉验收。本批尚未重建安装包，尚未提交。

剩余：正式页面资源重建后的截图检查、目标栏窄窗几何与亮暗主题；队列拖拽排序需真实 Host 排序契约；知识库、自动化、扩展、连接及右侧资源页面仍需逐页核对。不得将本批 8 项通过记为全部页面对齐完成。

## 续轮几何与资源入口

真实 Electron 夹具按正式顺序同时加载 goal-bar.css 与 product-design.css，增加 720px/320px 列宽下图标同行、不越界、删除按钮靠右、长正文省略及展开/收起断言。全部 22 个内部检查通过，合并目标单测仍为 8/8、退出码 0。修正产品窄窗规则导致目标栏换行的覆盖关系；亮暗主题尚未完成截图验收。

右侧资源默认标签改为文件结构与保存前差异；app.js 仅将初始 sideTab 从 inspect 改为 files，保留文件已有其他会话的差异。待接入资源分别使用测试、安全盾牌、部署、记忆、连接、来源与产物图标；没有解除 available=false 或模拟业务结果。该轮另修改 workbench-tabs.ts 与 inline-editor-render.test.mjs，未生成正式页面载荷或安装包。

## 亮暗主题取证

Electron nativeTheme 分别设置 light/dark，按 720px/320px 生成四张截图及 visual-proof.json。最终目录为 `apps/desktop/.tmp-test/inline-editor/run-oZDcV4/`。背景实测分别为 rgb(250,249,246) 与 rgb(37,38,34)。人工查看窄栏亮色与宽栏暗色截图，发现窄栏长指标挤占正文，已改为紧凑分秒时长，悬浮 title 保留完整轮数与秒数；再次查看最终窄栏截图确认正文空间改善，操作图标保持同行。重跑 8/8、退出码 0。

本夹具使用 --no-sandbox、offscreen 和独立 user-data，主题与几何证据仅适用于组件，不证明默认沙箱启动、正式 Host 请求或整页完成。未修改正式用户数据，未覆盖 vendor/dist，未提交或推送本批。

## 工作台键盘导航

资源选择列表支持上下方向键循环及 Home/End；搜索输入保留自身 Home/End 光标行为，禁用资源不进入可聚焦候选。关闭当前标签按剩余相邻标签选择，关闭最后一个标签将焦点返回添加按钮，关闭标签安排的聚焦在组件卸载后失效。新增 workbench-navigation.test.mjs 驱动实际编译组件，与 side-panels、team-panel-entry 合跑 16/16、实际退出码 0，无跳过、取消或失败。此为组件及接线回归，尚未完成工作台整页截图与真实 Host 验收。

定向核对 settings-state.js 已存在九类设置（通用、外观、对话与输入、模型中心、内置插件、快捷键、隐私与数据、个人资料、关于），本轮不重复重写共享设置文件。各设置持久化、未接入功能和窄窗状态仍按实际入口分别验收。

## 正式页面私有快照验收

复制当前桌面源码及既有 Host 到 `.tmp-test/page-alignment-co2n8tkf/`，页面输入 SHA256 登记于 source-hashes.json；通过私有 scripts/pack-pages.mjs 重建十二项页面及客户端槽位，CSP 与单一 Vue runtime 构建守卫通过，没有覆盖公共 vendor/dist。测试脚本随后作定向修订，原始清单不冒充修订后测试脚本哈希。

正式 preload、IPC、页面与真实 Host 联跑 product-design-smoke.cjs。依次纠正三类过期断言：预算检查范围由整个文档改为 conversation-center（右侧工具预算仍保留）；默认标签由 inspect 更新为 diff；对话设置新增 tips 后为四项、权限菜单已有回读重试按钮，不再把全部按钮误数为四个模式或要求所有模式永久禁用。权限断言仍检查四个实际模式及核心审批边界提示。

最终 proof-v5：PRODUCT_DESIGN_PASS 72 checks，Electron 实际 code=0、signal=null，完整 stdout/stderr 保存在 probe-v5-exit.json。截图位于快照 `apps/desktop/proof-v5/`。检查覆盖真实设置回读、工作区文件搜索/读取/编辑、Git 只读、终端既有日志回放，以及布局、菜单、聚焦恢复。失败历史 probe-exit/probe-v2/v3/v4-exit.json 保留。

边界：使用既有 Host 二进制，不证明当前核心与 Host 源码统一重建；profile/get 返回 -32601，个人资料真实读取尚未验收通过。缺文件及工作区切换引起的错误属于相应失败/并发场景，不吞成成功。启动使用 --no-sandbox，仅验证私有页面快照，不宣称默认沙箱交付完成。知识库、自动化、连接与未装配资源页面未由这 72 项全部覆盖，仍需实施和验收。

## 下拉箭头修正

用户指出选择下拉箭头不正确。模型与项目按钮原使用字体字符 ⌄，改为固定 14px SVG 折线，权限触发按钮同尺寸；展开态箭头向上。原生单选 select 保留浏览器键盘/选项行为，去除系统箭头，使用 renderer/assets/select-chevron.svg 统一右侧居中图标并预留 32px 文字空间，不改变多选或 size 列表控件。

私有快照重新编译，新增实际 DOM SVG 及设置 select computedStyle（appearance、backgroundImage、paddingRight）断言；最终 PRODUCT_DESIGN_PASS 74 checks，实际退出码 0。截图为 proof-arrows-v2/light-1384.png 等，已查看正式空会话截图确认模型与项目箭头固定几何。日志 probe-arrows-v2-exit.json 保留既有 Host profile/get 未接的限制；本批不是新安装包或全部下拉页面穷尽验收。

## 顶部布局及模型设置复验

左侧标识/收缩入口与会话标题并入 42px 标题栏，标题右侧留 150px 给 Electron 原生窗口按钮；不新增窗口控制 IPC。首页标语替换为「让灵感，有迹可循。」。模型选项和插件卡片的字符箭头改为 14px SVG，展开时旋转。

真实产品冒烟增加原生窗口 maximize/unmaximize 状态及最大化后标题边界判据：81 项通过，退出码 0。源码为工作区快照，使用既有 Host，不代表当前 Host 源码冷编或安装态通过。证据目录：apps/desktop/.tmp-test/page-alignment-co2n8tkf/apps/desktop/proof-window-state；原始退出记录 window-state-exit.json。原生按钮的鼠标点击、拖动及多显示器 DPI 仍未实测。

模型页面真实 Electron 渲染、设置状态、渲染语法及 el 参数形状合跑 13/13。模型校验/模型中心测试 19/19。模型校验测试构建本地依赖并 external Vue，输出改在独占 .tmp-test 目录，避免旧 dist 转译模块引用失败。
