# SaCode 独立原型 UI/交互 QA 评审

日期：2026-10-07
评审对象：`apps/desktop/prototype`（独立交互原型，全部为模拟数据，不连 Host / 不读凭据 / 不跑真实动作）
基线：固定提交 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，分支 `refactor/dsh-learning`
评审角色：UI Designer（设计系统 / 组件 / 无障碍方向）
评审性质：交付后评审，**只评审、不改代码、不改主入口、不提交**

**结论**：视觉与无障碍基线扎实，未发现阻塞性缺陷。有 2 项建议在"产品化前"处理（深色横幅不自适应、`resetTime:0` 权宜），其余均为体验打磨项。原型通过不等于业务接通，本报告不改变任何 F01–F20 验收状态。

> **2026-10-07 复核状态**：本报告读数（139 checks）与截图属评审当时版本；原型其后经历视觉重做与第二轮补齐，当前实测为 **602 checks / 0 failed**，最新截图与 `checks.json` 在 `apps/desktop/prototype/evidence/`。已确认处理：**D1**（原型顶条整体移除，`check('无全局原型顶条…')` 通过）。其余项（C1 `resetTime:0`、A1 Tabs ARIA、U1 窄窗空操作按钮、U2 动作按钮通栏、U3 标签溢出渐隐、L1 accent-on-soft、C2/C3、P1 微交互）在本轮**未逐项复核**，保持待修状态；下面第三节的对比度实测与第四节问题清单继续作为待修项来源。

---

## 一、评审范围与方法

| 输入 | 内容 |
| --- | --- |
| 源码 | `prototype.js`（Vue `h()` 组件）、`prototype.css`（令牌与布局）、`index.html`（CSP） |
| 证据 | `evidence/checks.json`、`light.png`、`dark.png`、`narrow.png` |
| 度量 | 实测 WCAG 对比度（脚本计算相对亮度），复核检查项计数 |
| 维度 | 设计令牌 → 对比度 → 键盘可达性 → 语义/ARIA → 响应式窄窗 → 状态机/竞态 → 组件状态与微交互 |

---

## 二、通过项（已核实）

| 项 | 证据 / 实测 | 判定 |
| --- | --- | --- |
| 真实 Electron 检查 | `checks.json`：**139 checks / 0 failed**，`errors: []` | PASS |
| 严格 CSP | `script-src 'self'`、`connect-src 'none'`；构建产物无 eval / new Function / import() | PASS |
| 键盘可达 | Ctrl+K 开标签、Escape 关弹层并归还焦点（`returnFocus`）、弹层 Tab/Shift+Tab 聚焦闭合 | PASS |
| 焦点可见 | `:focus-visible` 统一 3px accent 描边 + 2px offset，非文本对比 ≥3:1 | PASS |
| 语义/ARIA | `lang="zh-CN"`、`role=dialog` + `aria-modal`、`role=tablist/tab` + `aria-selected`、`role=status` + `aria-busy`；原生 `select/textarea` 均带 `aria-label` | 基本 PASS（见 A1） |
| 响应式 | <1000px 折叠 nav/workbench；760px 实测无水平溢出且导航折叠 | PASS |
| 增强竞态保护 | 手工复算 undo 栈 + revision 判定，`token/sid/rev` 三重匹配逻辑自洽，与"改回同文拒绝迟到增强"反证一致 | PASS |
| 性能/资源 | 全站无位图、无 `transition/animation`；默认即尊重 `prefers-reduced-motion`；零外部请求 | PASS |

---

## 三、对比度实测（WCAG）

计算方式：sRGB 相对亮度 + `(L1+0.05)/(L2+0.05)`；正文阈值 4.5:1，非文本/大字号阈值 3:1。

**亮色主题**

| 前景 | on bg | on panel | on soft |
| --- | --- | --- | --- |
| `--ink` #242733 | 13.74 | 14.86 | 12.79 |
| `--muted` #626976 | 5.11 | 5.52 | **4.76** |
| `--accent` #3769d5 | 4.69 | 5.07 | **4.36** |
| `--danger` #a33131 | 6.39 | 6.91 | 5.94 |

**暗色主题**

| 前景 | on bg | on panel | on soft |
| --- | --- | --- | --- |
| `--ink` #eef0f6 | 15.26 | 13.45 | 11.40 |
| `--muted` #a8afbc | 7.89 | 6.95 | 5.89 |
| `--accent` #8aacff | 7.81 | 6.88 | 5.83 |
| `--danger` #ffabab | 9.66 | 8.51 | 7.22 |

横幅：`#533900` on `#fff0d4` = **9.56**。

> 全部达到 AA。唯一低于 4.5 的组合是亮色 `--accent on --soft = 4.36`，但 `--accent` 在本原型中**从不作正文**，只用于边框、选中态与焦点环（非文本需 3:1，达标）。若未来把 accent 用作软底上的文字，需换色。

