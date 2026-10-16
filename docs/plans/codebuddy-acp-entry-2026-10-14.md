# CodeBuddy CLI ACP 产品接线

承接 OpenCode 后继续 CodeBuddy。仍复用共享 ACP 协议、委派、审批、取消、诊断日志和页面控制器，不建立另一套 Agent 或任务队列。提供方模型、登录与配置由 CodeBuddy 管理；默认不传模型覆盖、自动登录、跳过审批或沙箱参数。

## 固定事实与边界

本机程序为 `C:/Users/jingg/AppData/Local/codebuddy/bin/codebuddy.exe`，版本2.163.0。官方与本机帮助均声明 `--acp`；本机只读 NDJSON 直连完成 initialize 和 session/new，回执 model=hy3、mode=default，未发送prompt。没有agentInfo时保持未知，不能拿 --version 命令的结果冒充协议版本回执。Node直连不替代SaCode仓颉、Host、CLI、页面和产物验收。

官方依据：[ACP协议](https://www.codebuddy.cn/docs/cli/acp)、[CLI参数](https://www.codebuddy.cn/docs/cli/cli-reference)。默认沿用本机有效配置；`CODEBUDDY_API_KEY`只是可选认证途径，不是ACP准入硬条件。实际auth_required才提示用户在CodeBuddy处理，不复制凭据。

## 2026-10-15 接管更新

Codex已暂停ACP文件修改，本轮在授权范围接管。最新定向事实见[接管验证记录](../evidence/2026-10-15-codebuddy-acp-takeover.md)，下表保留2026-10-14计划快照，不再代表当前进度。

当前CB01–CB04已有独立生产构建、IPC/页面测试、核心审批取消结算、真实Host假提供方在途切换/设置门控与Host/CLI独立配置真实协议证据。默认配置仓颉session/new仍-32603，Node对照成功，根因未确认；不是默认配置产品就绪。实际Electron及最小无产品探针均启动退出0x80000003，窗口验收未通过。CB05真实模型任务未授权，未发送；安装/发布/其他平台未验，不据协议成功宣称产品完成。

## 接线顺序（历史快照）

| 工作项 | 状态 | 完成标准 |
| --- | --- | --- |
| CB01 专用提供方与发现 | 实施中 | 固定--acp、可信启动路径、无密钥硬门槛、取消前零启动、结构化发现错误；本机仓颉1.1.3验证 |
| CB02 提供方选择与开关 | 设计中 | 明确区分opencode/codebuddy，选择不启动；旧开关/诊断按OpenCode迁移解释，不能隐式启用另一提供方 |
| CB03 诊断与双入口 | 未开始 | Host/CLI有限peerId校验、单飞worker、持久诊断按提供方隔离、关闭/切会话取消、程序及协议错误分列 |
| CB04 委派与页面 | 未开始 | 复用ACP live runtime、原请求一次性审批、取消与终态；页面提供方选择后清除旧就绪与草稿回执，不串提供方 |
| CB05 真实任务与载荷 | 未开始 | 真实模型任务单独确认，记录权限、取消、输出和终态；统一源码重建载荷，不以协议初始化代替任务成功 |

## 兼容约束

当前acp/settings为两字段旧日志，AcpDiagnosticJournal以及Host/CLI/页面有OpenCode限定。公开接入前必须设计版本兼容和提供方绑定；不能只把peerId替换字符串后复用旧开启状态、旧诊断或旧运行时。选择有在途委派的提供方时先结算或明确取消，不擅自杀进程；恢复历史不自动启动任一提供方。

专用启动解析首批验证Windows原生exe；不执行当前目录或shell shim。其他平台的原生发现与提供方运行另行探针，不因路径函数存在宣称跨平台支持。配置风险、模型免费属性与实际任务仍各自验证。
