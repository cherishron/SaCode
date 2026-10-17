# 模型拉取超时缺陷修复（D22）：桥 5s 窗口与迟到结果协调（2026-10-17）

- 取证与修复时点：2026-10-16 晚诊断，2026-10-17 修复并验证；工作区基线 HEAD `5c22a36`。
- 涉及面：`apps/desktop/main.cjs`、`apps/desktop/customs-ipc.cjs`、`apps/desktop/test/custom-models-ipc.test.mjs`；Host 侧未动。
- 用户实际报错：`Error invoking remote method 'sacode:modelPull': Error: timeout: model/pull`（Downloads 中性验证包内实测）。

## 1. 现象与根因

模型中心的「拉取模型」是**网络动作**（Host `model/pull` → `ModelCatalog.fetch` 真发 `GET {baseUrl}/models`，读超时 15s），但桌面桥走的是通用投影默认超时 **5s**（`HostBridge.request(method, params, timeoutMs = 5000)`），且 `sacode:modelPull` 没传显式超时。

实测数据（同机器、同二进制）：

| 场景 | 结果 |
|---|---|
| 本机 1s 延迟响应 + 默认 5s 窗口 | 成功（1030ms） |
| 本机 8s 延迟响应 + 默认 5s 窗口 | **第 5013ms 报 `timeout: model/pull`**（复现用户报错） |
| 本机 8s 延迟响应 + 显式 20s 窗口 | 成功（8046ms）——证明瓶颈是桥的 5s，不是 Host |
| 真实 SenseNova 端点（无效测试 key） | 单次往返 3.1–4.5s（TLS 握手约 2s），对 5s 窗口余量不足 2s，网络波动即触发超时 |

**第二层缺陷（状态错位）**：桥超时只是不再等待，**并不取消 Host 的请求**。用包内原版桥 + 中性位置 Host 复现：桥第 5002ms 报 `timeout: model/pull`，Host 的拉取随后仍跑完并成功写库（延迟结果探针证据）。即用户看到失败，模型却已实际入库——界面报错与真实结果不一致。用户数据目录的 `providers.log`（20:23:29）显示 7 个 `provider-listed` 模型在报错时段落库，与该机制吻合。

## 2. 修复设计

1. **显式网络预算**：`sacode:modelPull` 的 request 传 `PULL_TIMEOUT_MS = 30000`——覆盖 Host fetch 的 15s 读超时 + 连接建立余量。`main.cjs` 的 customs request 闭包签名加可选第三参 `timeoutMs` 透传给 `bridge.request`（不传即回默认 5s，其他 9 个 customs handler 行为不变）。
2. **迟到结果协调**：桥超时被捕获后不直接报错——等 2.5s 给 Host 收尾，再调 `model/registry/describe` 核对 registry 修订号是否前进（`applyPulledModels` 成功会使 revision +1）：
   - 前进 → 返回最新视图并带 `late: true`（如实标记迟到成功）；
   - 未前进 → 抛 `model-pull-timeout-unknown: 网络超时，结果未知，请稍后刷新模型列表`（不再暴露不可解释的内部错误）；
   - 非超时错误原样抛出（不进协调）。

## 3. 验证

- **单测**（`custom-models-ipc.test.mjs` 新增 4 用例，全文件 **7/7 PASS**）：显式 30000ms 传参断言；超时后协调迟到成功（`late:true` + 视图返回）；非超时错误原样抛出不进协调（仅 1 次 request）；正常成功无 `late` 标志。
- **端到端**（中性位置 Host = 用户同二进制 + 8s 延迟服务 + 修复后 handler）：**8083ms 正常返回**、`late:false`、revision +1、双模型全部入库——修复前同场景第 5s 报超时的错位不再出现。
- **既有断言不破坏**：preload 通道对映（52 项）与主进程动词对映正则均过；`model/pull` 的 preload invoke 参数不变。

## 4. 边界与未覆盖

- 修复在桌面 IPC 层；Host 侧 `ModelCatalog.fetch` 未动（其 15s 读超时语义不变）。
- 迟到协调以 registry 修订号前进为判据；单用户桌面场景下 2.5s 窗口内的并发写会使判据偏宽（返回 `late:true` 视图），不会误报失败。
- **`model-pull-host.test.mjs` 仓内跑仍失败**：`-32099 ... %TEMP%\sacode-pull-*\settings return -13 Permission denied`——仓内 dist Host 继承仓库根 Low 标签写 %TEMP% 被拒，属 D10 同根源因族（台账 A3 段已有同类记录），失败点在测试 fixture 建立、先于 `model/pull` 调用，**非本修复回归**；中性位置运行不受影响（端到端已证）。
- 载荷未重打：修复待 codex 重打包后进入安装态复验。

## 5. 复验命令

```
cd apps/desktop && node --test test/custom-models-ipc.test.mjs
node target/tmp/modelpull-probe-20261016/fixed-e2e.cjs   # 中性位置 Host 端到端
```

诊断过程全量探针与原始数据在 `target/tmp/modelpull-probe-20261016/`（diagnosis.md、probe.mjs、late-result.cjs、fixed-e2e.cjs；可丢根，正式结论以本文档为准）。
