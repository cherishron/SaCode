package com.sa.demo.agent.rpc

import com.sa.demo.agent.AgentRegistry
import com.sa.demo.agent.BoundAgent
import com.sa.demo.agent.InMemoryAgentRegistryStore
import com.sa.demo.agent.LocalDeviceProfile
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.storage.SecureStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LocalDeviceProfileTest {
    private class MemoryStore : SecureStore {
        val values = mutableMapOf<String, String>()
        override fun getString(key: String) = values[key]
        override fun putString(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
        override fun clear() { values.clear() }
    }

    @Test fun owner_is_persistent_install_local_and_independent_of_legacy_username() {
        val store = MemoryStore()
        val profile = LocalDeviceProfile(store) { ByteArray(it) { 1 } }
        val owner = profile.ownerId()
        assertTrue(owner.startsWith("sacode-local-v1-"))
        assertEquals(owner, LocalDeviceProfile(store) { error("不得重新生成档案") }.ownerId())
        store.putString("username", "legacy-user")
        assertEquals(owner, profile.ownerId())
        assertNotEquals(owner, LocalDeviceProfile(MemoryStore()) { ByteArray(it) { 2 } }.ownerId())
        assertFalse(store.values.containsKey("access_token"))
        assertFalse(store.values.containsKey("api_key"))
    }

    @Test fun failed_write_or_corrupt_profile_fails_closed_without_blank_or_fake_owner() {
        val broken = object : SecureStore {
            override fun getString(key: String): String? = null
            override fun putString(key: String, value: String) = Unit
            override fun remove(key: String) = Unit
            override fun clear() = Unit
        }
        assertFailsWith<IllegalStateException> { LocalDeviceProfile(broken).ownerId() }
        val store = MemoryStore()
        LocalDeviceProfile(store).ownerId()
        val key = store.values.keys.single()
        store.putString(key, "legacy-user")
        assertFailsWith<IllegalStateException> { LocalDeviceProfile(store).ownerId() }
    }

    @Test fun enrollment_without_idp_keeps_remote_auth_and_target_owner_isolation() {
        val store = MemoryStore()
        val owner = LocalDeviceProfile(store).ownerId()
        val vault = RemoteCredentialVault(store)
        AgentRegistry.bindStore(InMemoryAgentRegistryStore())
        try {
            AgentRegistry.upsert("legacy-user", BoundAgent("pc", "旧目标", publicUrl = "https://pc.example"))
            assertTrue(AgentRegistry.list(owner).isEmpty())
            var calls = 0
            val auth = RemoteAuthRepository("https://pc.example", owner, "pc", vault, RemoteHttpExecutor {
                calls++
                when (calls) {
                    1 -> {
                        assertEquals("https://pc.example/auth/enroll", it.url)
                        HttpResponse(200, """{"instanceId":"i","deviceId":"d","credential":"synthetic-credential"}""")
                    }
                    else -> {
                        assertEquals("https://pc.example/auth/token", it.url)
                        HttpResponse(200, """{"accessToken":"synthetic-token","expiresInMs":60000,"tokenType":"Bearer"}""")
                    }
                }
            })
            assertFailsWith<RemoteAuthException> { auth.token() }
            assertEquals(0, calls)
            auth.enroll("synthetic-one-time-ticket", "phone")
            assertEquals("synthetic-token", auth.token())
            assertEquals(2, calls)
            assertNull(vault.load("legacy-user", "pc"))
            assertNull(vault.load(owner, "other-pc"))
            assertFalse(store.values.values.any { it.contains("synthetic-one-time-ticket") })
            assertFalse(store.values.values.any { it.contains("synthetic-token") })
        } finally {
            AgentRegistry.bindStore(InMemoryAgentRegistryStore())
        }
    }
}
