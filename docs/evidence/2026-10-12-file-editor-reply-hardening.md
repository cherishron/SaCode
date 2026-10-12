# 文件编辑保存回执校验与卸载保护（2026-10-12）

## 本批边界

用户要求继续处理不冲突另一个会话的业务问题。起点 `file-editor-state.ts` 无未提交差异，仅修改该文件、新增专属 `test/file-editor-recovery.test.mjs` 与本记录。未改模型、Host/core、IPC、app.js、公共打包配置或其他会话文件；未提交、发布、读取密钥或修改用户文件。

## 实际修复

- 原 `if (!answer.accepted)` 用真值而不是布尔判断，`accepted:"false"` 或 `1` 等非法回执可让编辑器调用 write。现仅接受对象回执的 `accepted === true`，保持核心一次性审批为最终守卫，不把此处缺陷扩大描述为核心授权绕过。
- API 边界改为 `Promise<unknown>`，读取、工单、审批、写入均先校验实际对象及字段类型；回执缺失或非法不再给用户显示原生属性访问异常，而是明确的阶段错误。
- 保存前读取失败不发工单；写入/写后回读未确认不推进已保存基线、不丢草稿。工具失败正文（如 fs-stale-version）仍保留，不吞成空成功。
- review/cancelReview/discard/reset 补 disposed 守卫，旧编辑器卸载后的同步调用不再改草稿状态。已有迟到工单拒绝路径保留，卸载后不主动写入。
- 没有修改差异算法、64K/二进制/截断限制、外部版本观察、原子写入或授权规则，也未实现 Git 写能力。

## 验证与偏差

1. 新专项红先：11条，3通过/8失败、rc=1。第一条实际证明非法真值会调用 write，其余覆盖非法回执的阶段错误及卸载保护。
2. 修复后新专项 **11/11、rc=0**。受控工具替身不读写用户文件、不起 Host。
3. 本来使用 `node --test --test-name-pattern="^(?!真实 Host)" test/file-editor.test.mjs` 排除真实 Host，但本轮实际未排除，最终 **8/8、rc=0**。如实登记筛选偏差，不称纯单测7条或跳过Host。真实Host用例只在新建 `.tmp-test/editor-*` 夹具工作区写文件，验证中文空白、外部冲突、审批期间版本变化和空正文；未重建Host。该证据基于当时现有开发宿主，不证明当前Host源码完整构建或新包。
4. `client-slots.ts` 真入口内存IIFE构建包含本状态模块，唯一 `globalThis.Vue` 与现有CSP/无运行时加载门禁通过，rc=0，未写公共vendor/dist。
5. `node --check test/file-editor-recovery.test.mjs` 与定向 `git diff --check` 通过。项目无lint/typecheck脚本及相关工具，不安装依赖，不将esbuild编译当完整类型检查。
6. 最终三批专属回归：`node --test test/file-editor-recovery.test.mjs test/plugin-manager-recovery.test.mjs test/permission-menu.test.mjs`，**36/36、rc=0**，无失败、跳过或取消；未再次运行真实Host用例。

## 剩余交付

本批是已有文件保存链路的回执安全加固，不是新增编辑器或完整Git工作台。实际Electron页面与新包尚需集成会话重建pages/vendor后验证；未覆盖用户正在运行的包。公共模型及权限持久化缺口仍未由本批处理。
