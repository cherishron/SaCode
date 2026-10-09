# Windows 桌面低完整性载荷修复

## 直接原因与同字节对照

此前 SaCode/Electron 在 sandbox 初始化创建匿名备用窗口站时返回 Win32 5，进而退出 0x80000003；用户普通 PowerShell 也复现。不能再把失败归因为 Codex 启动方式。

新取证 `target/electron-token-detail-994494448662451eb6e9e13bbca3a530` 对父子令牌逐 SID 属性比较：父进程完整性 RID=8192（Medium），新 Electron 进程 RID=4096（Low）。此前只比较数量和 IsTokenRestricted 等字段没有发现该差异，原先“未确定权限差异”的口径由本证据补正。完整 API 参数在 `target/electron-api-complete-c8b83947db0242618d201b602196d45f`：flags=0、SA length=24、inherit=0，原始错误仍为 5。

icacls 只读核查：产品仓库根目录存在可继承 Low Mandatory Level；构建出的 electron.exe、SaCode.exe、NSIS 安装器均继承 Low 标签。没有证据指认具体修改该标签的会话，不猜测写者。[Microsoft MIC 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)规定新进程完整性取调用者与可执行文件完整性的较小者。Medium 调用者因此仍启动 Low 主进程；该主进程不能按正常 broker 权限创建窗口站。

`probe-neutral-delivery.cjs` 将本轮完整 win-unpacked 按文件内容重新写入普通临时目录，不复制安全描述符、不改已有 ACL、不提权、不关闭 sandbox。逐文件 SHA 相同，清单 `target/unified-current-96fd8a63dfce4f298bc610a82e27d90e/neutral-delivery-manifest.json`；新 SaCode.exe 不含 Low 标签。

同字节产物 `C:/Users/jingg/AppData/Local/Temp/sacode-neutral-delivery-Q5qZov/app/SaCode.exe --smoke` 真正进入 Electron main 并完成真实 Host initialize/projection/subscribe、未知方法拒绝及持久屏障验证，SMOKE PASS，实际退出 0、forced=false。原件 neutral-delivery-result.json 与该目录 evidence/process.log。相比原仓库产物 0x80000003，该对照证实交付位置完整性继承是本次启动阻塞的直接原因；不再将相似上游 OS 崩溃报告当成本机原因。

## 可重复的交付修正

新增 `scripts/export-windows-artifact.mjs` 与只读 `scripts/windows-file-integrity.cs`：显式源文件和新目标文件，拒绝覆盖、拒绝仓库内交付位置；读取目标目录和文件的 LABEL_SECURITY_INFORMATION，只允许普通 Medium/implicit-medium。按内容创建文件而不是复制权限，核对源/目标 SHA，登记完整性标签与哈希。查询失败或标签不符合即失败，不修改 ACL、令牌或执行策略。工作区内目的地的反证被拒，未写出 Setup.exe；Windows 输出目录拒绝与真实正常导出都已执行。

导出命令：

```text
node scripts/export-windows-artifact.mjs "target/unified-current-96fd8a63dfce4f298bc610a82e27d90e/installer-candidate/SaCode Setup 0.1.0.exe" "C:/Users/jingg/Downloads/SaCode-20261008-bf68db6/SaCode Setup 0.1.0.exe"
```

实际退出 0。源标签 S-1-16-4096、目标父目录与目标文件 implicit-medium。安装器 93,880,558 字节，SHA256 e094d7b9edcfb4fa6dfefdb22395017d8352eab605e0e1b09068c53fda4a65df 与原构建完全一致；旁边 `.manifest.json` 为原件。安装器还未执行，不能宣布安装升级/数据保留已通过。

## 页面与安全准入仍须分别验收

相同正常目录下实际 --ui-smoke 已能加载 Vue/TinyRobot 页面、preload 隔离、真实 Host 附件/队列、会话搜索、历史导航与工具详情。套件实际退出 1，日志 ui-smoke-Aoo9sb/process.log：preload 白名单未包含新增 IPC、旧时间线选择器不存在、指南标签判据失败，随后脚本异常。不得将这些失败改记通过。--layout-smoke 亦退出 1，layout-smoke-A9Anae：send 的 hover+Tab 就绪判据未满足。启动问题已解除，页面回归仍未收口。

原生 AppContainer 探针从正常目录启动后，原先 CreateProcess/ACL 的 Win32 5 已不再出现；子进程确实启动，但 Node 默认主模块解析在未授权的 C:\ 根目录读元数据时 EPERM，仍未通过整个准入测试。私有夹具加 --preserve-symlinks-main 后出现进程退出未确认超时；两轮失败保留于 sacode-neutral-sandbox-vA0iiU，下游隔离门禁仍关闭。不授予根目录权限或网络例外，不据启动修复直接升级隔离为通过。

补充 --frame-smoke：真实页面实际中文字体、空会话、无账号启动、草稿收缩及 light/dark 各 860/1023/1024/1100/1600 宽度均有 PASS 读数；但完整套件退出 1。展开导航节奏、设置高度/繁忙发送说明、右栏收缩、会话行及侧栏状态等待仍红，原件 frame-smoke-e6vCaU/process.log 与同目录 frame 截图。不能只挑绿计为整页通过。三轮自建 SaCode 进程均已终态，未安装产品或关闭其他会话进程。
