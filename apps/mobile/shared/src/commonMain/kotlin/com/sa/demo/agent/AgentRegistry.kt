package com.sa.demo.agent

import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.currentTimeMillis
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/**
 * 已绑定的 Agent（一台电脑 / 一台公网 SaCode）。
 * 同一台物理机可同时登记 LAN / 中继 / 公网 等多个可达端点。
 */
@Serializable
data class BoundAgent(
    val deviceId: String,
    val name: String,
    val kind: String = "pc", // pc | cloud
    val idpSub: String = "",
    /** 绑定后探测出的首选链路 */
    val preferredMode: String = AgentConnectMode.SIGNED_RELAY.name,
    val publicUrl: String = "",
    val lanUrl: String = "",
    val vnetUrl: String = "",
    val ipv6Url: String = "",
    val bearerToken: String = "",
    val useRelay: Boolean = true,
    val online: Boolean = false,
    val lastProbeAt: Long = 0,
    val lastProbeDetail: String = "",
    val lastModeUsed: String = "",
    /** 断网续传游标 */
    val resumeTaskId: String = "",
    val resumeLastSeq: Long = 0,
    val resumeLastEvtId: String = "",
    val resumePending: Boolean = false,
    val note: String = "",
    /** 新设备登记；deviceId 保持客户端 targetId，不能与服务器设备号混用。 */
    val remoteInstanceId: String = "",
    val enrolledDeviceId: String = "",
    val workspaceId: String = "",
) {
    fun endpointFor(mode: AgentConnectMode): String = when (mode) {
        AgentConnectMode.PUBLIC_HTTP -> publicUrl
        AgentConnectMode.LAN -> lanUrl
        AgentConnectMode.VIRTUAL_NET -> vnetUrl
        AgentConnectMode.IPV6 -> ipv6Url
        AgentConnectMode.SIGNED_RELAY -> "relay://${deviceId}"
    }

    fun hasEndpoint(mode: AgentConnectMode): Boolean {
        if (mode == AgentConnectMode.SIGNED_RELAY) return false
        return endpointFor(mode).isNotBlank()
    }
}

@Serializable
data class AgentRegistryRoot(
    val userId: String,
    val agents: List<BoundAgent> = emptyList(),
    val activeDeviceId: String = "",
)

interface AgentRegistryStore {
    fun load(userId: String): AgentRegistryRoot
    fun save(root: AgentRegistryRoot)
}

object AgentRegistryStoreKeys {
    fun key(userId: String): String = "sa.agent.registry.${userId.ifBlank { "anon" }}"
}

class InMemoryAgentRegistryStore : AgentRegistryStore {
    private val map = mutableMapOf<String, String>()
    override fun load(userId: String): AgentRegistryRoot {
        val raw = map[AgentRegistryStoreKeys.key(userId)] ?: return AgentRegistryRoot(userId)
        return try {
            saaiJson.decodeFromString(AgentRegistryRoot.serializer(), raw)
        } catch (_: Exception) {
            AgentRegistryRoot(userId)
        }
    }

    override fun save(root: AgentRegistryRoot) {
        map[AgentRegistryStoreKeys.key(root.userId)] =
            saaiJson.encodeToString(AgentRegistryRoot.serializer(), root)
    }
}

class PrefsAgentRegistryStore(
    private val getString: (String) -> String?,
    private val putString: (String, String) -> Unit,
    private val getSecret: (String) -> String?,
    private val putSecret: (String, String) -> Unit,
    private val removeSecret: (String) -> Unit,
) : AgentRegistryStore {
    private fun secretKey(userId: String, deviceId: String) = "sa.agent.token.$userId.$deviceId"
    override fun load(userId: String): AgentRegistryRoot {
        val raw = getString(AgentRegistryStoreKeys.key(userId)) ?: return AgentRegistryRoot(userId)
        return try {
            val root = saaiJson.decodeFromString(AgentRegistryRoot.serializer(), raw)
            if (root.agents.any { it.bearerToken.isNotBlank() }) save(root)
            root.copy(agents = root.agents.map { agent ->
                agent.copy(bearerToken = getSecret(secretKey(userId, agent.deviceId)).orEmpty())
            })
        } catch (_: Exception) {
            AgentRegistryRoot(userId)
        }
    }

    override fun save(root: AgentRegistryRoot) {
        val previous = getString(AgentRegistryStoreKeys.key(root.userId))?.let {
            runCatching { saaiJson.decodeFromString(AgentRegistryRoot.serializer(), it) }.getOrNull()
        }
        previous?.agents?.filter { old -> root.agents.none { it.deviceId == old.deviceId } }
            ?.forEach { removeSecret(secretKey(root.userId, it.deviceId)) }
        root.agents.forEach { agent ->
            val key = secretKey(root.userId, agent.deviceId)
            if (agent.bearerToken.isBlank()) removeSecret(key) else putSecret(key, agent.bearerToken)
        }
        putString(
            AgentRegistryStoreKeys.key(root.userId),
            saaiJson.encodeToString(AgentRegistryRoot.serializer(), root.copy(
                agents = root.agents.map { it.copy(bearerToken = "") },
            )),
        )
    }
}

