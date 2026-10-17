# SaCode 阶段 1–3 独立复核证据

日期：2026-10-07（第二轮独立复核）
基线：固定提交 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，分支 `refactor/dsh-learning`，验证对象为含在途改动的工作区。
复核性质：**独立复核（读为主）**。只重跑可复现命令、只新增本证据文件；不修改实现源码、不替换主入口、不提交、不推送。
复核角色：与产出方分离的复核者；本文件不代表任何 F01–F20 业务接通或安装包验收。

## 0. 并发写入声明（复核有效性的前提）

复核期间检测到**另一个会话（Codex 运行时，进程 2026-10-07 23:30 启动）正在同时修改本批产物**，实测证据：

| 时间 | 观测 |
| --- | --- |
| 23:44 → 23:49 | `apps/desktop/prototype/prototype.js` 被改（新增待办/会话树置顶重命名归档/执行详情拆分） |
| 23:47 | `apps/desktop/prototype/smoke.cjs` 被改（新增 30 项断言） |
| 23:51 | `docs/plans/sacode-product-traceability-2026-10-07.md` 被追加「第二轮复核登记」 |
| 23:52 | `docs/evidence/sacode-prototype-ui-qa-2026-10-07.md` 被追加复核状态注记 |
| 23:53 | `docs/evidence/sacode-product-first-batch-2026-10-07.md` 被追加第二轮小节 |
| 23:54 / 23:55 | `apps/desktop/prototype/evidence/checks.json`、`README.md` 被重写 |

**结论与边界**：本复核是**在移动工作区上的快照复核**，不是对冻结版本的稳定复现。为避免互相覆盖，本文件不改动上表任何主文档正文；仅补一处并发会话明确遗漏的陈旧读数（见 §5）。阶段 3 的「稳定通过」需在冻结（提交）版本上再复跑确认。

## 1. 复核方法

- 构建：`node apps/desktop/prototype/build.mjs`。
- 反证：对构建产物 `vendor/kit.js`、`vendor/vue.js` 用正则反查 `eval(` / `new Function(` / `import(`。
- 真实渲染：以指定已核 Electron 运行时 `D:/Temp/SaCode-window-test-runtime-20261006/SaCode.exe` 跑 `node apps/desktop/prototype/verify.mjs`，证据重定向到私有目录 `D:/Temp/sacode-prototype-review-*`，避免污染仓库 `evidence/` 与对方产物。
- 静态核对：统计两份设计文档的 F 行号完整性；读取 CSP 元标签；解析 `checks.json` 统计与维度分布。

## 2. 阶段 1 出口：F01–F20 基线需求映射

**判定：静态覆盖 PASS（设计交付，非业务验收）。**

- `docs/plans/sacode-product-traceability-2026-10-07.md` 含 **F01–F20 共 20 行、无缺号、无重号**（`^\| F[0-9]{2} \|` 命中 20）。
- 每行含：用户动作、核心候选（`core/src`）、Host 契约/接线、桌面消费端与测试候选、裁决与下一步、主责/依赖、验收出口/状态。缺口与「待核」显式保留。
- 阶段 1 出口条件（「无遗漏需求表、缺口/主责/验收齐全」）成立；未核项按原文保持「待核」，本轮不升级。
- 新增未核线索（工作区已出现、需按新文件复验后再更新候选）：`core/src/goal_claim.cj`、`core/src/goal_evidence.cj`（F04）、`core/src/git_workbench.cj`（F08）、`core/src/terminal_view.cj`（F09）。

## 3. 阶段 2 出口：架构与接口设计

**判定：设计交付 PASS（拟议接口，未实现；本轮未改动，仅静态读核）。**

