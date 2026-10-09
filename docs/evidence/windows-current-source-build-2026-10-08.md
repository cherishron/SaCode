# Windows 当前源码统一构建

## 固定输入与责任

工作分支 refactor/dsh-learning，固定 HEAD bf68db63d331257485494f153c1a2ae5f8f379e1；不创建分支、不暂存、不提交或安装。快照根目录 `target/unified-current-96fd8a63dfce4f298bc610a82e27d90e`，并发工作区不等于提交态验收。

source-manifest.v1.json 保存最初 634 项哈希；桌面桥接修复及只读核查后的并发 CLI 两行 web 工具注册形成 636 项，前版保存在 source-manifest.v2.json。随后补齐 renderer/assets 的实际图标及许可、extjs 宿主和 npm 包装源，共 667 项，source-manifest.json 记录完整旧/新哈希和新增资源。三次补充均核对工作区字节，core/Host 编译输入没有热修改。具体会话写者未核的不猜测，责任参考 W00。

最初有限后缀冻结未收图标、扩展宿主和 npm 包装资源；此次补齐后才作为打包候选输入，不把初始 634 项当作完整交付源。运行时 DLL、安装器和最终产物另取证。

补充资源后的复查出现 scripts/pack-host.mjs 字节哈希漂移；git diff --no-index 无正文差异，逐字 CRLF 归一化对照相同，原件 pack-host-drift.json。只登记行尾变化，没有热改冻结脚本或将工作区声明为与快照逐字相同；实际打包将使用记录在清单中的冻结脚本。

## 默认 Host 与同核心 CLI

默认 `cjpm build` 在快照 apps/host 下运行，不修改 cjc-option、不加 -O1、不设置超时杀进程。命令及私有 TMP 位于 host-command.json，原始进程 28220、编译子进程 26836、LLVM 子进程 8132。最终 host-exit.json 记录 2026-10-08T11:12:08.714Z code=0、signal=null，工具 session 36663 同样实际退出 0；156 warnings 不作为验收判据。原构建完成，没有重启或替换旧核心。

CLI 的 build-cli.cjs 在 Host 真实 compiler code=0 后启动，默认选项直接链接该 Host 构建出的 core.cjo/libcore.a；cli-exit.json code=0，前后两库哈希不变。core.cjo SHA256 e7caba2bbdd601fd399de0adbdd31ac19e142f30a56d157278202ec58b06ea4d，libcore.a SHA256 8b70e363987631d84cb1a52e803153b22740aada3ff9660db961ab2cdc7e4f90；CLI sacode.exe SHA256 b93fb7f11aa9b24d1158ecd573e5fb06bf214e7bbef4baf749a85ff7beacc55d。原件 cli-manifest.json/cli-exit.json。

冻结 pack-host.mjs 将新 Host 与当前运行时 DLL 打入 host-packed/bin，真实退出 0；runtime-manifest.json 按实际目录登记 91 个 Host 载荷文件（可执行文件与 90 个 DLL）。CLI 构建目录另含 cli.cjo 编译元数据，不能直接作为发布目录。

该新 Host 跑 goal-host-verify.mjs 6/6，code=0，证据 apps/desktop/.tmp-test/goal-host-proof-lbjTTw；该新 CLI 跑 goal-cli-verify.mjs 8/8，code=0，证据 goal-cli-proof-mq1o5X。均使用实际子进程、私有目录与 SDK-free 子进程 PATH，模型为本地 HTTP/SSE 协议夹具，不冒充远端真模型。实际 Main IPC 处理器的模型审批消费链 3/3，证据 model-approval-host-WavYxU；它是真实 Host＋处理器 VM，不是 Electron GUI。

新 Host 执行六动作、精确审批、去重、恢复与旧修订拒绝验证退出 0，证据 execution-host-bRpkZy；新 CLI 执行契约 10/10、退出 0，证据 sacode-execution-cli-pQZRi0。两者剥 SDK PATH，实际启动门禁保持关闭，未执行命令。新 Host 的真实 bridge 中断/显式重连验证退出 0，证据 bridge-recovery-soikDO；恢复不自动执行且会话日志不变。这些证据不能替代隔离开放后的真实执行与 GUI 恢复。

同一默认构建 CLI 补真实 Windows Ctrl+C 控制事件：goal-cli-cancel-PaekgN/result.json signalDelivered=true、forcedCleanup=false、exitCode=130，发送控制事件后 704ms 到退出；重新 goal describe 返回原活动目标，未自动续跑。外层验证退出 0，不将子任务预期取消退出 130 当失败或伪造正常完成。

