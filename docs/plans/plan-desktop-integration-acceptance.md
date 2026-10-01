# Desktop 集成验收清单

> 范围：MonkeyCode 对齐（UI 契约 + P0–P2 主项）+ 产品线后端接入。技术栈：Vue 3 + TS + Vite + TDesign + Tauri 2。
> 更新：2026-09-28。详见 `docs/PROGRESS.md` 与 `compose/spec/desktop-backend-wiring.md`。

---

## A. 自动化验证（已跑）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 桌面类型 / 测试 / 构建 | `npm run typecheck` · `npm test` · `npm run build` | ✅ |
| client-core | `npm run build` | ✅ |
| runtime identity / daemon | `cargo test -p sacode-runtime identity|daemon` | ✅ 49 + 81 |
| Tauri release | `cargo build --manifest-path interfaces/desktop/src-tauri/Cargo.toml --release` | ✅ |
| 三件套 ready | sa-idp:8080 · gateway-rs:8090 · sa-entitlement:8091 | ✅ ready/ok |

---

## B. UI 颗粒度（契约验收）

对照 `docs/plans/desktop-layout-contract.md`：

- [ ] 拓扑：左任务列 + 平铺分格；无 status-bar、无第三固定列
- [ ] 度量：chrome 40 / 细头 48；列表 12/4；缩进 20；`--chat-measure` 一条
- [ ] 中线：消息与 composer 同宽
- [ ] 列表：选中=填充；未读=竖条；状态点行尾
- [ ] 文件：格内 scrim + 侧板（非整页 drawer）
- [ ] 空格=装载卡；创建页 h-40 页头
- [ ] 焦点格标题下划线；⋯ 菜单拆分/独占/更换/重命名

---

## C. 功能链路（手工）

### C1 工作台
- [ ] 任务列显示工作区会话，点选入格
- [ ] 同一会话不出现双格
- [ ] 任务列宽可拖、双击复位 232、刷新后保持
- [ ] 新建 → 空格/当前格创建页 → 发送

### C2 会话
- [ ] 发送后卡片流更新（用户 / 助手 / 工具）
- [ ] 运行中状态行在 composer 上方
- [ ] 任务清单（plan）在 composer 上方可折叠
- [ ] 上下文用量 % 在 composer 右端

### C3 提问 / 审批
- [ ] `interaction.ask` 任务出现 AskCard
- [ ] 提交答案后续写会话
- [ ] 取消提问可结束等待

### C4 历史回放
- [ ] 退出应用后重开，工具/助手卡片仍可见
- [ ] frames 与在线过程一致（允许折叠）

### C5 附件 / 草稿
- [ ] 📎 上传文件出现芯片，发送后进 `context_paths`
- [ ] 未发送草稿在切换会话后恢复

### C6 文件 / 终端 / 预览
- [ ] 细头「文件」→ 侧板树 | 预览；目录展开才加载子层；预览 ≤100KiB 文本
- [ ] 细头「终端」→ 侧板；Tauri 下可执行命令、^C；Web 提示需桌面会话
- [ ] 细头「预览」→ URL + 前往/刷新；按工作区记忆地址

### C7 设置
- [ ] ⚙ 打开设置（覆盖工作台），左分类右滚动
- [ ] 服务：终端/托盘 + **MCP 列表**（启停/探活/增删）
- [ ] 技能：列表 / 新建 / 删除

---

## D. 后端 / 账号权益（手工）

- [ ] 设置→账号：登录 sa-idp → 状态显示 subject / 模型数
- [ ] 同步模型后 Composer 模型列表更新
- [ ] 授权权益 → 列表出现 capabilities / 有效期
- [ ] License 导入 → 状态展示 kid/过期时间
- [ ] 生成设备激活请求 JSON
- [ ] 无 `sacode_audit_export` 时审计导出 403；有权限可导出
- [ ] 退出登录后权益/模型 UI 清空

依赖：三件套就绪 + `apply_sacode_ent_client` 已执行。

---

## E. 回归注意

- 旧 `src/app` 手写 UI 仍在测试中；入口已切 `src/ui/main.ts`。迁移完成后可删旧实现。
- client-core 变更后需 `npm run build` 再编 desktop。
- runtime 新端点：`/task/:id/answer`、`/api/mcp/*`、`/api/skills*`、`/api/workspace/uploads`、`/workspace/list`、`/account/entitlements*`、`/account/license`、`/account/activation-request`、`/api/audit/export`。
- 格内侧板三件套：FilesDrawer / TerminalDrawer / PreviewDrawer，均 `scrim + absolute`，禁止整页 drawer。
- SaDesign / 知识库 / 自动化 API 在 `/api/design|knowledge|automation`，Vue 尚未迁 UI。

---

## F. 未做（按定位）

- P3：自动更新、下载坞、终端 VT（xterm）、预览 dev-server 自动发现
- 云端任务 / 浏览器桥 / WSL / 桌宠
- 回放大字段分页与折叠优化
- Vue 迁入 SaDesign / SaNative / 自动化；设置四页；审计导出按钮
- 删除旧 `src/app` / `src/components`（待测试迁移）

---

## 文档索引

- [布局契约](plan-desktop-layout-contract.md) · [颗粒度审计](plan-desktop-layout-audit.md)
- [对齐差距](plan-desktop-monkeycode-parity.md) · [桌面 README](../../interfaces/desktop/README.md)
- [后端接入 spec](../specs/spec-desktop-backend-wiring.md) · [进度](../STATUS.md)
