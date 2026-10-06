# 最新源码桌面体验包（2026-10-06 23:11）

用户要求重新从本地最新源码构建，不继续交付旧体验包。最终产品源码提交：`151126a108d642e861e34410af3206c1dc8b492b`，分支 `refactor/dsh-learning`。

## 修复与真实失败

- `3b1a7a1`：窗口事件在 loadFile 前绑定；普通启动在加载停止后显示窗口；Windows 隐藏启动状态下首次显示无效时，只补一次有界重试。UI_SMOKE 仍保持隐藏。
- `151126a`：最新打包态实际发生 `ReferenceError: traceError is not defined`，根组件只剩注释节点、控件 0。render 函数误引用 setup 局部 ref，改为读取组件代理的 self.traceError/traceBusy/traceEvents/traceMore。修复前的包不交付。
- 普通启动与窗口单测分开：不能拿隐藏/offscreen 冒烟通过当人工入口正常。旧安装包曾有进程无可见窗口；该旧包的全部根因未穷尽，本轮直接验证最新源码的正常入口。

## 构建过程与边界

独立源码快照目录 `D:/Temp/SaCode-latest-build-20261006/source`：先 git archive 固定 `3b1a7a1`，再覆盖已提交 `151126a` 的唯一产品差异 renderer/app.js；没有吸收并行成员未提交的 fs_tools、model_tool_runtime_test、voice 或责任表。无新增工作分支。

- Host：`cd apps/host; cjpm build -i`，rc=0。重新构建仓颉核心和 Host，非复制旧 Host。pack-host 组装 SDK/stdx 运行库与 OpenSSL，92 个文件。
- 前端：npm run vendor 重新编译全部产物。首次 esbuild 辅助进程直接写文件 Access denied，rc=1；本地构建预加载器将 esbuild 设置 write:false，由 Node 写出相同的 outputFiles，再执行所有原构建脚本与静态守卫，rc=0。预加载器仅在取证目录，不修改项目实现。
- Electron 运行时使用本机既有同版本缓存，清理成仅运行时目录（无旧 app.asar/Host），不下载新 Electron。开发用 electron.exe 的三条窗口测试启动前即退 2147483651；改用已核验体验包的同版本运行时执行真实用例，无跳过，3/3 PASS。没有将替换运行时称作默认环境通过。
- NSIS：electron-builder 从新前端与新 Host 打包，不用 prepackaged。签名仍按既有 signExecutable:false 关闭；没有发布或做安装卸载验收。编译有 warnings，未称零告警。

日志与构建配置保留在 `D:/Temp/SaCode-latest-build-20261006/`：host-build.log、vendor-build.log、vendor-node-write.log、esbuild-node-write.cjs、source/build-config.json、package-build.log、package-final.log、normal-startup.log、installer-payload-startup.log。

## 验收

- 窗口专项：真实 Electron，3 tests / pass 3 / fail 0 / skipped 0，含无 ready-to-show 的正常显示、隐藏冒烟不显示、删除加载停止兜底后仍隐藏的变异反证。
- `node scripts/check-desktop-startup.mjs <新 win-unpacked/SaCode.exe>`：STARTUP_PASS，visible=true、ready=complete、controls=63、bodyLength=55，rc=0。独立用户/会话目录，不读取用户历史或凭据。该脚本在未取得结果/超时/主进程异常退出时均失败，验收后 app.quit。
- 安装器经缓存 7za 提取（工具自动展开至载荷，提取 rc=0，有一条 archive warning），再次对载荷执行同一普通启动验收：同样 STARTUP_PASS，rc=0。这是安装器载荷运行证明，非实际 NSIS 安装证明。
- main/preload/window-visibility/app.js/client-slots 五个文件在本次源码与 app.asar 逐项同哈希；asar 131 条目、node_modules 0。检查嵌套文件时使用 Windows 路径分隔符，首次 forward-slash 读取错误未被当成缺包证据。
- 新打包 Host 与安装器内 Host SHA256 一致；win-unpacked app.asar 与安装器内 app.asar 一致。

## 交付

默认目录：`D:/Project/sa/saai/sa-code/apps/desktop/dist/electron/`。

| 文件/载荷 | 字节或 SHA256 |
| --- | --- |
| SaCode Setup 0.1.0.exe | 92854425 字节；eb0f89f8547f21f614d139ebcb65c53056680d13776a6ee10123bcafb2809d23 |
| app.asar | 9f7a1296d33182b8d1a7f13c7a6175256d65a43ee80179b0861f7092b2e7ad00 |
| sacode-host.exe | 93ff9e263f2bd4ab238a5f2d1cce0bbfe20931f5dba83dddd1dee99765331b8a |

附 install-latest.cmd：仅为本次安装进程设置 D:\Temp\SaCode-install-temp 并启动安装器，避免默认 TEMP 写入失败；不是修改系统全局环境变量。附 build-info-latest.json。包内 build-info.json 的 verification 是构建前 pending 标记，最终实测状态以本台账及包旁验收信息为准，未在验收后修改 asar 破坏完整性。

本轮只交付最新 NSIS，其他旧 portable/win-unpacked 路径未宣称更新。全面 DSH 复刻仍未完成；队列九条历史红、电脑真实输入、全部插件与外部 provider、真实模型全链路及安装升级卸载验收仍待分别收口。63 个控件与启动通过不等于63模块功能验收。

## 用户安装失败追查：Windows 完整性标记

用户运行最新安装器仍报 NSIS Error writing temporary file。已核对活动进程实际 exe 路径、SHA256、磁盘空间与临时目录 DACL，不能归因于拿错包或空间不足。先前仅验证 PowerShell 能写入私有 TEMP，不足以证明 NSIS 能写入。

`icacls` 直接确认项目默认输出目录中的 Setup 继承 `Mandatory Label\Low Mandatory Level:(I)(NW)`；`D:/Temp/SaCode-install-temp` 没有低完整性标记。低完整性进程不能写入普通完整性对象，即使 DACL 允许写入，见 [Microsoft Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。未查明项目目录标签最初由哪个程序设置，不推测作者。

最小 NSIS 探针只执行 GetTempFileName、写诊断结果和删除自己的临时文件，不安装软件。相同字节（SHA256 `c8233d280a211f48ace11e80b59e3c2d6a53328d9a22ef0dd012158599257fec`）在相同 TEMP/TMP 下对照：

- 放项目 dist/electron（继承 Low）：rc=2。
- 放 D:/Temp/SaCode-nsis-diagnose-20261006（普通标记）：rc=0，GetTempFileName 成功，RESULT=PASS。

据此更新交付路径：**D:/Releases/SaCode/SaCode Setup 0.1.0-latest.exe**。用读取源字节、在普通交付目录新建文件的方式输出，不继承源安全描述符。新文件 icacls 没有 Low 标记；与源安装包 SHA256 完全一致，仍为 `eb0f89f8547f21f614d139ebcb65c53056680d13776a6ee10123bcafb2809d23`。附同目录 install-latest.cmd 和 build-info-latest.json；项目输出目录的安装脚本改指向此交付文件。

没有修改项目、TEMP 或系统的 ACL/完整性配置，没有启动真实安装器代用户安装。尚待用户实际安装后确认；这里只证明造成临时文件失败的标记差异及修正交付文件。默认 dist/electron 中的 exe 仍是构建产物，不能再次当作可直接运行的交付文件。
