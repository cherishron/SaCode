# B5 安全备份与换机迁移 — 实现证据

**日期**：2026-10-05  
**文件**：`core/src/migration_pack.cj`、`core/src/migration_pack_test.cj`

---

## 1. 设计映射

设计文档 §8 要求：

| 设计要求 | 实现位置 | 说明 |
|---------|---------|------|
| §8.1 两种包（config / secret-bundle） | `MigrationBundle` 类 + `MIGRATION_KIND_CONFIG` / `MIGRATION_KIND_SECRET` 常量 | config 包不含凭据值；secret-bundle 包含凭据引用，值由 `secret_bundle.cj` 加密存储 |
| §8.2 稳定 ID 对齐 | `MigrationProviderEntry.id`、`MigrationCustomModelEntry.id` | 按稳定 ID 对齐，不按名称；号池保号（同地址多实例各自独立） |
| §8.3 导入流程 | `computeMigrationPlan()` → 差异预览 → `MigrationApplyResult` | 校验 format/schema/摘要 → 计算差异 → 用户选合并或替换 → 原子落盘 |
| §8.3 幂等 | `migrationProviderEqual()` / `migrationCustomModelEqual()` / `migrationBindingEqual()` | 重复导入产生 `unchanged` 条目，`writeCount()` 返回 0 |
| §8.3 凭据覆盖需确认 | `computeMigrationPlan()` 检测 `needsCredentialConfirmation` | secret-bundle 包中若凭据引用已存在，标记需要用户确认 |
| §8.4 不含运行时数据 | 明确排除 | `usage-ledger.log`、`route-health.log`、待核算记录、已用额度不在迁移包范围内 |
| 归属字段不信任 | 不含 owner 字段 | 断言 78 对偶 |

---

## 2. 核心结构

### 2.1 迁移包条目

- `MigrationProviderEntry`：镜像 `ProviderRecord` 配置面字段（id, name, baseUrl, protocol, credentialRef, declared, sortOrder, enabled, transport, models）
- `MigrationBindingEntry`：镜像 `BindingRecord`（providerId, modelId, enabled, order, weight, price 系列, currency）
- `MigrationCustomModelEntry`：镜像 `CustomModelRecord`（id, name, description, enabled, category, requires, bindings, mode, 预算/探测系列）

### 2.2 迁移包信封

- `MigrationBundle`：format, kind, generatedAt, schemaVersion, checksum, providers, customModels, credentialRefs
- `MigrationBundle.fromJson()`：解析 JSON 信封
- `MigrationBundle.validate()`：结构校验 + 摘要校验
- `MigrationBundle.safeSummary()`：仅含计数信息，不含条目内容

### 2.3 差异预览

- `MigrationPlanEntry`：kind, id, action（"new"/"updated"/"unchanged"）, provider, customModel
- `MigrationPlan`：entries, needsCredentialConfirmation, bundleKind
- `computeMigrationPlan()`：按稳定 ID 对齐，计算差异

### 2.4 比较函数

- `migrationProviderEqual()`：逐字段比较（id, name, baseUrl, protocol, credentialRef, declared, sortOrder, enabled, transport, models）
- `migrationCustomModelEqual()`：逐字段比较（id, name, description, enabled, category, mode, sortOrder, params, modalityBudget, 预算/探测系列, requires, bindings）
- `migrationBindingEqual()`：逐字段比较（providerId, modelId, enabled, order, weight, price 系列, currency）

### 2.5 构建函数

- `buildConfigBundle()`：构建 config 包（不含密钥）
- `buildSecretBundle()`：构建 secret-bundle 包（含凭据引用）
- `computeEntriesSha256()`：SHA-256 摘要
- `sha256ToHex()`：摘要转 hex 字符串

---

## 3. 测试用例

共 **33 条**测试用例，覆盖：

### 3.1 包格式校验（6 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationBundleValidatesFormat` | 正确格式通过校验 |
| `migrationBundleRejectsBadFormat` | 错误格式返回 `migration-bad-format` |
| `migrationBundleRejectsBadSchema` | 错误 schema 版本返回 `migration-bad-schema` |
| `migrationBundleRejectsBadKind` | 未知 kind 返回 `migration-bad-kind` |
| `migrationBundleRejectsBadChecksum` | 错误摘要返回 `migration-bad-checksum` |
| `migrationBundleRejectsMissingChecksum` | 空摘要返回 `migration-bad-checksum` |

