package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * SaCode daemon 的 JSON-RPC 2.0 帧编解码（纯逻辑，无网络依赖，可直接单测）。
 *
 * 协议事实来自 `sa-code/apps/daemon/src/daemon.cj`：
 * - 请求：`{"jsonrpc":"2.0","id":<string|int>,"method":<name>,"params":<object>}`（`daemon.cj:50-60`）
 * - `id` **只接受字符串或整数**，其余返回 -32600（`daemon.cj:54`）
 * - `jsonrpc` 必填且必须等于 "2.0"（`daemon.cj:56`）
 * - `params` 若存在必须是对象（`daemon.cj:60` 的 `asObject()`）
 * - 成功：`{"jsonrpc":"2.0","id":<id>,"result":<any>}`
 * - 失败：`{"jsonrpc":"2.0","id":<id>,"error":{"code":<int>,"message":<string>}}`
 */
object AgentRpc {

    const val VERSION = "2.0"

    /** daemon.cj:126 —— 请求体不是合法 JSON。 */
    const val ERR_PARSE = -32700

    /** daemon.cj:138/141/154 —— id 非法、jsonrpc 版本不对、字段缺失或 params 非对象。 */
    const val ERR_INVALID_REQUEST = -32600

    /** daemon.cj:218 / host_proxy.cj:53 —— 方法不存在或未在白名单开放。 */
    const val ERR_METHOD_NOT_FOUND = -32601

    /** host_proxy.cj:54 —— params 不合法。 */
    const val ERR_INVALID_PARAMS = -32602

    /**
     * daemon.cj:159 —— 远程接入的鉴权/授权拒绝。
     *
     * 接入未启用时不会出现；启用后**每条** `/rpc` 请求（含 `initialize`）都过 gate，
     * 拒则原样回本码，附 `<denyReason>` 后缀。
     */
    const val ERR_AUTHDENIED = -32001

    /** daemon.cj:171 —— daemon 正在关闭；host_proxy.cj:55 复用该码表示宿主已退出。 */
    const val ERR_SHUTTING_DOWN = -32002

    /** daemon.cj:219 —— 分派过程中抛异常，message 是异常原文。 */
    const val ERR_EXCEPTION = -32003

    /** daemon.cj:165 —— 超出并发限额（每设备 8 槽）。 */
    const val ERR_CONCURRENCY = -32005

    /** host_proxy.cj:56 —— 宿主未配置（daemon 起在无宿主环境）。 */
    const val ERR_HOST_UNCONFIGURED = -32010

    /** host_proxy.cj:57 —— 等待宿主应答超时（默认 30s，`SACODE_HOST_TIMEOUT_MS` 可调）。 */
    const val ERR_TIMEOUT = -32011

    /** daemon.cj:206 注释 —— 宿主进程已退出。 */
    const val ERR_HOST_EXITED = -32012

    /** host_proxy.cj:58 —— 转发前置失败。 */
    const val ERR_FORWARD = -32013

    /**
     * 构造请求体。
     *
     * @param id 必须是「字符串或整数」——daemon 对其他类型直接拒（-32600）。
     *           这里固定用字符串，避免 JSON 数字精度问题。
     */
    fun request(id: String, method: String, params: JsonObject? = null): String {
        val body = buildJsonObject {
            put("jsonrpc", VERSION)
            put("id", id)
            put("method", method)
            params?.let { put("params", it) }
        }
        return saaiJson.encodeToString(JsonObject.serializer(), body)
    }

