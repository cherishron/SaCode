# Windows 原生执行载荷构建

新增独立 scripts/pack-windows-execution.mjs，从明确冻结目录的三份 C# 原生源码编译 broker，记录源码 SHA、各输入 SHA256、编译器哈希、实际命令／退出码、载荷哈希。先复制输入到普通私有临时目录，再校验编译期间输入没有变化；输出目录必须不存在，拒绝覆盖别人的载荷。依赖仅 Node 内置模块与本机 .NET Framework 编译器。

## 实测

node --check exit=0；冻结源码 2beda40519e4431ebb30cf71ab29b43a，HEAD=511c422421a3e5429fc3e24acfb0145fef01c43b，原生 build exit=0。产物目录 `C:\Users\jingg\AppData\Local\Temp\sacode-native-payload-e3ee7c0d718f404388d283c34748cb34`；sacode-job-broker.exe SHA256 `0c9f98077104ed34587a7efce93307324b221161ea535c24aa84d40cfb04d945`，完整清单 execution-provider-manifest.json。重新指向已有输出目录被拒，退出非零且原载荷哈希不变，overwrite-rejection.log。

生成的实际载荷（非另一份重新编译 probe）拒绝畸形首帧，exit=1、stdout 无协议伪成功帧、stderr broker-bad-fields；与当前适配器组合的 AppContainer stream-stop、stream-failure 均 exit=0，实际 PID 9416、18496 已消失。payload-probe.json 与各 run.log 为原件。

## 完成边界

清单 evidence=build-only、runtimeVerification=null，不能作为 RPC 注入放行值。未改 package.json、公共 pack-host 或当前安装产物，避免吞并并发修改；后续统一载荷组装应显式使用此脚本结果。可信提供方装配、完整最新版核心／Host／CLI、桌面及安装升级仍未验收。原生编译产物不会提交仓库。