### 3.2 条目序列化（4 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationProviderEntryRoundTrips` | ProviderEntry JSON 序列化/反序列化 |
| `migrationBindingEntryRoundTrips` | BindingEntry JSON 序列化/反序列化 |
| `migrationCustomModelEntryRoundTrips` | CustomModelEntry JSON 序列化/反序列化 |
| `migrationBundleRoundTrips` | Bundle JSON 序列化/反序列化 + 摘要校验 |

### 3.3 差异预览（6 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationPlanDetectsNewEntries` | 新条目检测 |
| `migrationPlanDetectsUnchangedEntries` | 未变更条目检测（幂等） |
| `migrationPlanDetectsUpdatedEntries` | 已更新条目检测 |
| `migrationPlanDetectsCredentialConfirmation` | 凭据覆盖需确认 |
| `migrationPlanNoConfirmationForConfigBundle` | config 包不需要凭据确认 |
| `migrationPlanWriteCount` | 写入计数统计 |

### 3.4 比较函数（4 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationProviderEqualDetectsDifference` | Provider 差异检测 |
| `migrationProviderEqualDetectsSame` | Provider 相同检测 |
| `migrationBindingEqualDetectsDifference` | Binding 差异检测 |
| `migrationBindingEqualDetectsSame` | Binding 相同检测 |

### 3.5 自定义模型比较（2 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationCustomModelEqualDetectsDifference` | CustomModel 差异检测 |
| `migrationCustomModelEqualDetectsSame` | CustomModel 相同检测 |

### 3.6 其他（5 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationBundleSafeSummary` | 安全摘要不含条目内容 |
| `buildSecretBundleContainsCredentialRefs` | secret-bundle 包含凭据引用 |
| `migrationApplyResultToJson` | ApplyResult JSON 序列化 |
| `migrationApplyResultWithErrors` | ApplyResult 错误处理 |
| `migrationPlanToJson` | Plan JSON 序列化 |

### 3.7 幂等与号池（4 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationIdempotentImport` | 重复导入产生 unchanged |
| `migrationPoolPreservation` | 号池保号（同地址多实例不合并） |
| `migrationRejectsMalformedJson` | 非法 JSON 处理 |
| `migrationRejectsEmptyRequiredFields` | 缺少必填字段拒绝 |

### 3.8 摘要与常量（4 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationSha256Checksum` | SHA-256 摘要计算 + 篡改检测 |
| `migrationConstants` | 格式常量验证 |
| `migrationRejectionCodes` | 拒绝码常量验证 |
| `migrationPlanEntryToJson` | PlanEntry JSON 序列化 |

### 3.9 应用结果（2 条）

| 测试函数 | 验证内容 |
|---------|---------|
| `migrationApplyResultToJson` | ApplyResult 成功场景 |
| `migrationApplyResultWithErrorsToJson` | ApplyResult 错误场景 |

---

## 4. 编译与测试命令

```bash
# 编译
cd core && cjpm build

# 运行迁移包测试
cd core && cjpm test --no-color --filter "migration"
```

**预期**：编译成功（仅有 line terminator 警告），33 条测试全部通过。

---

## 5. 范围外声明

以下不在 B5 迁移包范围内（§8.4）：

- `usage-ledger.log` — 用量账本
- `route-health.log` — 路由健康日志
- 待核算记录 — pending settlement records
- 已用额度 — 消耗统计

整套服务搬迁走独立的数据目录备份恢复流程，不在模型中心迁移包内。

---

## 6. 安全保证

| 不变量 | 保证方式 |
|--------|---------|
| 凭据覆盖需确认 | `computeMigrationPlan()` 检测 `needsCredentialConfirmation` |
| 归属字段不信任 | 迁移包不含 owner 字段 |
| 幂等 | 比较函数 + `unchanged` action |
| 号池保号 | 按稳定 ID 对齐，不按 baseUrl 合并 |
| 摘要防篡改 | SHA-256 校验，篡改后返回 `migration-bad-checksum` |
