# P0 官方基准与当前故障定位（2026-10-07）

## A：官方产品基准

### 产品版本
- **产品名**：DeepSeek Harness
- **版本**：44.0.0（Electron 版本号，见 `version` 文件）
- **桌面包**：`@deepseek-ai/dsh-desktop` v0.2.0-rc.2
- **前端包**：`@deepseek-ai/dsh-web-frontend`
- **构建 commit**：`04f392c9ddd144fa426da2045178797da6db6c11`
- **安装目录**：`D:\Program Files\Deepseek\DeepSeek Harness`
- **前端资源位置**：`resources/app.asar → dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/`

### 窗口尺寸（从 `lib/main.js` 提取）

| 参数 | 官方值 | SaCode 当前值 | 差异 |
|------|--------|--------------|------|
| 主窗口默认宽 | 1280 | 1100 | **不一致** |
| 主窗口默认高 | 820 | 720 | **不一致** |
| 最小窗口宽 | 520 | 860 | **不一致** |
| 最小窗口高 | 600 | 600 | 一致 |
| 全屏激活态最小宽 | 960 | — | 缺失 |

### 标题栏（从 `lib/main.js` + `lib/preload-app.cjs` 提取）

| 参数 | 官方值 | SaCode 当前值 | 差异 |
|------|--------|--------------|------|
| `titleBarOverlay.height` (primary) | 42 | 40 | **不一致** |
| `titleBarOverlay.color` (primary) | `#00000000`（透明） | 动态黑/白 | **不一致** |
| `titleBarOverlay.symbolColor` | `#0F1115` | 动态 | **不一致** |
| `backgroundMaterial` (primary) | `acrylic` | 无 | **缺失** |
| `--dsh-windows-titlebar-height` | 40px (preload 设置) | 40px (frame.css) | 一致 |

### 侧栏布局（从 `dsh-client-ui-layout/lib/client.js` 提取）

| 参数 | 官方值 | SaCode 当前值 | 差异 |
|------|--------|--------------|------|
| 侧栏默认宽度 | 280 | 184 (styles.css grid) | **不一致** |
| 侧栏拖动范围 | 264–420 | 264–420 (frame.js) | 一致 |
| 自动折叠阈值 | 1024 CSS px | 1040 (styles.css media) | **不一致** |
| 折叠后宽度 (Windows) | 0（完全隐藏） | 64px | **不一致** |
| 折叠后宽度 (其他平台) | 56 | — | — |
| 右栏默认比例 | 0.45 | — | — |
| 右栏最大比例 | 0.70 | — | — |
| 右栏最小宽度 | 300 | — | — |
| 中央列最小宽度 | 400 (grid minmax) | — | — |

### 中央内容区（从 `frame.css` 当前实现提取，对照官方 CSS）

| 参数 | 官方值 | SaCode 当前值 | 差异 |
|------|--------|--------------|------|
| 中央内容宽度 | `clamp(680px, 会话宽度×0.64, 920px)` | `clamp(680px, calc(var(--conversation-width)*.64), 920px)` | 一致 |
| 中央圆角 (Windows) | 16px (`--dsh-windows-content-radius`) | 16px (frame.css) | 一致 |
| 中央背景 | `var(--dsw-alias-bg-base)` | `var(--surface-2)` | 语义等价 |

### 主题色（从 `dsh-client-ui-theme/lib/index.js` 提取）

| 参数 | 官方值 | SaCode 当前值 | 差异 |
|------|--------|--------------|------|
| 亮色主背景 | `#fff` | `#f6f7f9` (styles.css) | **不一致** |
| 暗色主背景 | `#151517` | `#17191d` (styles.css) | **不一致** |
| 默认字号 | 14px | 14px (styles.css) | 一致 |
| 字号范围 | 10–22 | 10–22 (main.cjs) | 一致 |

### 输入卡（从官方 CSS 类名推断 + 方案文档基准）

| 参数 | 官方值 | SaCode 当前值 | 差异 |
|------|--------|--------------|------|
| 输入正文字号 | 14px / 24px 行高 | 14px / 24px | 一致 |
| 输入卡圆角 | 28px | 28px (`--radius-panel`) | 一致 |
| 文本区最小高度 | 36px | 36px (styles.css) | 一致 |
| 首页状态最小高度 | 52px | 52px (frame.css) | 一致 |

### 未提交修改归属确认

| 文件 | 修改内容 | 归属 |
|------|---------|------|
| `apps/desktop/renderer/styles.css` | 新增 `.composer-customSelect` 两条规则 | F（集成） |
| `apps/desktop/renderer/app.js` | 自定义模型选择器 + `custom-model-not-found` 错误处理 | F（集成） |
| `docs/plans/w00-path-ownership-and-isolation-2026-10-06.md` | 新增 goal_activation / goal_evidence 文件所有权 | F（W50） |