- `docs/plans/sacode-product-interfaces-2026-10-07.md` 含 **F01–F20 共 20 行**（无缺号），并覆盖所需四个面向：
  - **状态**：§1 对象状态机表（会话/轮次/工具、草稿、队列、目标、计划、待办、文件/Git、模型计量、标签布局）。
  - **权威源**：§1 明确「核心定义业务类型/状态机/授权/取消/版本裁决/持久屏障；Host 做 RPC/进程/平台适配；CLI 直接调用同一业务服务；渲染层只存编辑缓冲/焦点/布局」。
  - **双入口契约**：§3 双入口动作表（Host 面 / CLI 动作 / 输入→输出/权限/持久化/首要用例），并声明新增动词不在 `initialize` 冒报。
  - **授权与恢复**：§2 失败语义（具名 reason 集、取消两层、持久屏障失败保留待核、outcome-unknown 不自动重试）；§5 外部解锁与验收。
- `docs/plans/sacode-execution-contract-2026-10-07.md` 作为 F02/F09 增量：§2 不可变执行提案与身份、§3 提案/运行/输出状态与完成判据、§4 取消停止、§5 持久与恢复屏障、§6 拟议 RPC/CLI。均标注「拟议、未实现、不加入可执行按钮」。

## 4. 阶段 3 出口：独立交互原型

**判定：条件 PASS。** 亮/暗/窄窗与键盘/竞态检查齐备、连续复跑通过；但工作区为移动目标，且有约 1/5 的抖动，稳定通过需在冻结版本再确认。

### 4.1 构建与反证（本轮实测）

| 项 | 结果 |
| --- | --- |
| `node apps/desktop/prototype/build.mjs` | `PROTOTYPE_BUILD_PASS Vue runtime + OpenTiny + SlotCore；无运行时 npm`，rc=0 |
| 产物反证 | `vendor/kit.js`、`vendor/vue.js` 中 `eval(` / `new Function(` / `import(` 命中数均为 **0** |
| CSP | `index.html` 元标签：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'` |

### 4.2 真实 Electron 复跑（本轮独立）

指定运行时连续复跑 5 次（证据分别落在 `D:/Temp/sacode-prototype-review-20261007`、`...-b`、`...-r3/r4/r5`）：

| 次序 | 结果 |
| --- | --- |
| 第 1 次 | `PROTOTYPE_FAIL 归档会话移出项目树`，`ELECTRON_RC=1`，rc=1 |
| 第 2–5 次 | `PROTOTYPE_PASS 602 checks / 0 failed`，`ELECTRON_RC=0`，rc=0 |

第 1 次失败发生在并发会话修改 `smoke.cjs` / `prototype.js`（23:47–23:49）的窗口内；其根因（归档分组内「取消归档 <会话名>」按钮文本含会话名导致全文包含判断失真）已由该会话当轮修复，修复后连续 4 次 602/0。**该抖动本身是复核发现：阶段 3 的通过判定依赖工作区版本一致性。**

### 4.3 检查维度覆盖（解析本轮 `checks.json`）

| 维度 | 代表检查项（本轮实测存在且通过） |
| --- | --- |
| 亮/暗 | `设置消费深色主题`；`initial-light.png`、`initial-dark.png`、`light.png`、`dark.png` |
| 窄窗 | `窄窗无水平溢出且折叠导航`、`窄窗工作台可切换`、`窄窗可恢复项目导航` |
| 键盘/焦点 | `键盘聚焦显示上下文详情`、`键盘选择命令仅填入草稿`、`队列支持键盘排序`、`弹层键盘焦点闭合`、`Escape 关闭并归还焦点`、`CtrlEnter配置发送且提示同步` |
| 竞态 | `改回同文拒绝迟到增强`（增强撤销栈 token/sid/rev 三重匹配） |

### 4.4 截图独立目视（AI 辅助判读）

对本轮独立重生成的 `light.png` / `dark.png` / `narrow.png` 做一次 AI 辅助判读（非人工最终验收）：

- **亮色宽窗**：三栏完整；待办、目标条、计划/执行详情分离可见；无溢出或截断。
- **深色宽窗**：结构一致；次要文字（待核标签、占位符）对比偏低——与既有 QA 报告的对比度项方向一致，列为待打磨，不阻断。
- **窄窗**：左侧导航与右栏折叠，无水平溢出；仅见一处助手消息顶部文字被裁切，**疑似截图滚动位而非布局溢出**（`窄窗无水平溢出且折叠导航` 断言为通过），不作为阻断项。

