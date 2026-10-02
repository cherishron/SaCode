# MonkeyCode · 高保真 Web 原型规划 (Plan v1)

> 单一自包含 HTML 文件,从 `assets/template.html` seed 派生。
> 目标:让"产品评估者"一眼读懂 MonkeyCode 是谁、能做什么,以及主对话控制台的真实使用手感。

---

## 1. 一句话定位

MonkeyCode 是一款面向独立开发者的 AI 编码助手(类 Cursor / Windsurf),以"小猴子 + 圆润元素"的俏皮形象承载"暗色 + 等宽字体 + 数据感"的硬核工程气质,把对话控制台、知识库、自动化、内置浏览器合并到同一个工作台里。

---

## 2. 目标用户与核心场景

- **核心受众**:产品评估者(潜在技术决策者、有经验的开发者、技术作者) — 看到主屏既要看品牌,也要看工程完成度。
- **必呈现场景**:
  1. 主对话控制台:任务下发、流式输出、工具调用回显、上下文文件;
  2. 知识库管理:索引源、检索片段、版本;
  3. 自动化工作流:定时任务、钩子、运行历史;
  4. 内置浏览器:在 IDE 内查看文档/issue 并把片段附给对话。

---

## 3. 视觉与设计系统决策

| 维度 | 决策 |
| --- | --- |
| 调性 | 双轨:俏皮(圆润、SVG 小猴子 logo、萌系微动效)+ 科技(等宽数据、终端留白、SaCode 蓝克制强调) |
| 主色调 | 默认浅色 `#f5f7fb`(页) / `#ffffff`(容器),深色 `#0f1115`(页) / `#171a21`(容器) / `#1e222b`(raised),与 SaCode v0.1 §3.2/§3.3 对齐 |
| 强调色 | `--accent` SaCode 蓝 `#366CFF`(`--td-brand-color-7`),hover `#5b87ff`,active `#2457f5`;**全屏 accent 预算 ≤ 2 处**(logo / 主 CTA) |
| 猴子专属色 | `#f5c542` 香蕉黄**仅出现一次**,绑定到标题栏"小猴子捧香蕉"SVG,作为品牌资产;绝不进按钮、不进状态、不进文字 |
| 字体 | Display / UI = Inter(思源黑体兜底);**Mono = JetBrains Mono**,用于代码、终端、token、状态栏数据、时间戳 |
| 装饰 | 一个明确的小猴子 SVG 角色(标题栏 logo 位)+ 对话流里的 streaming 光标 — 共两个装饰。 |
| 反 slop | 不用紫色渐变、emoji 当功能图标、纯 outline 图表;不用 Inter/Roboto/Arial 做 display;不用暖米色底 |

具体配色(SaCode v0.1 §3 双主题令牌,精简到 seed 的六个 :root):
浅色:`--bg #f5f7fb` · `--surface #ffffff` · `--fg #1a1f29` · `--muted #8a91a0` · `--border #e2e6ee` · `--accent #366CFF`
深色:`--bg #0f1115` · `--surface #1e222b` · `--fg #eef1f6` · `--muted #7a8294` · `--border #2a2f3a` · `--accent #5b87ff`
猴子黄 `--mascot #f5c542` 独立变量,仅 logo SVG `fill` / `stroke` 引用。

---

## 4. 单页结构(主屏 + 三大副区整合)

由于这是**产品评估者看到的产品截图**,不是营销落地页,不再走 seed 默认的 "hero → features → stats → CTA" 节奏。我会保留 seed 的 `:root` token、`.container`、`.stack`、`.grid-*`、`.btn`、`.card`、`.eyebrow`、`.num`、`.pill`、`ds-table` 等可复用 class,但**新增应用专属类**(`app-shell`、`pane-*`、`chat-*`、`terminal-*`、`flow-node`、`browser-tab`),让一屏就能呈现完整 IDE 形态。**主题默认浅色**(`#f5f7fb` 页底),SaCode 蓝 `#366CFF` 主导;小猴子 logo 用 `#f5c542` 香蕉黄作为品牌资产,仅出现一次。

### 4.1 顶层外壳 (`.app-shell`)
三栏 grid:`[侧边栏 240px] · [中央对话 1fr] · [右栏 320px(上下文/工具面板,可切换)]`。
- 顶栏(`.topbar`):左侧 MonkeyCode 标志 + 项目切换;中部任务栏(命令面板/分支);右侧搜索、通知、头像。
- 状态条(`.statusbar`):底部 mono 字体的连接状态、当前模型、token 计数、快捷键提示。

