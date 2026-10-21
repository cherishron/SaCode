package host

import core.*
import std.sync.*
import std.time.*
import stdx.encoding.json.*
import stdx.crypto.crypto.SecureRandom
import stdx.encoding.base64.toBase64String

func isDatabaseMethod(method: String): Bool {
    return method == "database/connect" || method == "database/disconnect" ||
        method == "database/query" || method == "database/describe"
}

// 可信装配方实现此接口，不通过 RPC 注入可执行文件或扩展路径。
// connect 必须验证 TLS 并建立服务端强制只读连接；不支持即拒绝，不能靠 SQL 前缀猜测只读。
// query/fetch 必须流式执行累计限额、100 行分页、deadline 和取消，不能先拉全表再裁切。
// 非末页必须满 100 行；末页 cursor 为空，预算截断页标记 truncated；fetch 接管并释放旧游标。
// connect 抛异常前须自行收束未返回的句柄；disconnect 必须关闭该连接全部游标。
// credentialAllowed 必须按完整目标校验独立凭据引用的绑定，不能允许任意引用发往任意主机。
// 返回的句柄只在本接口内部使用；异常不得作为协议正文回显。没有真实驱动时不创建假连接。
public interface DatabaseRpcDriver {
    func credentialAllowed(spec: JsonObject): Bool
    func connect(spec: JsonObject, secret: String, token: TurnToken, deadline: MonoTime): String
    func disconnect(handle: String): Bool
    func query(handle: String, sql: String, parameters: JsonArray, maxRows: Int64,
        maxBytes: Int64, token: TurnToken, deadline: MonoTime): DatabaseRpcPage
    func fetch(handle: String, cursor: String, remainingRows: Int64,
        remainingBytes: Int64, token: TurnToken, deadline: MonoTime): DatabaseRpcPage
    func closeCursor(handle: String, cursor: String): Bool
}

public class DatabaseRpcPage {
    public let columns: JsonArray
    public let rows: JsonArray
    public let cursor: String
    public let truncated: Bool
    public init(columns: JsonArray, rows: JsonArray, cursor: String, truncated: Bool) {
        this.columns = columns
        this.rows = rows
        this.cursor = cursor
        this.truncated = truncated
    }
}

func databaseString(obj: JsonObject, name: String): String {
    return obj.get(name).getOrThrow().asString().getValue()
}

func databaseInt(obj: JsonObject, name: String): Int64 {
    return obj.get(name).getOrThrow().asInt().getValue()
}

func databaseFailure(kind: String): String {
    return "{\"ok\":false,\"failureKind\":\"${kind}\",\"columns\":[],\"rows\":[],\"truncated\":false}"
}

// 一个实例属于一个会话/项目，维护一条连接与一个活动 cursor，符合当前面板的单连接模型。
// 活句柄不落日志，不从历史记录恢复。调度方切换会话前须 cancel、等待 worker、再 disconnect。
public class DatabaseRpc {
    public let sessionId: String
    public let projectId: String
    let driver: Option<DatabaseRpcDriver>
    let credentials: CredentialStore
    let mtx = Mutex()
    let token = TurnToken()
    let instanceId: String
    var connection = ""
    var connectionId = ""
    var engine = ""
    var state = "disconnected"
    var serial: Int64 = 0
    var cursor = ""
    var cursorId = ""
    var rowLimit: Int64 = 0
    var byteLimit: Int64 = 0
    var rowsRead: Int64 = 0
    var bytesRead: Int64 = 0
    var queryTimeout: Int64 = 30000
    var connectionTimeout: Int64 = 30000
    var queryStarted = MonoTime.now()

    public init(sessionId: String, projectId: String, credentials: CredentialStore,
                driver!: Option<DatabaseRpcDriver> = None) {
        if (sessionId.size == 0 || projectId.size == 0) { throw Exception("invalid-input:database-owner") }
        this.sessionId = sessionId
        this.projectId = projectId
        this.credentials = credentials
        this.driver = driver
        let nonce = Array<Byte>(24, repeat: 0)
        SecureRandom().nextBytes(nonce)
        this.instanceId = toBase64String(nonce)
    }

