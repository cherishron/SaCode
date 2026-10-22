package com.sa.demo.agent.rpc

import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.storage.SecureStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class RemoteAuthRepositoryTest {
    private class MemoryStore : SecureStore {
        val map = mutableMapOf<String, String>()
        override fun getString(key: String) = map[key]
        override fun putString(key: String, value: String) { map[key] = value }
        override fun remove(key: String) { map.remove(key) }
        override fun clear() { map.clear() }
    }

    @Test fun registration_separates_namespaces_and_never_stores_enrollment_secret() {
        val store = MemoryStore()
        val vault = RemoteCredentialVault(store)
        val repository = RemoteAuthRepository("https://pc.example", "alice", "pc1", vault, RemoteHttpExecutor {
            assertEquals("https://pc.example/auth/enroll", it.url)
            assertFalse(it.headers.containsKey("Authorization"))
            HttpResponse(200, """{"instanceId":"instance","deviceId":"phone-1","credential":"credential"}""")
        })
        repository.enroll("one-time-secret", "phone")
        assertNotNull(vault.load("alice", "pc1"))
        assertNull(vault.load("bob", "pc1"))
        assertFalse(store.map.values.any { it.contains("one-time-secret") })
        assertFailsWith<IllegalArgumentException> { repository.enroll("secret", "中文设备") }
    }

    @Test fun token_ttl_is_milliseconds_and_renewal_is_single_flight() {
        val vault = RemoteCredentialVault(MemoryStore())
        vault.save("alice", "pc", RemoteDeviceCredential("i", "d", "c"))
        var time = 1000L
        val calls = AtomicInteger()
        val repository = RemoteAuthRepository("https://pc.example", "alice", "pc", vault, RemoteHttpExecutor {
            calls.incrementAndGet()
            HttpResponse(200, """{"accessToken":"token","expiresInMs":10000,"tokenType":"Bearer"}""")
        }, { time })
        val start = CountDownLatch(1)
        val done = CountDownLatch(12)
        val errors = java.util.concurrent.ConcurrentLinkedQueue<Throwable>()
        repeat(12) {
            Thread {
                try { start.await(); assertEquals("token", repository.token()) }
                catch (t: Throwable) { errors.add(t) }
                finally { done.countDown() }
            }.start()
        }
        start.countDown(); done.await()
        assertEquals(emptyList(), errors.toList())
        assertEquals(1, calls.get())
        time = 9999
        repository.token()
        assertEquals(1, calls.get())
        time = 10000
        repository.token()
        assertEquals(2, calls.get())
    }

    @Test fun invalid_credential_stops_repeated_exchange() {
        val vault = RemoteCredentialVault(MemoryStore())
        vault.save("a", "t", RemoteDeviceCredential("i", "d", "c"))
        var calls = 0
        val repository = RemoteAuthRepository("https://pc.example", "a", "t", vault, RemoteHttpExecutor {
            calls++
            HttpResponse(401, "secret response must not be reflected")
        })
        repeat(2) {
            val error = assertFailsWith<RemoteAuthException> { repository.token() }
            assertFalse(error.message.orEmpty().contains("secret response"))
        }
        assertEquals(1, calls)
        repository.forget()
        assertNull(vault.load("a", "t"))
    }

    @Test fun failed_secure_write_does_not_report_successful_registration() {
        val broken = object : SecureStore {
            override fun getString(key: String): String? = null
            override fun putString(key: String, value: String) = Unit
            override fun remove(key: String) = Unit
            override fun clear() = Unit
        }
        val repository = RemoteAuthRepository("https://pc.example", "a", "t", RemoteCredentialVault(broken), RemoteHttpExecutor {
            HttpResponse(200, """{"instanceId":"i","deviceId":"d","credential":"c"}""")
        })
        assertFailsWith<IllegalStateException> { repository.enroll("secret", "phone") }
    }
}
