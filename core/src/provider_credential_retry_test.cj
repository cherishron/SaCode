package core
import std.fs.*
import std.unittest.*

@Test
func providerRemovalCredentialWriteFailureLeavesConfigurationForRetry() {
    let root = "${coreTestRoot()}/provider-remove-failure"
    Directory.create(root, recursive: true)
    let registry = ProviderRegistry("${root}/providers.log")
    registry.addCatalogInstance("stepfun", 0)
    let view = registry.describe()
    let blocked = "${root}/credentials.env"
    Directory.create(blocked)
    let store = CredentialStore(blocked, { _ => "" })
    @ExpectThrows[Exception](registry.removeWithCredential(view.providers[0].id, view.revision, store))
    @Expect(registry.describe().revision, view.revision)
    @Expect(registry.describe().providers.size, 1)
    removeIfExists(blocked, recursive: true)
    store.set(view.providers[0].credentialRef, "retry-key")
    @Expect(registry.removeWithCredential(view.providers[0].id, view.revision, store), "credential-removed")
    @Expect(store.describe(view.providers[0].credentialRef).configured, false)
    removeIfExists(root, recursive: true)
}

@Test
func providerRemovalPreservesEnvironmentCredential() {
    let root = "${coreTestRoot()}/provider-remove-environment"
    Directory.create(root, recursive: true)
    let registry = ProviderRegistry("${root}/providers.log")
    registry.addCatalogInstance("stepfun", 0)
    let view = registry.describe()
    let provider = view.providers[0]
    let store = CredentialStore("${root}/credentials.env", { _ => "environment-key" })
    @Expect(registry.removeWithCredential(provider.id, view.revision, store), "environment-credential-retained")
    @Expect(store.describe(provider.credentialRef).configured, true)
    @Expect(registry.describe().providers.size, 0)
    removeIfExists(root, recursive: true)
}

@Test
func providerRemovalPreservesCredentialReferencedByAnotherProvider() {
    let root = "${coreTestRoot()}/provider-remove-shared"
    Directory.create(root, recursive: true)
    let registry = ProviderRegistry("${root}/providers.log")
    for (id in ["first", "second"]) {
        registry.update("{\"id\":\"${id}\",\"name\":\"shared\",\"baseUrl\":\"https://example.com/v1\",\"protocol\":\"openai-completions\",\"credentialRef\":\"SHARED_KEY\",\"models\":[{\"id\":\"m\",\"name\":\"m\",\"contextWindow\":\"\",\"maxTokens\":\"\",\"image\":false}]}", registry.describe().revision)
    }
    let store = CredentialStore("${root}/credentials.env", { _ => "" })
    store.set("SHARED_KEY", "shared-key")
    @Expect(registry.removeWithCredential("first", registry.describe().revision, store), "shared-credential-retained")
    @Expect(store.describe("SHARED_KEY").configured, true)
    @Expect(registry.describe().providers.size, 1)
    @Expect(registry.removeWithCredential("second", registry.describe().revision, store), "credential-removed")
    @Expect(store.describe("SHARED_KEY").configured, false)
    removeIfExists(root, recursive: true)
}

@Test
func providerRemovalDeletesOwnCredentialAndRejectsStaleAttempt() {
    let root = "${coreTestRoot()}/provider-remove-key"
    Directory.create(root, recursive: true)
    let registry = ProviderRegistry("${root}/providers.log")
    let store = CredentialStore("${root}/credentials.env", { _ => "" })
    registry.addCatalogInstance("stepfun", 0)
    let view = registry.describe()
    let provider = view.providers[0]
    registry.saveCredential(provider.id, view.revision, "owned-key", store)
    @ExpectThrows[Exception](registry.removeWithCredential(provider.id, view.revision - 1, store))
    @Expect(store.describe(provider.credentialRef).configured, true)
    @Expect(registry.removeWithCredential(provider.id, view.revision, store), "credential-removed")
    @Expect(store.describe(provider.credentialRef).configured, false)
    @Expect(registry.describe().providers.size, 0)
    removeIfExists(root, recursive: true)
}

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
