# Desktop 设置中心扩展方案

> 文档状态：方案草案，待评审
> 日期：2026-09-26
> 关联：设置中心现状 `interfaces/desktop/src/app/settings.ts`
> 说明：本文件为独立方案文档，**不是当前活动 plan**；与「知识库 API 与 cron 自动化调度」规划并列，互不覆盖。

## 1. 背景

设置中心已有 7 个 MVP 分区骨架（general / account / execution / appearance / project / services / about），但分区内容深度不足。用户参照 CodeBuddy 风格设置中心，要求扩展为产品级配置枢纽。

经核对，**缺的不是骨架，是分区内容与后端接线**。按性质分三类：

| 类别 | 项目 | 现状 | 成本 |
|---|---|---|---|
| 接线型（后端已有，补 UI） | Git 平台关联、三层安全扫描入口、执行模式偏好 | 后端模块已存在，前端零接线 | 低 |
| 壳层型（Tauri 能力） | 系统托盘、开机自启、默认项目位置 | 需启用 Tauri 插件 | 中 |
| 功能型（全新 feature） | 速记板、回复批注、Workspace Actions、数据导入、Hooks 只读查看 | 无后端无前端 | 高 |

## 2. 需求清单与现状核实

### 2.1 Git 平台关联（接线型）

后端 `runtime/src/git_auth/` 已完整存在：

- `store.rs`：`AuthHost` 枚举（GitHub/Gitee）、`git_auth_status()`、`save_token()`、`logout_host()`、`token_for_host()`，凭据走 secret_store / OS keyring
- `github.rs`：`GitHubDeviceClient`（设备授权）+ `parse_device_code_json` / `parse_token_poll_json`
- `gitee.rs`：`GiteeOAuthClient` + `parse_gitee_token_json`
- `credential.rs`：git credential helper 集成

**缺口**：上述能力未暴露任何 HTTP 路由，设置 UI 也无入口。

### 2.2 三层安全扫描（接线型）

后端 `runtime/src/code_audit/` 已有：

- `scan.rs`：`AuditScanOptions{use_ai, max_files, max_ai_files, max_findings_per_file}`、`heuristic_scan_workspace()`（静态高危模式）、`run_audit()`（全量 + AI）、`run_diff_audit()`（增量）
- daemon 已有 `/audit POST`（`handlers.rs`）与 `/audit GET`（列表）

**缺口**：三层语义（静态 / 轻量 / 深度）未在 `AuditRequest` 上区分；前端无入口，仅有手动触发。

### 2.3 Hooks 只读查看（功能型）

- `runtime/src/hook/executor.rs`：`HookExecutor`（register / execute / names），当前 hooks 仅在代码内注册
- **缺口**：无用户级 `~/.sacode/settings.json` 的读取与解析

需求语义（来自参考实现）：只读反映磁盘配置，明确标注「这里只反映磁盘配置，不代表 CLI 已加载或执行」。

### 2.4 数据导入（功能型）

无现有导入器。需探测并只读解析其他工具（CodeBuddy / OpenCode）的配置，用户确认后写入 SaCode 配置。

- CodeBuddy：`%LOCALAPPDATA%\CodeBuddyExtension\...`（Windows）/ `~/.config/codebuddy`（Unix）
- OpenCode：`~/.config/opencode/` 或 `~/.opencode/`

约束：只读源工具配置、需用户授权、不写回源工具。

### 2.5 通用项

- 默认新建项目位置：新增 `defaultProjectDir` 偏好
- 界面语言切换：新增 `locale` 偏好（一期仅持久化，i18n 框架后续）
- 系统托盘 / 开机自启：需 `tauri-plugin-tray` / `tauri-plugin-autostart`
- 完全访问权限：复用现有 `ExecutionMode`（plan / build / auto），补语义说明

### 2.6 第二批（登记，本方案不实施）

- 速记板：Agent 回复划选文本持久化
- 回复批注：划选引用到输入框，可附加评论、后续回引
- Workspace Actions：任务 Header 本机工作区命令入口

## 3. 实施方案

### 3.1 Git 平台关联

新增 daemon 路由（挂 `build_router`，与 `/audit` 同层，受 token 中间件保护）：

- `GET /api/git-auth/status` — 各平台授权状态（复用 `git_auth_status`）
- `POST /api/git-auth/github/device` — 启动设备授权，返回 user_code / verification_uri
- `POST /api/git-auth/github/poll` — 轮询令牌
- `POST /api/git-auth/gitee/authorize` — 返回授权 URL
- `POST /api/git-auth/gitee/callback` — 回调交换 token
- `POST /api/git-auth/logout` — 断开指定平台

前端 `settings.ts` 新增 `git` 分区：卡片式平台列表（状态 dot + 关联 / 断开按钮），授权弹窗展示 user_code + 复制 + 轮询。

### 3.2 三层安全扫描

扩展 `AuditRequest` 增加 `scan_tier`（向后兼容，缺失默认 `deep`），在 `run_audit_scan` 中映射：

| tier | 行为 |
|---|---|
| `static` | `use_ai=false`，仅 `heuristic_scan_workspace` |
| `lightweight` | `run_diff_audit`（增量，可选 AI） |
| `deep` | `run_audit`（全量 + AI，跨文件追踪） |

前端 `settings.ts` 新增 `security` 分区：三档卡片（标注免费 / 增量 / 深度 + 说明），点击触发，进度展示，完成后查看报告；历史报告复用 `/audit GET`。