---

## 四、问题清单

优先级：**P1** 产品化前应处理 / **P2** 体验与一致性打磨 / **P3** 可读性与健壮性。

| 级别 | ID | 问题 | 定位与证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- | --- |
| **P1** | D1 | **深色模式横幅不自适应** | `prototype.css`：`.banner{background:#fff0d4;color:#533900}`，横幅内 `select` 覆写 `#fff/#242733`，均无 dark 变体；`dark.png` 顶部仍是高亮浅黄条 | 对比度虽 9.56 达标，但暗色下出现刺眼亮条，破坏主题一致性 | 增加 `:root[data-theme=dark] .banner{...}` 令牌，或改为变量驱动（该横幅为原型专用，产品化会移除，成本极低） |
| **P1** | C1 | **`resetTime:0` 全局绕开组件加载态复位** | `prototype.js:23` `btn()` 对所有 `Button` 传 `resetTime:0`；证据文档说明是为快速交互测试规避 OpenTiny 默认 1000ms 复位 | 属测试提速权宜，会把"加载态不自动复位"的隐患带进真实实现 | 真实实现应回到组件自身的异步/loading 契约，由请求状态驱动 disabled，而非固定 resetTime |
| P2 | A1 | **标签页 ARIA 不完整** | 有 `role=tablist/tab` + `aria-selected`，但面板容器缺 `role=tabpanel` 与 `aria-controls/aria-labelledby` | 屏幕阅读器无法把标签与面板关联 | 补全 WAI-ARIA Tabs 模式三件套 |
| P2 | U1 | **窄窗出现空操作按钮** | `<1000px` 时 `.nav/.workbench` 已 `display:none`，但"收起导航""切换右栏"仍渲染（`narrow.png` 可见） | 点了无反应，误导用户 | 窄窗隐藏这两个按钮，统一由"对话/工作台"承担切换 |
| P2 | U2 | **工作台动作按钮通栏拉伸** | 资源面板 `.stack` 网格导致"模拟连接/模拟部署授权/重试模拟状态"占满整行（`light.png` 右键区） | 视觉偏重，与产品信息密度不符 | 改为左对齐 inline 按钮 + `min-width`，与真实产品密度对齐 |
| P2 | U3 | **标签溢出无视觉引导** | 1440px 下 5+ 标签出现原生细滚动条，无渐隐/溢出提示 | 溢出关系不直观 | 标签条加边缘渐隐，或强化"标签溢出列表"入口的可见性 |
| P2 | L1 | **accent-on-soft 4.36** | 亮色 `--accent #3769d5` on `--soft #eceef2` | 当前仅用于边框/焦点环，达标；若改作文本则不合格 | 作为文本使用时换更深色（如 #2b55b5）；或记录为"仅限非文本用途"约束 |
| P3 | C2 | **`submit()` 判定表达式难读** | `prototype.js:122`：`submit(alternate?busyPolicy.value==='排队发送':busyPolicy.value==='即时补充')` | 易误读、易改错 | 抽成命名变量/纯函数 |
| P3 | C3 | **Ctrl+K 会重置已打开的弹层** | `keyHandler` 无条件 `openModal('标签')`，弹层已开时被覆盖 | 轻微状态丢失 | 弹层已开时不响应 Ctrl+K |
| P3 | P1 | **无过渡/微交互** | 全站无 `transition/animation` | 状态卡出现、弹层开合生硬 | 产品化时补 motion，并加 `prefers-reduced-motion` 保护 |

---

## 五、修订建议摘要

- **产品化前（P1）**：修 D1（深色横幅）与 C1（resetTime 权宜）——两项都不影响原型继续用于评审，但会把不一致/隐患带进真实实现。
- **体验打磨（P2）**：A1 补 Tabs ARIA 三件套；U1 窄窗隐藏无效按钮；U2 动作按钮回归 inline；U3 标签溢出加渐隐。
- **代码质量（P3）**：C2 表达式重命名；C3 弹层防重入；P1 补 motion。

---

## 六、评审边界

- 本次**只评审**：未修改任何源码、未触碰产品主入口、未提交或推送。
- 结论基于**固定截图 + 源码 + 脚本度量**；如需活体验证，在仓库根目录 `node apps/desktop/prototype/build.mjs` → `node apps/desktop/prototype/serve.mjs`，打开 http://127.0.0.1:3197/。
- 三张截图来自测试脚本末态（草稿已清空，故发送/增强按钮呈禁用态），非交互中途态；如需展示 disabled→enabled 过渡可另出截图。
- 原型 139 项通过**仅代表 UI 行为**，不代表任何 F01–F20 业务接通；本报告不更新旧验收矩阵。
