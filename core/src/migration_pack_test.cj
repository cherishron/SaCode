package core

import std.collection.*
import std.unittest.*
import stdx.encoding.json.*

// 迁移包（B5）的验收用例。
//
// 覆盖范围：
//   * 包格式校验（format/schema/kind）
//   * 摘要校验（SHA-256）
//   * 条目构建与 JSON 序列化/反序列化
//   * 差异预览（幂等、凭据覆盖检测）
//   * 比较函数（provider/customModel/binding）
//   * 构建 config 包与 secret-bundle 包

@Test
func migrationBundleValidatesFormat() {
    let bundle = MigrationBundle("sacode-migrate/1", "config", 1759600000, 1, "", [], [], [])
    @Expect(bundle.structuralValidation().size, Int64(0))
}

@Test
func migrationBundleRejectsBadFormat() {
    let bundle = MigrationBundle("wrong-format", "config", 1759600000, 1, "", [], [], [])
    @Expect(bundle.structuralValidation(), "migration-bad-format")
}

@Test
func migrationBundleRejectsBadSchema() {
    let bundle = MigrationBundle("sacode-migrate/1", "config", 1759600000, 999, "", [], [], [])
    @Expect(bundle.structuralValidation(), "migration-bad-schema")
}

@Test
func migrationBundleRejectsBadKind() {
    let bundle = MigrationBundle("sacode-migrate/1", "unknown-kind", 1759600000, 1, "", [], [], [])
    @Expect(bundle.structuralValidation(), "migration-bad-kind")
}

@Test
func migrationBundleRejectsBadChecksum() {
    let bundle = MigrationBundle("sacode-migrate/1", "config", 1759600000, 1, "abc123", [], [], [])
    @Expect(bundle.checksumValidation(), "migration-bad-checksum")
}

@Test
func migrationBundleRejectsMissingChecksum() {
    let bundle = MigrationBundle("sacode-migrate/1", "config", 1759600000, 1, "", [], [], [])
    @Expect(bundle.checksumValidation(), "migration-bad-checksum")
}

@Test
func migrationProviderEntryRoundTrips() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let entry = MigrationProviderEntry.fromProvider(provider)
    let json = entry.toJson()
    let parsed = MigrationProviderEntry.fromJson(JsonValue.fromStr(json).asObject())
    @Expect(parsed.isSome(), true)
    let restored = parsed.getOrThrow()
    @Expect(restored.id, "test-provider")
    @Expect(restored.name, "Test Provider")
    @Expect(restored.baseUrl, "https://api.example.com")
    @Expect(restored.protocol, "openai-completions")
    @Expect(restored.credentialRef, "TEST_API_KEY")
    @Expect(restored.declared, true)
    @Expect(restored.transport, "direct")
    @Expect(Int64(restored.models.size), Int64(1))
    @Expect(restored.models[0].id, "gpt-4")
}

@Test
func migrationBindingEntryRoundTrips() {
    let binding = BindingRecord("test-provider", "gpt-4", true, 0, 1,
        1000, 2000, 500, 500, 1, "CNY")
    let entry = MigrationBindingEntry.fromBinding(binding)
    let json = entry.toJson()
    let parsed = MigrationBindingEntry.fromJson(JsonValue.fromStr(json).asObject())
    @Expect(parsed.isSome(), true)
    let restored = parsed.getOrThrow()
    @Expect(restored.providerId, "test-provider")
    @Expect(restored.modelId, "gpt-4")
    @Expect(restored.enabled, true)
    @Expect(restored.order, Int64(0))
    @Expect(restored.weight, Int64(1))
    @Expect(restored.priceInMicro, Int64(1000))
    @Expect(restored.priceOutMicro, Int64(2000))
    @Expect(restored.currency, "CNY")
}

@Test
func migrationCustomModelEntryRoundTrips() {
    let bindings = [MigrationBindingEntry("test-provider", "gpt-4", true, 0, 1,
        1000, 2000, 500, 500, 1, "CNY")]
    let entry = MigrationCustomModelEntry("test-model", "Test Model", "A test model",
        true, "coding", ["text"], bindings, "weighted", 0, "", "",
        -1, -1, -1, -1, -1, true, 3)
    let json = entry.toJson()
    let parsed = MigrationCustomModelEntry.fromJson(JsonValue.fromStr(json).asObject())
    @Expect(parsed.isSome(), true)
    let restored = parsed.getOrThrow()
    @Expect(restored.id, "test-model")
    @Expect(restored.name, "Test Model")
    @Expect(restored.category, "coding")
    @Expect(restored.mode, "weighted")
    @Expect(Int64(restored.bindings.size), Int64(1))
}

