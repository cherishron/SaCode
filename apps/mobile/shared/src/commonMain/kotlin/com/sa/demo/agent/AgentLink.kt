package com.sa.demo.agent

/**
 * 手机 ↔ 用户 PC（sacode daemon）连接方式。
 *
 * 这些枚举描述的是**链路形态**，不是协议。协议只有一套：daemon 的 JSON-RPC
 * （见 `agent/rpc/AgentRpc.kt`），与链路无关。
 */
enum class AgentConnectMode {
    /** 公网服务器上的 SaCode：需 HTTPS 代理 */
    PUBLIC_HTTP,

    /** 同网访问 PC：需 HTTPS 代理与 daemon 令牌（或经 ADB reverse 本机回环） */
    LAN,

    /** 出站签名中继：预留模式，服务端尚未实现 */
    SIGNED_RELAY,

    /** 虚拟组网：亦需 HTTPS 代理与令牌 */
    VIRTUAL_NET,

    /** IPv6 全球地址：亦需 HTTPS 代理与令牌 */
    IPV6,
}

data class AgentDevice(
    val deviceId: String,
    val name: String,
    val mode: AgentConnectMode,
    val endpoint: String,
    val online: Boolean = false,
    val note: String = "",
)

sealed class AgentResult<out T> {
    data class Ok<T>(val value: T) : AgentResult<T>()
    data class Err(val message: String, val code: String? = null) : AgentResult<Nothing>()
}

inline fun <T> AgentResult<T>.onSuccessOrError(
    onSuccess: (T) -> Unit,
    onError: (String, String?) -> Unit,
) {
    when (this) {
        is AgentResult.Ok -> onSuccess(value)
        is AgentResult.Err -> onError(message, code)
    }
}

/**
 * 链路探测契约：只回答「这条链路通不通、能做什么」。
 *
 * **为什么只剩探测**：旧实现有 `ping` + `sendCommand` 两个方法，
 * `sendCommand` 自造了 `agent.create_task` / `agent.task.status` 这套类型名和
 * `POST /task`、`GET /task/:id/status` 这套 REST 路径——**daemon 上全都不存在**
 * （`daemon.cj` 只有 `/health`、`/rpc`、`/sse`）。保留它只会让人以为链路是通的。
 *
 * 现在：探测 = JSON-RPC `initialize`，返回值就是能力清单；
 * 具体业务调用由 [com.sa.demo.agent.rpc.DaemonTransport] 按方法名直接发，
 * 不再经过这层抽象。
 */
interface AgentTransport {
    val mode: AgentConnectMode

    /**
     * 探测链路。成功返回该 daemon 实际支持的能力集合。
     *
     * 能力清单会随 PC 上是否启动宿主而变（`daemon.cj:172-188`），
     * 所以它是**运行时事实**，不是常量——不要缓存成"这个版本支持 XXX"。
     */
    fun probe(onDone: (AgentResult<Set<String>>) -> Unit)
}

/** 配置：Env 级默认 + 用户可选模式。 */
data class AgentLinkConfig(
    val idpSub: String,
    val mode: AgentConnectMode = AgentConnectMode.SIGNED_RELAY,
    /** 回环用 `http://127.0.0.1:18937`（daemon 默认端口）；其他地址须为 HTTPS。 */
    val directBaseUrl: String = "",
    /** daemon / 桥的 Bearer（远程接入启用时） */
    val bearerToken: String = "",
) {
    companion object {
        @Volatile
        var current: AgentLinkConfig = AgentLinkConfig(idpSub = "anon")
    }
}

object AgentLink {
    fun describe(mode: AgentConnectMode): String = when (mode) {
        AgentConnectMode.PUBLIC_HTTP ->
            "公网直连：经 HTTPS 代理访问受令牌保护的 PC daemon"
        AgentConnectMode.LAN -> "本机 ADB reverse 或局域网 HTTPS 代理 + 令牌"
        AgentConnectMode.SIGNED_RELAY -> "签名中继尚未部署，不能下发任务"
        AgentConnectMode.VIRTUAL_NET -> "虚拟组网：经 HTTPS 代理访问 PC"
        AgentConnectMode.IPV6 -> "IPv6：经 HTTPS 代理访问 PC"
    }

    fun createTransport(config: AgentLinkConfig): AgentTransport = when (config.mode) {
        AgentConnectMode.PUBLIC_HTTP,
        AgentConnectMode.LAN,
        AgentConnectMode.VIRTUAL_NET,
        AgentConnectMode.IPV6,
        -> DirectHttpTransport(config)
        AgentConnectMode.SIGNED_RELAY ->
            SignedRelayTransport(config)
    }
}

/**
 * 直连 PC：把一次 JSON-RPC `initialize` 当作链路探测。
 *
 * 真实收发在 [com.sa.demo.agent.rpc.DaemonTransport]，这里只做一层适配，
 * 让 [AgentProbe] 能按链路顺序逐个试。
 */
class DirectHttpTransport(config: AgentLinkConfig) : AgentTransport {
    override val mode: AgentConnectMode = config.mode

    private val transport =
        com.sa.demo.agent.rpc.DaemonTransport(config.directBaseUrl, config.bearerToken)

    override fun probe(onDone: (AgentResult<Set<String>>) -> Unit) {
        val bad = transport.validate()
        if (bad != null) {
            onDone(AgentResult.Err(bad, "insecure_endpoint"))
            return
        }
        transport.initialize { caps, err ->
            if (err != null) onDone(AgentResult.Err(err, "probe_failed"))
            else onDone(AgentResult.Ok(caps))
        }
    }
}

/** 中继尚无服务端与设备签名协议；在部署之前明确拒绝，不能伪装在线。 */
class SignedRelayTransport(config: AgentLinkConfig) : AgentTransport {
    override val mode: AgentConnectMode = AgentConnectMode.SIGNED_RELAY

    override fun probe(onDone: (AgentResult<Set<String>>) -> Unit) {
        onDone(AgentResult.Err("签名中继尚未部署", "relay_unavailable"))
    }
}
