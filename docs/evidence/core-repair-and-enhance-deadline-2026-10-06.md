# 核心红灯修复与提示词增强期限（2026-10-06）

延续完整 63 子系统、54 前端包复刻范围；本批不缩小交付分母。

## 原始证据

重新核查当前分支 3281f8c 后，以独立 target 复验主树：702 总数 / 693 通过 / 2 跳过 / ERROR 0 / FAILED 7，rc=1。日志 D:/Temp/sacode-core-current-20261006.log。此前 692 通过 / ERROR 5 / FAILED 3 仍作为历史红灯保留。

## 修复

- PluginStore 的 newStagingPath 每次无条件创建同一 plugins 父目录。仓颉 Directory.create 的 recursive 参数不忽略目标已存在，第二次安装、重装、孤儿目录及多插件均因此失败。改为仅在父目录不存在时创建，保留独占临时名字和租约契约。
- MigrationBundle.fromJson 经 mgJson 吞掉解析异常，把非法输入伪装成 `{}`。改为直接解析并捕获异常返回 None；显式空对象契约不变。增加数组、null、集合类型错误的拒绝测试与显式空对象兼容测试。
- secretBundleConstTimeEquals 使用 XOR 折叠差异，两处相同差异会抵消。改为 OR 累积，保持按长度遍历。新增末端双字节差异拒绝、实际信封标签双字节篡改拒绝且不返回明文测试。修复认证判据，不放宽密码学参数。
- 提示词增强：专用 Host 请求的读超时由 30 秒改为 90 秒；前端总等待由 10 秒改为 120 秒，到期仅取消增强，不停当前 Agent。原稿、编辑修订与会话隔离仍按原保护逻辑处理。
- UI 冒烟清单补入既有 globalAppearanceSetBusySend 有限键。慢响应夹具增加 enhance-slow，只影响明确选择此路由的测试。

## 交互反证

真实 Vue/preload/IPC/Host 界面走慢响应夹具，并将前端时钟推进 11 秒。当前代码 UI_SMOKE PASS（D:/Temp/sacode-enhance-ui-red-20261006-1791249085145）。把同份渲染代码复制到隔离目录，仅将 120 秒阈值回退为 10 秒，验收出现 6 项失败，包括不进入回退态、原文未得到增强结果及取消后无用量（D:/Temp/sacode-enhance-ui-red-20261006-1791249143347）。这条是前端期限行为证据，不冒充外部真实模型语义验收。

开发态路径由 paths.cjs 固定解析 dist/host/bin，SACODE_HOST 只适用于指定测试驱动，不覆盖产品开发态路径。隔离前端副本复制了自包含 Host；装包态始终从 resources/host/bin 解析。

## 待落最终结果

核心最终整套、包含新认证修复的最终 Host 构建、真实 StepFun 增强与取消回归正在运行；以进程最终返回与 Summary 为准。上一批模型中心安装器是早先快照，本批核心改动尚不能宣称已经进入该安装器。
