package core
import std.fs.*
import std.unittest.*

@Test
func providerCatalogInstanceRequiresRevisionAndExclusiveWriter() {
    let root = "${coreTestRoot()}/provider-catalog-admission"
    Directory.create(root, recursive: true)
    let file = "${root}/providers.log"
    let registry = ProviderRegistry(file)
    registry.addCatalogInstance("stepfun", 0)
    let first = registry.describe()
    @Expect(first.providers.size, 1)
    @ExpectThrows[Exception](registry.addCatalogInstance("stepfun", 0))
    @ExpectThrows[Exception](registry.addCatalogInstance("stepfun", -1))
    @ExpectThrows[Exception](registry.addCatalogInstance("missing", first.revision))
    @Expect(registry.describe().revision, first.revision)
    let holder = WriteLease(file)
    @Expect(holder.acquire(), true)
    @ExpectThrows[Exception](registry.addCatalogInstance("stepfun", first.revision))
    @Expect(holder.release(), true)
    registry.addCatalogInstance("stepfun", first.revision)
    let second = registry.describe()
    @Expect(second.providers.size, 2)
    @Expect(second.providers[0].credentialRef != second.providers[1].credentialRef, true)
    @Expect(second.providers[0].id != second.providers[1].id, true)
    @Expect(second.revision, first.revision + 1)
    removeIfExists(root, recursive: true)
}

@Test
func providerDefaultRejectsDisabledProviderWithoutChangingSelection() {
    let root = "${coreTestRoot()}/provider-disabled-default"
    Directory.create(root, recursive: true)
    let registry = ProviderRegistry("${root}/providers.log")
    registry.addFromCatalog("stepfun", "SA_CODE_DISABLED_DEFAULT")
    let initial = registry.describe()
    let provider = initial.providers[0]
    registry.setDefault(provider.id, provider.models[0].id, initial.revision)
    let selected = registry.describe()
    registry.setEnabled(provider.id, false, selected.revision)
    let disabled = registry.describe()
    @ExpectThrows[Exception](registry.setDefault(provider.id, provider.models[1].id, disabled.revision))
    let after = registry.describe()
    @Expect(after.revision, disabled.revision)
    @Expect(after.defaultModel, selected.defaultModel)
    registry.setEnabled(provider.id, true, after.revision)
    registry.setDefault(provider.id, provider.models[1].id, registry.describe().revision)
    @Expect(registry.describe().defaultModel, provider.models[1].id)
    removeIfExists(root, recursive: true)
}

@Test
func providerCredentialRetryRejectsStaleConfigurationAndLeavesRegistryUntouched() {
    let root = "${coreTestRoot()}/provider-key-retry"
    Directory.create(root, recursive: true)
    let registry = ProviderRegistry("${root}/providers.log")
    let store = CredentialStore("${root}/credentials.env", { _ => "" })
    registry.addFromCatalog("deepseek", "SA_CODE_RETRY_TEST")
    let initial = registry.describe()
    registry.saveCredential(initial.providers[0].id, initial.revision, "first", store)
    @Expect(store.resolve("SA_CODE_RETRY_TEST").getOrThrow().value, "first")
    @Expect(registry.describe().revision, initial.revision)
    registry.setEnabled(initial.providers[0].id, false, initial.revision)
    @ExpectThrows[Exception](registry.saveCredential(initial.providers[0].id, initial.revision, "stale", store))
    @Expect(store.resolve("SA_CODE_RETRY_TEST").getOrThrow().value, "first")
    @ExpectThrows[Exception](registry.saveCredential("missing", registry.describe().revision, "other", store))
    @ExpectThrows[Exception](registry.saveCredential(initial.providers[0].id, -1, "unguarded", store))
    let holder = WriteLease("${root}/providers.log")
    @Expect(holder.acquire(), true)
    @ExpectThrows[Exception](registry.saveCredential(initial.providers[0].id, registry.describe().revision, "busy", store))
    @Expect(store.resolve("SA_CODE_RETRY_TEST").getOrThrow().value, "first")
    @Expect(holder.release(), true)
    let current = registry.describe()
    registry.saveCredential(current.providers[0].id, current.revision, "second", store)
    @Expect(store.resolve("SA_CODE_RETRY_TEST").getOrThrow().value, "second")
    removeIfExists(root, recursive: true)
}