    // 永久取消本实例；重建实例才可再连接，避免切任务后迟到请求重新获得执行能力。
    public func cancel(): Unit { token.cancel() }

    func checkSpec(spec: JsonObject): Unit {
        if (spec.size() != 10) { throw Exception("invalid-input:database-spec") }
        let selected = databaseString(spec, "engine")
        if (selected != "postgresql" && selected != "mysql" && selected != "dm") {
            throw Exception("invalid-input:database-engine")
        }
        let host = databaseString(spec, "host")
        let port = databaseInt(spec, "port")
        if (host.size == 0 || host.size > 253 || host.contains("://") || host.contains("@") ||
            databaseString(spec, "database").size == 0 || databaseString(spec, "user").size == 0 ||
            port < 1 || port > 65535 || !isValidCredentialRef(databaseString(spec, "credentialRef")) ||
            databaseString(spec, "tlsMode") != "verify-full") {
            throw Exception("invalid-input:database-spec")
        }
        for (b in host.toArray()) {
            if (b <= 32 || b == 127) { throw Exception("invalid-input:database-host") }
        }
        if (let Some(value) <- spec.get("readonly")) {
            if (!value.asBool().getValue()) { throw Exception("database-write-requires-review") }
        } else { throw Exception("invalid-input:database-readonly") }
        let connectMs = databaseInt(spec, "connectTimeoutMs")
        let statementMs = databaseInt(spec, "statementTimeoutMs")
        if (connectMs <= 0 || connectMs > 60000 || statementMs <= 0 || statementMs > 300000) {
            throw Exception("invalid-input:database-timeout")
        }
    }

    func connect(params: JsonObject): String {
        if (params.size() != 3 || databaseString(params, "projectId") != projectId) {
            throw Exception("not-authorized:database-project")
        }
        if (state == "unknown") { return databaseFailure("connection-unknown") }
        if (connection.size > 0) { return databaseFailure("connection-in-use") }
        let spec = params.get("spec").getOrThrow().asObject()
        // 拒绝 password、URL、额外驱动选项等所有非白名单字段；readonly 缺省为 true。
        if (spec.get("readonly").isNone()) { spec.put("readonly", JsonBool(true)) }
        checkSpec(spec)
        if (driver.isNone()) { return databaseFailure("driver-load") }
        let backend = driver.getOrThrow()
        if (!backend.credentialAllowed(spec)) { return databaseFailure("credential-target-denied") }
        let secret = credentials.resolve(databaseString(spec, "credentialRef"))
        if (secret.isNone()) { return databaseFailure("auth") }
        let deadline = MonoTime.now() + databaseInt(spec, "connectTimeoutMs") * Duration.millisecond
        state = "connecting"
        try {
            let handle = backend.connect(spec, secret.getOrThrow().value, token, deadline)
            if (handle.size == 0) { state = "disconnected"; return databaseFailure("server-refused") }
            // 先拥有句柄再检查迟到，清理失败保留 unknown，不遗失可能活着的连接。
            connection = handle
            serial += 1
            connectionId = "${instanceId}:db:${serial}"
            engine = databaseString(spec, "engine")
            connectionTimeout = databaseInt(spec, "statementTimeoutMs")
            if (token.cancelled() || MonoTime.now() >= deadline) {
                state = "unknown"
                disconnectCurrent()
                return databaseFailure(if (token.cancelled()) { "cancelled" } else { "timeout" })
            }
            state = "connected"
            return "{\"ok\":true,\"connectionId\":\"${jsonEscapeText(connectionId)}\",\"readonly\":true}"
        } catch (_: Exception) { state = "unknown"; return databaseFailure("connection-unknown") }
    }

    func closeCurrentCursor(): Bool {
        if (cursor.size == 0) { cursorId = ""; return true }
        try {
            if (!driver.getOrThrow().closeCursor(connection, cursor)) { state = "unknown"; return false }
            cursor = ""
            cursorId = ""
            return true
        } catch (_: Exception) { state = "unknown"; return false }
    }

