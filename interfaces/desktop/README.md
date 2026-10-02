# SaCode Desktop

**当前唯一桌面主线：Vue 3 + TypeScript + Vite + TDesign + Tauri 2。** `index.html` 加载 `src/ui/main.ts`；Vue 工作台经 `@cherishron/sacode-client-core` 与 daemon 通信，Tauri Rust shell 承担 sidecar/PTY 与本机能力。旧 `src/main.ts`、`src/app/`、`src/components/` 手写 DOM 前端不是第二套可交付 UI；已有删除/迁移中的代码与测试不得作为当前 Vue UI 的验收证据。对齐 MonkeyCode 的**布局契约与交互形态**，不抄其源码/视觉资产。

## 技术栈（定案）

| 层 | 选型 |
| --- | --- |
| 壳 | Tauri 2（Rust：PTY、sidecar、原生文件） |
| UI | Vue 3（`<script setup>` + TS） |
| 构建 | Vite + `@vitejs/plugin-vue` + `vue-tsc` |
| 组件 | `tdesign-vue-next` + `tdesign-icons-vue-next` |
| 状态 | composable（`useDesktopApp`），对接 `@cherishron/sacode-client-core` |

**禁止** React / Tailwind / daisyUI / 拷贝 MonkeyCode 组件。布局度量以 `src/ui/styles/layout-contract.css` 与 `docs/plans/desktop-layout-contract.md` 为唯一来源。

## 目录

```text
interfaces/desktop/
  index.html              # 入口 → src/ui/main.ts
  src/ui/                 # 唯一正式 Vue UI
    main.ts               # Vue + TDesign 挂载
    App.vue               # 工作台：任务列 + 平铺分格
    composables/useDesktopApp.ts
    components/           # TaskColumn / PaneFrame / ChatCard / Composer / KnowledgeView / AutomationView …
    logic/                # Vue 主线复用的非视图逻辑
    styles/
      layout-contract.css # 度量令牌（唯一来源）
      theme.css           # TDesign ← SaCode 暖色
      shell.css           # 壳与组件皮相
  src/tauri-bridge.ts     # Tauri invoke / PTY / SSE
  src-tauri/              # Rust 壳
```

## 壳形态（契约摘要）

```text
┌─ 任务列 232 (184–420) ─┬─1px─┬─ 平铺分格 ──────────────┐
│ 品牌行 h-40  ☰ +      │     │ 细头 h-48 [动作簇]      │
│ tabs 本地|云端         │     │  会话 / 创建 / 装载卡   │
│ 项目组列表             │     │  文件|终端|预览 = 格内侧板│
│ ⚙ 设置沉底            │     │                          │
└────────────────────────┴─────┴──────────────────────────┘
```

- 无 status-bar、无第三固定列
- 焦点格 = 标题 primary 下划线
- 消息与 composer 共用 `--chat-measure`
- 格内侧板：`scrim + absolute 侧板`（非整页 drawer）

完整度量与信息安放见 `docs/plans/desktop-layout-contract.md`。

### 当前接入与待验收边界（2026-09-29 工作区核对）

下表列的是当前 Vue 主线可见的接入，不表示真实交互、安装包或发布验收已经完成；工作区内未提交组件及迁移中的测试只计作实现线索。

| 能力 | 入口 | 后端 |
| --- | --- | --- |
| 会话列表 / 选格 / 同会话禁双格 | 任务列 | `/api/desktop/conversations*` |
| 新建任务 / 发送 / 草稿 | 创建页、Composer | `/task` · `sendDesktopMessage` |
| 附件上传 | Composer 📎 | `/api/workspace/uploads` |
| 卡片流 / 提问卡 / plan / 用量 | 会话格 | `/task/:id/answer` 等 |
| 文件树懒加载 / 代码与 MD 预览 | 细头 文件 | `/workspace/list` `/workspace/file` |
| 终端 PTY | 细头 终端 | Tauri invoke（非 daemon） |
| 预览 URL | 细头 预览 | 前端 iframe |
| 账号登录 / 模型同步 / 权益 / License / 激活 | 设置 · 账号 | `/account/*` |
| MCP / 技能管理 | 设置 · 服务 / 技能 | `/api/mcp/*` `/api/skills*` |
| 分格拆分/拖宽/独占/更换/改名 | 细头 ⋯ | 本地状态 |
| 知识库笔记/检索 | 任务列 → `KnowledgeView.vue`（工作区内可见） | `/api/knowledge/*` |
| 自动化规则/运行历史 | 任务列 → `AutomationView.vue`（工作区内可见） | `/api/automation/*` |