### 3.3 Hooks 只读查看

新增 `runtime/src/hook/settings.rs`：

- `load_user_hooks(user_root) -> Vec<HookConfig>`：读 `~/.sacode/settings.json` 的 `hooks` 数组，返回 `{name, event, command, enabled}`
- 文件不存在或无字段时返回空数组（fail-safe）
- **不执行** hooks

新增 `GET /api/hooks`（只读）。前端 `hooks` 分区：配置来源路径（mono）+ 计数徽章 + 列表；空态显示「尚未配置用户级 Hooks」；常驻说明「只反映磁盘配置，不代表 CLI 已加载或执行」。

### 3.4 数据导入

新增 `runtime/src/config/importer.rs`：

- `detect_external_tools() -> Vec<ExternalTool>`：探测已安装工具配置路径
- `read_tool_providers(tool) -> Vec<ImportedProvider>`：只读解析 provider / 模型条目
- `apply_imported_providers(workdir, providers)`：用户确认后写入 `provider.json`

路由：`GET /api/import/tools`、`GET /api/import/tools/:id/providers`、`POST /api/import/apply`。

前端 `import` 分区：工具卡片 → 展开可导入条目 → 勾选 → 导入。

### 3.5 通用项与壳层

- `DesktopPreferences` 新增 `defaultProjectDir`、`locale`
- `buildGeneralSection` 补：默认项目位置（目录选择）、语言（segmented zh-CN / en）、系统托盘 / 开机自启（toggles）、完全访问权限说明
- `src-tauri/Cargo.toml` 加 `tauri-plugin-autostart` / `tauri-plugin-tray`；`tauri.conf.json` 加 capability；`main.rs` 初始化
- `tauri-bridge.ts` 封装 Tauri command
- `bundle.active` 保持 `false` 不动（发布门禁另立专项）

## 4. 目录影响

```
runtime/src/
├── daemon/
│   ├── mod.rs                 # [MODIFY] 注册 git-auth / hooks / import 路由
│   └── handlers.rs            # [MODIFY] AuditRequest 增 scan_tier 映射
├── git_auth/store.rs          # [MODIFY] 暴露 git_auth_status 为 HTTP
├── hook/
│   ├── mod.rs                 # [MODIFY] pub mod settings
│   └── settings.rs            # [NEW] 只读读取 settings.json hooks
└── config/importer.rs         # [NEW] 探测 + 只读解析外部工具配置

interfaces/desktop/
├── src-tauri/
│   ├── Cargo.toml             # [MODIFY] 加 autostart / tray 插件
│   ├── tauri.conf.json        # [MODIFY] 加 capability
│   └── src/main.rs            # [MODIFY] 初始化插件 + commands
├── src/app/settings.ts        # [MODIFY] 新增 git / security / hooks / import 分区 + 通用项
├── src/app/service.ts         # [MODIFY] gitAuth / hooks / import / scan 方法
└── src/tauri-bridge.ts        # [MODIFY] autostart / tray 封装

interfaces/client-core/src/daemon-client.ts  # [MODIFY] GitAuth / Hooks / Import API
docs/reference/daemon-api.md                 # [MODIFY] 补端点文档
AGENTS.md                                    # [MODIFY] 同步端点描述
```

## 5. 关键代码结构

```rust
// AuditRequest 扩展（向后兼容）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRequest {
    #[serde(default)]
    pub use_ai: Option<bool>,
    #[serde(default)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub model_provider: Option<sacode_kernel::model::ModelProvider>,
    #[serde(default)]
    pub scan_tier: Option<String>,  // "static" | "lightweight" | "deep"，缺失默认 "deep"
}

// 只读 hooks 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookConfig {
    pub name: String,
    pub event: String,
    pub command: String,
    pub enabled: bool,
}
```

## 6. 约束与安全

- Git 凭据不进 localStorage，沿用 OS keyring
- 数据导入只读源工具配置、需用户授权、不写回源工具
- Hooks 视图严格只读，标注「不代表已执行」
- 安全扫描复用 `/audit`，不造第二套引擎；受 token 中间件保护
- `AuditRequest` 扩展向后兼容；新增路由不改现有端点
- Tauri 插件为增量依赖，不影响现有 sidecar 逻辑
- cron 时区统一 UTC（本方案无 cron，沿用既有约定）

## 7. 验证

- `cargo test -p sacode-runtime --lib`（git_auth 已有测试；新增 hooks 读取、import 探测、scan_tier 映射测试）
- desktop `npm run typecheck && npm test`
- 路由测试用 `create_daemon_in(tempdir)` 隔离，不触碰真实 `~/.sacode/`

## 8. 设计风格

延续 `tokens.css` 暖石墨 / 暖纸白双主题与卡片式 settings 骨架，复用现有 `settingCard` / `settingRow` / `settingToggle` / `segmented` 控件，不引入新视觉语言。

- **Git 分区**：平台行（logo + 状态 dot + 关联 / 断开按钮），未关联主强调色，已关联幽灵按钮
- **Security 分区**：三档卡片纵向排列（层级标注 + 说明 + 触发），历史报告折叠列表
- **Hooks 分区**：配置来源路径（mono）+ 计数徽章 + 列表（命令 mono）+ 空态卡片
- **Import 分区**：工具卡片 → 展开勾选列表 + 导入按钮

不涉及全局布局、导航、主题改动。
