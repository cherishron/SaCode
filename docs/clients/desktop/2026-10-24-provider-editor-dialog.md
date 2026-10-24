# 供应商页新增/编辑表单改为弹窗（试点）

- 日期：2026-10-24
- 范围：`apps/desktop/renderer/pages/provider-settings.ts`、`apps/desktop/renderer/product-design.css`、`apps/desktop/renderer/DESIGN.md` 与相关测试/测试支持
- 环境：Windows、未提交工作区；未构建候选、未安装、未提交/推送/发布
- 用户指令：现有设置类页面把「添加」表单渲染成列表后的内联区块，展开后把列表挤出视野；采用弹窗方案，**先从供应商页开始改**

## 1. 现象与根因

供应商页的「添加供应商 / 编辑」表单原先作为 `fieldset.ps-editor` 直接排在 `ul.ps-list` 之后（同层兄弟节点）。模型目录一长，表单整体把列表推到视口之外，用户需要长距离滚动才能对照列表与表单；窄窗口下尤其明显。同类内联表单还存在于 `custom-models.ts`、`automation-page.ts`、`knowledge-page.ts`、`product-management.ts`、`models-page.ts`，本批**只改供应商页**作试点。

## 2. 实现

- **宿主复用**：表单改由 `renderer/dialog.js` 暴露的共享 `SaCodeDialog` 承载（`index.html` 在页面脚本之前加载），沿用其 `showModal()`、Escape→`onClose`、关闭后复原焦点的既有行为，不新造第二套弹窗。
- **代码落点**：`provider-settings.ts:248-279` 把原内联 `fieldset` 放进 `SaCodeDialog` 的默认插槽（函数式插槽）；标题随模式取「添加供应商 / 编辑 <名称>」，透传 `class:'ps-editor-dialog'`（沿用 `plugin-manager` 的 `plugin-manager-install` 先例，落到底层唯一根 `<dialog>`）。
- **列表不再位移**：弹窗位于列表之后但脱离文档流；模型目录再长也只滚 `.dialog-body`，`ul.ps-list` 保持原位。
- **操作条常驻**：`product-design.css:341-345` 新增宽变体——`width:min(760px,calc(100vw - 48px))`、`.dialog-body` 去 `gap`、`fieldset` 去边框内边距、`.ps-actions` 在底部 sticky 并铺满体宽（用 `-1 * var(--space-5)` 抵消 body 内边距），顶部 1px `--border` 分隔、底色 `--surface-2`。
- **错误就地显示**：校验/保存失败信息在弹窗内（`ps-error`），页面级操作错误仍在页顶，且页顶错误在编辑态隐藏（`error.value&&!isEditing`），避免同一错误出现两处。
- **不丢草稿**：保存中 `fieldset:disabled` + `aria-busy`；头部关闭与 Escape 都经 `if(!saving.value)closeEdit()` 守卫。
- **设计口径**：`DESIGN.md` §2 组件基线补一条「新增/编辑表单走共享弹窗、宽表单用页面类别名、操作条 sticky 底部」，作为后续页面迁移的范例。

## 3. 测试与读数