### 4.2 左栏(`.pane-files`):工作区导航
- 项目列表(以"monkeycode-saas-starter"为主)
- 文件树(`tree-row` 行,有 mono 路径名 + 状态点:● modified, + M+· added)
- 折叠的"自动化 / 知识库 / 浏览器"分组入口(直接放进侧栏底部,不让用户多翻一屏)
- 底部用量卡片:本月 token、剩余配额(强 mono 数据感)

### 4.3 中央(`.pane-chat`):对话主控台 — 整张原型的视觉重心
内容顺序(自上而下):
1. **任务/线程切换条**:三个会话 tab(Monkey 正在跑的事 / 评审线程 / 一次性问答),激活态用 `--accent` 下划线 + 小猴子头像。
2. **对话历史**:
   - 用户消息卡片(浅灰底,含附带的文件 chip `lib/auth.ts` `tests/auth.spec.ts`);
   - 助手消息(markdown 渲染):
     - 思维链短句(灰色,折叠可展);
     - 工具调用序列(`tool-call` 行:带工具图标 + mono 摘要 + 耗时,例如 "🔧 read_file · src/server.ts · 42ms" / "✏️ edit_file · src/server.ts · 87ms");
     - 代码 diff 块(等宽 + 行号 + 红绿着色;review 视图,可勾选/回滚);
     - **streaming 占位**:一个正在"打字中"的助手消息尾巴,显示"Monkey 正在写… `[cursor]`" 加上一道黄色下划线光标。
   - 内嵌终端日志块(深底 mono,像复制 `npm test` 输出)。
3. **任务下发输入框**(`composer`):
   - 大输入区(multi-line,`@` 唤起文件 / `/` 唤起命令 / `#` 选知识库片段);
   - 模型选择(`Sonic` 默认 + `Sage` 思考型 / `Echo` 轻量);
   - 上下文徽章(已附文件、知识库命中、浏览器标签数);
   - 主操作按钮:**运行任务(`Run task`)** —— 整页唯一 primary 实心按钮;
   - 次级:`Cmd+K` 触发提示词片段、`附件`图标。

### 4.4 右栏(`.pane-context`):上下文面板 — tabs 切换
三个 tab:
- **Files**:当前任务涉及的文件列表(每行有 git 状态点 + 最后改动时间 mono);
- **Knowledge**:命中的知识库片段,显示来源 + 相似度(0.92);
- **Tools**:工具调用流水(每条记录:工具名 / 输入摘要 / 输出字节 / 状态徽章),实时滚动。

### 4.5 底部/弹层补充
- **命令面板弹层**(`.cmd-palette`):以 mono 行展示所有快捷动作,在最后做一个截图式 hover 状态。
- **小猴子吉祥物浮窗**(`mascot-badge`):右下角固定小头像 + 当前心情("修了一晚上的 bug · 写下一行代码…")。

### 4.6 三大副区如何"出现在主屏里"
按表单要求覆盖知识库 / 自动化 / 内置浏览器,直接以**屏内分区或弹出层**形式呈现:
- **知识库**:`pane-context` 的 Knowledge tab + 中央对话里 # 触发的检索结果;
- **自动化**:左栏底部 "Automations" 分组入口 + 中央对话中可演示"每晚 02:00 跑一次回归"的工作流节点;
- **内置浏览器**:右栏工具调用流水展示 `browser.open` + `browser.scrape` + `browser.snapshot`,并在状态栏给出"Browser: connected · 2 tabs"。

---

## 5. 关键交互状态(成片里能看到)

| 元素 | 状态 | 设计 |
| --- | --- | --- |
| 主 CTA `Run task` | 默认 / hover / running | hover 时 background 下沉 ±0.08 亮度 + 边框黄;running 状态变成等宽 "● Running · 00:14s" 不可点击 |
| 助手消息 | idle / streaming | streaming 时尾部追加黄色光标 + 三个呼吸点 + 渐变进度条 |
| 文件树行 | 默认 / hover / modified / selected | 默认 0 边;hover 背景 `--fg-soft`;selected 左侧 2px 黄 line、底色 `--accent-soft` |
| Tab 切换 | active / hover | active 下划线黄;hover 文字提亮;其他栏不变色 |
| 命令面板 | 默认 / hover / 当前选中 | 当前选中行:左侧 2px 黄 + 浅黄背景 |