    // 可信 IPC 装配方可映射面板释放动作；关闭也必须核验会话、连接与游标归属。
    public func closeCursor(ownerSessionId: String, ownerConnectionId: String, id: String): String {
        mtx.lock()
        var result = ""
        try {
            if (ownerSessionId != sessionId || ownerConnectionId != connectionId ||
                id.size == 0 || id != cursorId) {
                throw Exception("not-authorized:database-cursor")
            }
            result = if (closeCurrentCursor()) { "{\"ok\":true}" } else { databaseFailure("cursor-close-unknown") }
        } finally { mtx.unlock() }
        return result
    }

    func disconnectCurrent(): String {
        if (connection.size == 0) {
            if (state == "unknown") { return databaseFailure("disconnect-unknown") }
            state = "disconnected"; return "{\"ok\":true}"
        }
        state = "disconnecting"
        try {
            // disconnect 的驱动契约包含释放该连接全部 cursor，不因 cursorClose 失败跳过安全断连。
            if (!driver.getOrThrow().disconnect(connection)) {
                state = "unknown"; return databaseFailure("disconnect-unknown")
            }
            connection = ""; connectionId = ""; engine = ""; cursor = ""; cursorId = ""
            state = "disconnected"
            return "{\"ok\":true}"
        } catch (_: Exception) { state = "unknown"; return databaseFailure("disconnect-unknown") }
    }

    func pageJson(page: DatabaseRpcPage, deadline: MonoTime): String {
        cursor = page.cursor
        if (cursor.size == 0) { cursorId = "" }
        if (token.cancelled() || MonoTime.now() >= deadline) {
            if (!closeCurrentCursor()) { return databaseFailure("cursor-close-unknown") }
            return databaseFailure(if (token.cancelled()) { "cancelled" } else { "timeout" })
        }
        let count = page.rows.size()
        let size = Int64(page.rows.toString().toArray().size + page.columns.toString().toArray().size)
        if (count > 100 || (count < 100 && cursor.size > 0 && !page.truncated) ||
            count > rowLimit - rowsRead || size > byteLimit - bytesRead) {
            closeCurrentCursor()
            state = "unknown"
            return databaseFailure("driver-limit-violation")
        }
        for (column in page.columns.getItems()) {
            let item = column.asObject()
            databaseString(item, "name"); databaseString(item, "type")
        }
        rowsRead += count
        bytesRead += size
        var truncated = page.truncated
        if (rowsRead >= rowLimit || bytesRead >= byteLimit || page.truncated) {
            if (cursor.size > 0) {
                truncated = truncated || rowsRead >= rowLimit || bytesRead >= byteLimit
                if (!closeCurrentCursor()) { state = "unknown"; return databaseFailure("cursor-close-unknown") }
            }
        }
        if (cursor.size > 0 && cursorId.size == 0) {
            serial += 1
            cursorId = "${instanceId}:cursor:${serial}"
        }
        let out = JsonObject()
        out.put("columns", page.columns); out.put("rows", page.rows)
        out.put("truncated", JsonBool(truncated))
        out.put("elapsedMs", JsonInt((MonoTime.now() - queryStarted).toMilliseconds()))
        if (cursor.size > 0) { out.put("cursorId", JsonString(cursorId)) }
        return out.toString()
    }

