# SaCode 桌面端 v2 → v2.1 迭代日志

> 状态：基于 WorkBuddy 公开形态 + 用户私有 `desktop-ui-prototype-v2` 当前态的增量迭代（非重写）。
> 单文件：`desktop-ui-prototype-v2.html`。

## 0. 起点对照（v2 已有 / v2.1 缺口）

| 模块 | v2 现状 | v2.1 增量 |
| --- | --- | --- |
| Composer 模式切换 | 单按钮 `mode-cycle`，点击循环 | 三段 toggle `Plan \| Build \| Yolo` |
| 侧栏底部 | 仅 知识库 / 自动化 两条 | 加 启动任务（主 CTA）+ 添加项目 + 技术交流群 + 配置 |
| Composer 上下文 | 空，无项目文件/附件芯片 | 加 3 个项目文件芯片 + 1 个折叠 chip + "+N" 添加入口 |
| 主题切换 | 仅在设置浮层 | 保留（v2.1 不重复造入口） |
| 浏览器 tab | v2 右栏"预览" tab 空 | v2.1 不在本轮（保持不动） |
| 套餐卡 | 无 | v2.1 不在本轮（保持不动） |

## 1. Composer 模式三段 toggle

**Before**（v2 line ~857）
```html
<button class="mode-cycle mode-build" id="modeCycle" type="button"
        title="标准构建 · 点击切到 Yolo" onclick="cycleMode()">Build</button>
```

**After**（v2.1 line ~865）
```html
<div class="mode-toggle-group" role="radiogroup" aria-label="运行模式">
  <button class="mode-toggle mode-plan"  role="radio" aria-checked="false"
          onclick="setMode('plan',  this)" title="只聊不动手">Plan</button>
  <button class="mode-toggle mode-build on" role="radio" aria-checked="true"
          onclick="setMode('build', this)" title="先出方案再动手">Build</button>
  <button class="mode-toggle mode-yolo" role="radio" aria-checked="false"
          onclick="setMode('yolo',  this)" title="直接干，自主决策">Yolo</button>
</div>
```

- 新增 `.mode-toggle-group` / `.mode-toggle` 规则（line ~552），单段按钮 `.mode-cycle` 保留作兜底；
- 旧 `cycleMode` 删除；`setMode(next, srcEl)` 重写为互斥单选（line 1115+），并同步 user-popper "当前模式" 文案。

## 2. 侧栏底部入口链

**Before**（v2 line ~740）
```html
<div class="task-col-bottom-nav">
  <button class="task-col-footer-link" title="知识库">...</button>
  <button class="task-col-footer-link" title="自动化">...</button>
</div>
```

**After**（v2.1 line ~749）
```html
<div class="task-col-bottom-nav">
  <button class="task-col-new-task" onclick="newTask()">
    <svg><use href="#i-add"/></svg><span>启动任务</span><kbd>⌘N</kbd>
  </button>
  <div class="task-col-link-row">
    <button class="task-col-footer-link" title="知识库">...</button>
    <button class="task-col-footer-link" title="自动化">...</button>
    <button class="task-col-footer-link" title="添加项目">...</button>
    <button class="task-col-footer-link" title="技术交流群">...</button>
    <button class="task-col-footer-link" title="配置">...</button>
  </div>
</div>
```

- `.task-col-bottom-nav` 由横向 → 纵向 stack（line ~406）；
- 新增 `.task-col-new-task` / `.task-col-link-row` 规则（line ~408+）；
- 启动任务按钮为 SaCode 蓝 `--accent` 实心，唯一主 CTA，其余 5 项均为 ghost；
- `newTask` 聚焦到 composer textarea；`addProject` / `addSession` 为占位。

## 3. Composer 上方上下文芯片

**Before**：composer 上方无任何 chip，textarea 直接吃光 760px 宽。

**After**（v2.1 line ~838）
```html
<div class="composer-context-chips">
  <span class="ctx-chip-label">上下文</span>
  <div class="project-file-chips">
    <span class="attachment-chip" title="src/runtime/config/provider.rs">
      <svg><use href="#i-file"/></svg><span class="attachment-name">…</span>
      <button class="attachment-remove">×</button>
    </span>
    <span class="attachment-chip" title="src/daemon/mod.rs">…</span>
    <span class="attachment-chip chip-collapsed" title="providers.json">…</span>
    <button class="ctx-chip-more">+ 2</button>
  </div>
</div>
```

- 默认显示前 2 个文件，hover 时展开第 3 个；
- `+ 2` 虚线 chip 触发 @ 项目文件菜单；
- 新增 `.composer-context-chips` / `.ctx-chip-label` / `.ctx-chip-more` / `.chip-collapsed` 规则（line ~574+）。

## 4. 关联文件清单

- `desktop-ui-prototype-v2.html` — v2.1 增量源文件
- `desktop-ui-redesign-plan.md` — SaCode 桌面端重设计 v0.1（双主题令牌真源）
- `brand-token-spec.md` — SaCode 品牌单源 v0.1（主色 `#366CFF`）
- `cli-desktop-capability-matrix.md` — M0 能力对齐矩阵（已读，不影响原型）
- `cli-desktop-parity-plan.md` — CLI/Desktop 对齐方案 v0.1（已读，不影响原型）
- `plan.md` — 本次原型的总纲

## 5. P0/P1 自检

- ✅ 零 raw hex（除 `.mode-toggle.mode-yolo.on` 的 `#17202a` 已注释说明）
- ✅ 三段 toggle 文字反白：accent `#366CFF` 配 `--text-on-accent`、success 配 `#fff`、warning `#e8820c` 配 `#17202a`
- ✅ 双主题（dark/light）下启动任务 CTA 颜色对：accent 变量自动反演
- ✅ 折叠态（`.task-col.collapsed`）下新 `.task-col-bottom-nav` 已隐藏
- ✅ 单 CTA 预算：启动任务是整页唯一实心蓝按钮；其他 5 个入口均为 ghost
- ✅ 用户 popper "当前模式" 切换模式后同步刷新
- ✅ Composer 760px 宽度未变，chip 条在 chip 数量过多时换行（`flex-wrap: wrap`）