    /** 解析响应：成功给 [Parsed.ParsedOk.result]，失败给 [Parsed.ParsedErr.code]/[ParsedErr.message]。 */
    fun parse(body: String, expectedId: String? = null): Parsed {
        val obj = runCatching { saaiJson.parseToJsonElement(body).jsonObject }.getOrNull()
            ?: return Parsed.ParsedErr(ERR_PARSE, "响应不是合法 JSON")
        val version = obj["jsonrpc"] as? JsonPrimitive
        if (version?.isString != true || version.content != VERSION) {
            return Parsed.ParsedErr(ERR_PARSE, "响应 JSON-RPC 版本无效")
        }
        val id = obj["id"] as? JsonPrimitive
        if (id == null || (!id.isString && !id.content.matches(Regex("-?[0-9]+")))) {
            return Parsed.ParsedErr(ERR_PARSE, "响应 id 无效")
        }
        if (expectedId != null && (!id.isString || id.content != expectedId)) {
            return Parsed.ParsedErr(ERR_PARSE, "响应 id 与请求不匹配")
        }
        if (obj.containsKey("result") == obj.containsKey("error")) {
            return Parsed.ParsedErr(ERR_PARSE, "响应须恰好包含 result 或 error")
        }
        obj["error"]?.let { err ->
            val eo = err as? JsonObject ?: return Parsed.ParsedErr(ERR_PARSE, "错误信封无效")
            val codeNode = eo["code"] as? JsonPrimitive
            val code = codeNode?.takeIf { !it.isString }?.intOrNull
                ?: return Parsed.ParsedErr(ERR_PARSE, "错误码无效")
            val msg = (eo["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: return Parsed.ParsedErr(ERR_PARSE, "错误消息无效")
            return Parsed.ParsedErr(code, msg, eo["data"])
        }
        return Parsed.ParsedOk(obj.getValue("result"))
    }

    sealed class Parsed {
        data class ParsedOk(val result: JsonElement) : Parsed()
        data class ParsedErr(val code: Int, val message: String, val data: JsonElement? = null) : Parsed()
    }

    /**
     * 从 `initialize` 的 result 里取能力清单。
     *
     * daemon 返回：`{"protocolVersion","capabilities":[...],"core","transport"}`
     * （`daemon.cj:81`）。能力会随宿主是否配置而变化——宿主不可用时**不宣称**
     * 相关能力（`daemon.cj:73-79`），所以客户端必须按能力判断，不能假定方法可用。
     */
    fun parseCapabilities(result: JsonElement): Set<String> {
        val caps = (result as? JsonObject)?.get("capabilities") ?: return emptySet()
        return runCatching {
            caps.jsonArray.mapNotNull { it as? JsonPrimitive }.map { it.content }.toSet()
        }.getOrElse { emptySet() }
    }

    /** 从 `initialize` 的 result 里取协议版本（用于客户端侧兼容检查）。 */
    fun parseProtocolVersion(result: JsonElement): String? =
        (result as? JsonObject)?.get("protocolVersion")?.jsonPrimitive?.content

    /**
     * 解析 `session/catalog`。
     *
     * 响应形状（`daemon.cj:201`）：
     * `{"root":"<绝对路径>","entries":[{"id","title","durable","status","workspaceDirectory","current"}]}`
     *
     * `current` 恒为 `false`——daemon 侧没有标当前会话的逻辑（`daemon.cj:196` 字面量）。
     * 客户端不要依赖它做选中态判断。
     */
    fun parseCatalog(result: JsonElement): Catalog {
        val obj = result as? JsonObject ?: return Catalog()
        val entries = (obj["entries"] as? JsonArray).orEmpty().mapNotNull { e ->
            val eo = e as? JsonObject ?: return@mapNotNull null
            val id = eo["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            CatalogEntry(
                id = id,
                title = eo["title"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                durable = eo["durable"]?.jsonPrimitive?.booleanOrNull ?: false,
                status = eo["status"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                workspaceDirectory = eo["workspaceDirectory"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                current = eo["current"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
        }
        return Catalog(root = obj["root"]?.jsonPrimitive?.contentOrNull.orEmpty(), entries = entries)
    }

    /**
     * 把能力清单转成一句可展示的摘要。
     *
     * 用户关心的不是"有哪些方法名"，而是"这台 PC 现在能替我做什么"。所以按
     * 能力**组**归并：能不能列会话、能不能跑任务、能不能管理工作树、能不能协同、
     * 能不能审批。不逐条罗列方法名——那既长又没信息量。
     */
    fun describeCapabilities(caps: Set<String>): String {
        if (caps.isEmpty()) return "未协商到任何能力"
        val groups = buildList {
            if (AgentMethods.SESSION_CATALOG in caps) add("会话目录")
            if (AgentMethods.TASK_START in caps) add("任务下发")
            if (AgentMethods.TURN_POLL in caps) add("进度轮询")
            if (AgentMethods.TURN_CANCEL in caps) add("中途取消")
            if (caps.any { it.startsWith("worktree/") }) add("工作树")
            if (caps.any { it.startsWith("team/") && !it.contains("approval") }) add("团队协同")
            if (caps.any { it.contains("approval") }) add("审批")
            if (AgentMethods.DAEMON_SHUTDOWN in caps) add("远程关闭")
        }
        // 兜底：有未知能力但没归进任何组时，至少报数量，不让用户看到空白
        if (groups.isEmpty()) return "能力 ${caps.size} 项（暂无可识别功能）"
        return "${groups.joinToString("、")}（共 ${caps.size} 项）"
    }

    /** `session/catalog` 的结果。`root` 是 daemon 当前所在的工作目录。 */
    data class Catalog(val root: String = "", val entries: List<CatalogEntry> = emptyList())

    /** 目录里的一条会话。 */
    data class CatalogEntry(
        val id: String,
        val title: String,
        val durable: Boolean,
        val status: String,
        val workspaceDirectory: String,
        val current: Boolean,
    )

    /** 人类可读的错误文案，界面直接展示，避免各页面各写一份映射。 */
    fun describeError(code: Int, message: String): String = when (code) {
        ERR_PARSE -> "响应解析失败：$message"
        ERR_INVALID_REQUEST -> "请求格式不被接受：$message"
        ERR_METHOD_NOT_FOUND -> "目标端不支持该能力（可能宿主未启动）：$message"
        ERR_INVALID_PARAMS -> "参数不被接受：$message"
        ERR_AUTHDENIED -> "目标端拒绝了本次请求（设备未登记或权限不足）"
        ERR_SHUTTING_DOWN -> "目标端正在关闭"
        ERR_EXCEPTION -> "目标端内部错误：$message"
        ERR_CONCURRENCY -> "目标端并发已满，请稍后重试"
        ERR_HOST_UNCONFIGURED -> "目标端未配置执行宿主，请先在 PC 上启动宿主"
        ERR_TIMEOUT -> "目标端响应超时"
        ERR_HOST_EXITED -> "PC 侧宿主进程已退出"
        ERR_FORWARD -> "转发失败：$message"
        else -> "$message（code=$code）"
    }

    /**
     * 把一次 `/rpc` 调用的 HTTP 结果翻译成协议结果。
     *
     * **关键**：`/rpc` 的路由处理器从不设置状态码（`daemon.cj:392-398` 只写
     * `Content-Type` 和响应体），所以**业务失败也回 HTTP 200**，
     * 失败信息在 JSON-RPC 的 `error` 帧里。只看 `isSuccess` 会把
     * `{"error":{"code":-32010}}` 当成成功——那正是旧传输层踩的坑。
     *
     * 非 2xx 只在网络层/接入层出问题（路由不存在、被代理拦截、
     * `Content-Type` 不对时也会走 200 + -32600），此时给出明确归因。
     */
    fun parseHttp(statusCode: Int, body: String, expectedId: String? = null): Parsed {
        if (statusCode !in 200..299) {
            return Parsed.ParsedErr(ERR_FORWARD, "HTTP $statusCode ${body.take(120)}")
        }
        return parse(body, expectedId)
    }
}
