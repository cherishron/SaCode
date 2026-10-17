# CodeBuddy ACP 下一阶段白名单诊断

## 范围

用户选择默认配置原生差异排查与Electron窗口验收。持续目标goal-16205f6b-6d27-4b3a-ab0d-326c3a9ce156。不读秘密、不改默认配置、不降低隔离、不发送真实模型任务、不提交推送安装；保护其他会话。

## 第一轮启动上下文

工作区HEAD e10c601。现场无相关Electron/CodeBuddy/cjpm/cjc残留。PowerShell所在交互SessionId=1、父进程中完整性等级；不能据父进程推断提供方实际令牌。环境ELECTRON_RUN_AS_NODE=1；仅在诊断子进程环境清除并启用日志，最小Electron仍退出0x80000003，stderr空、Chromium日志未生成。

读取本地工具契约，cjpm init首轮参数错误（位置参数不支持），查help后使用--path成功。创建无业务核心依赖的cbcontext，std.process.execute启动固定Node白名单报告器，未改产品源码。构建exit0，只有unused import警告。与Node spawnSync以相同cwd启动相同报告器对照，USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/SystemRoot/PATH/ELECTRON_RUN_AS_NODE的存在性、长度和目录存在性完全一致，HOME均不存在。未输出配置/密钥/完整PATH。这排除本次白名单范围的缺失/截断，不排除值差异、进程令牌、DLL加载或协议运输。

结果在apps/desktop/.tmp-test/codebuddy-stage2-20261015/native-child-context.json、node-child-context.json；私有探针native-context。未跑真实模型或读用户配置。

## 第二轮实际身份差异

同一node-handshake.cjs：直接Node启动initialize/sessionNew成功、model=hy3；最小仓颠菜单std.process.execute启动该Node脚本则initialize成功/sessionNew=-32603。均modelTaskSent=false/exitObserved=true/命令exit0，排除SaCode核心及其ACP帧处理作为必需触发条件。

identity-context.cjs固定whoami /groups只提取Mandatory Label SID，其他输出不落盘。仓颉启动的Node后代标签S-1-16-4096（Low），直接Node标签S-1-16-8192（Medium）。Node可执行路径一致，PATH/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/SystemRoot白名单摘要完全一致。此为实测后代身份差异，不仅父进程推测。

只读icacls确认私有仓颉main.exe与工作区Electron.exe均继承Mandatory Label Low Mandatory Level (NW)，外部Node.exe无此显式低标签。说明执行文件位置/继承标签是关键启动上下文线索，不能将其当仓颉语言自身降权。低完整性上下文与默认配置失败关联已缩窄，但没有读取配置或确认具体被拒绝操作；-32603仍不解释为认证缺失。Electron也带低标签，但尚未证明其崩溃根因。

严格不修改ACL/完整性标签、不将可执行文件挪到高完整性位置以绕过、不改提供方默认配置。不通过提高权限制造验收成功。

## 第三轮保持Low边界复验

低完整性原生父进程经同一Node代理：默认配置sessionNew=-32603，独立全新私有配置sessionNew=true/model=hy4-preview。未提升身份或修改ACL，两次initialize=true/modelTaskSent=false/exitObserved=true，命令exit0。固定stderr错误类别EACCES/EPERM/ENOENT/SQLITE_READONLY/SQLITE_CANTOPEN等均未命中，原文不落盘。故无法确定默认配置具体被拒操作或数据库/日志归因；只能登记低身份与默认配置组合的实测差异。

Electron保留同样完整性边界以--enable-logging=stderr --v=1复验最小脚本，仍exit0x80000003、stderr空，无新故障线索。未改身份、关闭沙箱或更换运行二进制。

## 第四轮无应用入口对照

清除子进程ELECTRON_RUN_AS_NODE运行Electron --version（不加载任何应用脚本），仍exit0x80000003。保留已知Node模式运行该同一二进制可输出Node20.18.3/Electron33.4.11，exit0。Node模式不是窗口验收，不能拿它绕过GUI启动失败。已把失败缩到Electron正常模式初始化路径，而非SaCode业务入口必需触发；低文件标签是否为唯一原因尚未证实。

## 当前阻塞与安全续作条件

连续三轮在不改变完整性/沙箱/默认配置的边界内，Electron正常模式最小脚本、详细日志和无应用--version均0x80000003且无诊断输出；无法到达真实ACP窗口。默认配置失败已定位到相同Node脚本的Low/Medium实际后代身份差异与Low默认/独立配置差异，具体提供方失败操作仍未知，固定错误分类无命中。不读取密钥/配置正文、不修改ACL、不搬移程序提升身份、不用--no-sandbox。

后续需要用户提供可正常运行该Electron的合规交互环境或无秘密的崩溃栈/CodeBuddy错误分类资料，才能继续窗口和具体失败点验收。不要在当前约束下自动反复同样启动或将结果记完成。产品默认配置和Electron验收均未通过。

## 用户交互终端补充证据（06:24–06:39，Asia/Shanghai）

以下为用户粘贴的手工输出，不冒充工具端复跑：

| 场景 | 结果 |
| --- | --- |
| 普通桌面入口（后来确认该终端为High）Electron --version | v33.4.11，exit0 |
| 同终端最小app.whenReady探针 | exit0，06:24:09 ready=true报告 |
| High终端私有SaCode ACP窗口 | exit0x80000003，GPU process launch failed error_code=18，随后GPU不可用fatal |
| High终端--disable-gpu对照 | 同样GPU子进程错误与fatal，无验收报告 |
| 多次名为medium但whoami仍High | 不构成Medium对照，仍失败 |
| 06:39:04通过S-1-16-8192门禁的真实Medium终端私有窗口 | exit0x80000003，stdout/stderr空，无报告 |

据此修正：High不是失败必要条件，工具环境无应用入口失败不能外推用户交互环境；用户High窗口错误和Medium静默失败不能仅凭相同退出码判定同根因。error_code=18尚未核Chromium对应定义，不能当Windows错误码18、显卡驱动故障或权限故障。两个远端源码获取失败，不宣称已读定义。禁用GPU不等于禁用图形子进程，未使用--no-sandbox。

## 下一诊断切片

2026-10-15 06:42用户要求整理问题并继续下一阶段。已恢复目标，先准备最小空BrowserWindow探针，将脚本加载、ready、窗口创建、页面加载、renderer结束等阶段分开写白名单报告，不加载SaCode、不访问网络/模型、不改沙箱和权限。工具端无法进入脚本时应报告未到达，不把父进程exit0或组件测试记窗口PASS。再核现有ACP诊断分层文案，避免把-32603解释为登录要求。暂不要求用户重复相同命令。

已创建empty-window.cjs/html分阶段探针，Node语法检查exit0。默认sandbox=true、contextIsolation=true、nodeIntegration=false，本地无脚本HTML CSP default-src none，不加载SaCode。工具端运行仍0x80000003，未生成任何report.json，连script-loaded阶段都没有观测到；因此工具端这次不能判断BrowserWindow创建是否成功，也不能替代用户交互环境空窗口对照。作业已收取。现有acp-diagnostics.ts检查仍将模型/价格/网络标为未知或未测试，显示的是SaCode进程完整性而非提供方实际令牌，暂未改产品诊断文案。


