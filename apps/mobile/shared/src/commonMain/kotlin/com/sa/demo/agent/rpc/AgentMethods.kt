package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * SaCode daemon 的方法名与端点（常量集中在此，避免各页面硬编码字符串）。
 *
 * 方法清单来自 daemon 分派层与两座桥的白名单，逐字对齐：
 * - daemon 自有：`daemon.cj:35,64,84,102`
 * - 转发宿主白名单：`host_proxy.cj:38-44`
 * - 转发团队宿主：`team_host_bridge.cj:13-15`
 *
 * 端点仅 `/rpc`（POST，JSON-RPC）与 `/sse`（GET，事件流）；
 * `/auth/enroll`、`/auth/token` 仅用于身份登记与令牌兑换，不承载业务调用。
 */
object AgentMethods {

    const val PATH_RPC = "/rpc"
    const val PATH_SSE = "/sse"
    const val PATH_AUTH_ENROLL = "/auth/enroll"
    const val PATH_AUTH_TOKEN = "/auth/token"

    /** 能力协商。返回 capabilities，是客户端判断可用方法的唯一依据。 */
    const val INITIALIZE = "initialize"

    /** 会话目录，由 daemon 按本地会话根回答（`daemon.cj:84`）。 */
    const val SESSION_CATALOG = "session/catalog"

    /** 结束 daemon（`daemon.cj:102`）。 */
    const val DAEMON_SHUTDOWN = "daemon/shutdown"

    // —— 以下均转发给宿主，宿主未配置时返回 -32010 ——

    const val SESSION_CREATE = "session/create"
    const val SESSION_SELECT = "session/select"
    const val SESSION_PROJECTION = "session/projection"
    const val SESSION_SUBMIT = "session/submit"
    const val SESSION_FLUSH = "session/flush"

    const val WORKSPACE_GET = "workspace/get"
    const val WORKSPACE_SET_DIRECTORY = "workspace/set-directory"

    /** 发起一轮任务（对应旧设想的 POST /task）。 */
    const val TASK_START = "task/start"

    /** 轮询一轮结果（对应旧设想的 GET /task/:id/status）。 */
    const val TURN_POLL = "turn/poll"

    /** 取消一轮（对应旧设想的 POST /task/:id/cancel）。 */
    const val TURN_CANCEL = "turn/cancel"

    const val WORKTREE_ENTER = "worktree/enter"
    const val WORKTREE_DESCRIBE = "worktree/describe"
    const val WORKTREE_EXIT = "worktree/exit"
    const val WORKTREE_AGENT_PREPARE = "worktree/agent-prepare"
    const val WORKTREE_AGENT_FINISH = "worktree/agent-finish"
    const val WORKTREE_CLEANUP = "worktree/cleanup"

    // —— 团队宿主 ——

    const val TEAM_DESCRIBE = "team/describe"
    const val TEAM_MEMBER_CREATE = "team/member/create"
    const val TEAM_MESSAGE_SEND = "team/message/send"
    const val TEAM_MESSAGE_BROADCAST = "team/message/broadcast"
    const val TEAM_TASK_CREATE = "team/task/create"
    const val TEAM_TASK_ASSIGN = "team/task/assign"
    const val TEAM_TASK_CLAIM = "team/task/claim"
    const val TEAM_TASK_COMPLETE = "team/task/complete"
    const val TEAM_MEMBER_STOP = "team/member/stop"

    /** 审批答复（对应旧设想的 POST /task/:id/approve）。 */
    const val TEAM_APPROVAL_ANSWER = "team/approval/answer"
}

/**
 * `GET /sse` 的事件帧解析（纯逻辑）。
 *
 * daemon 行为（`daemon.cj:138-160`）：
 * - 建连后先发 `: connected\n\n` —— SSE **注释**，不是数据
 * - 空闲时每秒发 `: keepalive\n\n` —— 同样是注释
 * - 真实事件为 `data: <json>\n\n`
 *
 * 所以必须按 `data:` 前缀过滤，否则会把注释当事件解析。
 */
object AgentSse {

    /** 取出 `data:` 行的载荷；注释行/心跳/空行返回 null。 */
    fun dataLine(line: String): String? {
        val t = line.trim()
        if (!t.startsWith("data:")) return null
        return t.removePrefix("data:").trim().takeIf { it.isNotEmpty() }
    }

    /** 事件是否为心跳/连接确认（用于 UI 显示连接状态，不进消息流）。 */
    fun isComment(line: String): Boolean = line.trimStart().startsWith(":")

    /** 解析事件载荷为 JSON 对象；非法返回 null。 */
    fun parseEvent(payload: String): JsonObject? =
        runCatching { Json.parseToJsonElement(payload).jsonObject }.getOrNull()

    /**
     * 从事件里取可展示文本。
     *
     * 事件形状由各能力自行决定，这里只认常见的几种键，找不到就返回 null，
     * 不猜测未知形状——那会把协议演进变成静默的数据丢失。
     */
    fun extractText(obj: JsonObject): String? {
        for (key in TEXT_KEYS) {
            val v = obj[key] as? JsonPrimitive ?: continue
            if (v.isString && v.content.isNotBlank()) return v.content
        }
        return null
    }

    private val TEXT_KEYS = listOf("text", "delta", "content", "summary", "message")
}

/** 复用仓库既有的宽松 JSON 实例（与 ChatRepository/AuthRepository 一致）。 */
private val Json = com.sa.demo.auth.saaiJson