**验收状态：部分验收，未正式发布。** 2026-09-22 的 Desktop 6 tests/build 等记录属于旧 UI 阶段，不能证明 Vue/TDesign 主线验收。当前仍需针对 Vue 入口重新跑 typecheck/test/build、真实手工交互（含退出重开回放、审批/取消、Diff）、Tauri sidecar/安装包及跨平台 E2E；完成后按[集成验收清单](../../docs/plans/desktop-integration-acceptance.md)逐项记录，不以代码存在或旧 UI 测试替代。

### 尚未在 Vue 主线完成接入或验收

| 能力 | 后端/逻辑 | Vue 主线状态 |
| --- | --- | --- |
| SaDesign | `/api/design/*`、`src/ui/logic/sadesign-state.ts` | 尚无当前 Vue 视图，不能引用已迁移的旧 `src/app/sadesign.ts` |
| 企业审计导出 | `POST /api/audit/export` | 按钮/真实权限链路待验收 |

知识库、自动化与设置各页均已在 `src/ui/components/` 中有 Vue 实现（其中部分为当前工作区未提交改动），不能再写作“Vue 尚未接”；模型与执行、Git、安全、导入等设置项以当前 `SettingsView.vue` 和真实交互验收为准，不从旧 `src/app/settings.ts` 推断完成度。

## 开发

```powershell
cd interfaces/desktop

# 可选：注册 OpenCode ACP
# $env:SACODE_OPENCODE_EXECUTABLE = "..."
# $env:SACODE_OPENCODE_ARGS = "x opencode-ai acp"

npm run dev      # Vite 插件 spawn sacode serve，同源代理 daemon
npm run typecheck
npm test
npm run build
```

依赖变更（client-core）后：

```powershell
cd interfaces/client-core && npm run build
cd ../desktop && npm run typecheck
```

## Tauri

```powershell
# 需已安装 Tauri CLI / Rust
cargo build --manifest-path src-tauri/Cargo.toml
# 或
npx tauri dev
```

- ready-file **不含 token**；token 只经子进程 env / Tauri invoke 传递。
- 终端仅在 Tauri 会话可用（Web 预览会提示）。

## 新端点（daemon）

| 路径 | 用途 |
| --- | --- |
| `GET /workspace/list?path=` | 目录一层懒加载 |
| `POST /api/workspace/uploads` | 附件上传 |
| `GET/PUT/DELETE /api/mcp/servers…` | MCP 管理 |
| `GET/PUT/DELETE /api/skills…` | 技能管理 |
| `POST /task/:id/answer` | 提问应答 |
| `GET/POST /account/entitlements` · `entitlement-login` | 权益 / 二次授权 |
| `GET/POST /account/license` | License 状态 / 导入 |
| `POST /account/activation-request` | 设备激活请求 v1 |
| `POST /api/audit/export` | 企业审计导出（capability 门禁） |
| `/api/design/*` `/api/knowledge/*` `/api/automation/*` | SaDesign / 知识库 / 自动化 |

## 相关文档

- [布局契约](../../docs/plans/desktop-layout-contract.md)
- [颗粒度审计](../../docs/plans/desktop-layout-audit.md)
- [对齐差距](../../docs/plans/desktop-monkeycode-parity.md)
- [集成验收](../../docs/plans/desktop-integration-acceptance.md)
