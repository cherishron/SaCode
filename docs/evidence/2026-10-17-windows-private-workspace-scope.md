# Windows 私有任务目录权限范围（2026-10-17）

## 已实现

新增 core/native/windows_workspace.h/.c：三个有限函数 create/revoke/close，只允许新建不存在的 sacode-workspace-<标识> 叶目录。以初始受保护 DACL 给当前用户/SYSTEM 保留控制权，仅给本次唯一 AppContainer 包 SID Read/Execute 或 Modify。拒绝未知档位、相对父路径、路径分隔/点号叶名、宽泛 All Application Packages SID；逐级持有禁止共享删除的目录句柄并拒绝重解析点。既有目录碰撞只返回错误，不给它重新授权。

撤销方式是销毁自有的空权限载体，不递归改写 ACL：任务整树结束并导出产物后，独立清理进程删除明确的私有内容；revoke 通过持有的根句柄将空目录标记删除，非空直接拒绝，close 才最终释放。没有清理成功就不能丢弃句柄或宣称撤销。该机制不编辑真实工作区、父目录或用户权限。

## 本机真实结果

`SACODE_NATIVE_VERIFY_DIR=D:\Temp\SaCode-Native-Workspace node scripts/verify-windows-workspace.mjs`，clang -Wall/-Wextra/-Werror 构建及实际运行 rc=0，**47 checks / failed=0 / cleanup=confirmed**。新目录与导出载荷是本次独占生成；非管理员，不改系统 PATH/用户配置或安装。

实际 AppContainer 进程分别验证：

- read-only：读取预置私有文件成功，写入失败且原文保持；workspace-write：读取及写入成功。
- 两种档位均不能读取或覆盖拥有专用保护 DACL 的区外 canary，内容不变。普通父进程读写 canary 的控制路径成功。
- 宽泛 SID/未知模式/相对路径/叶名越界被拒绝；真实 mklink /J 私有 junction 父路径被拒绝，之后仅删除本次 junction 本身。
- 既有同名目录不被重新授权；非空 revoke 拒绝；独立清理子进程真实退出 0；revoke 重复调用幂等，close 后自有目录确实不存在。
- 父目录测试前后的 DACL 字节完全一致。

原始目录 `target/tmp/windows-workspace-verify-20261017-LHyaCm/`：stdout.log/stderr.log/exit.txt/verification.json；Medium 内容导出清单位于对应 neutral 路径旁。最终指纹：

```json
{
  "version": 1,
  "checks": 47,
  "exitCode": 0,
  "neutral": "D:\\Temp\\SaCode-Native-Workspace\\windows-workspace-verify-20261017-LHyaCm",
  "dllSha256": "f4a739032beab8529eba363733dd6cc5591c82afc064e1ff2fc3194d0549121a",
  "sourceSha256": "bcc1f5192a50eb173462c2e77ddf5b2ede588962d3e5e4754a347b3732abe351",
  "headerSha256": "d951d791da0df0149e9667a031f10fe436a2dbd06848149fcb293be6bb507136",
  "testSha256": "ae4e145a9758a63c44ede6792538c8b5dc84277bb8ca40e550c07ba2bd8c4243"
}
```

同批 DLL 增加三个导出，原八函数 ABI 未变。随后从相同源码重新构建并复验原生进程 **35 项**（target/tmp/windows-process-verify-20261017-2QPtoN）和共享核心真实监督 **13/13**（target/tmp/windows-adapter-20261017-be20f207e8924e228a21e094b98fa5ef），均 rc=0/无跳过。重编产物各自以 verification.json 的 DLL 指纹为准，不能把不同构建的二进制哈希混成同一包。源文件相同，不宣称已打包安装。

## 失败与边界

首轮原生构建因 wcscpy 被 -Werror 拒绝；改为已知长度的 memcpy 后通过，未关闭警告。第一次组件实测 41 项通过；加入宽泛 SID/未知模式与 junction 断言后最终 47 项通过，旧运行目录保留。

这只验证私有目录的 native 生命周期与特定文件 canary 边界，不证明所有区外路径不可读。没有验证网络、私有目录内创建恶意重解析/硬链接、复制深度/并发源修改、工具链依赖范围或 .git/target/node_modules 排除；不对这些作完成声明。

尚未从仓颉任务调用本组件，也未实现工作区快照→修改差异导出→F08 审查→原工作区 CAS 合入。共享执行提案的 cwd/修订与私有副本的映射必须明确，不能静默换目录执行。D14 及 Host/CLI 产品门禁保持未解除。

本批产物守卫仍 13 checks/fail=5/rc=1，日志 target/tmp/windows-adapter-20261017-1f3b/workspace-artifact-guard.log。没有清理已有冲突目录、提交、推送或修改 SDK。

## 官方契约核对

- [AppContainer 启动与双重访问检查](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
- [包 SID 与宽泛应用 SID 的区别](https://devblogs.microsoft.com/oldnewthing/20220502-00/?p=106550)
- [SetSecurityInfo 的可继承 ACE 传播](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo)：本实现没有调用它去改写/递归重置既有目录 ACL。