@Test
func migrationBundleRoundTrips() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let cm = CustomModelRecord("test-model", "Test Model", "", true, "general",
        [], [], "weighted")
    let bundle = buildConfigBundle([provider], [cm], 1759600000)
    @Expect(bundle.format, "sacode-migrate/1")
    @Expect(bundle.kind, "config")
    @Expect(bundle.schemaVersion, Int64(1))
    @Expect(Int64(bundle.providers.size), Int64(1))
    @Expect(Int64(bundle.customModels.size), Int64(1))
    // 校验摘要
    @Expect(bundle.validate().size, Int64(0))
    // JSON 序列化
    let json = bundle.toJson()
    // 反序列化
    let parsed = MigrationBundle.fromJson(json)
    @Expect(parsed.isSome(), true)
    let restored = parsed.getOrThrow()
    @Expect(restored.format, "sacode-migrate/1")
    @Expect(restored.kind, "config")
    @Expect(Int64(restored.providers.size), Int64(1))
    @Expect(Int64(restored.customModels.size), Int64(1))
}

@Test
func migrationPlanDetectsNewEntries() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider], [], 1759600000)
    // 空的本机状态
    let plan = computeMigrationPlan(bundle, [], [], [])
    @Expect(Int64(plan.entries.size), Int64(1))
    @Expect(plan.entries[0].action, "new")
    @Expect(plan.entries[0].id, "test-provider")
    @Expect(plan.entries[0].kind, "provider")
}

@Test
func migrationPlanDetectsUnchangedEntries() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider], [], 1759600000)
    // 本机已有相同条目
    let plan = computeMigrationPlan(bundle, [provider], [], [])
    @Expect(Int64(plan.entries.size), Int64(1))
    @Expect(plan.entries[0].action, "unchanged")
}

@Test
func migrationPlanDetectsUpdatedEntries() {
    let original = ProviderRecord("test-provider", "Original Name", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let updated = ProviderRecord("test-provider", "Updated Name", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([updated], [], 1759600000)
    let plan = computeMigrationPlan(bundle, [original], [], [])
    @Expect(Int64(plan.entries.size), Int64(1))
    @Expect(plan.entries[0].action, "updated")
}

@Test
func migrationPlanDetectsCredentialConfirmation() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildSecretBundle([provider], [], ["TEST_API_KEY"], 1759600000)
    // 本机已有相同凭据
    let plan = computeMigrationPlan(bundle, [], [], ["TEST_API_KEY"])
    @Expect(plan.needsCredentialConfirmation, true)
}

@Test
func migrationPlanNoConfirmationForConfigBundle() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider], [], 1759600000)
    // config 包永远不需要凭据确认
    let plan = computeMigrationPlan(bundle, [], [], ["TEST_API_KEY"])
    @Expect(plan.needsCredentialConfirmation, false)
}

