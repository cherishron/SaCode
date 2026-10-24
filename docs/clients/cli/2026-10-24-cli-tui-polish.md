# 2026-10-24 TUI 四方向细节打磨（候选待验）

## 本轮范围

用户确认同时推进代码/Markdown、输入编辑、审批工具卡、视觉留白。只修改 TUI 源码/测试/构建及 npm 主包许可清单，未改 Host/core/桌面或用户模型设置；未发起收费请求、安装新依赖、提交/推送/发布。继续 Gemini CLI 交互骨架，不重新换设计方向。

## 已落地的行为

1. **代码与 Markdown**：JS/TS/Python/Bash/JSON/CJ 常见 token 轻量着色，无语言/未知语言安全回退；连续码点分词确保中文、emoji、数字后缀不丢。修复无语言时 `resolved.split` 异常风险、引用块漏导入 `displayText`、文件名下划线误解析、不完整标记误删；链接保留实际目标。标题层级、缩进列表、斜体/删除线、引用、流式未闭合围栏和 `c++` 围栏标记可读。表格按字格判宽，空间够时成列，长单元格回退记录，不截断。
2. **编辑**：Ctrl+W 词删除、Ctrl+左右词移动（空白分词）；Ctrl+Z/Y 撤销重做50步。`set` 是撤销边界，发送/清空/换历史/配置字段不复活旧内容；新编辑清 redo，空删除不占栈。Ctrl+R 检索本进程当前会话输入历史，最近优先/去重；Enter或Tab仅回填，Esc恢复草稿，未隐式发送。
3. **工具与审批**：JSON结果格式化，历史卡截取预览并指向 `/tools`；只有详情页有焦点时 `e` 展开/收起全部结果，超过40行不再假“展开”。普通 `+/-` 列表不猜diff，要求文件头和hunk。审批对 edit 的 old/new 片段、write 的 content 或 command 只作请求预览，明确非磁盘真实diff/非执行结果；默认拒绝、y/n工单协议不变，搜索键不能抢审批焦点。
4. **视觉**：角色强调、消息间距收紧到单侧留白；流式正文用文字提示，不伪造进度；窄屏审批省略次要预览保留工单/决策/取消提示。80×24与48×18合成视口复核，不宣称任意终端/字体均通过。

## 许可打包补缺

此前源码中存有Apache全文，但 `pack-tui` 和npm `files`未将其带入产物。本批构建从Rollup**实际输出且renderedLength>0**的模块收集37个内联包根级许可证/NOTICE，并带Google Apache-2.0、来源和修改说明，输出到 `tui/third-party/`；当前npm dry-run共46文件，必需许可路径已核。

构建门禁首次发现 `yoga-layout@3.2.1` 与 `@alcalzone/ansi-tokenize@0.1.3` 包缺许可文件：

- Yoga补同版本 [v3.2.1/LICENSE](https://github.com/facebook/yoga/blob/v3.2.1/LICENSE)。
- ansi-tokenize固定源码 `d9313397…` 和npm元数据均声明MIT，但固定树无LICENSE；补带同作者后续提交 `5da59bc5ac94972bdc92ba8fea34ff6ea1653a0c` 的 [MIT原文](https://github.com/AlCalzone/ansi-tokenize/blob/5da59bc5ac94972bdc92ba8fea34ff6ea1653a0c/LICENSE)，在本地说明中明确不是0.1.3压缩包原文件，保留版权年份，不伪称同版本提取。
- 未知缺许可文件仍阻断构建，不盲套通用模板。此经验记录在本证据，未在仓库根新建游离学习目录。

## 实跑验证

- Windows，Node v22.23.2；显式开发态 Host `apps/desktop/dist/host/bin/sacode-host.exe`，SHA256 `052917f95f2d6f966aa94a941b988d07f1081d50c1c0b8d44dc008297f4fb4ea`。不冒充当前桌面同源候选。
- `npm test`：**52 tests / 52 pass / 0 fail / 0 skip**，约8.97秒。含既有2条真实Host只读引导/消息投影/会话目录冷重开；**没有新增真实配置保存验收或模型请求**，之前骨架文档把这2条称“配置冷重开”不准确。
- 新增16条相对上批36条，覆盖代码原文保真、缺失语言/控制码、引用/围栏/表后标题、链接目标/文件下划线、词删除/撤销边界、搜索回填、工具全部展开、默认拒绝及窄屏/表格。部分初始失败来自刚写入未接完整的代码，已定向修复后全量回归。
- `node scripts/pack-tui.mjs` rc=0，自足校验通过；新包 **511,622 B**，SHA256 `2b2584245c754de883be2c767238b4146d2628df82e206b800abed8516bbb99d`，dist与npm主包目录逐字相同。
- 30个TUI `.mjs`的 `node --check` 通过；项目无lint/typecheck脚本，不冒充已执行。受影响构建脚本与主包JSON亦做语法/解析检查。
- 伪TTY+开发Host `/help`→Ctrl+D rc=0；`npm pack --dry-run --json` rc=0，清单46文件，含Google Apache全文/README、37包许可目录和manifest。
- 10份合成文本帧：80×24/48×18的历史、全屏、菜单、审批和两个新鲜全屏审批帧；后两者帧高≤终端行数，避免Ink Static在debug中混入已打印历史而误判。
- 原始日志/帧/打包清单：`target/tmp/tui-polish-final-20261024-df93a333/{tests.log,frames.json,smoke.log,npm-pack.json}`；取样驱动 `apps/cli/tui/test/support/polish-frames.mjs` 可复用。

## 未验与限制

当前代码高亮是逐行轻量规则，不是完整语言词法器；Markdown非完整CommonMark，未保证复杂嵌套/转义管道表格。无Home/End、词级语义分词、持久输入历史、动画系统。静态历史工具通过 `/tools` 看完整结果，不对已打印历史作原地展开。**没有实际磁盘diff能力新增**，只展示已有结果和明确标注的请求预览。

真实Windows Terminal/其他平台配色与CJK字宽、真实模型审批/落盘/差异/恢复、新包安装及主包+平台包组合仍待验。配置表单既有三步保存未知态等不在本批宣称闭合。未改变唯一桌面候选/主阻塞，不升级任何F域为完成。