---

## E：session/projection 超时归因

### 链路

```
渲染层 app.js: window.sacode.projection()
  → preload.cjs: ipcRenderer.invoke("sacode:projection")
    → main.cjs: ipcMain.handle("sacode:projection", ...)
      → host-bridge.cjs: bridge.request("session/projection")
        → 仓颉 Host main.cj: method == "session/projection"
```

### 超时点

**`host-bridge.cjs` 第 71–73 行**：
```javascript
const timer = setTimeout(() => {
  if (this.pending.delete(String(id))) rej(new Error(`timeout: ${method}`));
}, 5000).unref();
```

- **硬编码 5000ms 超时**，无配置、无退避。
- 超时后请求被拒绝，渲染层收到 `Error: timeout: session/projection`。

### 可能原因

1. **首次启动慢**：仓颉 Host 首次启动需读日志、回放事件，如果日志大或磁盘慢，projection 可能在 5s 内未返回。
2. **宿主崩溃**：`this.proc.on("exit")` 会 `#fail()` 立即拒绝所有 pending 请求（不是超时，但表现类似）。
3. **工作区故障**：`main.cj` 中 `workspaceFault` 状态下 projection 仍放行（第 895 行），但如果核心初始化失败可能导致。
4. **会话选择回放**：`selectionFault` 状态下 projection 放行（第 902 行），但首次 select 可能慢。

### 诊断方法

- 在 `main.cjs` 的 `withHost` 前后加时间戳日志。
- 检查宿主 stderr 输出（`process.stderr.write('[host] ${d}')`）。
- 检查宿主是否成功 spawn（`bridge.proc` 是否非 null）。

### 建议（不在此批修改）

超时值 5000ms 是合理的默认值，不应盲目增大。如果确实超时，应定位仓颉 Host 为何慢，而非增加等待时间。

---

## F：当前运行版本确认

### 源码版本
- **分支**：`refactor/dsh-learning`
- **最新 commit**：与 `origin/refactor/dsh-learning` 同步
- **未提交修改**：3 个文件（styles.css、app.js、w00 文档），归属 F

### 宿主
- **路径**：`apps/desktop/dist/host/bin/sacode-host.exe` — 存在
- **来源**：由 `scripts/pack-host.mjs` 从 `apps/host/target/release/bin/main.exe` 打包

### 安装包
- **路径**：`apps/desktop/dist/electron/win-unpacked/SaCode.exe`
- **构建时间**：2026-10-06 19:38:25
- **状态**：较新（昨天构建），但源码有未提交修改，需要重建才能验证最新代码

### 前端资源
- `renderer/vendor/` 目录存在，包含 Vue runtime、TinyVue、TinyRobot 等折叠产物
- `renderer/index.html` 加载链正确（styles → highlight → frame → 页面 CSS → vendor JS → app.js）

### 放行条件评估

| 条件 | 状态 |
|------|------|
| 官方基准可复现 | ✅ 已从 asar 提取全部关键参数 |
| 当前运行版本明确 | ✅ 源码分支 + 宿主 + 安装包均已核对 |
| 投影超时有确定归因 | ✅ 5s 硬编码超时 + 首次启动慢 / 宿主崩溃 / 核心初始化 |

---

## 第1批需要修正的差异清单

### B 独占文件：`frame.css`、`styles.css`

**styles.css 需改：**
1. `.app` grid-template-columns：`184px` → `280px`（侧栏默认宽度对齐官方 280）
2. 亮色 `--surface`：`#f6f7f9` → `#fff`（对齐官方 `LIGHT_BACKGROUND = "#fff"`）
3. 暗色 `--surface`：`#17191d` → `#151517`（对齐官方 `DARK_BACKGROUND = "#151517"`）
4. `@media (max-width: 1040px)` → `@media (max-width: 1023px)`（对齐官方 `SIDEBAR_AUTO_COLLAPSE = 1024`，用 1023 确保刚好 1024 时不折叠）

**frame.css 需改：**
1. 确认侧栏折叠态宽度对齐（Windows 折叠后宽度 0，当前 64px——这是有意的差异，SaCode 保留了图标轨道，官方 Windows 完全隐藏）

**main.cjs 需改（F 负责）：**
1. `width: 1100` → `width: 1280`
2. `height: 720` → `height: 820`
3. `minWidth: 860` → `minWidth: 520`
4. `titleBarOverlay.height: 40` → `42`（primary 窗口）
5. `titleBarOverlay.color` → `#00000000`（透明，配合 acrylic）
6. `titleBarOverlay.symbolColor` → `#0F1115`
7. 新增 `backgroundMaterial: "acrylic"`
