# CodeBuddy ACP：提供方基础与协议探针

基线b512b65加本批明确文件。产品仓库D:/Project/sa/saai/sa-code，分支refactor/dsh-learning。不是CodeBuddy产品完整接线验收。

## 当前改动

新增CodeBuddyAcpProvider，复用现有AcpProtocolProvider、AcpProcess及取消判据，固定启动向量为可信程序加`--acp`。默认不传模型、Agent、登录或跳过权限参数，不读取认证库。可信环境可指定程序路径，Windows PATH只接受绝对目录里的原生codebuddy.exe，不运行当前目录或shell shim。缺程序/发现未知/取消分别反馈，不回显底层配置或异常正文。

通用环境表移除CodeBuddy对CODEBUDDY_API_KEY的硬前提，已有登录状态或其他认证方式不再因此被误判缺认证。它不证明模型可以调用；只有实际ACP要求认证才归为auth_required。

## 验证

- 本机codebuddy.exe --version返回2.163.0；帮助包含--acp。官方：[ACP](https://www.codebuddy.cn/docs/cli/acp)、[CLI参数](https://www.codebuddy.cn/docs/cli/cli-reference)。
- 仓颉1.1.3专用契约：TOTAL420/PASSED3/SKIPPED417/ERROR0/FAILED0，rc=0。验证固定启动参数、配置保留、取消前不启动/不解析、失败脱敏及不执行shell shim。没有执行虚构exe。
- 环境专项：TOTAL420/PASSED9/SKIPPED411/ERROR0/FAILED0，rc=0。CodeBuddy测试明确禁止API_KEY硬前提；保留其他提供方既有用例。不是全量core通过。
- Node直连真实CodeBuddy：initialize与session/new成功，NDJSON/protocolVersion1，默认模型回执hy3、模式default；agentInfo未返回保持未知。未发送session/prompt。探针EOF后仍未退出，终止本次持有的进程，close观察SIGTERM；不是模型任务成功或全部孙进程树验收。
- 仓颉原生真实探针未通过：Low上下文的initialize通过、session/new返回未确认，model/mode均未知；不归因为认证。初轮临时目录清理被占用，覆盖为单测ERROR，TOTAL421/PASSED0/SKIPPED420/ERROR1/FAILED0，rc=1。清理错误不是协议成功证据。后续尝试仅输出错误码和类别的私有探针遇到测试runner内部nOutputs/nResults不一致，rc=1、无可信Summary；不作为通过读数。检查终态后未见存活CodeBuddy进程，没有杀其他会话进程。下一步用独立原生程序定位协议错误，避免把测试runner异常当产品结论。

原件在忽略目录apps/desktop/.tmp-test/：approval-binding-candidate/codebuddy-provider-core.log、codebuddy-env-core.log、codebuddy-native-probe.log、codebuddy-native-detail.log；codebuddy-protocol-cb7f1437d65040ff814c06ae0897cff8/protocol-report.json。本机路径、版本和model/mode是本次环境事实，不固化为其他机器默认值。

## 公开接线缺口

Host/CLI/IPC/页面目前仍有OpenCode限定，提供方选择、独立开关、诊断绑定和运行时归属尚需扩展；本批未默认为用户启用CodeBuddy。仓颉原生真实协议、真实委派任务、取消/审批终态及最新载荷分别验收。真实模型请求需要独立确认，不通过自动登录或静默换模型满足测试。
