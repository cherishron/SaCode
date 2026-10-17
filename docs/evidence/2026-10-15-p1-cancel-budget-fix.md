# P1取消与请求预算修复台账

## 授权与基线

用户在上一目标收口后要求“设定下一步目标并继续”。本阶段限定静默SSE有界取消、请求侧上下文/输出预算的最小生产修复及本地合成回归；不扩展MCP、不调用真实模型、不安装、不提交推送。既有未提交内容保留。前置证据见[验证台账](2026-10-15-self-core-verification.md)。

已重读现行PRD、平台要求、文档导航、测试规范及实际CangjieSkills README/SKILL。项目保持SDK1.1.3、stdx1.1.3.1，不执行技能建议的自动下载/clean。当前无cjpm/cjc占用。

## 第一轮：设计约束核实

已读[RealSseProvider](../../core/src/sse.cj#L39-L217)、[closeResources](../../core/src/sse.cj#L420-L441)、[TurnToken](../../core/src/cancel.cj#L33-L71)。现状是同步body.read期间只有取消标志，无法主动唤醒；资源关闭在读取返回后执行。

通过技能查询脚本分别查询Client.close、HttpResponse.close、HttpRequestBuilder.readTimeout精确叶子：Client.close关闭所有连接且不再可发送；Response.close可关闭未读完body、HTTP2发Reset；请求readTimeout覆盖Client配置。额外检索线程安全/取消并未得到InputStream可取消或Client跨线程安全保证。技能文档不自动等于当前stdx实现契约，下一步须核匹配版本源码或构造当前SDK编译/运行探针。

不采用下列伪修复：单纯缩短所有请求读超时；超时后无依据继续读取可能已失效的HTTP流；取消即返回但把阻塞Reader留在后台；扩大红测期限；跨线程同时改动Provider解析状态。取消后不重发模型请求、不削弱TLS。

当前尚未修改生产代码；需先确定安全唤醒路径与资源归属，再实现并以严格静默流红测、慢流非取消、服务端断开、审批等待取消及账本结算验收。

## 持续第一轮：匹配版本源码确认

Web搜索接口余额不足、raw GitHub获取失败，未改用户网络配置。改用官方仓`https://gitcode.com/Cangjie/cangjie_stdx.git`，只读获取v1.1.3.1，SHA `8fa4b04b4cb1753e8f3581e4935cf72ad145fedc`，位于忽略临时根stdx-cancel-contract。

已读该版本Client.close（493–498）：原子isClosed.swap保障单次关闭；HttpEngine1.close（486–504）持连接锁，逐个关闭pool和in-use连接并取消timer；closeConnInUse（443–457）也持同一锁。HttpResponse.close只下发body Resource.close。由此优先研究取消监护仅关闭本请求独占Client、不并发操作Provider解析状态的方案，原Reader线程仍负责返回/异常、资源回收与账本结算；监护Future必须被持有并在Provider结束时退出/等待。不把原Reader遗弃到后台。

这只是源码设计依据，尚未完成当前DLL探针或业务实现；HTTP2及TLS具体唤醒仍需运行覆盖，不凭源码锁就宣称所有平台安全。下一轮先做最小运行验证，再接入。

## 持续第二轮：最小探针编译通过、运行尚未就绪

新增可提交的[关闭探针](../../apps/host/test/fixtures/models/client-close-probe.cj)及[本地驱动](../../apps/host/test/models/client-close-probe.test.mjs)。目标是服务端发送首块后静默、原Reader阻塞，再由另一线程Client.close，并要求2秒内join原Reader、服务端观察断开。仅127.0.0.1、白名单环境、有界清理。

当前SDK直接cjc编译退出0，但运行返回3221225477（Windows访问冲突），stdout/stderr均无阶段输出，未证实执行到关闭操作。初次PowerShell未引用-lstdx.net.http参数导致参数分拆，已修；补齐全部stdx链接依赖后仍在首条输出之前异常。不能将该结果归因于跨线程close，也不能将它当唤醒成功。后续改用cjpm官方工程骨架/匹配运行布局对照，先证明简单入口启动，再测关闭。保留失败断言，不转skip、不改业务代码。本轮所有后台探针任务已收集。

## 持续第三轮：启动对照排除HTTP专属故障

工具来源为本机SDK cjc1.1.3、target x86_64-w64-mingw32。尝试cjpm官方init，同样返回3221225477；cjpm init --help无输出退出1。独立无任何HTTP导入的`main(){println(...)}`编译退出0，运行返回-1073741819；此前第八轮通过的CLI独立包执行--help也返回-1073741819（与3221225477同一0xC0000005）。注意承载PowerShell命令最终exit0只是最后Write-Output成功，不代表两个二进制通过。

结论：当前启动异常不局限HTTP探针，不能归因close并发。SDK运行库与旧CLI副本同为1276416字节（体积相同不证明内容完全相同）；未重装、未改变系统权限/运行参数。先继续只读定位当前运行环境，暂不启动长构建或宣称修复通过。生产源码仍未改；该环境问题只持续本轮具体对照，不提前将目标标blocked。所有本轮后台任务已收集，无运行中的编译任务。

## 持续第四轮：外部启动障碍确认

只读Windows Application事件1000显示：hello.exe、旧独立CLI和cjpm.exe均在msvcrt.dll（7.0.26100.9711）偏移0x62f1e访问冲突0xc0000005。此证据定位故障模块，不证明Windows DLL本身有缺陷，调用方/环境根因仍未确定。SDK和独立CLI的libcangjie-runtime.dll SHA-256相同。最小白名单环境（仅SystemRoot、包目录PATH和合成开关）运行仍返回3221225477。

相同启动条件已连续第二至第四轮阻断，不能执行SDK唤醒探针、cjpm工程构建或Host回归；未能安全验证两项生产修复，目标不标完成。需要先恢复当前Windows上简单仓颉main、cjpm及已知CLI正常启动；具体处置需用户授权，不擅自替换系统DLL、安装或重装SDK、关闭安全软件。后续可授权独立诊断（崩溃栈/受控调试）或提供已确认可运行的环境；不能把源码层修复当已验收。保留现有测试失败与所有未提交内容，生产代码未修改。

## 用户授权恢复：已有调试工具采栈

用户明确同意只诊断自建最小程序、采调用栈，不安装/不改系统设置。目标恢复。Windows Kits只有调试DLL、无cdb；SDK内lldb启动缺DLL（-1073741515），cjdb退出1。找到本机DevEco SDK既有LLDB15.0.4可用，仅用它启动自建hello.exe。

成功捕获：`msvcrt!wcslen+78 ← MapleRuntime::WinModuleManager::ReadWinModuleAtInit+143 ← CangjieRuntime::Init+240 ← CreateAndInit ← CJ_MRT_CjRuntimeInit ← hello CRT`。读取地址0x00620026；调用者反汇编显示从PEB/Ldr链取模块信息后调用宽字符长度函数，尚未进入用户main。是运行时初始化中的模块枚举路径，不是SSE、HTTP或模型业务代码。确切根因需匹配运行时源码及结构布局继续确认，不能把模块名直接当责任归属。

调试日志留忽略临时根sse-close-probe，文本证据仅保留调用链，不采真实用户进程。第二次LLDB会话显式process kill，exit0，无残留hello进程；第一次取反汇编命令引号错误退出1，已有栈仍有效，第二次重取成功。无系统设置变更、无安装。下一步只读核运行时源码与模块枚举契约。

## 持续第五轮：匹配运行时源码与现场结构

获取官方cangjie_runtime v1.1.3，SHA `fc9f54db5d92079eb1845968abe98e52df92d70d`，只读副本在忽略临时根cangjie-runtime-contract。WinModuleManager.cpp:78–114：head取InMemoryOrderModuleList.Flink（首元素），do遍历至iterator==head；链中哨兵仍可能在返回首元素前被当普通LdrDataTableEntry。第92行std::wstring(Buffer)与现场wcslen吻合。

现场r12（当前链节点）落在ntdll映像，r13（首元素）为堆地址；r12+0x50值0x00620026被当宽字符指针。结合遍历方式，强烈怀疑哨兵误读，但还需直接比较真实哨兵地址，不能把推断升格为定论。两次查询PEB表达式失败（__readgsqword未声明、LLDB无gs_base寄存器），未改目标内存；失败后按确切ExecutablePath清理自建hello进程。任务均已收集。

不在本阶段擅自二进制patch运行库、替换SDK、跳过初始化来制造测试通过；后续只读确认并整理上游最小复现/处置选择。

## 持续第六轮：哨兵误读现场确认

LLDB在自建hello异常处选frame1：r13为首模块链节点，读取其两个LIST_ENTRY指针，Blink等于故障节点r12；表达式`*(unsigned long long*)($r13 + 8) == (unsigned long long)$r12`返回true。结合故障节点Flink等于首模块（第五轮已读），这是首元素前的链表哨兵，不是普通模块。运行时以首元素为终止点的遍历经过该节点，误取+0x50为名称指针0x00620026，触发wcslen访问冲突。会话process kill成功，LLDB退出0，无目标内存写入。

结论限当前最小程序、匹配1.1.3运行库与源码：启动故障有具体SDK模块遍历边界原因；为何早前同程序可运行尚不确定，不归因Windows更新/杀毒软件。修复方向是使用`&Ldr->InMemoryOrderModuleList`作为哨兵并在转换条目前判终点，而非仅判Buffer非空；这是上游运行时修复，不是SaCode业务补丁。

安全下一步需用户选择：授权评估并构建独立临时运行库源码修复（不安装、不覆盖SDK或正式包，若缺依赖停止报告），或提供已修复且验证可启动的兼容SDK/环境。不得直接改系统DLL或给未知下载替换运行库；私有修复通过也只登记该非官方运行库条件下结果，不能冒充原版SDK验证。原目标两项业务修复尚未实施。

## 用户授权隔离构建后的前置核查

用户选择“授权隔离构建”，随后要求检修/继续。已仅在临时上游源码副本修正head取地址、iterator从head->Flink开始、while入口排除哨兵；diff --check通过，未修改SDK或正式包。新增独立C++结构回归覆盖空链/一模块/两模块，clang编译运行退出0；只证明遍历结构边界，不是运行库已构建或仓颉启动恢复。

阻碍：官方README明确Windows产物须Linux交叉编译，Windows原生构建不支持；build.py的windows-x86_64分支要求target-toolchain（示例mingw-w64-v11.0.1）。本机wsl --list --quiet退出1，Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG；未发现docker命令。未安装/修复WSL、不强行改官方构建系统、不进行二进制patch。按所授权“缺依赖停止报告”边界，完整私有DLL尚未构建，原P1回归仍不能执行。需要可用Linux交叉构建环境及匹配工具链，或另行授权环境准备；不能拿结构回归PASS替代真正启动与取消验收。

## 用户再次继续：本机环境方案只读评估

14:09后重新执行hello和旧CLI --help均仍返回-1073741819；导出固定SHA的最小patch至忽略临时根，未替换SDK。用户选择“授权评估本机环境安装方案”（仅评估，具体安装需再次批准）。

只读结果：Get-ComputerInfo报告build26300、HyperVisorPresent=False（产品名字段Windows10 Home China/Version2009可能为兼容字段，不据此判断真实营销版本）；CPU VirtualizationFirmwareEnabled=True、SLAT=True。WSL Appx包2.3.26.0对当前用户显示Status Ok，但未查询到WslService/LxssManager；vmcompute存在、Stopped/Manual。WSL先前REGDB_E_CLASSNOTREG说明当前调用/注册有问题，包Status Ok不能证明WSL可用。OptionalFeature两个状态查询均要求提升权限，当前无法判断启用状态；未提权、未改设置。

建议先由用户在管理员PowerShell只读查询WSL/VirtualMachinePlatform功能、WSL服务及hypervisor启动项，再决定官方WSL包修复与必要组件启用。可能需要管理员权限、下载发行版、磁盘空间和重启，但当前证据不能断言一定重启或只需重装。禁止卸载发行版/删除VHD（现有数据状态未知）。本阶段不运行安装、enable-feature、bcdedit写操作或系统重启。

## 用户指定Windows优先：原生配置实测

用户明确无Linux环境，要求先用Windows、优先编译Windows。目标已更新，不再要求准备WSL。实际CMakeLists包含Windows宿主调用build_cjthread_windows.bat分支，该bat存在，说明README“不支持原生”不能替代逐项实测。

使用已有clang22.1.0、cmake4.3、DevEco附带ninja，隔离配置runtime-native-win-build。CMake识别C/C++/ASM后编译最小C对象成功，链接失败`unable to execute command: program not executable`；没有生成运行库。首次CJ_SDK_VERSION参数被PowerShell拆成`.1.3`，下次须整体引用。已发现多个Windows ld.lld.exe可用于下一步明确指定链接器；还需匹配MinGW sysroot/libc++/boundscheck，不跳过编译器检查假装配置通过。所有产物在临时根，未安装/覆盖SDK。

## 持续第七轮：Windows LLD可执行，推进到系统库缺失

明确指定SDK已有ld.lld15.0.4（--version正常）与SDK裁剪的mingw/lib。首次命令行含空格路径被PowerShell拆分；改独立临时toolchain.cmake后链接器成功被调用。当前CMake最小测试链接准确报缺gdi32、winspool、ole32、oleaut32、uuid、comdlg32库，不再是链接器不可执行。尚未通过CMake配置、没有生成DLL。

定向检索SDK/DevEco与已有clang目录未找到可用MinGW windows.h或SDK libc++ __config；SDK只有裁剪系统静态库和libc++.a，不是完整C++开发sysroot。CMake默认列表中的部分GUI库可能并非运行库必须项，下一步可在临时toolchain剔除无关默认库验证真正依赖，但不能用CMAKE_*_COMPILER_WORKS强制伪通过；缺失Windows头/libc++头及boundscheck仍需逐项核。不安装工具链、不改SDK。

## 持续第八轮：CMake最小链接通过，实际编译暴露开发头缺失

临时toolchain去除无关GUI/COM默认库后，缺Clang22 Windows GNU builtins；复制SDK已有Windows libclang_rt-builtins.a到临时resource布局，显式传给链接器，最小C/C++ ABI编译链接均通过，CMake配置/生成退出0。该检查未使用强制COMPILER_WORKS；输出的working compiler skipped来自此前ABI链接成功，不是人工跳过。上游CMake自动获取固定boundscheck提交2ae82839ecaaa7d031e66ccbd2076d671acfd615，未运行安装脚本。

但配置阶段CJThread子脚本报路径不存在仍打印done，不能登记其成功。将install prefix显式限临时根（未执行install），尝试173步实际编译。首先上游config覆盖CXX为不存在的clang++.exe；已在临时副本保留检测出的绝对clang路径。随后实际源码编译失败：atomic/cstddef头不存在，确认当前GNU目标缺libc++开发头。没有修复DLL、仓颉启动仍未恢复。

后续需找到或经用户允许取得匹配Windows GNU开发工具链（头/库/汇编等），不能借用MSVC/OHOS C++头强行混搭。继续Windows原生方向，不要求Linux；仍不安装、不覆盖SDK。所有后台构建已收集，未改SaCode业务源码。

## 持续第九轮：便携工具链授权与下载失败

已读CJThread Windows bat，依赖mingw32-make且会删除自身output/build目录，不能原样盲跑；后续需临时构建适配、独立输出与严格子进程退出码。用户明确允许从LLVM-MinGW官方发布下载Windows x64便携工具链，仅临时解压，不安装、不改PATH或SDK。

GitHub官方API查到20230614的msvcrt-x86_64.zip，大小129226864字节；API未提供digest，不能虚称已核官方校验和。该版本实际LLVM版本待解压后--version核对（日期不证明LLVM15兼容）。官方下载URL连接失败，未取得归档、未解压。下载命令未设ErrorActionPreference=Stop，后续命令继续并错误打印“解压完成”、shell退出0；实际stderr有连接/文件不存在错误，故本轮明确登记下载失败而不是成功。下一次下载驱动必须fail-fast并验证大小/结构/来源和本地hash。未执行安装脚本，当前依赖缺口未解除。

## 持续第十轮：限时重试失败，明确暂停点

按用户对进度偏离的提醒，本轮仅作一次限时官方资产下载，不扩建SDK工程。重读PRD/平台要求/文档权威规则并核工作树，广泛未提交工作保留未动。curl --fail --location --connect-timeout15 --max-time90，实际15秒连接超时，exit28；驱动fail-fast退出1，未继续解压，没有成功提示。所有后台任务已收集。

第8–10轮连续存在同一依赖阻碍：现有Windows GNU目标缺libc++开发头（atomic/cstddef）、完整sysroot与可工作的CJThread构建依赖；获准下载便携工具链后官方资产仍不可达。当前没有修复DLL，无法恢复仓颉最小启动，Client.close及业务红测不能运行。停止自动重复同类SDK尝试；恢复条件为官方便携工具链可取得或用户提供本地完整工具链路径。不能用旧PASS、结构测试或CMake配置通过替代P1验收，两项生产修复仍未实施。

## 用户纠偏：第二阶段重新成为首要任务

用户明确指出首要任务是第二阶段。目标已改回两项P1业务修复并恢复，不再以SDK构建成功作为准备最小业务补丁的前置，不继续下载/扩展工具链支线。

重读已取得技能README/SKILL及测试规范，批量查询Future.get/AtomicBool/sleep契约；保留项目1.1.3/1.1.3.1依赖，不按技能默认版下载或clean。首个生产候选改动在core/src/sse.cj：真实HTTP每次阻塞read配属独占Client取消监视Future，每20ms检查token，取消仅close该Client；读取线程保留解析/资源/账本唯一所有权，finally停止并join监视器。测试注入InputStream不假定可跨线程close，构造器不创建后台任务，避免原构造器复制所有权泄漏。正常30秒读超时不降低。

这只是待编译/运行的候选，不宣称有界取消修复已验收：Client.close是否有界解除read仍需探针，连接打开/错误响应体读取尚未纳入监视，本次目标严格静默SSE读取路径。每次read创建Future的开销与monitor.get异常路径也需回归审查。

git diff --check通过（仅行尾提示）；无其他cjpm/cjc争用后尝试根cjpm build，返回3221225477，仍为已知启动故障，未取得编译器语法/类型或回归结果。未继续环境支线。下一步补取消重复/正常结束资源回归，并把保存的预算字段接到真实请求前校验与输出上限参数，失败必须先于派发标记/预留。

## 持续第十一轮：预算生产候选接通

AttemptPlan新增contextWindow/modelOutputLimit/maxOutputTokens不可变字段（默认未配置），planFor从实际上游模型及自定义模型读取，withAttemptId完整保留。Host请求装配明确传入三字段，仍先于凭据解析、预留、markDispatched。modelRequestJson选择模型输出上限与自定义预算的较小正值，真实JSON新增max_tokens；容量支持十进制K/M，非法/零/过大容量拒绝。上下文校验包含完整messages、工具定义UTF-8字节与256结构余量及输出预留，超限显式request-context-limit，既不截断日志也不自动重放/压缩。

限制：无模型tokenizer，文本字节守卫仅保守本地策略，不是精确模型token计数/费用；256结构余量不是经过模型验证的绝对上界。配置上下文限制的图片请求明确request-context-image-unestimated，不将base64字节冒充图片token。当前仅OpenAI completions Host生产路线，max_tokens兼容性需按所支持模型实测，不能冒称Responses等协议完成。此策略待后续审查，未取得运行证据。

新增core源码包内model_request_budget_test.cj四项回归源码：容量解析、输出较小值、超限不改原事件、输出预留/模型cap。按测试发现规则不外迁。git diff --check通过，尝试根cjpm build仍3221225477；未进入语法/类型检查，测试未执行。本轮无SDK构建/下载，业务候选已有实际改动但两项尚未验收，继续补Host验收及取消资源断言。

## 持续第十二轮：诊断用例升级为修复验收源码

Host本地合成套件由16变17项源码：原“服务端放行后才结算”的诊断断言改为不调用releaseStream、必须客户端主动断连、pendingToolCalls/pendingReservations/unsettledAttempts均零且不重发。保留原严格有界取消用例。原预算缺口诊断改为task/start明确request-context-limit、上游零请求、账本无预留/待核算且session/projection仍含完整原文；新增两次真实请求分别验证自定义cap8/模型cap16的较小值写入max_tokens。断言不以修改后的缺陷行为为PASS。

node --check与本批git diff --check退出0（仅SSE行尾提示）；这只是语法/差异检查，不是17项运行PASS。没有可用的新Host，未执行旧二进制套件冒充当前验收。检查AccountedModelProvider：取消后close走recordRouteFailure/voidAttempt，作为零遗留断言的源码依据，运行仍待验。

用户关于LLVM的质疑已澄清：现有SDK确有LLVM15后端/LLD/预编译运行库，SaCode与magic-cli应用构建都走已安装SDK/cjpm；缺完整LLVM-MinGW只影响额外“重建SDK运行库”支线，不是SaCode从未编译过。该支线保持停止，本轮只改Host回归源码/文档。

## 第十三至十四轮：直接cjc构建与首轮真实回归

第十三轮补容量非法输入、工具schema占用、未配置输出与非法输出共六项预算单测源码。cjc --help正常，可绕开cjpm直接编译业务；首次生产core因缺实际core.launch_context子包失败，不创建替代stub。第十四轮先编译该实际子包成功，再编译所有非_test核心文件静态库成功（25条既有警告），两项候选通过类型/代码生成。其他项目正在编译，不动其进程/target；本轮输出独立临时根。

Host首次链接错误地使用-llaunch而文件名launch.a，退出1；改显式真实core/launch静态库及stdx DLL链接后Host构建成功（4条警告）。用现有pack-host私有打包、原SDK DLL，未修改SDK或运行时。当前新Host实际可启动；此前崩溃与当前差异原因未确认，不能声称SDK缺陷已修复。

本地17项实际运行：15PASS/2FAIL，约9.28秒。原严格静默取消PASS（整用例约0.48秒），增强用例客户端断连/取消/pendingToolCalls/预留断言通过，但unsettledAttempts预期0实际1失败。输出预算实际max_tokens较小值PASS；超限测试task/start同步reject预期未发生，需核异步回合错误契约并保持上游零请求/日志完整断言，不能直接删除。其余工具、隔离编辑/取消、恢复等PASS。目标尚未完成；下一步针对这两项失败核真实结算语义与异步状态，运行六项预算单测。

## 持续第十五轮：17项Host回归通过与契约纠正

查ledgerStatsJson混合了缺价/usage待核算与已派发未结算读面。UsageLedger.voidAttempt仅释放实际预留，无预留返回no-reservation；已送达上游的静默取消不应推定费用为零。故增强测试改为明确保留一条待核算事实，同时要求attempt/failed+cancelled落盘、零预留、零pendingToolCalls、服务端主动断连，冷重启后待核算ID不变且不重发。这是纠正“所有unsettled必须零”的错误预期，不是删除资源/账本要求。

Host通过DeferredProvider异步routing.open；超限不是task/start同步错误，ModelAgentRunner捕获后finishReason=error:request-context-limit。测试按真实契约要求该准确终态、interrupted、零上游请求、零预留/待核算及原投影完整。未修改生产实现以迎合错误测试。

同一新编Host完整17项重跑：17PASS/0FAIL/0SKIP，6.78秒；取消严格用例整用例0.55秒，增强取消/断连/恢复0.73秒。node检查与diff检查正常。这仍非完整workspace/安装态/真实提供方验收。

六项预算单测首次错误地只传同包测试文件但未用test-only/生产可见性，undeclared错误退出1；已改真实全部生产源码+该测试同编，无stub、未改包名，独立构建已退出0（602条包含未用生产成员的警告）；隔离打包运行预算单测6PASS/0FAIL/0SKIP，退出0。测试含全部真实生产源码而非重复算法，只有六项无文件产物的预算测试被纳入。全部后台任务已收集。

## 持续第十六轮：重复取消与SDK探针

新增同Host三轮静默取消/正常请求交替测试，每次取消独立<3秒、服务端观察断连、pendingToolCalls/预留零，随后正常文本请求不被旧token污染，六次请求无重发。完整Host套件18PASS/0FAIL/0SKIP，5.68秒，重复用例整项约0.98秒。审查四份生产差异及diff --check通过（行尾提示）。

旧隔离close-probe二进制仍启动0xC0000005，不能反写成从未发生。用当前cjc重新编译同一真实探针、显式stdx DLL链接、现有pack-host及原SDK运行库打包，新探针1PASS，约4.63秒，内含reader.get(2秒)断言和服务端断连。没有运行库替换/patch；旧新启动差异尚未解释，SDK运行时漏洞诊断不等于当前全部产物不可运行。

当前已验证：Host静默读取取消、原读取收束、客户端断连、无待执行工具、预留释放、未知费用事实保留且不重放；输出cap进入实际请求、上下文超限不派发且不改原文。未覆盖：精确tokenizer/图像token、真实模型费用、连接建立/错误响应摘要阶段取消、其他平台/安装态/完整workspace；每read监视Future开销需后续压力测试。下一步补可复现直接构建驱动、核图片拒绝边界与最终材料收口，不扩SDK工程。

## 持续第十七轮：可复现驱动与签名执行限制

新增Host所属verify-p1-windows.ps1，固定SDK/目标检查、唯一临时输出、实际launch子包/core/Host编译、原pack-host、18项Host/六项预算/关闭探针串行验证；遇错停止、还原临时环境变量、不删已有目录、不安装或改SDK。实际尝试执行被本机脚本签名策略阻止（PSSecurityException），未运行驱动正文，未绕过执行策略或变更系统设置。PowerShell Parser语法检查通过，不能称完整驱动已验收。

此前各步实际编译和18+6+1测试证据仍成立，但不能把新驱动等同执行通过。后续可在不修改/绕过本机策略的前提下将维护驱动实现为已允许的Node脚本，并实际跑通；不要让驱动整理再次盖过已完成的两项业务验证。图片预算的精确估算仍不在本轮支持范围，当前明确拒绝策略须登记。

## 用户要求查明旧探针：运行库实际已不同（重要证据更正）

逐文件SHA256比较旧/新探针包：同名DLL仅libcangjie-runtime.dll不同（另EXE不同，旧包多一个default.cjo）。旧DLL SHA256 CA65F2B82121A0587E03203314FC723724058D59D42391AA1E19B3EB69463B27；新DLL与当前已安装SDK均为8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2。当前SDK文件mtime为2026-10-15 20:31:13，但mtime不证明修改主体。

独立临时副本两项交叉实验：旧EXE+新DLL通过Client.close探针；新EXE+旧DLL仍启动0xC0000005、无阶段输出。其余随包DLL同哈希，故决定旧新启动差异的是运行库内容，不是重编探针本身。

完整DLL对比仅2字节改变，文件偏移0x1c208:8b→8d；0x1c22b:11→04。从函数边界反汇编确认ReadWinModuleAtInit：MOV [Ldr+0x20]→LEA [Ldr+0x20]，把首模块指针改成哨兵地址；首次跳转改为先取Flink并比较哨兵，再读取条目。因此新DLL确实含模块链边界的二进制修正，旧DLL则仍有此前现场证实的哨兵误读缺陷。

更正此前“原SDK DLL未修改”的推断：本会话可见工具操作没有写SDK，但SDK文件在两次取证间确已变更；无法凭当前资料认定由谁或何操作修改，亦不能称其官方发布修复。18项Host+6项预算+新探针PASS绑定上述新DLL哈希，即当前含两字节修正的运行库条件；不得作为旧原版DLL条件下PASS。未在本轮修改SDK、原包或DLL字节，交叉替换仅限新建临时副本。

## 持续第十八轮：绑定运行库指纹的统一验收

新增verify-p1-artifacts.mjs，显式要求SACODE_HOST/SACODE_BUDGET_TEST/SACODE_CLOSE_PROBE，不默认找旧包；读取EXE与同目录运行库SHA256，三份DLL不一致则拒绝合并验收；依次运行Host、真实核心预算单测和close探针。此入口仅验证显式产物，不冒称重新构建源码；PowerShell完整构建脚本仍未执行通过。

实际统一入口退出0：Host18PASS（5.56秒）、预算6PASS、探针1PASS（0.39秒），均0FAIL/0SKIP。运行库共同哈希8b1d0783e10ec18191af900ac3da632006037d0a61e0518c4ab005c3f5f8c9c2。Host EXE c4711cf2fbe7768286f2b005720a1608eff8072877de548b3d211f15edd9e7a8；预算EXE 8a9fff8046544adcbe13f798f62f7a22293bcfd6500bf81a7aac2da2ed4a656c；探针EXE cfb1d4efdedebb17ea4a2d8cd26c40cafa4edac0302339efdfcea4ef02b6c2cc。

两项P1在当前Windows+上述修正运行库+合成本地服务条件下已取得实际证据，非原版SDK/完整workspace/安装发布/真实费用/其他平台验收。上下文字节策略仍非精确tokenizer，图片估算不支持而明确拒绝，连接建立与错误体阶段取消不包含在静默SSE读修复中。当前目标限定的生产补丁与定向回归具备，但最终仍需报告上述限制，不能把运行库修正的来源未知隐去。
