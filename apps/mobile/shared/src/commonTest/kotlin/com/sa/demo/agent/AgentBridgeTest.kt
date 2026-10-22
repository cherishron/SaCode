package com.sa.demo.agent

import com.sa.demo.auth.saaiJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentBridgeTest {
    @Test
    fun relay_reports_unavailable_instead_of_simulated_online() {
        // 中继没有服务端，探测必须明确拒绝且不带任何能力——
        // 返回空能力集，上层据此禁用任务按钮，而不是让用户点了才报错。
        val relay = SignedRelayTransport(AgentLinkConfig(idpSub = "user"))
        var called = false
        relay.probe { result ->
            called = true
            val err = assertIs<AgentResult.Err>(result)
            assertEquals("relay_unavailable", err.code)
        }
        assertTrue(called, "probe 必须同步给出结果")
    }

    @Test
    fun direct_transport_rejects_insecure_remote_endpoint_without_claiming_online() {
        // 远程明文会把 Bearer 裸奔在网络上，必须在发请求前就拒。
        // 这是配置校验，不涉及网络，所以可以单测。
        val t = DirectHttpTransport(
            AgentLinkConfig(
                idpSub = "u",
                mode = AgentConnectMode.LAN,
                directBaseUrl = "http://192.168.1.5:18937",
            )
        )
        var code: String? = null
        t.probe { code = assertIs<AgentResult.Err>(it).code }
        assertEquals("insecure_endpoint", code)
    }

    @Test
    fun direct_transport_rejects_blank_endpoint() {
        val t = DirectHttpTransport(
            AgentLinkConfig(idpSub = "u", mode = AgentConnectMode.PUBLIC_HTTP, directBaseUrl = "")
        )
        var msg: String? = null
        t.probe { msg = assertIs<AgentResult.Err>(it).message }
        assertTrue(msg!!.contains("未配置"), "实际：$msg")
    }

    @Test
    fun preferences_migrate_plaintext_token_into_secure_store() {
        val prefs = mutableMapOf<String, String>()
        val secrets = mutableMapOf<String, String>()
        val root = AgentRegistryRoot("user", listOf(BoundAgent(
            deviceId = "pc", name = "PC", kind = "pc", idpSub = "user",
            bearerToken = "secret", preferredMode = AgentConnectMode.LAN.name,
        )))
        prefs[AgentRegistryStoreKeys.key("user")] = saaiJson.encodeToString(AgentRegistryRoot.serializer(), root)
        val store = PrefsAgentRegistryStore(
            getString = { prefs[it] }, putString = { k, v -> prefs[k] = v },
            getSecret = { secrets[it] }, putSecret = { k, v -> secrets[k] = v },
            removeSecret = { secrets.remove(it); Unit },
        )
        assertEquals("secret", store.load("user").agents.single().bearerToken)
        assertFalse(prefs.values.single().contains("secret"))
        assertTrue(secrets.values.contains("secret"))
        store.save(root.copy(agents = emptyList()))
        assertTrue(secrets.isEmpty())
    }
}
