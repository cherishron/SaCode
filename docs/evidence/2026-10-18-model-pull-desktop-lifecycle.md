# D22 桌面操作身份、精确查询与可见取消（2026-10-18）

## 1. 范围与身份

- 工作区基线HEAD `5c22a36`；本轮未提交、不替换Downloads旧包、不生成安装器、不发布。
- 平台Windows x64；延续[10-17 Host实现](2026-10-17-model-pull-host-lifecycle.md)。新Host SHA256 `c40b45a5c2bbf99d0f130d0f084ba00fd07c8b90f9eec6c3ae2d1d059474fa1e`，来自前轮私有源码构建，中性路径 `D:/tmp/sacode-model-pull-host-20261017-v1/bin/model-pull-verified.exe`。
- 本轮只动桌面模型链、测试和文档，不修改workbuddy的执行隔离源码、Windows权限或安全配置。
- 入口：供应商Vue页面 → 生产model-center-adapter → 生产preload有限动作 → 生产customs-ipc → Host模型发现 → 本地合成HTTP。

## 2. 已实施行为

1. 新增 `model-pull-state.ts`，在页面适配器生命周期内保存操作ID；发送前以crypto.randomUUID生成，订阅先通知UI再调用IPC。页签卸载/重挂载复用同一适配器时保留在途身份，不写localStorage、不落用户密钥或配置。
2. 新增有限IPC `modelPullDescribe(operationId)`、`modelPullCancel(operationId)`；`modelPull`可选第三参operationId。主进程验证ID形状与长度，不接收任意方法名；旧两参调用继续返回供应商视图。
3. 带ID调用返回 `{pullOperation: ...}` 纯数据，避免Electron跨进程Error自定义data字段丢失。成功/Host错误只接受对应身份；桥超时自动**查询一次原操作**，不重发model/pull；查不到/失联保持unknown。
4. 页面展示供应商与操作ID、结果状态、后台是否收束；提供「查询拉取结果」「取消拉取」。取消请求不等于收束；committing不能显示为取消；结果未知/outcome-unknown或settled=false时锁住重复拉取和配置写操作。
5. 目录刷新不清除操作未知态；新操作/新终态不会被旧回执倒灌；页面卸载注销监听，不擅自取消后台任务。
6. 拉取成功/失败后及显式查询、取消后刷新输入区目录；查询成功只依据该操作真实结果，目录本身不作为成功证据。操作表/配置事实仍由Host持有，renderer只是短期UI投影。

## 3. 验证

| 项 | 实际结果与范围 |
|---|---|
| 状态、主进程、页面及既有模型目录/桥接/模型中心回归 | **58/58**，0失败/0跳过；含9条新状态/IPC测试、4条真实Vue页面挂载测试，旧测试不移除 |
| 生产preload与主进程实际注册集合 | 两个筛选测试 **2/2**；新增通道后preload和handler均149 |
| Electron实际preload/IPC/Host与旧两参兼容集成 | **2/2**，0失败/0跳过；一个默认沙箱Electron全链测试，一个实际6.5秒慢响应Host兼容测试 |
| IPC静态集合门禁 | **149/149**，8 checks / fail=0，无通用转发 |
| 页面构建 | `node scripts/pack-pages.mjs`通过，静态bundle自检通过、唯一Vue runtime、无运行时模块加载/模板编译器 |
| 产物落点 | 守卫13项通过；新可维护驱动在test/support、合成renderer检查在test/fixtures；运行目录均target/tmp |

原始输出：`target/tmp/model-pull-desktop-20261018/regression.txt`、`electron-host.txt`。实际Electron测试生成的每轮fixture与output.txt位于 `target/tmp/model-pull-electron/run-*/`。

最终复验：`regression-final.txt` **58/58**、`ipc-sets-final.txt` **2/2**、`electron-host-final.txt` **2/2**（约6.95秒），全部零跳过；Electron回读并断言sandboxConfigured=true、contextIsolation=true、nodeIntegration=false。页面构建与静态bundle守卫重跑通过；IPC149/149、落点13项及自证10条通过；本批7份文档307条相对链接零缺失，指定改动空白检查、主进程/preload/驱动JS语法检查通过。以上不包括下文明确失败的四组页面测试。

