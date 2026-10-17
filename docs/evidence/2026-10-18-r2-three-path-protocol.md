# R2中性候选三路径协议验收：mock通过，真实LongCat待凭据（2026-10-18）

## 候选与范围

- 用户指定候选：`D:/tmp/sacode-delivery-R2-20261018/win-unpacked`。未构建、修改或另出候选包，未修改生产代码，未提交/推送。
- 包内实际Host为 `resources/host/bin/sacode-host.exe`，不是main.exe。SHA256：`a01957e0e68d6185a6a082e76161b62dd14b0c657f674a7a65e0d5e825e74f1f`；app.asar SHA256：`a31a9c075ecea7ea5d80aba341702cb7b70872ced03ebe05aac802b1b1950394`。
- 驱动：`target/tmp/three-path-longcat-20261017/driver.mjs`；使用用户指定managed Node 22.22.2，不使用系统Node代替。
- 驱动从工作区main.cjs抽取taskStart/turnPoll，使用既有HostBridge与model-approval；已独立对照包内同名文件：忽略CRLF/LF后三者文本一致，HostBridge字节一致。不是实际Electron IPC、GUI或安装态验证。
- 测试文件读写由真实Host工具执行；加法测试由驱动通过managed Node在外部执行，**不是产品受控执行器运行测试**。不以此宣称产品完整“改码→受控构建测试”通过。

## 驱动修正（仅测试代码）

1. VM补 `pageToolsWindow: () => null`，明确无GUI；pageToolBridge.attach桩一旦被调用即抛错，不能假装页面挂接成功。
2. 移除与本次单次任务无关的goal/create。首轮创建持续目标后，前三次模型调用和编辑成功，但Host自动进入后续目标轮次；mock拒绝第四次请求，导致interrupted=true。原失败证据保留，不关闭生产目标机制或放宽终态断言。
3. 真实分支set-default使用create-instance成功回执中的revision，而不是固定0；该分支尚未运行，不算验证通过。
4. 加强实际read成功、ok-edit、pendingToolCalls=0、测试源码未被改写及Host自然退出断言。denied可记录一次工具运行时校验尝试，但必须返回拒绝、无ok-edit且文件不变。
5. 失败诊断仅记录稳定分类，不输出外部异常正文/data；不复制、打印或落盘真实密钥。真实阶段只接受用户进程注入的SA_CODE_LONGCAT_API_KEY。

## 最终mock结果

证据目录：`D:/tmp/opencode-3path-mock-BrGVcq/`，含results.json、summary.json、candidate-identity.json以及各路径scenario.json/session.log。驱动SHA256：`1b5d9d4c6b5cb49b803ade0793f3e532ce9528c86fbff35bf0daaf55eaf792b0`。

| 路径 | 实际read | 实际edit成功 | 加法测试前→后 | 工具待处理数 | Host退出 |
|---|---|---|---|---|---|
| allowed-once | 是 | 是，a-b→a+b | 1→0，通过 | 0 | code=0，signal=null，forced=false |
| denied | 是 | 否，文件不变 | 1→1，预期保持失败 | 0 | code=0，signal=null，forced=false |
| cancelled | 是 | 否，文件不变 | 1→1，预期保持失败 | 0 | code=0，signal=null，forced=false |

- 三条路径均完整结算；allowed/denied finishReason=stop、interrupted=false；cancelled=true，取消到结算约66ms。
- mock请求数分别3/3/2；每条只有一笔edit审批提案，取消路径没有发送approval/answer。测试源码保持原样。
- request/end分别3/3/2条，均有实际协议日志；只读落盘日志，**没有验证冷启动回放**。

## 保留的失败记录

- `D:/tmp/opencode-3path-mock-JzfaH8/`：首轮持续目标额外轮次导致mock拒绝并中断。
- `D:/tmp/opencode-3path-mock-SXHdnX/`：修正单次任务后的初轮3/3通过，之后追加更严格断言。
- `D:/tmp/opencode-3path-mock-VcqH3P/`：增强断言误将tool/runtime/call当成成功编辑；实际denied记录为denied:edit:approval-denied，文件不变。最终按ok-edit结果和文件字节核验，未修改生产授权。

## 当前阻塞与下一步

**真实LongCat未运行**：本会话进程SA_CODE_LONGCAT_API_KEY不存在（仅检查存在性，不读取其值或其他磁盘凭据）。因此没有发送真实远端模型请求，没有3/3真实供应商通过读数。

用户在启动驱动的进程中注入该变量后，以同一R2 Host、去掉TPL_MOCK再跑。不要把密钥发到聊天或写入命令文件/日志；父进程已有变量不代表本会话已继承。R2包内host/bin清单未见ca-bundle.pem，真实TLS需按实际结果取证，不擅自补包、不降级证书校验。

本轮没有GUI、不调整Chromium沙箱或系统防护，不解除A3 GPU阻断、runtime分发风险或整体“未交付”状态。