@Test
func migrationPlanWriteCount() {
    let provider1 = ProviderRecord("provider-1", "Provider 1", "https://api1.example.com",
        "openai-completions", "KEY1", true,
        [ModelSpec("m1", "Model 1", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let provider2 = ProviderRecord("provider-2", "Provider 2", "https://api2.example.com",
        "openai-completions", "KEY2", true,
        [ModelSpec("m2", "Model 2", "8192", "4096", false)],
        sortOrder: 1, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider1, provider2], [], 1759600000)
    // 本机已有 provider-1
    let plan = computeMigrationPlan(bundle, [provider1], [], [])
    @Expect(plan.newCount(), Int64(1))
    @Expect(plan.unchangedCount(), Int64(1))
    @Expect(plan.writeCount(), Int64(1))
}

@Test
func migrationProviderEqualDetectsDifference() {
    let a = MigrationProviderEntry("id", "name", "url", "proto", "ref", true, 0, true, "direct", [])
    let b = MigrationProviderEntry("id", "different", "url", "proto", "ref", true, 0, true, "direct", [])
    @Expect(migrationProviderEqual(a, b), false)
}

@Test
func migrationProviderEqualDetectsSame() {
    let a = MigrationProviderEntry("id", "name", "url", "proto", "ref", true, 0, true, "direct", [])
    let b = MigrationProviderEntry("id", "name", "url", "proto", "ref", true, 0, true, "direct", [])
    @Expect(migrationProviderEqual(a, b), true)
}

@Test
func migrationBindingEqualDetectsDifference() {
    let a = MigrationBindingEntry("pid", "mid", true, 0, 1, 1000, 2000, 500, 500, 1, "CNY")
    let b = MigrationBindingEntry("pid", "mid", true, 0, 2, 1000, 2000, 500, 500, 1, "CNY")
    @Expect(migrationBindingEqual(a, b), false)
}

@Test
func migrationBindingEqualDetectsSame() {
    let a = MigrationBindingEntry("pid", "mid", true, 0, 1, 1000, 2000, 500, 500, 1, "CNY")
    let b = MigrationBindingEntry("pid", "mid", true, 0, 1, 1000, 2000, 500, 500, 1, "CNY")
    @Expect(migrationBindingEqual(a, b), true)
}

@Test
func migrationCustomModelEqualDetectsDifference() {
    let a = MigrationCustomModelEntry("id", "name", "desc", true, "cat", [], [], "weighted", 0, "", "", -1, -1, -1, -1, -1, true, 3)
    let b = MigrationCustomModelEntry("id", "name", "different", true, "cat", [], [], "weighted", 0, "", "", -1, -1, -1, -1, -1, true, 3)
    @Expect(migrationCustomModelEqual(a, b), false)
}

@Test
func migrationCustomModelEqualDetectsSame() {
    let a = MigrationCustomModelEntry("id", "name", "desc", true, "cat", [], [], "weighted", 0, "", "", -1, -1, -1, -1, -1, true, 3)
    let b = MigrationCustomModelEntry("id", "name", "desc", true, "cat", [], [], "weighted", 0, "", "", -1, -1, -1, -1, -1, true, 3)
    @Expect(migrationCustomModelEqual(a, b), true)
}

@Test
func migrationBundleSafeSummary() {
    let bundle = MigrationBundle("sacode-migrate/1", "config", 1759600000, 1, "", [], [], [])
    let summary = bundle.safeSummary()
    @Expect(summary.contains("format=sacode-migrate/1"), true)
    @Expect(summary.contains("kind=config"), true)
    @Expect(summary.contains("providers=0"), true)
    @Expect(summary.contains("customModels=0"), true)
    // 不含条目内容
    @Expect(summary.contains("provider-1"), false)
}

@Test
func buildSecretBundleContainsCredentialRefs() {
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildSecretBundle([provider], [], ["TEST_API_KEY", "OTHER_KEY"], 1759600000)
    @Expect(bundle.kind, "secret-bundle")
    @Expect(Int64(bundle.credentialRefs.size), Int64(2))
    @Expect(bundle.credentialRefs[0], "TEST_API_KEY")
    @Expect(bundle.credentialRefs[1], "OTHER_KEY")
}

@Test
func migrationApplyResultToJson() {
    let result = MigrationApplyResult(2, 1, 3, [], 0)
    @Expect(result.isSuccess(), true)
    let json = result.toJson()
    @Expect(json.contains("\"imported\":2"), true)
    @Expect(json.contains("\"updated\":1"), true)
    @Expect(json.contains("\"unchanged\":3"), true)
}

@Test
func migrationApplyResultWithErrors() {
    let result = MigrationApplyResult(1, 0, 2, ["error1"], 0)
    @Expect(result.isSuccess(), false)
    @Expect(Int64(result.errors.size), Int64(1))
}

@Test
func migrationPlanToJson() {
    let entries = [MigrationPlanEntry("provider", "test-id", "new", None, None)]
    let plan = MigrationPlan(entries, false, "config")
    let json = plan.toJson()
    @Expect(json.contains("\"action\":\"new\""), true)
    @Expect(json.contains("\"id\":\"test-id\""), true)
    @Expect(json.contains("\"needsCredentialConfirmation\":false"), true)
}

@Test
func migrationIdempotentImport() {
    // 构建一个包
    let provider = ProviderRecord("test-provider", "Test Provider", "https://api.example.com",
        "openai-completions", "TEST_API_KEY", true,
        [ModelSpec("gpt-4", "GPT-4", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider], [], 1759600000)
    // 第一次导入：new
    let plan1 = computeMigrationPlan(bundle, [], [], [])
    @Expect(plan1.entries[0].action, "new")
    @Expect(plan1.writeCount(), Int64(1))
    // 模拟导入后，本机状态包含该条目
    // 第二次导入：unchanged（幂等）
    let plan2 = computeMigrationPlan(bundle, [provider], [], [])
    @Expect(plan2.entries[0].action, "unchanged")
    @Expect(plan2.writeCount(), Int64(0))
}

@Test
func migrationPoolPreservation() {
    // 号池保号：同地址多实例按稳定 ID 对齐
    let provider1 = ProviderRecord("deepseek-a", "DeepSeek A", "https://api.deepseek.com",
        "openai-completions", "KEY_A", true,
        [ModelSpec("deepseek-v3", "DeepSeek V3", "64000", "8192", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let provider2 = ProviderRecord("deepseek-b", "DeepSeek B", "https://api.deepseek.com",
        "openai-completions", "KEY_B", true,
        [ModelSpec("deepseek-v3", "DeepSeek V3", "64000", "8192", false)],
        sortOrder: 1, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider1, provider2], [], 1759600000)
    // 本机为空
    let plan = computeMigrationPlan(bundle, [], [], [])
    @Expect(plan.newCount(), Int64(2))
    // 本机已有 provider1
    let plan2 = computeMigrationPlan(bundle, [provider1], [], [])
    @Expect(plan2.newCount(), Int64(1))
    @Expect(plan2.unchangedCount(), Int64(1))
    // 即使 baseUrl 相同，也不会按 baseUrl 合并
}

@Test
func migrationRejectsMalformedJson() {
    let parsed = MigrationBundle.fromJson("not json at all")
    @Expect(parsed.isSome(), false)
}

@Test
func migrationRejectsWrongJsonShapesWithoutThrowing() {
    for (text in ["[]", "null", "{\"format\":\"sacode-migrate/1\",\"providers\":false}",
        "{\"format\":\"sacode-migrate/1\",\"credentialRefs\":[false]}"]) {
        @Expect(MigrationBundle.fromJson(text).isSome(), false)
    }
}

@Test
func migrationKeepsExplicitEmptyObjectContract() {
    let parsed = MigrationBundle.fromJson("{}")
    @Expect(parsed.isSome(), true)
    if (let Some(bundle) <- parsed) { @Expect(bundle.validate(), "") }
}

@Test
func migrationRejectsEmptyRequiredFields() {
    // 缺少 id 的 provider 条目
    let json = "{\"id\":\"\",\"name\":\"Test\",\"baseUrl\":\"https://api.example.com\",\"protocol\":\"openai-completions\",\"credentialRef\":\"KEY\",\"declared\":true,\"sortOrder\":0,\"enabled\":true,\"transport\":\"direct\",\"models\":[]}"
    let parsed = MigrationProviderEntry.fromJson(JsonValue.fromStr(json).asObject())
    @Expect(parsed.isSome(), false)
}

@Test
func migrationSha256Checksum() {
    // 验证 SHA-256 摘要计算
    let provider = ProviderRecord("test", "Test", "https://api.example.com",
        "openai-completions", "KEY", true,
        [ModelSpec("m", "M", "8192", "4096", false)],
        sortOrder: 0, enabled: true, transport: "direct")
    let bundle = buildConfigBundle([provider], [], 1759600000)
    @Expect(bundle.checksum.size, Int64(64))
    @Expect(bundle.validate().size, Int64(0))
    // 篡改条目后摘要不匹配
    let tamperedProvider = MigrationProviderEntry(provider.id, "被篡改的名称", provider.baseUrl,
        provider.protocol, provider.credentialRef, provider.declared, provider.sortOrder,
        provider.enabled, provider.transport, provider.models)
    let tampered = MigrationBundle(bundle.format, bundle.kind, bundle.generatedAt,
        bundle.schemaVersion, bundle.checksum, [tamperedProvider], [], [])
    @Expect(tampered.checksumValidation(), "migration-bad-checksum")
}

@Test
func migrationConstants() {
    @Expect(MIGRATION_FORMAT, "sacode-migrate/1")
    @Expect(MIGRATION_SCHEMA_VERSION, Int64(1))
    @Expect(MIGRATION_KIND_CONFIG, "config")
    @Expect(MIGRATION_KIND_SECRET, "secret-bundle")
}

@Test
func migrationRejectionCodes() {
    @Expect(MIGRATION_BAD_FORMAT, "migration-bad-format")
    @Expect(MIGRATION_BAD_SCHEMA, "migration-bad-schema")
    @Expect(MIGRATION_BAD_CHECKSUM, "migration-bad-checksum")
    @Expect(MIGRATION_BAD_KIND, "migration-bad-kind")
    @Expect(MIGRATION_MALFORMED, "migration-malformed")
    @Expect(MIGRATION_CREDENTIAL_CONFIRM_REQUIRED, "migration-credential-confirm-required")
}

@Test
func migrationPlanEntryToJson() {
    let provider = MigrationProviderEntry("id", "name", "url", "proto", "ref", true, 0, true, "direct", [])
    let entry = MigrationPlanEntry("provider", "id", "new", Some(provider), None)
    let json = entry.toJson()
    @Expect(json.contains("\"kind\":\"provider\""), true)
    @Expect(json.contains("\"action\":\"new\""), true)
    @Expect(json.contains("\"provider\":"), true)
}

@Test
func migrationApplyResultWithErrorsToJson() {
    let result = MigrationApplyResult(1, 0, 0, ["error1", "error2"], 0)
    let json = result.toJson()
    @Expect(json.contains("\"errors\":["), true)
    @Expect(json.contains("error1"), true)
    @Expect(json.contains("error2"), true)
}