### 真实Electron验证内容

- `sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`；测试驱动未传 `--no-sandbox`，最终输出回读webPreferences并断言。
- 第一笔合成HTTP不返回响应头：从页面点击取消，经生产preload和IPC到真实Host，回执取消、连接收束、模型清单不变。
- 第二笔正常成功，新ID与第一笔不同。
- 第三笔服务延迟650ms，驱动仅将该笔桥等待缩至150ms模拟回执丢失；生产handler查询精确ID，页面切走重挂仍保留ID，再查询取得真实成功。
- 三次拉取总共**3次HTTP请求**；所有查询/取消不重发拉取。Host停止退出0、未强杀。
- 这里是隔离的供应商页面与有限测试主进程，不是完整SaCode应用外壳/安装态验收。驱动直接复用生产preload、主进程注册函数和HostBridge，不复制产品实现。

### 保留失败与环境对照

- 首次用仓内Electron执行，约400ms退出 `2147483651 (0x80000003)`，未取得renderer结果，output.txt为空；该次失败保留，不算通过。
- 通过既有 `export-windows-artifact.mjs` 将**同一已装官方Electron dist**字节导出新中性目录 `D:/tmp/sacode-model-pull-electron-20261017-v1`，未改ACL或沙箱，显式 `SACODE_TEST_ELECTRON` 重试后通过。此差异不单独证明具体DACL、SID、标签或GPU根因，不据此闭合D10。
- 前轮四组model-pages渲染用例失败在只读说明文案，本轮没有改其只读判据。既有槽位夹具补查询/取消及新结构化回执、退出新增表单后再点拉取；本轮重跑仍为**0/4通过**，四组都只有「内置供应商目录字段只读且说明保存范围」未通过，输出在 `target/tmp/model-pull-desktop-20261018/expanded-pages.txt`。未拿58条定向通过代替，未删断言制造全绿。
- 未安装Node、OpenSSL、SDK或测试依赖；测试只用现有开发工具。此不构成最终用户额外安装要求。

## 4. 边界与剩余工作

- ID是**当前renderer适配器内存状态**，不是跨应用/renderer重启持久恢复。Host重启后未知旧操作不能据目录revision猜结果，也不会解锁自动重试。
- outcome-unknown即使资源已收束仍阻止重复；没有增加「清除未知并强制重试」后门，需后续明确人工核对/恢复策略。
- Host128条结果容量、DNS等不可中断调用收束、提交磁盘故障和运行库来源风险沿前轮保留；不扩大本轮结论。
- 工作区尚未提交，尚无同源正式安装包、完整应用默认启动、真实用户双击与安装态验证。D22仍部分修复，未闭合。
- package.json没有lint/typecheck脚本，未安装TypeScript检查器；esbuild构建不冒充类型检查。JS语法检查、定向测试和bundle守卫分别记录。

## 5. 复验入口

在 `apps/desktop`：

```powershell
node --test test/models/model-pull-desktop-state.test.mjs test/models/model-pull-page.test.mjs test/custom-models-ipc.test.mjs test/models/model-pull-timeout.test.mjs test/model-center.test.mjs test/model-directory-state.test.mjs test/model-directory-invalidation.test.mjs test/model-revision-precision.test.mjs test/host-bridge-lifecycle.test.mjs
node --test --test-name-pattern='预加载 IPC 面|预加载调用的通道集合' test/bridge.test.mjs
# 显式指定当前源码Host；默认官方Electron若在当前环境启动受阻，可指定经字节导出的同版本中性副本。
node --test test/models/model-pull-electron.test.mjs test/models/model-pull-host-integration.test.mjs
```

Electron用例需要显式SACODE_HOST，没有时明确跳过；默认使用已装Electron，SACODE_TEST_ELECTRON仅供同版本中性对照，不自动降级或关闭沙箱。