    func query(params: JsonObject): String {
        if (connection.size == 0 || databaseString(params, "connectionId") != connectionId || state != "connected") {
            throw Exception("not-authorized:database-connection")
        }
        if (let Some(value) <- params.get("cursor")) {
            if (params.size() != 4 || value.asString().getValue() != cursorId || cursor.size == 0) {
                throw Exception("not-authorized:database-cursor")
            }
            if (databaseInt(params, "offset") != rowsRead) { throw Exception("invalid-input:database-offset") }
            let deadline = queryStarted + queryTimeout * Duration.millisecond
            if (MonoTime.now() >= deadline) {
                if (!closeCurrentCursor()) { return databaseFailure("cursor-close-unknown") }
                return databaseFailure("timeout")
            }
            state = "querying"
            let result = pageJson(driver.getOrThrow().fetch(connection, cursor, rowLimit - rowsRead,
                byteLimit - bytesRead, token, deadline), deadline)
            if (state == "querying") { state = "connected" }
            return result
        }
        if (params.size() != 5) { throw Exception("invalid-input:database-query") }
        let opts = params.get("opts").getOrThrow().asObject()
        if (opts.get("readonly").isNone()) { opts.put("readonly", JsonBool(true)) }
        if (opts.size() != 5) { throw Exception("invalid-input:database-options") }
        if (!opts.get("readonly").getOrThrow().asBool().getValue()) {
            // execution/review-apply 尚无数据库执行适配，不消费一张票便直接执行写 SQL。
            return databaseFailure("approval-required")
        }
        let maxRows = databaseInt(opts, "maxRows")
        let maxBytes = databaseInt(opts, "maxBytes")
        let timeout = databaseInt(opts, "statementTimeoutMs")
        if (maxRows <= 0 || maxRows > 10000 || maxBytes < 1024 || maxBytes > 4194304 ||
            timeout <= 0 || timeout > connectionTimeout || databaseInt(opts, "cursorBatch") != 100) {
            throw Exception("invalid-input:database-limits")
        }
        let sql = databaseString(params, "sql")
        let parameters = params.get("params").getOrThrow().asArray()
        if (sql.size == 0 || sql.toArray().size > 65536 || parameters.toString().toArray().size > 1048576) {
            throw Exception("invalid-input:database-sql")
        }
        if (!closeCurrentCursor()) { state = "unknown"; return databaseFailure("cursor-close-unknown") }
        rowLimit = maxRows; byteLimit = maxBytes; rowsRead = 0; bytesRead = 0
        queryTimeout = timeout; queryStarted = MonoTime.now()
        let deadline = queryStarted + timeout * Duration.millisecond
        state = "querying"
        let result = pageJson(driver.getOrThrow().query(connection, sql, parameters, maxRows, maxBytes,
            token, deadline), deadline)
        if (state == "querying") { state = "connected" }
        return result
    }

    public func describe(): String {
        mtx.lock()
        var out = ""
        try {
            out = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"projectId\":\"${jsonEscapeText(projectId)}\"," +
                "\"state\":\"${state}\",\"connectionId\":\"${jsonEscapeText(connectionId)}\"," +
                "\"engine\":\"${engine}\",\"readonly\":true,\"pageSize\":100,\"driverAvailable\":${driver.isSome()}}"
        } finally { mtx.unlock() }
        return out
    }

    // 返回结果 JSON，由调度方封装帧；所有请求均需补 sessionId，不能信任前端裸句柄。
    // query 首次使用 {sessionId,connectionId,sql,params,opts}；翻页使用 {sessionId,connectionId,cursor,offset}。
    // 前端 cursorFetch/close 后续由 IPC owner 映射；本文件只定义本轮要求的四个 RPC。
    public func request(method: String, body: String): String {
        if (!isDatabaseMethod(method)) { throw Exception("method-not-found") }
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (databaseString(params, "sessionId") != sessionId) {
            throw Exception("not-authorized:database-session")
        }
        mtx.lock()
        var result = ""
        try {
            if (method == "database/describe") {
                if (params.size() != 1) { throw Exception("invalid-input:database-describe") }
                result = describe()
            } else if (method == "database/disconnect") {
                if (params.size() != 2 || databaseString(params, "connectionId") != connectionId) {
                    throw Exception("not-authorized:database-connection")
                }
                result = disconnectCurrent()
            } else if (token.cancelled()) {
                result = databaseFailure("cancelled")
            } else if (method == "database/connect") {
                result = connect(params)
            } else {
                try { result = query(params) }
                catch (_: Exception) {
                    // 不回显驱动错误、SQL、连接串或口令；不把传输异常当确定的 SQL 失败。
                    if (state == "querying") { state = "unknown" }
                    result = databaseFailure(if (state == "unknown") { "query-unknown" } else { "bad-spec" })
                }
            }
        } finally { mtx.unlock() }
        return result
    }
}