同一默认核心的 Windows 监督探针重新编译并运行：快照 apps/desktop/.tmp-test/windows-supervisor-DBRgqN，实际 5/5（output、gate、missing、startup-fail、stop）且退出 0。覆盖有界双流、分别 EOF/截断、真实非零退出、创建时间身份、一次性准入重放拒绝、身份持久失败冻结、默认门禁不消费许可及落盘退出重放。此探针显式注入 providerReady=true 的机械测试提供方，不改变产品准入。

broker 源与旧已验构建逐字 SHA 一致后，仍从冻结源重新编译复验 8/8，快照 apps/desktop/.tmp-test/windows-broker-VdZSCO：output、stop-before-resume、stop、timeout-tree、wrong-identity、owner-eof、bad-fields、bad-limit，真实退出 0。涵盖启动未恢复时停止、超时子树回收、身份拒绝和所有者断连；不证明 AppContainer 安全隔离已经可用。

## 当前前端载荷重建

另复制冻结桌面和 scripts 到 `desktop-build-input`，生成文件只写这个私有候选目录。构建期 node_modules 是指向现有开发依赖的私有 junction，未安装或改动共享依赖；它不是运行时载荷，也不代表完整 npm-ci 锁定安装已经验收。

命令：`node target/unified-current-96fd8a63dfce4f298bc610a82e27d90e/build-desktop-vendor.cjs`。顺序执行 pack-vendor、pack-tinyvue、pack-tinyrobot、pack-pages、pack-next-sdk 五份冻结脚本，全部真实退出 0，输出 DESKTOP_VENDOR_BUILD_PASS 5。desktop-vendor-manifest.json 记录五条命令、开发包版本与 package.json 哈希、锁文件哈希及各 vendor 输出哈希；五份 .log 为原件。

已观测开发依赖：Vue 3.5.43、esbuild 0.28.2、TinyVue/Button 3.32.0、TinyRobot 0.5.1、Next SDK 0.4.11。构建沿用唯一 Vue runtime 与静态经典脚本，不更换技术栈或放宽 CSP。原始输入和生成输出分别保留，未把新 bundle 写回共享工作区。

在此候选目录执行 packaging-contract、package-runtime-files、renderer-bundle-guard 三个套件：5 tests / pass 5 / fail 0 / skip 0，真实退出 0。原件 desktop-packaging-check.log/.exit.txt。包含本地 CJS 递归依赖清单、真实删项反证及真实 esbuild 动态/外部模块与运行时求值拒绝；它不是已生成 asar 的载荷核验，也不是 Electron 窗口交互。

## 仍待收口

Electron-builder 26.15.3 使用同一冻结候选前端与新 host-packed/bin、现有 Electron 33.4.11、独占 TMP 构建 NSIS，installer-exit.json code=0，结束于 2026-10-08T11:27:12.065Z。命令 build-installer.cjs/installer-command.json，原始 installer-build.log。未安装、未发布。

产物：`target/unified-current-96fd8a63dfce4f298bc610a82e27d90e/installer-candidate/SaCode Setup 0.1.0.exe`，93,880,558 字节，SHA256 e094d7b9edcfb4fa6dfefdb22395017d8352eab605e0e1b09068c53fda4a65df。verify-installer.cjs 检查 builder 的 win-unpacked/resources/app.asar 共 174 项，对 26 个入口、助手及 vendor 文件逐字哈希核对，91 个 Host 文件全部与 runtime-manifest 相同，asar 无 node_modules。installer-manifest.json 保存哈希；这证明安装器生成和构建暂存载荷，不替代安装器安装后的载荷、启动及升级验收。

打包结束后重新读取主树，HEAD 已由并发提交推进至 668a3e46dbcc99bc13e7a13d66a65ad7579fb107，索引为空。本包仍绑定冻结 bf68db63d331257485494f153c1a2ae5f8f379e1 与未提交输入清单，不改写为新 HEAD 构建。post-package-drift.json 对 667 项逐字重新核查，仍只有此前登记的 scripts/pack-host.mjs 行尾漂移；未发现新的 Host/CLI/桌面源码差异。

保持 sandbox 的 Electron 页面启动、真实执行隔离、远端模型、完整双入口执行场景及安装升级/数据保留仍须验证。当前 premain 崩溃和 OS 隔离准入未通过，执行门禁保持关闭。该安装器是预验收候选，不声明能正常启动；当前前端构建成功不升级前三阶段完整 UI 复验或最终交付为通过。