/** 多电脑绑定注册表：一台一行，绑定后写入探测出的 preferredMode。 */
object AgentRegistry {

    private var store: AgentRegistryStore = InMemoryAgentRegistryStore()

    fun bindStore(s: AgentRegistryStore) {
        store = s
    }

    fun userKey(userId: String): String = userId.ifBlank { "anon" }

    fun load(userId: String): AgentRegistryRoot {
        val id = userKey(userId)
        val root = store.load(id)
        return if (root.userId == id) root else AgentRegistryRoot(userId = id)
    }

    fun list(userId: String): List<BoundAgent> = load(userId).agents

    fun active(userId: String): BoundAgent? {
        val root = load(userId)
        return root.agents.firstOrNull { it.deviceId == root.activeDeviceId }
            ?: root.agents.firstOrNull()
    }

    fun setActive(userId: String, deviceId: String) {
        val id = userKey(userId)
        val root = load(id)
        store.save(root.copy(userId = id, activeDeviceId = deviceId))
    }

    fun upsert(userId: String, agent: BoundAgent): BoundAgent {
        val id = userKey(userId)
        val root = load(id)
        val merged = agent.copy(idpSub = agent.idpSub.ifBlank { id }, lastProbeAt = currentTimeMillis())
        val agents = root.agents.filterNot { it.deviceId == merged.deviceId } + merged
        val active = if (root.activeDeviceId.isBlank()) merged.deviceId else root.activeDeviceId
        store.save(root.copy(userId = id, agents = agents, activeDeviceId = active))
        return merged
    }

    fun update(userId: String, deviceId: String, transform: (BoundAgent) -> BoundAgent): BoundAgent? {
        val id = userKey(userId)
        val root = load(id)
        val old = root.agents.firstOrNull { it.deviceId == deviceId } ?: return null
        val neu = transform(old)
        val agents = root.agents.map { if (it.deviceId == deviceId) neu else it }
        store.save(root.copy(userId = id, agents = agents))
        return neu
    }

    fun remove(userId: String, deviceId: String) {
        val id = userKey(userId)
        val root = load(id)
        val agents = root.agents.filterNot { it.deviceId == deviceId }
        val active = if (root.activeDeviceId == deviceId) {
            agents.firstOrNull()?.deviceId ?: ""
        } else {
            root.activeDeviceId
        }
        store.save(root.copy(userId = id, agents = agents, activeDeviceId = active))
    }

    fun newDeviceId(): String = "dev-${currentTimeMillis()}-${(0..9999).random()}"

    /** 写入续传游标（任务流式中断/切网时） */
    fun saveResume(
        userId: String,
        deviceId: String,
        taskId: String,
        lastSeq: Long,
        lastEvtId: String,
        pending: Boolean,
    ) {
        update(userId, deviceId) {
            it.copy(
                resumeTaskId = taskId,
                resumeLastSeq = lastSeq,
                resumeLastEvtId = lastEvtId,
                resumePending = pending,
            )
        }
    }

    fun clearResume(userId: String, deviceId: String) {
        update(userId, deviceId) {
            it.copy(resumeTaskId = "", resumeLastSeq = 0, resumeLastEvtId = "", resumePending = false)
        }
    }

    fun toConfig(agent: BoundAgent, mode: AgentConnectMode? = null): AgentLinkConfig {
        val m = mode ?: AgentConnectMode.valueOf(agent.preferredMode)
        return AgentLinkConfig(
            idpSub = agent.idpSub.ifBlank { "anon" },
            mode = m,
            directBaseUrl = agent.endpointFor(m),
            bearerToken = agent.bearerToken,
        )
    }
}

/**
 * 链路探测：绑定后 / 换网后调用，选出当前最稳模式。
 * 规则：
 * 1) PUBLIC_HTTP（若有）优先 —— 蜂窝/Wi-Fi 都稳
 * 2) 内网电脑：**先测 LAN**（本次对话是否同网）→ 通则 LAN
 * 3) LAN 不通 → VIRTUAL_NET → IPV6
 * 4) 仍不通 → SIGNED_RELAY（若 useRelay）
 *
 * 探测 = JSON-RPC `initialize`（`daemon.cj:172-191`），返回值是**能力清单**。
 * 不用 `/health`：它只给 `{"status":"ok"}`，不含能力，且非本机要求认证
 * （`daemon.cj:367-389`），拿它判断"能做什么"不成立。
 */
object AgentProbe {

    data class ProbeOutcome(
        val mode: AgentConnectMode,
        val ok: Boolean,
        val detail: String,
        val elapsedMs: Long,
        /** 探测成功时该 daemon 实际支持的能力；失败为空集。 */
        val capabilities: Set<String> = emptySet(),
    )

    data class SelectResult(
        val chosen: AgentConnectMode?,
        val results: List<ProbeOutcome>,
        val detail: String,
        /** 选中链路的实际能力，供上层决定按钮是否可用。 */
        val capabilities: Set<String> = emptySet(),
    )

