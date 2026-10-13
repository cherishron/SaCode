package core
import std.fs.*
import std.unittest.*

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