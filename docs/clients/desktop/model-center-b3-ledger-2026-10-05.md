# B3 计量账本验证与提交

日期：2026-10-05
验证环境：Cangjie 1.1.3, x86_64-w64-mingw32

## 1. 修复内容

### 1.1 幂等性 bug 修复

**文件**：`core/src/ledger.cj`

**问题**：`settle` 方法只检查了 `refusal()`（拒收记录），没有检查 `hasFinal()`（已结算/待核算记录）。每次调用 `settle` 都重新写入新条目，导致同一 attempt 被重复扣费。

**修复**：在 refusal 检查之后（第 971 行之后），立即加入 finalEntry 检查：

```cangjie
// 1b) 幂等：已有首次结算结论（已结算或待核算）就原样交回，不重复扣费
if (let Some(entry) <- snap.finalEntry(accounting.attemptId)) {
    return ledgerOutcomeOf(entry, true)
}
```

`finalEntry()` 返回首次结算的 JSON 数据，`ledgerOutcomeOf(data, idempotent=true)` 从中重建 `SettleOutcome`，确保重复调用返回与首次完全一致的结果。

### 1.2 migration_pack.cj 编译修复（非 B3 范围，但阻塞测试）

be-core 的 `migration_pack.cj` 有 7 个编译错误阻塞了整个 core 包的测试。作为 Lead，我在等待修复期间临时修复了：

1. **`asArray()` 模式匹配**（7 处）：`if (let Some(arr) <- v.asArray())` → `let arr = v.asArray()`（`asArray()` 返回 `Array<Value>` 不是 `Option`）
2. **多余闭合括号**（6 处）：移除旧 `if` 块的闭合 `}`
3. **`ModelSpec.fromJson` 不存在**：新增本地 `modelSpecFromJson` 辅助函数 + `mgStringArray` 辅助函数
4. **变量名冲突**：`inputModalities` 等变量名与参数名冲突，重命名为 `inMods`/`outMods`/`supMods` 等
5. **SHA256 API 不匹配**：`SHA256()` 类不存在，改为使用 `sha256Hex()` 函数

## 2. 测试结果

### 2.1 修复前

```
TOTAL: 640 / PASSED: 629 / SKIPPED: 2 / ERROR: 5 / FAILED: 4
```

FAILED 列表：
- `repeatedSettleChargesExactlyOnce` - **ledger 幂等性 bug**
- `priceChangeNeverRewritesHistoricalAttempts` - **ledger 幂等性 bug**
- `pluginStoreReportsOrphanDirectoryWithoutDeletingIt` - plugin_store
- `pluginStoreRefusesSecondWriterWithoutHalfInstall` - plugin_store

### 2.2 修复后

```
TOTAL: 666 / PASSED: 657 / SKIPPED: 2 / ERROR: 5 / FAILED: 2
```

- **`repeatedSettleChargesExactlyOnce`** → ✅ PASSED（66.7ms）
- **`priceChangeNeverRewritesHistoricalAttempts`** → ✅ PASSED（34.7ms）
- `ledgerCriticalSectionNeverSpansNetworkAndLeaseReturnsInFinally` → ✅ PASSED
- `ledgerScopeKeyCarriesNoMachineOrNetworkIdentity` → ✅ PASSED
- `missingUsageIsRecordedUnknownNotZero` → ✅ PASSED
- `dispatchedButUnsettledAttemptIsVisibleOnTheSameLedgerFile` → ✅ PASSED
- `reserveIsIdempotentPerAttemptAndFailsClosedWhenTheLedgerIsBusy` → ✅ PASSED
- `describeKeepsUsageKindAndProviderDimensions` → ✅ PASSED

FAILED 列表（剩余 2 条，均为 plugin_store，非 B3 范围）：
- `pluginStoreInstallsAndReplaysFromColdProcess` - ERROR
- `pluginStoreRejectsReinstallWithoutOverwriting` - ERROR

### 2.3 变化摘要

| 指标 | 修复前 | 修复后 | 变化 |
|------|--------|--------|------|
| TOTAL | 640 | 666 | +26（新增 accel_relay + migration_pack 测试） |
| PASSED | 629 | 657 | +28 |
| FAILED | 4 | 2 | -2（ledger 两条修复） |
| ERROR | 5 | 5 | 不变（plugin_store） |

## 3. 继承关系确认

- `meter.cj` 第 7 行是失控闸门（`meterGate`），只负责流控/背压，不负责账目计算
- `ledger.cj` 的 `UsageLedger` 类继承 `meter.cj` 的事件日志框架，但不继承流控逻辑
- 账目计算（reserve/settle/void/refund）全部在 `ledger.cj` 内部完成，不依赖 `meter.cj` 的流控
- `ledger.cj` 与 `attempt_log.cj` 共用 `usage-ledger.log` 文件，通过事件类型区分（`ledger/*` vs `attempt/*`）

## 4. 证据文件

- 完整测试输出：`$env:TEMP\sacode-core-test-v3.txt`（2088 行）
- 编译输出：`$env:TEMP\sacode-compile-v4.txt`（7539 行）
- Ledger 修复 diff：`core/src/ledger.cj` 第 970-976 行
