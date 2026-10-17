# Windows 进程提供方完整提案绑定（2026-10-17）

## 范围与实现

本轮为既有未提交工作区上的必要安全切片，不提交、不推送。WindowsExecutionProcessProvider 构造只接收完整提案字节，从中固定 executable、cwd、argv、timeoutMs、outputLimit；execute 在任何创建进程之前逐字段核对，参数数量及顺序均不可变。请求已取消也不得绕过绑定校验；提供方仍是一次性实例。现有两处可信组件装配迁移到传入对应 ExecutionSnapshot.proposal。

新增定向测试覆盖七种篡改（可执行文件、目录、参数内容、参数数量、超时、输出上限、参数顺序）、精确匹配的取消及重复使用拒绝。延续所属核心既有独立 test-support 驱动，不迁移其他测试。verify-windows-process-adapter.ps1 的期望分母从 36 增至 37。

## 本轮构建与验证

- 当前核心源码以内容导出到 D:/Temp/SaCode-Proposal-Binding-20261017-9e31/src；独立 src.manifest.json 记录全部 419 文件和目录，聚合 SHA256 为 4da82271007ac6addb90cdfc64826adc58ffaf44588c2366ed1214459532764a。
- 独立中性副本使用仓颉 1.1.3 / stdx 1.1.3.1 执行 cjpm build；结果待本轮实际返回后登记，不复用历史产物。
- git diff --check 定向三处源码/测试/脚本：退出码 0。

## 生产接线仍阻断

默认 Host/CLI 门禁保持关闭，没有普通 shell 回退，没有 ready 开关。当前私有工作区的原生 revoke 仅对固定根句柄调用 FileDispositionInfo，非空目录不能完成撤销；快照复制后必然非空。现有生产原语没有固定句柄约束的安全递归清空，也没有进程/目录/profile/library 清理失败后的持久所有权保留与重试装配。组件测试的独立夹具清理不是可复用到生产的授权。

因此本轮不能安全地声称完成 WindowsExecutionProcessProvider 的默认生产生命周期。后续还需可信快照创建时机、精确审批绑定与启动复核、停止后整树终态/审查导出、异常及取消的资源所有权与安全回收、默认 Host/CLI 与打包原生库装配的真实验证。D14、EX-01 及整体产品状态不升级。