    /** 候选顺序：公网 → 局域网 → 组网 → IPv6 → 中继 */
    fun candidateOrder(agent: BoundAgent, preferLanFirst: Boolean = false): List<AgentConnectMode> {
        val all = mutableListOf<AgentConnectMode>()
        if (preferLanFirst && agent.hasEndpoint(AgentConnectMode.LAN)) {
            all += AgentConnectMode.LAN
        }
        if (agent.hasEndpoint(AgentConnectMode.PUBLIC_HTTP)) all += AgentConnectMode.PUBLIC_HTTP
        if (AgentConnectMode.LAN !in all && agent.hasEndpoint(AgentConnectMode.LAN)) {
            all += AgentConnectMode.LAN
        }
        if (agent.hasEndpoint(AgentConnectMode.VIRTUAL_NET)) all += AgentConnectMode.VIRTUAL_NET
        if (agent.hasEndpoint(AgentConnectMode.IPV6)) all += AgentConnectMode.IPV6
        if (agent.hasEndpoint(AgentConnectMode.SIGNED_RELAY)) all += AgentConnectMode.SIGNED_RELAY
        return all
    }

    /**
     * 内网电脑：preferLanFirst=true —— 先验证「本次」局域网是否可达。
     * 云主机：preferLanFirst=false —— 先测 PUBLIC_HTTP。
     */
    fun probeAndSelect(agent: BoundAgent, onDone: (SelectResult) -> Unit) {
        val order = candidateOrder(agent, preferLanFirst = agent.kind != "cloud")
        if (order.isEmpty()) {
            onDone(SelectResult(null, emptyList(), "未配置任何可达端点"))
            return
        }
        val results = mutableListOf<ProbeOutcome>()
        var index = 0

        fun next() {
            if (index >= order.size) {
                val ok = results.firstOrNull { it.ok }
                val chosen = ok?.mode
                val detail = buildString {
                    append("探测链路：")
                    results.forEachIndexed { i, r ->
                        if (i > 0) append(" → ")
                        append(r.mode)
                        append(if (r.ok) "✓" else "✗")
                    }
                    if (chosen != null) {
                        append("；选用 ")
                        append(chosen)
                    } else {
                        append("；全部不可达")
                    }
                }
                onDone(SelectResult(chosen, results.toList(), detail, ok?.capabilities ?: emptySet()))
                return
            }
            val mode = order[index]
            val cfg = AgentRegistry.toConfig(agent, mode)
            val transport = AgentLink.createTransport(cfg)
            val t0 = currentTimeMillis()
            transport.probe { r ->
                val elapsed = currentTimeMillis() - t0
                val outcome = when (r) {
                    is AgentResult.Ok ->
                        ProbeOutcome(
                            mode, true,
                            com.sa.demo.agent.rpc.AgentRpc.describeCapabilities(r.value),
                            elapsed, r.value,
                        )
                    is AgentResult.Err -> ProbeOutcome(mode, false, r.message, elapsed)
                }
                results += outcome
                index += 1
                // 公网/局域网首个成功即停，避免无谓探测
                if (outcome.ok && mode != AgentConnectMode.SIGNED_RELAY) {
                    // 仍记录已测项，直接收尾
                    val ok = results.firstOrNull { it.ok }
                    onDone(
                        SelectResult(
                            ok?.mode,
                            results.toList(),
                            "探测提前命中 ${ok?.mode}（${results.joinToString { it.mode.name + if (it.ok) "✓" else "✗" }}）",
                            ok?.capabilities ?: emptySet(),
                        )
                    )
                    return@probe
                }
                next()
            }
        }
        next()
    }

    fun configForMode(agent: BoundAgent, mode: AgentConnectMode): AgentLinkConfig =
        AgentRegistry.toConfig(agent, mode)
}

/**
 * 断网续传：按 deviceId + taskId 记住 seq / Redis stream id。
 * 切网或重连后：从 last_seq/last_evt_id 之后继续拉，不重复展示已收 delta。
 */
object AgentResume {

    data class Cursor(
        val deviceId: String,
        val taskId: String,
        val lastSeq: Long,
        val lastEvtId: String,
    )

    fun cursorOf(agent: BoundAgent): Cursor? {
        if (agent.resumeTaskId.isBlank()) return null
        return Cursor(
            deviceId = agent.deviceId,
            taskId = agent.resumeTaskId,
            lastSeq = agent.resumeLastSeq,
            lastEvtId = agent.resumeLastEvtId,
        )
    }

    /** 合并新事件：seq 更大才接受；返回是否应用 */
    fun shouldApply(cursor: Cursor?, taskId: String, seq: Long): Boolean {
        if (cursor == null || cursor.taskId != taskId) return true
        return seq > cursor.lastSeq
    }

    fun noteEvent(userId: String, agent: BoundAgent, taskId: String, seq: Long, evtId: String, completed: Boolean) {
        AgentRegistry.saveResume(
            userId = userId,
            deviceId = agent.deviceId,
            taskId = taskId,
            lastSeq = maxOf(agent.resumeLastSeq.takeIf { agent.resumeTaskId == taskId } ?: 0L, seq),
            lastEvtId = evtId.ifBlank { agent.resumeLastEvtId },
            pending = !completed,
        )
    }
}
