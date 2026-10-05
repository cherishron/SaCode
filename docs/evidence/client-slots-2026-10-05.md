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
4. 最终打包态真实窗口完整冒烟 **255/255，0 FAIL，rc=0**，`packaged=true`；报告 `D:/Temp/sacode-client-slots-packaged-ui-final-20261005/ui-smoke-report.json`，日志 `D:/Temp/sacode-client-slots-packaged-ui-final.log`。包含上述插件挂载、卸载、恢复与草稿保护，以及提示词增强和工具审批既有场景。主目录槽位加静态 bundle 测试合计 **11/11，rc=0**，日志 `D:/Temp/sacode-client-slots-root-tests.log`。
5. 后续整页滚动验收发现真实观察器缺口，修复后的最终源码为隔离 `864ee22`／主目录 `fcc9b4b`。两条新增回归先红：4 总数／2 PASS／2 FAIL，见 `sacode-client-slots-scroll-red.log`；实现后 **4/4 PASS**，见 `sacode-client-slots-scroll-green.log`。主目录同样 4/4，见 `sacode-client-slots-root-scroll.log`。以下日志均位于 D:/Temp。
6. 最终源码全量桌面测试 **183 总数 / 181 PASS / 2 凭据门控 SKIP / 0 FAIL，rc=0**，`sacode-client-slots-node-scroll-fixed.log`。补跑时一次未设 SSE_OPENSSL 导致 12 个夹具失败，`sacode-client-slots-node-final.log` 不记为通过；恢复环境后完整重跑，未放宽断言。
7. 最终源码打包态整页验收 **254 组 / 736 检查 / 0 FAIL，rc=0**，`sacode-client-slots-frame-fixed.log`；报告与截图目录 `sacode-client-slots-frame-fixed-capture-20261005`。同时补跑完整打包态 UI，仍为 **255/255、0 FAIL、rc=0**，`sacode-client-slots-packaged-ui-scroll-fixed.log`，报告 `sacode-client-slots-packaged-ui-scroll-fixed-20261005/ui-smoke-report.json`。真实窗口截图 active-conversation.png 已检视；整页夹具内主动触发缺模型错误属于预期场景，不能用该截图证明已选真模型运行。
8. 补 Host 打包依赖后最终全量 **186 总数 / 184 PASS / 2 SKIP / 0 FAIL，rc=0**，`sacode-client-slots-node-release-final.log`。新增打包测试先红 **1/3 PASS、2 FAIL**，再 **3/3 PASS**，分别为 `sacode-client-slots-host-pack-red.log`、`sacode-client-slots-host-pack-green.log`。真实 DLL 目录运行 pack-host 成功、91 文件逐个匹配发布资源，见 `sacode-client-slots-host-pack-actual-sdk-first.log`。

## 失败及修复记录

- 首次 GUI 失败是测试 evaluate 返回不可克隆 ClientScope；改为 void 返回，不改功能断言。第二次缺 SSE_OPENSSL，不能记为通过；补实际 OpenSSL 路径后完整运行得到上述 254 项。
- 首次全量 Node 测试读取用户默认模型注册表，覆盖夹具环境，出现流帧和轮次断言失败且遗留子进程。诊断仅输出配置字段与计数，未读取凭据正文：既有注册表有 1 个提供商且有默认项；空隔离用户目录返回 fake 提供商和预期 2 帧。
- 11 文件夹具修复为每次测试使用独立 SACODE_USER_SETTINGS_DIR，并清空继承的供应商环境密钥；显式夹具配置覆盖仍保留。未修改用户配置，未放宽原断言或时间预算。隔离提交 `7bb80ca`；主目录提交 `937f010`。仅清理核实为本批测试路径的进程。
- 打包态前两轮均完整结束但各有 1 FAIL：第一次在目录刷新尚未结算时断言重新选择已启用，第二次在同一合法禁用期间点击取消。分别见 `sacode-client-slots-packaged-ui.log`、`sacode-client-slots-packaged-ui-fixed.log`，均在 D:/Temp。没有认定为随机抖动或忽略失败：增加受控 session/catalog 响应闸，证明未结算时禁用、结算后启用；常规目录点击等待真实可交互状态，保持原 120×50ms 预算。主目录提交 `4d77a93`、`59363d8`；隔离提交 `50c8179`、`ca8005a`。最终完整 255 项通过。
- 独立 frame-smoke 首轮 rc=1：展开消息后 following=true，但 scrollTop=1222，实际底部=3202；见 `sacode-client-slots-frame.log` 及超时现场。这是实际实现问题：directive.mounted 时尚无消息容器，插件延迟挂载的新子元素未被 ResizeObserver 观察。修复增加子元素 MutationObserver，同步当前尺寸观察集合，取消旧容器观察，卸载清理两种观察器及待执行帧；重跑得到上述 736 检查通过，不以 UI 冒烟替代整页验收。
- SDK 环境隔离的便携／解包入口首次均 rc=1。直接入口捕获 Host `3221225781`（0xC0000135）；PE 导入诊断定位唯一未带入的非系统依赖为 `libstdx.net.tlsFFI.dll -> libwinpthread-1.dll`，来自 Cangjie/tools/bin。脚本现将它列为必带运行库，已有显式 DLL 目录可直接承接，缺失拒绝打包。隔离提交 `ebda418`、主目录 `ea35c12`。移除 Cangjie PATH 和相关环境、使用独立用户目录后，直接入口协议与持久化验收 **SMOKE PASS、rc=0、Host EOF code=0**，`sacode-client-slots-direct-sdk-fixed-protocol.log`。真实组装首轮因 PATH 优先命中 Git 的另一版 pthread 导致一致性检查失败；固定 SDK/tools/bin 优先后 91 个文件全部一致，未将不同哈希认定为同一产物。这是同机环境隔离，不能写成另一台无 SDK 机器验证。