---

## 6. 文案与示例数据(让"对话流"像真的)

为了让屏内对话流避免变成"测试 placeholder",我会注入以下真实化的示例片段(基于一个虚构的开源任务):

- 用户:> 给 `src/server.ts` 的 `/checkout` 接口加上请求签名校验,要求:…… (附 2 个文件)
- 助手:
  - 思维:我先扫一下路由,然后定位校验位置。
  - 工具调用序列:`read_file src/server.ts` · `read_file src/middleware/auth.ts` · `edit_file src/server.ts`(`+24 / -6`)
  - diff:红绿高亮 patch
  - 内嵌终端输出:`npm test -- checkout` → `2 passed, 0 failed`
  - 等待用户:跑通了,要我提交一个 PR 吗? `[Y / 修改]`
- 状态栏:`Model: Sonic · tokens 1,284 / 16k · browser: 2 tabs · 16:42`

---

## 7. 真实版 MonkeyCode 设计语言参考(已核实 · 已应用 SaCode 品牌)

来自 `assets/reference-monkeycode-console.jpg`(已落盘项目根 `assets/`),与公开资料交叉验证:

- **真实品牌**:左上 `MonkeyCode / 长亭百智云`,logo 是**猴子捧香蕉**的拟人 SVG,黄色 `#f5c542` 系;
- **真实版式**:**左侧 240px 左右的项目/任务侧栏 + 顶部高 56px 的面包屑 + 中央对话居中标题 + 大块输入面板**,并非传统 IDE 三栏。这是产品评估者第一眼会认出的"官方版";
- **真实主色**:**浅色为主**(白底 + 灰底),不是原计划的暗色;状态条用 `免费大模型 / 16.2%` 进度条 + `积分余额 chip`;
- **真实文案**:"启动任务 / 历史任务 / 添加项目 / 技术交流群 / 配置" 是侧栏真实条目;
- **真实交互**:运行按钮带"飞行"图标 + 实心品牌色,徽章为浅胶囊(`开发 / 代码 / 4 个技能`),底部用户信息卡片显示当前套餐 + 积分余额。

### 本轮决策:绑定 SaCode v0.1 品牌(已锁定)

本原型作为 **SaCode 桌面端 v0.1 的高保真评估稿**,复用 MonkeyCode 真实版的版式骨架与侧栏条目,**视觉主导改用 SaCode 品牌色系**;小猴子 logo 仍作为 MonkeyCode 品牌资产保留,但颜色限定到 logo SVG 内部,绝不入侵主 CTA / 状态 / 文本。

| 原计划 | 修正为(SaCode v0.1 §3 绑定) | 理由 |
| --- | --- | --- |
| 暗色 `#0f1115` 为主屏默认 | **浅色 `#f5f7fb` 为主屏默认,深色 `#0f1115` 作为切换的副主题**(v0.1 §5 三态:跟随系统 / 浅 / 深) | 与 SaCode v0.1 一致;评估者一眼认品牌 |
| 三栏 IDE 形态 | **左栏 + 中央对话 + 右栏可折叠**(中央对话与官网一致居中、有大标题) | 不照搬通用 IDE 形态 |
| 橙红 `#e85d2c` 主 accent | **SaCode 蓝 `#366CFF`(`--td-brand-color-7`)+ hover `#5b87ff` + active `#2457f5`**(v0.1 §3.1) | SaCode 品牌前置决策 D1/D2 锁定 `#366CFF`;废弃橙红 |
| 香蕉黄 `#f5c542` 强调色 | **`#f5c542` 退到 logo / 小猴子专属色**,通过 `--mascot` 独立令牌,仅在标题栏 logo SVG 出现一次 | accent 不被抢戏;小猴子资产仍受尊重 |
| 字体全套 monospace | Display / UI = Inter(思源黑体兜底);**Mono = JetBrains Mono**,仅用于代码区、状态栏、token 数、时间戳 | 全 monospace 会破坏评估者认知匹配 |
| "小猴子 emoji 头像" 唯一装饰 | **保留官网 logo 风格的"猴子捧香蕉"SVG**,inline 重画,`fill: var(--mascot)`,不引用外链 | 必须尊重品牌资产 |

### 主屏版式最终骨架