## CLI tarball 与产物启动复验

pack-cli-candidate.cjs 从同一快照的 npm 包装和 extjs 源、同核心新 CLI 与 DLL 组装私有平台目录；仅复制 exe/DLL，未带 cli.cjo。npm pack --ignore-scripts --offline 两次真实退出 0，未进行 npm 安装或发布。两个 tarball 均经 Windows tar 解包，清单中每个文件与输入 SHA256 相同。

- stand-alone-sacode-0.2.0.tgz：1,379 字节，SHA256 516f77b2b6eecb5fd5058e945b394f70b11f6da5924e74bd9d11611adf59576e。
- stand-alone-sacode-win32-x64-0.1.0.tgz：22,198,591 字节，SHA256 7b6c382ab99d204c849e086042c64385e6a90909b01c8f93b274eb32de0faa18。

原件位于快照 cli-package-candidate/artifacts，manifest.json 保存 npm 命令、实际退出、文件清单及输出哈希。未改变既有包装版本 0.2.0 与平台依赖版本 0.1.0。实际 Node 包装入口在 PATH 仅 Windows System32、私有空工作区运行 goal describe，退出 0，返回 phase=none；此为解包布局中的包装解析与 SDK-free 启动验证，不能代替 npm 安装后的 shim、全部用户动作或完整产品验收。

probe-packaged-start.cjs 实际运行本轮 win-unpacked/SaCode.exe --smoke，私有 TMP/settings/user-data，不关闭 sandbox、不安装。packaged-start-TG6rHP/result.json 记录真实退出 2147483651（0x80000003）、signal=null、forced=false，结束于 2026-10-08T11:33:06.285Z；process.log 为空。当前候选仍启动失败，不以此前最小应用诊断替代该产物失败。

check-desktop-start.ps1 可由用户在普通 PowerShell 对相同 exe 做独立启动对照；使用私有目录且保持安全参数，不安装、不改系统权限。只有得到该环境的实际退出与日志才能进一步判定是否与 Codex 启动上下文有关；目前不假定用户侧能运行。

用户普通 PowerShell 对照：脚本文件被现有签名策略拒绝，尚未启动产品；未建议修改执行策略。改用交互式 Start-Process --smoke 与私有 user-data、Wait/PassThru，用户实际返回 -2147483645，同为 0x80000003。私有目录 SaCode-check-06ef7ab8-9b64-4688-8a0b-79fe5d015526；此结果来自用户终端记录，未把不存在的机器日志冒充独立证据。普通用户启动同样失败，排除“只换出 Codex 启动方式即可解锁”的解释。

只读系统版本查询：CurrentBuild=26300、UBR=9457、DisplayVersion=26H2。Get-ProcessMitigation 系统默认的 DisableWin32kSystemCalls 与 DisallowChildProcessCreation 均 NOTSET，未读取到 SaCode.exe/electron.exe 的专用缓解设置，原件 process-mitigation-settings.json；不能据设置缺失排除运行时实际策略，也未修改注册表/缓解策略。

[Electron 上游 #52098](https://github.com/electron/electron/issues/52098) 报告 Windows build 26200.8655 的 GPU/renderer sandbox 初始化崩溃，处于 closed as not planned。其系统版本、子进程故障阶段与本机 premain 窗口站失败不同，只有退出码相同，不能当成本机根因或已发布修复。当前保持 sandbox，不套用上游描述中的禁用选项。

## 后续启动修复（取代此前启动阻塞结论）

[低完整性交付修复](windows-low-integrity-delivery-fix-2026-10-08.md) 已证实仓库 Low 标签使原 exe 主进程降为 Low。相同产物逐字导出到普通目录后真实 Electron＋Host 协议冒烟退出 0，sandbox 保持开启。安装器已正常导出到 `C:/Users/jingg/Downloads/SaCode-20261008-bf68db6/SaCode Setup 0.1.0.exe`，哈希不变，源 Low/目标 implicit-medium 均有只读查询原件。新增交付脚本查询并拒绝 Low 输出位置，不修改仓库或系统 ACL。

因此 premain 启动阻塞已解除；完整 UI/整页套件仍红，安全准入、真实远端模型及安装升级/数据保留继续待验。原仓库路径 exe 的失败不覆盖正常导出文件的成功，亦不将新成功改写到历史失败日志。