- **新增回归** `apps/desktop/test/provider-editor-dialog.test.mjs`（真 Vue 运行时 + 自定义 renderer，不依赖 Electron）：**2/2 通过**。断言新增/编辑两种模式都满足「恰好一个 `role=dialog`」「标题正确」「`ps-editor-dialog` 类挂上」「Provider ID / 显示名称 / API 地址 / API 密钥在弹窗内」「列表外 `fieldset` 数为 0」「关闭按钮回调后弹窗卸载」。
- **反证（先红）**：以 `git show HEAD:apps/desktop/renderer/pages/provider-settings.ts` 为输入、同一套真 Vue 装配点「添加供应商」，输出 `{"verdict":"RED-AS-EXPECTED",...}`（HEAD 版没有 `role=dialog`），证明新断言不是空转。脚本为一次性产物，留在 `target/tmp/`，不提交。
- **受影响的非 Electron 用例**：`provider-form-boundary`、`provider-credential-retry-state`、`provider-adapter-revision`、`model-directory-invalidation`、`model-removal-status`、`models/model-pull-page`、`provider-editor-dialog` 共 **34/34 通过、0 失败/跳过**。
- **渲染层门禁**：`model-center`、`page-sources-parse`、`renderer-bundle-guard`、`renderer-el-shape`、`renderer-syntax` 共 **22/22 通过**。
- **Electron 门控用例（在中立目录真实执行，全部通过）**：仓库内新建的文件会继承工作区完整性标签 `S-1-4-322009398-287923377`，默认沙箱 Electron 直接在此启动即 `0x80000003`。把 `apps/desktop`（不含 `node_modules`）与 `node_modules/electron/dist` 导出到 `D:/tmp/sacode-dialog-ui-20261024/`（仓外临时产物，不入库），用 `ELECTRON_OVERRIDE_DIST_PATH` 指向中立二进制，再把 `TMP`/`TEMP` 指到仓内可写目录（本机 `%TEMP%` 对宿主拒写），门控即通过、用例真实执行：`model-credential-electron-host` + `model-pages-render` + `provider-credential-retry-render` **7/7 通过、0 失败 / 0 跳过、rc=0**（日志 `target/tmp/electron-neutral-20261024/electron-suites-r3.log`）。
- **首轮 3 过 / 4 败的两处根因都在驱动，产品与弹窗代码未动**：① `test-support/model-pages-smoke.cjs` 按 `aria-label="输入价格（微）"` 取价格输入框，而工作区 `custom-models.ts:228` 已把标签补成「输入价格（百万分之一货币/Token，-1=未设置）」，取到 `null` 抛 `Cannot read properties of undefined (reading 'value')`；改为在 `.cm-binding .cm-pricings` 内按位置取（字段顺序稳定，不再与文案耦合）。② 内置供应商那条断言里的说明文案写作「此处仅保存启停」，实际文案（`HEAD` 与工作区均为「此处可保存启停和密钥」）不含该串——是此前被环境跳过长期掩盖的失效断言，按现文案修正。修完 `model-pages-render` **4/4**、三件套 **7/7** 全绿；未改并发会话的 `custom-models.ts`。
- **供应商弹窗在真实 Electron 中通过**：上述 `model-pages-render` 的供应商段断言全部在四个 `SACODE_MODEL_CAPTURE` 之前执行并已通过——列表真实呈现、编辑/删除/添加的只读护栏、点击编辑打开字段、**表单在 `dialog.sacode-dialog[open]` 内且列表不再内联**、字段不越界、表单样式实际加载、新增表单位于弹窗内、**取消后弹窗关闭且列表恢复**；失败点在其后的自定义模型段落。
- **真实窗口 `--ui-smoke`**：在中立导出目录执行 `env -u ELECTRON_RUN_AS_NODE … SACODE_UI_SMOKE_SUITE=model-center ../electron/electron.exe . --ui-smoke` → **RC=0、`MODEL_MAIN_SMOKE PASS`**。该套件真实点击「添加实例 → 编辑 → 填密钥 → 保存 → 设默认模型 → 添加供应商 → 填表 → 保存 → 编辑自定义模型 → 添加模型 → 保存」，并回读 core `model/registry/describe`。
- **实拍**：`target/tmp/dialog-captures-20261024/{1-provider-edit,2-provider-create}[-bottom].png` 来自真实 Electron 渲染，可见 760px 宽弹窗、遮罩、体内滚动与底部常驻「取消/保存」操作条。

测试支持同批调整（均为夹具，不是产品行为）：

- `test/support/load-page-module.mjs` 新增可选 `globals` 注入：VM 沙箱的 `globalThis` 是 context 本身，需要把宿主全局（`SaCodeDialog`）补进 context。
- `provider-credential-retry-state.test.mjs`：替身 `h` 展开函数式插槽子节点，并按标记把 `SaCodeDialog` 渲染成 `dialog` 节点。
- `model-center.test.mjs`：替身 `h` 同步展开函数式子节点（真 Vue 对数组插槽会告警）。
- `model-pages-render`、`provider-credential-retry-render`、`model-credential-electron-host`：夹具 HTML/目录补 `dialog.js`，与 `index.html` 的加载顺序一致。
- `test-support/model-pages-smoke.cjs`：新增三条「编辑/取消/新增」弹窗包含性断言（真实 Electron 下运行）。

## 4. 边界与未验证

- **GUI 验收边界**：结构、布局与流程已在真实 Electron 中跑通（见 §3），**观感仍归用户**：宽弹窗形态是否满意、亮暗主题对比度、`SACODE_MODEL_WIDTH=600` 窄窗表现、Escape 与焦点复原的实际体感，需用户在自己的桌面上确认，自动化不替代视觉接受。
- **环境限制的正确解法**：不是关沙箱或降低防护，而是把运行物放到不带工作区完整性标签的中立目录（`D:/tmp/...`）；仓库内直接跑仍会 `0x80000003`，属 D10 同源的目录标签问题，不是产品缺陷。
- **驱动改为按结构取字段**：价格输入框不再依赖 `aria-label` 文案，改取 `.cm-binding .cm-pricings` 内首个 `input`。若将来调整价格字段顺序，这条断言需同步复核——它松开了与文案的耦合，但没有松开对字段存在性的要求（取不到仍是失败）。
- **未重打候选**：`dist/`、随包 Host 与安装包未重打，现有交付包不含本批改动；`--ui-smoke` 已在中立导出副本上真实跑过（见 §3），不等于打包态一致。
- **删除确认仍是自有实现**：供应商删除仍用 `div.ps-dialog[role=alertdialog]`，未切到 `SaCodeDialog`，属后续一致性项，不在本批范围。
- **仅试点**：`custom-models`、`automation`、`knowledge`、`product-management`、`models-page` 的内联表单保持原样，待用户确认后再迁移。
- 未改 JS/IPC/Host/core，未新增依赖，未提交、推送、安装或发布；不升级任何 F 域完成状态，不改当前候选身份与主阻塞。
