# 客户端槽位与聊天插件装配验收

日期：2026-10-05。隔离目录：`D:/Temp/SaCode-model-tools-20261005`，基点 `7bb80ca`。本批承接冻结版 DSH 的普通槽位契约，不设计新市场，不将槽位接通记作完整插件架构完成。

## 冻结依据及实现范围

固定提交 `639ed015397290b3745d163aafe02ffee4aa3f84`，直接阅读 `packages/client/ui-slots/README.md`、`src/index.ts`、`ui-conversation/src/client/apply.ts`、`ui-chat/src/client/apply.ts`、`ui-trajectory/src/client/index.ts`。官方原文地址以 `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/639ed015397290b3745d163aafe02ffee4aa3f84/` 加上述路径组成。

- 纯 TS SlotCore 实现 single/list/keyed/chain、原始条目稳定快照、低 priority 遮蔽、同单元同 priority 冲突拒绝、list order、chain 首个非 null 选择、根与会话作用域、声明者身份限制、递归撤销和失效 disposer 幂等。
- ClientScope 统一拥有注册、订阅、effect 与注入子作用域。声明坍缩清理子作用域，重建声明后重新激活；同步初始化失败回滚，异步初始化明确拒绝，不能将 Promise 当初始化成功。
- Vue runtime + h() 适配器连接注册表与实际渲染；全部依赖构建期折叠并检查静态 bundle，复用唯一 globalThis.Vue，保持 script-src 'self'。
- 真实聊天挂载由 ui-conversation 声明 conversation.view，再由 ui-chat 注入。消费现有宿主投影 VNode，不另建会话历史；输入框位于视图槽位外，卸载视图不丢草稿。

## 已实跑验证

1. 槽位单测 **10/10 PASS**；严格 TypeScript 检查 rc=0；静态 renderer bundle 检查及构建通过。
2. Electron 开发态真实 DOM 冒烟 **254/254，0 FAIL，rc=0**。报告 `D:/Temp/sacode-client-slots-ui-20261005-c/ui-smoke-report.json`，日志 `D:/Temp/sacode-client-slots-ui-final.log`。新增 8 项验证聊天来源、遮蔽插件接管真实 DOM、草稿保留、卸载恢复、父声明坍缩、重建自动注入、聊天卸载及重装；没有用静态页面替代真实 Host。
3. 完整桌面 Node 测试 **181 总数 / 179 PASS / 2 凭据门控 SKIP / 0 FAIL，rc=0**；日志 `D:/Temp/sacode-client-slots-node-fixed.log`。跳过项不记为真实模型通过。本批 GUI 使用协议夹具；真实远端工具调用证据另见 model-tool-runtime 文档。

## 失败及修复记录

- 首次 GUI 失败是测试 evaluate 返回不可克隆 ClientScope；改为 void 返回，不改功能断言。第二次缺 SSE_OPENSSL，不能记为通过；补实际 OpenSSL 路径后完整运行得到上述 254 项。
- 首次全量 Node 测试读取用户默认模型注册表，覆盖夹具环境，出现流帧和轮次断言失败且遗留子进程。诊断仅输出配置字段与计数，未读取凭据正文：既有注册表有 1 个提供商且有默认项；空隔离用户目录返回 fake 提供商和预期 2 帧。
- 11 文件夹具修复为每次测试使用独立 SACODE_USER_SETTINGS_DIR，并清空继承的供应商环境密钥；显式夹具配置覆盖仍保留。未修改用户配置，未放宽原断言或时间预算。隔离提交 `7bb80ca`；主目录提交 `937f010`。仅清理核实为本批测试路径的进程。

## 仍未完成

完整 Service/Factory/Store、会话标准服务、locale、监督树、异步客户端模块、核心 profile 驱动客户端装配及用户本地插件加载尚未完成；不宣称 Cordis 源码兼容或自写插件产品闭环。本批只将既有聊天接入普通槽位，尚无轨迹视图、真实系统提示词查看器、完整工具插件分派或计划/反馈视图。不能以本批完成提升完整能力矩阵计数。

打包态验证及新的安装产物在实际完成后补记。真实安装/卸载、签名、发布均不属于本批已验证事项。