1. **顶栏(`.topbar`)**:`[🐒 小猴子 SVG logo · MonkeyCode · SaCode]` 项目切换 + 中央搜索 + 右侧主题切换(浅/暗)+ 头像;高度 56px,底色 `--surface`,下边线 `--border`。
2. **左栏(`.pane-side`,240px)**:
   - "启动任务 / 历史任务 / 添加项目 / 技术交流群 / 配置" 五个真实条目(激活态:左侧 2px `--accent` 线 + 文字 `--accent`);
   - 文件树:`monkeycode-saas-starter/` 展开,行含 mono 路径 + git 状态点;
   - 底部用量卡(浅色):本月 token / 剩余配额(双 mono 数据);
   - 底部套餐卡:`高能贾贾 · 基础版` + `积分余额 12,480` chip。
3. **中央对话(`.pane-chat`)**:顶部三个任务 tab(Monkey 正在跑 / 评审线程 / 一次性问答),`--accent` 下划线激活态;中部"MonkeyCode 智能任务"大标题 + 三段 prompt 引导 + 一个 SaCode 蓝实心 `Run task` 主按钮(整页唯一);下方完整任务流:`用户消息 → 思维链 → 工具调用序列 → 代码 diff(等宽 + 行号 + 红绿填充)→ 终端输出 → 等待审批卡`。
4. **右栏(`.pane-context`,320px,默认折叠在 tab 切换)**:Files / Knowledge / Tools 三 tab;Tools tab 实时滚动展示工具调用流水。
5. **底部状态条(`.statusbar`,mono)**:模型 `Sonic` · tokens 1,284 / 16k · browser 2 tabs · 16:42 · 套餐 + 积分余额。

### 三态主题切换(完整 demo)

按 SaCode v0.1 §5:跟随系统 / 浅色 / 深色三态,顶栏右侧给一颗 toggle,JS 切 `<html data-theme="dark|light">` 后 `:root` 整体换皮;两套都已渲染,确保评估者一眼看到 SaCode 蓝在两种语境下的表现。

---

## 8. 待你确认的开放项

- [ ] **主题切换**:默认浅色(与官网一致),要不要在顶栏加一颗暗/亮切换,演示一遍暗色态?(推荐:加,暗色态用 `#0f1115 + #e85d2c`,完整 demo 两套)
- [ ] **小猴子 logo 形象**:我用 inline SVG 重画一只"戴工程帽、捧香蕉"的圆润吉祥物,香蕉黄主色 + 棕描边 + 黑色眼睛,作为品牌资产;你也可以另发图片替换。
- [ ] **示例任务文案**:中央对话演示一次完整任务流(用户提问 → 思维链 → 工具调用 → diff → 终端输出),是否就以"给 `/checkout` 加请求签名校验"这个例子继续?
- [ ] **是否需要 Pricing 入口**:左栏底部"高能贾贾 / 基础版"套餐卡 + 积分余额,要不要再加一颗 Pricing 入口按钮?(推荐:不加,套餐卡已经承担价格信号)

---

## 9. 交付清单(下一步)

1. 在 seed 基础上扩展样式:`assets/template.html` 的 `:root` 用 SaCode v0.1 §3 双主题令牌覆盖;新增应用专属类(`app-shell`、`pane-side`、`pane-chat`、`pane-context`、`composer`、`tool-call`、`diff-block`、`statusbar`、`mascot-svg`),**不重写 seed 的 `container / stack / grid-* / btn / card / eyebrow / num / pill` 等基础 class**;
2. inline 重画一只"戴工程帽、捧香蕉"的小猴子 SVG,绑定 `--mascot #f5c542`,仅出现在标题栏 logo 位一次;
3. 输出单个自包含 HTML 到 `monkeycode-sacode-main-console.html`(浅色默认 + 顶栏 toggle 可切深色);SaCode 蓝 `#366CFF` 全屏主导;`#f5c542` 仅 logo SVG 内出现;
4. 自检:`references/checklist.md` P0 全部通过;无 raw hex(除 seed 已允许的注释与 logo SVG fill / 描述文案);无 emoji 当图标;无 purple gradient;accent 单屏 ≤ 2 处;对比度 ≥ AA;动效尊重 `prefers-reduced-motion`;
5. 渲染一张主屏预览(浅色态 + 深色态各一张)验证。

---

**Next step**:请审阅这份 plan.md,在第 8 节里回答开放项(任何不答的我都会按"推荐"项默认推进)。确认后我会进入构建阶段,产出单个 HTML 交付。