## 仍未完成

完整 Service/Factory/Store、会话标准服务、locale、监督树、异步客户端模块、核心 profile 驱动客户端装配及用户本地插件加载尚未完成；不宣称 Cordis 源码兼容或自写插件产品闭环。本批只将既有聊天接入普通槽位，尚无轨迹视图、真实系统提示词查看器、完整工具插件分派或计划/反馈视图。不能以本批完成提升完整能力矩阵计数。

## 安装产物与一致性

最终打包基点为隔离 `ebda418`（追加 pthread 运行库；渲染层仍与 `864ee22` 的 UI/frame 验收内容逐字节相同）。electron-builder 使用本地官方 Electron 33.4.11，构建 rc=0；日志 `D:/Temp/sacode-client-slots-package-runtime-fixed.log`。已将本批产物保存到主目录 `apps/desktop/dist/electron-client-slots-20261005/`，不与其他快照安装包混用。

| 产物 | 大小（字节） | SHA256 |
| --- | --- | --- |
| SaCode Setup 0.1.0.exe | 83088414 | d3708bd9723059e6be45bb8728dd5275e61cb2ad7559a85b05015be6bdc4860d |
| sacode-portable.exe | 82936383 | b22d8aaf3e559ae320e76cdc8874462173706deb94c8dd4d7b92c8781a3e04de |

NSIS 仅解包取证，没有运行安装器。102 个打包源码文件逐字节匹配隔离源码（package.json 构建期转换另计）；app.asar 与最终 UI/frame 验收包及 NSIS 内相同，SHA256 `aaf1dbe1b71774e0a3f6540080c7708805639fd09ba2c5be9fe0341793b3c4f3`。源目录、win-unpacked、NSIS 内 91 个宿主资源全部相同，Host SHA256 `7af9fe6d10ba297d44466b5b6ef29edc228c89fe9af09c3e0744d0bddba37d30`。运行时 node_modules 条目为 0；manifest 见 [产物账本](client-slots-artifacts-2026-10-05.json)。

最终便携入口移除 SDK 环境后 `--smoke` **rc=0**，`D:/Temp/sacode-client-slots-portable-fixed-protocol.exit.json`；独立 session.log 核对为 6 条持久事件，最后一条为冒烟屏障实际提交的 assistant/message。便携启动器未转发 stdout，不宣称捕获其 SMOKE PASS 文本。直接解包入口已捕获完整 SMOKE PASS 和 Host EOF code=0。新增 pthread SHA256 `a10833b977a83946f1b8aeb1c8cef33e3f7f86e10f7b3406d058abbb9027191e`，不是从 Git 的另一个同名 DLL 混入。

主目录槽位功能提交 `53170e7`，隔离提交 `797f5c1`；滚动修复主目录 `fcc9b4b`。本包包含已收尾增强、共享模型工具管线及本批槽位／滚动修复，未含主目录未提交目标卡或其他并发改动。真实安装/卸载、签名、发布、无 SDK 的另一台机器验证及 CLI npm 重打均未完成；不将当前增量包认定为完整产品。
