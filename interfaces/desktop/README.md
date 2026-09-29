# SaCode Desktop

Vue 3 + TypeScript + Vite + **TDesign** + Tauri 2 桌面壳。对齐 MonkeyCode 的**布局契约与交互形态**，不抄其源码/视觉资产。

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
  src/ui/                 # 新壳（当前正式 UI）
    main.ts               # Vue + TDesign 挂载
    App.vue               # 工作台：任务列 + 分格
    composables/useDesktopApp.ts
    components/           # TaskColumn / PaneFrame / ChatCard / Composer …
    styles/
      layout-contract.css # 度量令牌（唯一来源）
      theme.css           # TDesign ← SaCode 暖色
      shell.css           # 壳与组件皮相
  src/app|components/     # 旧 el() 实现（测试仍在用，迁移完可删）
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

## 功能一览（当前）

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

### 后端已备、Vue 尚未接

| 能力 | 后端 | 旧 UI | Vue |
| --- | --- | --- | --- |
| SaDesign | `/api/design/*` | `src/app/sadesign.ts` | 待迁 |
| SaNative 知识库 | `/api/knowledge/*` | `src/app/sanative.ts` | 待迁 |
| 自动化 | `/api/automation/*` | `src/app/automation.ts` | 待迁 |
| 模型与执行 / Git / 安全 / 导入 | providers · git-auth · audit · import | `src/app/settings.ts` | 设置页占位 |
| 企业审计导出 | `POST /api/audit/export` | — | 按钮未挂 |

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