## 5. 陈旧记录修正

按「只补并发会话明确遗漏、不动主文档正文」的口径执行：

| 位置 | 旧值 | 处置 |
| --- | --- | --- |
| `apps/desktop/prototype/README.md`（设置小节验证行） | `PROTOTYPE_PASS 572 checks / 0 failed`（未随 602 更新） | **本轮修正为**：标注该轮读数，并补「第二轮补齐后现行 `602 checks / 0 failed`」 |
| `docs/evidence/sacode-prototype-ui-qa-2026-10-07.md` 第 30、101 行 | `139 checks` | 主文档正文由并发会话负责；其第 11 行已加复核状态注记说明 139 为历史版本，保留 |
| `docs/evidence/sacode-product-first-batch-2026-10-07.md` 第 18/42/56 行 | `139 / 173 / 360 checks` | 属各轮历史读数，文档已按轮次分节递增，保留 |
| `docs/plans/sacode-product-traceability-2026-10-07.md` P3 状态 | 原 `139 checks` | 并发会话已改为 `602 checks`，本复核不重复改动 |

## 6. 三阶段出口条件确认

| 阶段 | 出口条件（PRD §10 / 计划口径） | 本轮独立判定 | 边界 |
| --- | --- | --- | --- |
| 阶段 1 需求映射 | F01–F20 无遗漏，含缺口/主责/验收 | **PASS（静态）** | 未核项保持待核；不换算完成率 |
| 阶段 2 接口设计 | 状态/权威源/双入口契约/授权与恢复 | **PASS（设计交付）** | 全部为拟议接口，未实现、不在 `initialize` 冒报 |
| 阶段 3 独立原型 | 亮暗/窄窗/键盘/竞态可操作，含截图与检查记录，模拟数据明示 | **条件 PASS** | 工作区移动；首跑抖动 1/5；需冻结版本再复跑确认 |

## 7. 阶段 4–6 依赖与解锁（本轮不推进）

阶段 4–6 对应 PRD §10 的 S2/S3/S4 与追踪表 P4/P5/P6；**在外部能力探针与逐次授权可用前按依赖推进**，本轮不做任何实施或验收声明：

| 阶段 | 覆盖 | 前置依赖（探针/授权） | 解锁出口 |
| --- | --- | --- | --- |
| 阶段 4 主闭环 | F02–F09、F18 与权限持久化 | 真实模型/提供方、工具执行授权链、持久屏障与恢复（执行契约 §5） | 真实模型与工具完成改码/验证/队列/目标/压缩/审查链路 |
| 阶段 5 集成 | F10–F17、F19，补齐其余设置 | ACP（OpenCode/CodeBuddy/Qoder）握手/发现/认证/取消探针；ASR 真实工具链；数据库三方言；浏览器/电脑目标身份；SSH 主机指纹 | 各 provider 真实副作用、取消与失败恢复 |
| 阶段 6 平台与发布 | F20 与全域适用入口 | Windows/Linux/鸿蒙进程/PTY/凭据/图形/打包探针；逐次发布授权 | 双入口、三平台产物与干净环境 |

未支持项一律标 BLOCKED 并写明解锁条件，不以缩范围或放宽授权凑通过（对齐执行契约 §8）。

## 8. 复核边界

- 本轮**未编译**核心与 Host，**未运行**其测试；工作区中 `core/src/{agent,approval,goal_runner,model_agent,model_tool_runtime,shlex,goal_evidence}.cj` 与 `apps/host/src/main.cj` 的在途改动未经复核。
- 原型为模拟数据，不连 Host、不读凭据、不跑真实动作；原型通过**不更新任何 F01–F20 业务状态**。
- 未构建安装包、未提交、未推送、未发布。
- 本复核在并发会话同时写入的移动工作区上完成，结论以文中时间点为准。