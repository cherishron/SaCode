package host
import core.*
import stdx.encoding.json.*
import stdx.encoding.base64.*
import std.collection.ArrayList
import std.collection.HashMap
import std.env.*
import std.fs.*
import std.sync.*

// 帧：NDJSON，一行一条 JSON-RPC 2.0 报文（读侧用 readln，写侧补 LF）。
// stdout 只走协议帧，诊断走 stderr。只用已证实的 API：String.split / toArray() /
// Array.size / String.fromUtf8 / ArrayList，不用 String.find 与切片。
//
// turn 线程也要发帧（模型侧审批通知）：stdout 的写必须互斥，否则主循环的
// 应答帧与通知帧会交错成半行，把协议撕开。锁只圈「一行写完整」。
let emitMtx = Mutex()

func emit(body: String) {
    emitMtx.lock()
    try {
        getStdOut().write((body + String.fromUtf8(Array<Byte>(1, { _ => 10 }))).toArray())
    } finally {
        emitMtx.unlock()
    }
}

// 通知帧（无 id）：宿主主动推给调用方的事件，不应答、不占请求号。
// 模型侧发起的一次性审批工单走这条——读侧（桌面/测试桥）按无 id 分拣。
func notifyFrame(method: String, params: String): String {
    return "{\"jsonrpc\":\"2.0\",\"method\":\"${method}\",\"params\":${params}}"
}

func errFrame(id: String, code: Int64, message: String): String {
    // message 是外部可见文本（工具失败里带着调用方给的路径），不转义就会让
    // 一条含引号或换行的消息自己把协议帧撕开。
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${jsonEscapeText(message)}\"}}"
}

func okFrame(id: String, result: String): String {
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"result\":${result}}"
}

// 带 data 的错误帧：LSP 的失败必须带着「为什么失败 + 非语义回退线索」回来，
// 只有一句 message 的话，界面与模型都答不出这是没插件还是插件不支持。
func errFrameData(id: String, code: Int64, message: String, data: String): String {
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${jsonEscapeText(message)}\",\"data\":${data}}}"
}

func bytesOf(s: String): Array<Byte> {
    return s.toArray()
}

func fromBytes(bs: ArrayList<Byte>): String {
    return String.fromUtf8(bs.toArray())
}

// 取 "key":"value" 的 value；value 不允许含转义引号（本端生成的报文满足此约束）。
func jsonStr(body: String, key: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":\"")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return ""
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            let out = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                let c = hay[j]
                if (c == 34) {
                    return fromBytes(out)
                }
                // 入口就要还原 JSON 转义：否则 "a\"b" 会在 \" 处被当成结束引号而截断，
                // 聊天消息里的引号与换行都会被写坏（多行消息还会把日志一行事件劈成两行）。
                if (c == 92 && j + 1 < hlen) {
                    let e = hay[j + 1]
                    if (e == 34) {
                        out.add(34)
                        j += 2
                        continue
                    } else if (e == 92) {
                        out.add(92)
                        j += 2
                        continue
                    } else if (e == 110) {
                        out.add(10)
                        j += 2
                        continue
                    } else if (e == 114) {
                        out.add(13)
                        j += 2
                        continue
                    } else if (e == 116) {
                        out.add(9)
                        j += 2
                        continue
                    }
                    // \uXXXX 这类不支持的转义原样保留反斜杠，不做「猜一个字符」的降级
                    out.add(c)
                    j += 1
                    continue
                }
                out.add(c)
                j += 1
            }
            return fromBytes(out)
        }
        i += 1
    }
    return ""
}

// 取 "id":<整数> 的 id；找不到或为 null 时返回 "null"。
// 附件帧的入参走完整 JSON 解析而不是手扫：显示名里可能带转义引号，
// 而 base64 载荷长度不受限，手扫的「value 不含引号」前提在这两条上都不成立。
func attHasReceipts(body: String): Bool {
    let hay = bytesOf(body)
    let pat = bytesOf("\"receiptIds\"")
    var i: Int64 = 0
    while (i + pat.size <= hay.size) {
        var same = true
        var k: Int64 = 0
        while (k < pat.size) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            return true
        }
        i += 1
    }
    return false
}

func attStr(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        return v.asString().getValue()
    }
    return ""
}

func attList(obj: JsonObject, key: String): ArrayList<String> {
    let out = ArrayList<String>()
    if (let Some(v) <- obj.get(key)) {
        let arr = v.asArray()
        var i: Int64 = 0
        while (true) {
            if (let Some(item) <- arr.get(i)) {
                out.add(item.asString().getValue())
                i += 1
            } else {
                break
            }
        }
    }
    return out
}

func jsonId(body: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"id\":")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return "null"
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            let num = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                let b = hay[j]
                let n = Int64(b)
                if (n >= 48 && n <= 57) {
                    num.add(b)
                } else {
                    break
                }
                j += 1
            }
            if (num.size == 0) {
                return "null"
            }
            return fromBytes(num)
        }
        i += 1
    }
    return "null"
}

// 取 "key":<整数>，用于 cursor/limit 等数值参数。
func jsonNum(body: String, key: String): Int64 {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return -1
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            var v: Int64 = 0
            var j = i + plen
            var seen = false
            while (j < hlen) {
                let n = Int64(hay[j])
                if (n >= 48 && n <= 57) {
                    v = v * 10 + (n - 48)
                    seen = true
                } else {
                    break
                }
                j += 1
            }
            if (!seen) {
                return -1
            }
            return v
        }
        i += 1
    }
    return -1
}

// 把请求原样转给 JS 子进程，并把子进程的真实应答嵌进 forwarded 字段：
// 桌面看到的能力表与工具结果只可能来自子进程，本端一律不替它编。
// 未 spawn 与「发了但没回」是两种失败，必须分开报，不能都糊成空表。
func forward(idText: String, spawned: Bool, frame: Option<String>) {
    if (!spawned) {
        emit(errFrame(idText, -32011, "js-host-not-spawned"))
        return
    }
    if (let Some(f) <- frame) {
        emit(okFrame(idText, "{\"forwarded\":${f}}"))
    } else {
        emit(errFrame(idText, -32013, "js-host-no-reply"))
    }
}

// turn 在途期间仍放行的方法：结算与读侧，外加工具调用的发起/收帧/取消。
// 少了后三类，桌面的 stop 就只能排在一次转调后面，取消永远追不上在途调用。
func allowedDuringTurn(method: String): Bool {
    let turnSide = method == "turn/poll" || method == "turn/cancel" || method == "initialize"
    let readSide = method == "session/projection" || method == "session/subscribe" || method == "appearance/get" || method == "session/catalog" || method == "workspace/get" || method == "attachment/image-read" || method == "worktree/describe" || isTipsMethod(method)
    let callSide = method == "extension/host/call" || method == "extension/host/poll" || method == "extension/host/cancel"
    // 审批是人在环：流式进行中也要能发号、应答、查状态，否则「边跑边批」做不到。
    // 不再有 approval/tick——过期改由真实单调钟决定，协议面上不该存在「推进时钟」这种动作。
    let approvalSide = method == "approval/ask" || method == "approval/answer" || method == "approval/status"
    // 计量读数与「收紧预算」都归读侧：预算只允许往下调，所以在途期间调它
    // 不会放宽任何放行条件，反而能让正在跑的这一轮更早被拦。
    let meterSide = method == "usage/status" || method == "usage/set-budget"
    // 运行中排队与改队列正是在途期间要做的事，拦掉等于这个面板没法用
    // 增强与轮次各走各的车道：turn 在跑时也要能润色下一条草稿，
    // 反过来增强在途时桌面的取消必须答得上来——否则「支持取消」只是一句空话。
    let enhanceSide = method == "prompt/enhance" || method == "prompt/poll" || method == "prompt/cancel"
    return turnSide || readSide || callSide || approvalSide || meterSide || enhanceSide || isQueueMethod(method) || method == "goal/describe" || isGoalControlMethod(method) || ExecutionApi.readOnly(method) || method == "execution/stop"
}

// 队列读写都是「按动作命名」的有限方法：界面说不出任意一条路径，也拿不到通用转发。
func isQueueMethod(method: String): Bool {
    return method == "queue/describe" || method == "queue/enqueue" || method == "queue/update"
}

// LSP 协议面同样只有 7 条固定 method。分派条件写成字面量链（与 isQueueMethod 同形）：
// 本仓的门禁是按 `method == "字面量"` 取分派集的，拼出来的方法名它收不到，
// 而「分派了却没声明 / 声明了却没分派」正是这张协议面最不能出的漂移。
// verb 名仍由核心契约那张表映射回来，宿主不另抄一份 verb→handler 表。
func isLspMethod(method: String): Bool {
    return method == "lsp/define" || method == "lsp/lookup" || method == "lsp/references" ||
        method == "lsp/implementation" || method == "lsp/call-hierarchy" ||
        method == "lsp/diagnostics" || method == "lsp/rename"
}

func lspVerbOfMethod(name: String): String {
    for (verb in lspVerbNames()) {
        if (name == lspMethodName(verb)) { return verb }
    }
    return ""
}

// params 整段的 JSON 文本：交给核心的 lspParseParams 逐字段校验。
// 宿主不自己数键——键集是 verb 的函数，写死在这里就等于协议面比声明面宽。
func paramsTextOf(body: String): String {
    try {
        let request = JsonValue.fromStr(body).asObject()
        if (let Some(p) <- request.get("params")) { return p.asObject().toString() }
    } catch (_: Exception) {}
    return ""
}

// 条目与附件均来自核心日志投影；只交引用元数据，不交本地路径或上传字节。
func inboxListJson(inbox: AgentInbox, target: String): String {
    let list = JsonArray()
    for (message in inbox.snapshot(target)) {
        let item = JsonObject()
        item.put("id", JsonString(message.id))
        item.put("text", JsonString(message.text))
        item.put("rpcId", JsonString(message.rpcId))
        let refs = JsonArray()
        for (ref in message.attachments) { refs.add(ref.toJsonObject()) }
        item.put("attachments", refs)
        list.add(item)
    }
    return list.toString()
}

// 所有写入口加载会话时同时恢复计量，不能因租约先被审批或工具取得而绕过预算。
func loadForWrite(log: SessionLog, meter: TokenMeter): Bool {
    if (!log.load()) {
        return false
    }
    meter.rebuild()
    return true
}

// 日志里有没有系统提示：只认 system/message 事件本身，不猜、不留第二真源。
// 有就复用盘上那条（同一会话后续轮次），没有才补——补多条只会让请求里
// 堆一串重复的 system 消息。
func hasSystemMessage(log: SessionLog): Bool {
    for (ev in log.snapshotEvents()) {
        if (ev.eventType == "system/message") { return true }
    }
    return false
}

func boolText(value: Bool): String {
    if (value) { return "true" }
    return "false"
}

// 引用→值：CredentialStore 自己就分层（活环境压过用户文件层），所以这里每次现取。
// 不在宿主里留缓存——上游的机制是「旋转后的下一次请求就用新值」，缓存会把它变成谎言。
func resolveCredentialKey(reference: String): String {
    if (reference.size == 0) {
        return ""
    }
    try {
        if (let Some(v) <- CredentialStore.forUser().resolve(reference)) {
            return v.value
        }
    } catch (e: Exception) {
        return ""
    }
    return ""
}

// 描述面按引用现查凭据层：页面上那颗「钥匙配了没有」的点只能来自核心事实，
// 不能由渲染层自己记一份——否则换个入口配的密钥在这里就是假的。
func providerObjectJson(p: ProviderRecord, creds: CredentialStore): String {
    var models = "["
    for (i in 0..p.models.size) {
        if (i > 0) { models += "," }
        models += p.models[i].toJson()
    }
    models += "]"
    var configured = false
    var writable = true
    try {
        let info = creds.describe(p.credentialRef)
        configured = info.configured
        writable = info.writable
    } catch (_: Exception) {
        configured = false
        writable = true
    }
    return "{\"id\":\"${jsonEscapeText(p.id)}\",\"name\":\"${jsonEscapeText(p.name)}\",\"baseUrl\":\"${jsonEscapeText(p.baseUrl)}\",\"protocol\":\"${jsonEscapeText(p.protocol)}\",\"credentialRef\":\"${jsonEscapeText(p.credentialRef)}\",\"declared\":${boolText(p.declared)},\"models\":${models},\"keyConfigured\":${boolText(configured)},\"credentialWritable\":${boolText(writable)},\"sortOrder\":${p.sortOrder},\"enabled\":${boolText(p.enabled)},\"transport\":\"${jsonEscapeText(p.transport)}\"}"
}

func providerViewJson(view: ProviderView, creds: CredentialStore): String {
    var arr = "["
    for (i in 0..view.providers.size) {
        if (i > 0) { arr += "," }
        arr += providerObjectJson(view.providers[i], creds)
    }
    arr += "]"
    return "{\"providers\":${arr},\"revision\":${view.revision},\"writable\":${boolText(view.writable)},\"defaultProviderId\":\"${jsonEscapeText(view.defaultProviderId)}\",\"defaultModel\":\"${jsonEscapeText(view.defaultModel)}\"}"
}

// 插件清单序列化只用核心 PluginInventory.asJson()：哪些字段可为 null 由清单视图定义决定，
// 宿主自己拼第二份字段规则迟早对不上（此前手写版就丢了 error 字段的闭合引号）。

// 协议面不接受「没点名修订号」的写：缺失就拒，而不是静默当成无条件写。
// 核心侧的 -1 = 无条件写是给 CLI 自测与测试用的，不能变成协议面的默认——
// 「没给版本」和「不在乎版本」是两件事。
func revisionOrReject(body: String, idText: String): Option<Int64> {
    let request = JsonValue.fromStr(body).asObject()
    if (let Some(p) <- request.get("params")) {
        if (let Some(r) <- p.asObject().get("expectedRevision")) {
            return Some(r.asInt().getValue())
        }
    }
    emit(errFrame(idText, -32020, "missing-revision"))
    return None
}

// 取 params 下的子对象并序列化成文本，喂给核心的字符串入口。
// 宿主不手写 JSON 拼接：键序由 stdx 决定，核心按 key 取值与顺序无关。
func draftTextOf(body: String, key: String): String {
    let request = JsonValue.fromStr(body).asObject()
    if (let Some(p) <- request.get("params")) {
        if (let Some(d) <- p.asObject().get(key)) {
            return d.toString()
        }
    }
    return ""
}

// 取 params 下的字符串数组（如 custom/import/* 的 items）
func stringArrayFrom(body: String, key: String): Array<String> {
    let out = ArrayList<String>()
    let request = JsonValue.fromStr(body).asObject()
    if (let Some(p) <- request.get("params")) {
        if (let Some(a) <- p.asObject().get(key)) {
            let arr = a.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                out.add(item.asString().getValue())
            }
        }
    }
    return out.toArray()
}

// 提供商与凭证的配置面：桌面模型页的每个动作都必须落到仓颉核心，渲染层不留第二份状态。
// 失败原样带码回传——settings-conflict 与 settings-rejected 对用户是两句话，
// 合并成「保存失败」就丢掉了「别人先改过，请重新加载」这条唯一可执行的信息。
func providerSurfaceRequest(method: String, body: String, idText: String): Unit {
    let registry = ProviderRegistry.forUser()
    let creds = CredentialStore.forUser()
    try {
        if (method == "model/registry/describe" || method == "model/registry/update" || method == "model/registry/remove" || method == "model/registry/set-default" || method == "model/registry/add-catalog" || method == "model/registry/sort" || method == "model/registry/set-enabled") {
            if (method == "model/registry/update") {
                let request = JsonValue.fromStr(body).asObject()
                var draft: Option<JsonObject> = None
                if (let Some(p) <- request.get("params")) {
                    if (let Some(d) <- p.asObject().get("draft")) {
                        draft = Some(d.asObject())
                    }
                }
                if (draft.isNone()) {
                    emit(errFrame(idText, -32020, "settings-rejected"))
                    return
                }
                registry.updateObject(draft.getOrThrow(), jsonNum(body, "expectedRevision"))
            } else if (method == "model/registry/remove") {
                registry.remove(jsonStr(body, "id"), jsonNum(body, "expectedRevision"))
            } else if (method == "model/registry/set-default") {
                registry.setDefault(jsonStr(body, "providerId"), jsonStr(body, "model"), jsonNum(body, "expectedRevision"))
            } else if (method == "model/registry/add-catalog") {
                registry.addFromCatalog(jsonStr(body, "id"), jsonStr(body, "credentialRef"))
            } else if (method == "model/registry/sort") {
                // 拖动排序只改一列：核心 setSortOrder 不重写整条记录，别处刚改过的 baseUrl 不会被盖回去。
                registry.setSortOrder(jsonStr(body, "providerId"), jsonNum(body, "sortOrder"), jsonNum(body, "expectedRevision"))
            } else if (method == "model/registry/set-enabled") {
                // 启停同样走单列写：内置（declared）供应商拒绝整条 update，但不拒绝关断。
                registry.setEnabled(jsonStr(body, "providerId"), jsonStr(body, "enabled") == "true", jsonNum(body, "expectedRevision"))
            }
            emit(okFrame(idText, providerViewJson(registry.describe(), creds)))
            return
        }
        if (method == "model/registry/catalog") {
            emit(okFrame(idText, registry.catalogJson()))
            return
        }
        if (method == "credential/describe" || method == "credential/set" || method == "credential/unset") {
            let reference = jsonStr(body, "ref")
            if (method == "credential/set") {
                creds.set(reference, jsonStr(body, "value"))
            } else if (method == "credential/unset") {
                creds.unset(reference)
            }
            let after = creds.describe(reference)
            emit(okFrame(idText, "{\"ref\":\"${jsonEscapeText(reference)}\",\"configured\":${boolText(after.configured)},\"source\":\"${jsonEscapeText(after.source)}\",\"writable\":${boolText(after.writable)},\"summary\":\"${jsonEscapeText(after.safeSummary())}\"}"))
            return
        }
        if (method == "model/list") {
            // 「测试连接」与「拉取模型清单」是同一次动作：真的发一个 GET /models，只回报事实。
            let record = ProviderRegistry.forUser().describe().providers
            var baseUrl = ""
            var reference = ""
            var secret = ""
            let wanted = jsonStr(body, "providerId")
            for (p in record) {
                if (wanted.size == 0 || p.id == wanted) {
                    baseUrl = p.baseUrl
                    reference = p.credentialRef
                }
            }
            if (baseUrl.size == 0) {
                // 「获取可用模型」发生在保存之前：草稿里的地址与刚敲进的密钥直接去问远端。
                // 内联明文只活在这一次调用里——不进注册表、不进会话日志、不进回执。
                let inlineUrl = jsonStr(body, "baseUrl")
                if (inlineUrl.size == 0) {
                    emit(errFrame(idText, -32020, "provider-not-found"))
                    return
                }
                baseUrl = inlineUrl
                let inlineKey = jsonStr(body, "apiKey")
                secret = if (inlineKey.size > 0) { inlineKey } else { resolveCredentialKey(jsonStr(body, "credentialRef")) }
            } else {
                secret = resolveCredentialKey(reference)
            }
            let ids = ModelCatalog().fetch(baseUrl, secret)
            var arr = "["
            for (i in 0..ids.size) {
                if (i > 0) { arr += "," }
                arr += "\"${jsonEscapeText(ids[i])}\""
            }
            arr += "]"
            emit(okFrame(idText, "{\"models\":${arr},\"summary\":\"${jsonEscapeText(ModelCatalog.summary(secret, ids))}\"}"))
            return
        }
        // —— 第 3 层自定义模型与发现/导入（模型目录动词组）——
        if (method == "custom/describe") {
            emit(okFrame(idText, CustomModelRegistry.forUser().describe().asJson()))
            return
        }
        if (method == "custom/upsert") {
            let request = JsonValue.fromStr(body).asObject()
            var draft: Option<JsonObject> = None
            if (let Some(p) <- request.get("params")) {
                if (let Some(d) <- p.asObject().get("draft")) {
                    draft = Some(d.asObject())
                }
            }
            if (draft.isNone()) {
                emit(errFrame(idText, -32020, "settings-rejected"))
                return
            }
            if (let Some(rev) <- revisionOrReject(body, idText)) {
                CustomModelRegistry.forUser().upsertObject(draft.getOrThrow(), rev)
                emit(okFrame(idText, CustomModelRegistry.forUser().describe().asJson()))
            }
            return
        }
        if (method == "custom/remove" || method == "binding/remove") {
            if (let Some(rev) <- revisionOrReject(body, idText)) {
                if (method == "custom/remove") {
                    CustomModelRegistry.forUser().remove(jsonStr(body, "customId"), rev)
                    emit(okFrame(idText, CustomModelRegistry.forUser().describe().asJson()))
                } else {
                    CustomModelRegistry.forUser().removeBinding(
                        jsonStr(body, "customId"), jsonStr(body, "providerId"), jsonStr(body, "modelId"), rev)
                    emit(okFrame(idText, CustomModelRegistry.forUser().describe().asJson()))
                }
            }
            return
        }
        if (method == "binding/upsert" || method == "binding/reorder") {
            if (let Some(rev) <- revisionOrReject(body, idText)) {
                let customs = CustomModelRegistry.forUser()
                if (method == "binding/upsert") {
                    customs.upsertBinding(jsonStr(body, "customId"), draftTextOf(body, "binding"),
                        registry.describe(), rev)
                } else {
                    customs.reorderBindings(jsonStr(body, "customId"), stringArrayFrom(body, "keys"), rev)
                }
                emit(okFrame(idText, customs.describe().asJson()))
            }
            return
        }
        if (method == "custom/import/new" || method == "custom/import/into") {
            if (let Some(rev) <- revisionOrReject(body, idText)) {
                let customs = CustomModelRegistry.forUser()
                if (method == "custom/import/new") {
                    let created = customs.importNewModels(stringArrayFrom(body, "items"), registry.describe(), rev)
                    var arr = "["
                    for (i in 0..created.size) {
                        if (i > 0) { arr += "," }
                        arr += "\"${jsonEscapeText(created[i])}\""
                    }
                    arr += "]"
                    emit(okFrame(idText, "{\"created\":${arr},\"view\":${customs.describe().asJson()}}"))
                } else {
                    let added = customs.importInto(jsonStr(body, "customId"), stringArrayFrom(body, "items"),
                        registry.describe(), rev)
                    emit(okFrame(idText, "{\"added\":${added}}"))
                }
            }
            return
        }
        if (method == "model/pull") {
            // 拉取与「测试连接」同源：真的发一次 GET /models。坏响应不 catch——
            // 必须由外层抛出去变成帧错误，绝不能报「0 个模型」。
            if (let Some(rev) <- revisionOrReject(body, idText)) {
                let wanted = jsonStr(body, "providerId")
                var baseUrl = ""
                var reference = ""
                for (p in registry.describe().providers) {
                    if (p.id == wanted) {
                        baseUrl = p.baseUrl
                        reference = p.credentialRef
                    }
                }
                if (baseUrl.size == 0) {
                    emit(errFrame(idText, -32020, "provider-not-found"))
                    return
                }
                let ids = ModelCatalog().fetch(baseUrl, resolveCredentialKey(reference))
                registry.applyPulledModels(wanted, ids, rev)
                emit(okFrame(idText, providerViewJson(registry.describe(), creds)))
            }
            return
        }
        if (method == "model/upstream/upsert") {
            if (let Some(rev) <- revisionOrReject(body, idText)) {
                registry.addUpstreamModel(jsonStr(body, "providerId"), jsonStr(body, "modelId"), rev)
                emit(okFrame(idText, providerViewJson(registry.describe(), creds)))
            }
            return
        }
    } catch (e: Exception) {
        emit(errFrame(idText, -32020, e.message))
        return
    }
    emit(errFrame(idText, -32601, "method-not-found"))
}

// 全局外观有独立租约，不依赖当前会话的写入状态；只接收已命名的字段。
func globalAppearanceRequest(method: String, body: String, idText: String): Unit {
    var theme = ""
    var size: Int64 = -1
    var busySend = ""
    try {
        let request = JsonValue.fromStr(body).asObject()
        if (let Some(value) <- request.get("method")) {
            if (value.asString().getValue() != method) { throw Exception("bad-global-request") }
        } else { throw Exception("bad-global-request") }
        if (method != "global/appearance/get") {
            if (let Some(value) <- request.get("params")) {
                let params = value.asObject()
                if (method == "global/appearance/set-theme") {
                    if (let Some(field) <- params.get("theme")) { theme = field.asString().getValue() }
                    if (!SessionAppearance.validTheme(theme)) { throw Exception("bad-theme") }
                } else if (method == "global/appearance/set-busy-send") {
                    if (let Some(field) <- params.get("busySend")) { busySend = field.asString().getValue() }
                    if (!GlobalAppearanceSettings.validBusySend(busySend)) { throw Exception("bad-busy-send") }
                } else {
                    if (let Some(field) <- params.get("fontSize")) { size = field.asInt().getValue() }
                    if (!GlobalAppearanceSettings.validFontSize(size)) { throw Exception("bad-font-size") }
                }
            } else { throw Exception("bad-global-request") }
        }
    } catch (e: Exception) {
        let message = if (method == "global/appearance/set-font-size") { "bad-font-size" } else { "bad-global-appearance-params" }
        emit(errFrame(idText, -32602, message))
        return
    }
    try {
        let settings = GlobalAppearanceSettings.forUser()
        var changed = false
        if (method == "global/appearance/set-theme") { changed = settings.setTheme(theme) }
        if (method == "global/appearance/set-font-size") { changed = settings.setFontSize(size) }
        if (method == "global/appearance/set-busy-send") { changed = settings.setBusySend(busySend) }
        let snapshot = settings.read()
        let writeResult = if (method == "global/appearance/get") { "" } else {
            let flag = if (changed) { "true" } else { "false" }
            ",\"saved\":true,\"changed\":${flag}"
        }
        emit(okFrame(idText, "{\"theme\":\"${snapshot.theme}\",\"fontSize\":${snapshot.fontSize},\"busySend\":\"${snapshot.busySend}\",\"scope\":\"user\"${writeResult}}"))
    } catch (e: Exception) {
        let code: Int64 = if (e.message == "settings-already-owned") { -32001 } else { -32003 }
        emit(errFrame(idText, code, e.message))
    }
}

// 通用设置：transcriptView / composerEnter / sessionLog 持久化到 user settings 目录的文本文件。
func globalSettingsRequest(method: String, body: String, idText: String): Unit {
    var transcriptView = "default"
    var composerEnter = "send"
    var sessionLog = "off"
    try {
        let request = JsonValue.fromStr(body).asObject()
        if (let Some(value) <- request.get("method")) {
            if (value.asString().getValue() != method) { throw Exception("bad-settings-request") }
        } else { throw Exception("bad-settings-request") }
        if (method != "global/settings/get") {
            if (let Some(value) <- request.get("params")) {
                let params = value.asObject()
                if (method == "global/settings/set-transcript-view") {
                    if (let Some(field) <- params.get("transcriptView")) { transcriptView = field.asString().getValue() }
                    if (transcriptView != "default" && transcriptView != "compact" && transcriptView != "expanded") { throw Exception("bad-transcript-view") }
                } else if (method == "global/settings/set-composer-enter") {
                    if (let Some(field) <- params.get("composerEnter")) { composerEnter = field.asString().getValue() }
                    if (composerEnter != "send" && composerEnter != "newline") { throw Exception("bad-composer-enter") }
                } else if (method == "global/settings/set-session-log") {
                    if (let Some(field) <- params.get("sessionLog")) { sessionLog = field.asString().getValue() }
                    if (sessionLog != "on" && sessionLog != "off") { throw Exception("bad-session-log") }
                }
            } else { throw Exception("bad-settings-request") }
        }
    } catch (e: Exception) {
        emit(errFrame(idText, -32602, e.message))
        return
    }
    // 读现有设置（文本格式：key=value 每行一条）
    // 首次启动文件尚不存在，只规范化已存在的父目录。
    let path = Path("${canonicalize(".")}/general-settings.txt")
    var tv = "default"
    var ce = "send"
    var sl = "off"
    if (exists(path.toString())) {
        let content = String.fromUtf8(File.readFrom(path.toString()))
        let lines = content.split("\n")
        var i = 0
        while (i < lines.size) {
            let line = lines[i]
            if (line.contains("transcriptView=")) { tv = line.split("transcriptView=")[1] }
            else if (line.contains("composerEnter=")) { ce = line.split("composerEnter=")[1] }
            else if (line.contains("sessionLog=")) { sl = line.split("sessionLog=")[1] }
            i += 1
        }
    }
    var changed = false
    if (method == "global/settings/set-transcript-view") {
        if (tv != transcriptView) { tv = transcriptView; changed = true }
    } else if (method == "global/settings/set-composer-enter") {
        if (ce != composerEnter) { ce = composerEnter; changed = true }
    } else if (method == "global/settings/set-session-log") {
        if (sl != sessionLog) { sl = sessionLog; changed = true }
    }
    // 写回文件
    if (changed) {
        let parent = path.parent
        if (!exists(parent.toString())) { Directory.create(parent.toString(), recursive: true) }
        let data = "transcriptView=${tv}\ncomposerEnter=${ce}\nsessionLog=${sl}\n"
        File.writeTo(path.toString(), data.toArray())
    }
    let writeResult = if (method == "global/settings/get") { "" } else {
        let flag = if (changed) { "true" } else { "false" }
        ",\"saved\":true,\"changed\":${flag}"
    }
    emit(okFrame(idText, "{\"transcriptView\":\"${jsonEscapeText(tv)}\",\"composerEnter\":\"${jsonEscapeText(ce)}\",\"sessionLog\":\"${jsonEscapeText(sl)}\",\"scope\":\"user\"${writeResult}}"))
}

main(args: Array<String>) {
    let catalog = SessionCatalog(".")
    let teamRuntime = HostTeamRuntime(".", catalog)
    let teamSchedulerToken = TurnToken()
    let teamScheduler = spawn { =>
        while (!teamSchedulerToken.cancelled()) {
            try { teamRuntime.poll() } catch (e: Exception) { getStdErr().writeln("team-poll-failed:${e.message}") }
            sleep(50 * Duration.millisecond)
        }
    }
    var activeId = "current"
    var startupFault = false
    var p = catalog.indexPath()
    try { activeId = catalog.selectedId(); p = catalog.pathFor(activeId) } catch (e: Exception) {
        // 根日志损坏交给既有 replay-rejected 协议；缺失所选会话则不能静默切回默认会话。
        startupFault = e.message != "catalog-index-rejected"
    }
    var lease = WriteLease(p)
    var shared = SessionLog(p)
    var leaseHeld = false
    var selectionFault = false
    var workspaceFault = false
    // 上传与结算之间靠暂存凭证连接：凭证由本宿主铸造，对端自报的 attachmentId
    // 没有通路——「谁上传的」与「谁引用的」必须是同一次会话里的同一张条子。
    // 宿主文件后端的内容寻址目录相对会话根（与 SessionCatalog(".") 同一个 CWD）。
    let attReceipts = HashMap<String, AttachmentRef>()
    var attSeq = Int64(0)
    let attDir = "attachments/v1"
    // 内置仓颉工具在此登记；extension/* 全部走同一个注册表与同一个 ToolRuntime，
    // 保证 CLI 与桌面看到的工具集与审批语义一致。
    let extReg = ToolRegistry()
    extReg.register(ToolSpec("write", "写临时文件", "path content", true))
    // 读侧工具与写侧共用同一条管线；它不改盘，所以默认不要审批，
    // 但它会留下版本标记，随后同一路径的 write 要按这份标记判是否已被第三方改过。
    extReg.register(ToolSpec("read", "读文件并记录版本标记", "path", false))
    // 手工工具运行态的工作目录取会话有效目录：会话日志里已有绑定事件时它本就跟着日志走，
    // 这一份只兜「该会话从未绑过目录」的落点——留空串会退回进程当前目录，而宿主进程 cwd
    // 是调用方给的工作状态目录，不是项目目录。
    var extRt = ToolRuntime(shared, extReg, workingDirectory: sessionWorkingDirectory(shared))
    // 审批工单与工具运行态共用同一份日志：asked/decided/expired 都是可回放的事件
    var approvalDesk = ApprovalDesk(shared)
    var executionService: Option<ExecutionService> = None
    let executionRuns = ArrayList<ExecutionRun>()
    var executionSettled = true
    // token 计量与预算：账只认会话日志重算出来的那份，内存计数不是第二真源，
    // 所以每次接手日志都要 rebuild，崩溃重启后不会因为「失忆」而放行。
    var meter = TokenMeter(shared)
    // JS 动态扩展宿主：由 core 的 ExtProcess 直接驱动的子进程，与内置仓颉工具共用
    // 同一套语义（未登记即拒、卸载残留归 0、退出必须结算）。
    var jsHost: Option<ExtProcess> = None
    var jsAlive = false
    // 流式 turn 跑在独立仓颉线程上：这样 stdin 上的 turn/cancel 能在「流中间」被读到，
    // 桌面 stop 才有落点。日志侧的并发由 core 的 SessionLog 锁兜住，所以这里只把
    // 「会动日志的写」串行化，读侧（投影/订阅）在 turn 在途期间照常应答。
    var turnHandle: Option<TurnHandle> = None
    var turnComputer: ?ComputerRuntime = None
    var turnGoal: Option<HostGoalRun> = None
    var turnBusy = false
    var turnSink = ThreadSafeDeliveryQueue(64)
    // 工具调用改成「立刻回执 + 独立线程收帧」：主循环因此能在转调期间继续读 stdin，
    // 桌面的 cancel/stop 才追得上在途调用。登记表只由主循环动，收帧线程只写 sink。
    var callSink = ThreadSafeDeliveryQueue(64)
    var inflight = InflightCalls()
    var callSeq: Int64 = 0
    // 每次 turn/start 递增：调用登记时记下自己属于哪一轮，
    // 取消一轮只结算它自己发起的那些（epoch 0 = 不在任何 turn 里）。
    var turnEpoch: Int64 = 0
    var modelKey = ""
    var modelKeyRef = ""
    // 提示词增强是第三条独立车道：不占会话租约、不进 turnBusy、不接工具执行循环，
    // 结果只回给调用方，永不落成会话消息（替用户说话的是发送，不是润色）。
    // 一槽就够：第二笔会把第一笔的结算顶掉，界面上表现为「点了没反应」。
    var enhanceHandle: Option<EnhanceHandle> = None
    var enhanceModel = ""
    // 同一笔用量只能进账一次；租约取不到时保持 false，让下一次轮询补记。
    var enhanceCharge: Option<EnhanceCharge> = None
    let enhanceCharges = ArrayList<EnhanceCharge>()
    while (true) {
        var body = ""
        var eof = false
        try {
            body = readln()
        } catch (e: Exception) {
            // stdin EOF（父进程关闭管道）属于正常退出路径，不得抛异常终止
            eof = true
        }
        if (eof) {
            break
        }
        if (body.size == 0) {
            break
        }
        var valid = true
        try {
            JsonValue.fromStr(body)
        } catch (e: Exception) {
            valid = false
        }
        if (!valid) {
            emit(errFrame("null", -32700, "parse error"))
            continue
        }
        var chargeIndex = Int64(enhanceCharges.size) - 1
        while (chargeIndex >= 0) {
            if (enhanceCharges[chargeIndex].settle()) { enhanceCharges.remove(at: chargeIndex) }
            chargeIndex -= 1
        }
        let method = jsonStr(body, "method")
        let idText = jsonId(body)
        try {
        if (executionRuns.size > 0) {
            let run = executionRuns[0]
            if (run.settled()) {
                try { let result = run.wait(); executionSettled = result.exitObserved && result.outputComplete }
                catch (e: Exception) { executionSettled = false; getStdErr().writeln("execution-settlement-failed: ${e.message}") }
                executionRuns.clear()
            }
        }
        // 活动执行只开放只读查询与精确停止；不能切换日志或并行开启其他副作用。
        if (executionRuns.size > 0 || !executionSettled) {
            let safe = method == "initialize" || ExecutionApi.readOnly(method) || method == "execution/stop" ||
                method == "session/projection" || method == "session/subscribe" || method == "session/catalog" ||
                method == "workspace/get" || method == "appearance/get" || method == "usage/status" ||
                method == "goal/describe" || method == "model/get" || method == "model/registry/describe" ||
                method == "global/appearance/get"
            if (!safe) { emit(errFrame(idText, -32026, "execution-in-flight-or-unsettled")); continue }
        }
        if (shared.isDurableFrozen() && method == "execution/stop") {
            if (executionRuns.size > 0) {
            let run = executionRuns[0]
                if (jsonStr(body, "sessionId") == activeId && jsonStr(body, "executionId") == run.starting.id) {
                    try { run.cancel() } catch (_: Exception) {}
                }
            }
        }
        if (shared.isDurableFrozen() && method != "initialize" && method != "turn/poll" && method != "turn/cancel") {
            emit(errFrame(idText, -32026, "session-durable-frozen"))
            continue
        }
        if (method == "model/get" || method == "model/configure" || method == "model/use-key") {
            if (turnBusy && method != "model/get") { emit(errFrame(idText, -32001, "turn-in-flight")); continue }
            try {
                let settings = ModelSettings.forUser()
                if (method == "model/configure") {
                    settings.save(jsonStr(body, "baseUrl"), jsonStr(body, "model"), jsonStr(body, "credentialRef"))
                    modelKey = ""; modelKeyRef = ""
                }
                let saved = settings.read()
                if (method == "model/use-key") {
                    let reference = jsonStr(body, "credentialRef")
                    let key = jsonStr(body, "apiKey")
                    if (reference.size == 0 || reference != saved.credentialRef || key.size == 0 || key.size > 8192) { throw Exception("bad-model-key") }
                    for (byte in key.toArray()) { if (byte < 32 || byte == 127) { throw Exception("bad-model-key") } }
                    modelKeyRef = reference; modelKey = key
                    emit(okFrame(idText, "{\"loaded\":true}")); continue
                }
                let url = if (saved.baseUrl.size > 0) { saved.baseUrl } else { getVariable("SACODE_PROVIDER_BASE_URL") ?? "" }
                let name = if (saved.model.size > 0) { saved.model } else { getVariable("SACODE_PROVIDER_MODEL") ?? "" }
                let environment = saved.baseUrl.size == 0
                let environmentKey = (getVariable("SACODE_PROVIDER_KEY") ?? "").size > 0 || (getVariable("STEPFUN_API_KEY") ?? "").size > 0
                let readyKey = (environment && environmentKey) || (modelKeyRef == saved.credentialRef && modelKey.size > 0)
                emit(okFrame(idText, "{\"baseUrl\":\"${jsonEscapeText(url)}\",\"model\":\"${jsonEscapeText(name)}\",\"credentialRef\":\"${jsonEscapeText(saved.credentialRef)}\",\"environment\":${environment},\"keyLoaded\":${readyKey}}"))
            } catch (e: Exception) { emit(errFrame(idText, -32020, e.message)) }
            continue
        }
        if (method == "model/registry/describe" || method == "model/registry/catalog" || method == "model/registry/update" || method == "model/registry/remove" || method == "model/registry/set-default" || method == "model/registry/add-catalog" || method == "model/registry/sort" || method == "model/registry/set-enabled" || method == "credential/describe" || method == "credential/set" || method == "credential/unset" || method == "model/list" || method == "custom/describe" || method == "custom/upsert" || method == "custom/remove" || method == "binding/upsert" || method == "binding/remove" || method == "binding/reorder" || method == "model/pull" || method == "model/upstream/upsert" || method == "custom/import/new" || method == "custom/import/into") {
            // 在途轮次里只放行读面：改提供商或换凭据不该打断正在流式返回的这一轮
            let configReadSide = method == "model/registry/describe" || method == "model/registry/catalog" || method == "credential/describe" || method == "custom/describe"
            if (turnBusy && !configReadSide) { emit(errFrame(idText, -32001, "turn-in-flight")); continue }
            providerSurfaceRequest(method, body, idText)
            continue
        }
        // 插件清单：逐条通道落地，缺通道适配器保持 unconnected（不冒充本地状态）
        if (method == "plugin/describe" || method == "plugin/uninstall" || method == "plugin/set-enabled") {
            try {
                // 与 providers.log 同一个用户目录：两入口共用一份安装态，相对路径会随宿主 CWD 漂移。
                let store = PluginStore.forUser()
                if (method == "plugin/uninstall") {
                    store.uninstall(jsonStr(body, "name"), jsonNum(body, "expectedRevision"))
                } else if (method == "plugin/set-enabled") {
                    store.setEnabled(jsonStr(body, "name"), jsonStr(body, "enabled") == "true", jsonNum(body, "expectedRevision"))
                }
                // 三个动作统一回最新清单：写后回 {} 会逼界面再发一次 describe，还要自己处理两帧之间的漂移。
                emit(okFrame(idText, store.describe().asJson()))
            } catch (e: Exception) {
                emit(errFrame(idText, -32030, e.message))
            }
            continue
        }
        if (method == "global/appearance/get" || method == "global/appearance/set-theme" || method == "global/appearance/set-font-size" || method == "global/appearance/set-busy-send") {
            globalAppearanceRequest(method, body, idText)
            continue
        }
        if (method == "global/settings/get" || method == "global/settings/set-transcript-view" || method == "global/settings/set-composer-enter" || method == "global/settings/set-session-log") {
            try {
                globalSettingsRequest(method, body, idText)
            } catch (e: Exception) {
                emit(errFrame(idText, -32003, e.message))
            }
            continue
        }
        if (isTipsMethod(method)) {
            tipsSurfaceRequest(method, body, idText, shared)
            continue
        }
        if (workspaceFault && method != "initialize" && method != "session/projection" && method != "session/catalog" && method != "appearance/get" && method != "usage/status" && method != "workspace/get") {
            emit(errFrame(idText, -32003, "workspace-failed-restart-required")); continue
        }
        if (startupFault && method != "initialize" && method != "session/catalog" && method != "session/create" && method != "session/select") {
            emit(errFrame(idText, -32002, "selection-replay-rejected"))
            continue
        }
        if (selectionFault && method != "initialize" && method != "session/projection" && method != "session/catalog" && method != "appearance/get" && method != "usage/status") {
            emit(errFrame(idText, -32003, "selection-failed-restart-required"))
            continue
        }
        // turn 在途期间只拦「会动日志的写」：读侧走 core 的守护访问器，工具调用的
        // 发起/收帧/取消必须放得进来，否则取消永远追不上在途调用。
        if (method == "team/approval/answer") {
            try {
                let params = JsonValue.fromStr(paramsTextOf(body)).asObject()
                if (params.size() != 4) { throw Exception("bad-team-approval-arguments") }
                let result = teamRuntime.answer(jsonStr(body, "teamSessionId"), jsonStr(body, "memberId"), jsonNum(body, "approvalId"), jsonStr(body, "decision"))
                emit(okFrame(idText, result))
            } catch (e: Exception) { emit(errFrame(idText, -32003, e.message)) }
            continue
        }
        if (HostTeamRuntime.accepts(method)) {
            try {
                teamRuntime.poll()
                let result = teamRuntime.request(method, paramsTextOf(body))
                teamRuntime.poll()
                emit(okFrame(idText, result))
            } catch (e: Exception) { emit(errFrame(idText, -32003, e.message)) }
            continue
        }
        if (turnBusy && !allowedDuringTurn(method)) {
            emit(errFrame(idText, -32001, "turn-in-flight"))
            continue
        }
        if (method == "initialize") {
            emit(okFrame(idText, "{\"protocolVersion\":\"0.1\",\"capabilities\":[\"team/describe\",\"team/member/create\",\"team/message/send\",\"team/message/broadcast\",\"team/task/create\",\"team/task/assign\",\"team/task/claim\",\"team/task/complete\",\"team/member/stop\",\"global/appearance/get\",\"global/appearance/set-theme\",\"global/appearance/set-font-size\",\"global/appearance/set-busy-send\",\"global/settings/get\",\"global/settings/set-transcript-view\",\"global/settings/set-composer-enter\",\"global/settings/set-session-log\",\"tips/get\",\"tips/startup\",\"tips/after-reply\",\"tips/set-hidden\",\"initialize\",\"session/projection\",\"session/append\",\"session/submit\",\"session/flush\",\"session/subscribe\",\"session/terminal-output\",\"extension/list\",\"extension/call\",\"extension/dispose\",\"turn/start\",\"turn/cancel\",\"turn/poll\",\"prompt/enhance\",\"prompt/poll\",\"prompt/cancel\",\"extension/host/spawn\",\"extension/host/load\",\"extension/host/list\",\"extension/host/call\",\"extension/host/dispose\",\"extension/host/poll\",\"extension/host/cancel\",\"extension/host/close\",\"approval/ask\",\"approval/answer\",\"approval/status\",\"usage/status\",\"usage/set-budget\",\"appearance/get\",\"appearance/set-theme\",\"session/catalog\",\"session/create\",\"session/select\",\"workspace/get\",\"workspace/set-directory\",\"workspace/files\",\"workspace/git-status\",\"workspace/git-diff\",\"task/start\",\"execution/propose\",\"execution/authorize\",\"execution/start\",\"execution/describe\",\"execution/output\",\"execution/stop\",\"model/get\",\"model/configure\",\"model/use-key\",\"model/registry/describe\",\"model/registry/catalog\",\"model/registry/update\",\"model/registry/remove\",\"model/registry/set-default\",\"model/registry/add-catalog\",\"model/registry/sort\",\"model/registry/set-enabled\",\"credential/describe\",\"credential/set\",\"credential/unset\",\"model/list\",\"queue/describe\",\"queue/enqueue\",\"queue/update\",\"attachment/upload\",\"attachment/image-read\",\"plugin/describe\",\"plugin/set-enabled\",\"plugin/uninstall\",\"goal/describe\",\"goal/create\",\"goal/edit\",\"goal/pause\",\"goal/resume\",\"goal/clear\",\"ledger/stats\",\"custom/describe\",\"custom/upsert\",\"custom/remove\",\"binding/upsert\",\"binding/remove\",\"binding/reorder\",\"model/pull\",\"model/upstream/upsert\",\"custom/import/new\",\"custom/import/into\",\"lsp/define\",\"lsp/lookup\",\"lsp/references\",\"lsp/implementation\",\"lsp/call-hierarchy\",\"lsp/diagnostics\",\"lsp/rename\",\"worktree/enter\",\"worktree/describe\",\"worktree/exit\",\"worktree/agent-prepare\",\"worktree/agent-finish\",\"worktree/cleanup\"],\"core\":\"cangjie\",\"transport\":\"stdio-ndjson\"}"))
            continue
        }
        if (ExecutionApi.handles(method)) {
            try {
                let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
                if (params.get("sessionId").getOrThrow().asString().getValue() != activeId) {
                    throw Exception("execution-session-changed")
                }
                if (ExecutionApi.readOnly(method)) {
                    var source = shared
                    if (!leaseHeld) {
                        source = SessionLog(p)
                        if (!source.load()) { throw Exception("replay-rejected") }
                    }
                    let service = if (leaseHeld) { executionService ?? ExecutionService(source, lease, activeId) }
                        else { ExecutionService(source, lease, activeId) }
                    emit(okFrame(idText, ExecutionApi(service, approvalDesk, activeId).dispatch(method, params.toString())))
                } else {
                    if (!leaseHeld) {
                        if (!lease.takeoverIfStale()) { throw Exception("already-owned") }
                        if (!loadForWrite(shared, meter)) { lease.release(); throw Exception("replay-rejected") }
                        leaseHeld = true
                        executionService = None
                    }
                    if (executionService.isNone()) {
                        let service = ExecutionService(shared, lease, activeId)
                        executionService = Some(service)
                        service.recover()
                    }
                    let response = ExecutionApi(executionService.getOrThrow(), approvalDesk, activeId).dispatch(method, params.toString(),
                        asynchronous: method == "execution/start", onStarted: { run => executionRuns.add(run) })
                    if (executionRuns.size > 0) { executionSettled = false }
                    emit(okFrame(idText, response))
                }
            } catch (e: Exception) { emit(errFrame(idText, -32026, e.message)) }
            continue
        }
        if (method == "goal/describe" || isGoalControlMethod(method)) {
            // 会话身份必须随动作绑定；迟到控制不能编辑切换后的另一会话。
            if (jsonStr(body, "sessionId") != activeId) { emit(errFrame(idText, -32025, "goal-session-changed")); continue }
            if (method == "goal/describe") {
                try {
                    var source = shared
                    if (!leaseHeld) {
                        source = SessionLog(p)
                        if (!source.load()) { throw Exception("replay-rejected") }
                    }
                    emit(okFrame(idText, goalProjectionJson(source)))
                } catch (e: Exception) { emit(errFrame(idText, -32025, e.message)) }
                continue
            }
            let hadLease = leaseHeld
            if (!hadLease) {
                if (!lease.takeoverIfStale()) { emit(errFrame(idText, -32001, "already-owned")); continue }
                if (!loadForWrite(shared, meter)) { lease.release(); emit(errFrame(idText, -32002, "replay-rejected")); continue }
                leaseHeld = true
            }
            try {
                let result = controlGoalJson(shared, method, jsonNum(body, "revision"), jsonStr(body, "objective"))
                if (!shared.flush()) { throw Exception("goal-flush-failed") }
                if (!hadLease) { lease.release(); leaseHeld = false }
                emit(okFrame(idText, result))
            } catch (e: Exception) {
                if (!hadLease && shared.flush()) { lease.release(); leaseHeld = false }
                emit(errFrame(idText, -32025, e.message))
            }
            continue
        }
        if (method == "attachment/image-read") {
            // 迟到的图片请求不能在切换会话后读取新会话；路径与类型均不可由界面指定。
            if (jsonStr(body, "sessionId") != activeId) { emit(errFrame(idText, -32024, "attachment-session-changed")); continue }
            try {
                var source = shared
                if (!leaseHeld) {
                    source = SessionLog(p)
                    if (!source.load()) { throw Exception("replay-rejected") }
                }
                let store = AttachmentStore(attDir, source, AttachmentLimits.localBackend())
                emit(okFrame(idText, sessionImageJson(source, store, jsonStr(body, "attachmentId"))))
            } catch (e: Exception) { emit(errFrame(idText, -32024, e.message)) }
            continue
        }
        if (method == "session/projection") {
            // 实例内可见性：持有租约时投影未 flush 的内存态（DSH 中 append 即可见，
            // flush 只决定崩溃持久与跨进程可见），否则从磁盘重建。
            // 一律走守护访问器：turn 线程可能正在写，这里必须拿到一次自洽的快照，
            // 而不是边遍历共享列表边拼帧。
            var target = shared
            if (!leaseHeld) {
                let fresh = SessionLog(p)
                if (!fresh.load()) {
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                target = fresh
            }
            // 待办投影由共享核心回放；损坏快照不能拖垮协议主进程。
            var todos = "null"
            try {
                todos = TodoStore(target).projectionJson()
            } catch (_: Exception) {
                emit(errFrame(idText, -32002, "todo-replay-rejected"))
                continue
            }
            let tailFlag = if (target.isTruncatedTail()) { "true" } else { "false" }
            // 消息正文一并交出：渲染层只能显示核心投影，不允许自己再拼一份历史。
            // 只给尾部 64 条，帧大小有界；计数仍是全量投影计数。
            var msgs = ArrayList<MessageProjectionRow>()
            try { msgs = projectMessageRows(target.snapshotEvents().toArray()) }
            catch (_: Exception) { emit(errFrame(idText, -32002, "message-replay-rejected")); continue }
            let total = msgs.size
            let from = if (total > 64) { total - 64 } else { Int64(0) }
            var marr = "["
            var rows = "["
            var mi = from
            while (mi < total) {
                if (mi > from) {
                    marr += ","
                    rows += ","
                }
                marr += "\"${jsonEscapeText(msgs[mi].line())}\""
                rows += msgs[mi].toJson()
                mi += 1
            }
            marr += "]"
            rows += "]"
            emit(okFrame(idText, "{\"projection\":${total},\"events\":${target.eventCount()},\"durable\":${target.durableCount()},\"pending\":${target.pendingCount()},\"truncatedTail\":${tailFlag},\"messages\":${marr},\"messageRows\":${rows},\"todos\":${todos}}"))
            continue
        }
        if (method == "session/append") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            var attachFailure = ""
            var receiptIds = ArrayList<String>()
            if (attHasReceipts(body)) {
                try {
                    receiptIds = attList(JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject(), "receiptIds")
                } catch (_: Exception) {
                    attachFailure = "attachment-bad-request"
                }
            }
            if (attachFailure.size > 0) {
                emit(errFrame(idText, -32024, attachFailure))
                continue
            }
            if (receiptIds.size == 0) {
                // 没有凭证的调用方走原路：报文形态与这次改动之前逐字相同
                shared.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            } else {
                let att = AttachmentStore(attDir, shared, AttachmentLimits.localBackend())
                let refs = ArrayList<AttachmentRef>()
                for (rid in receiptIds) {
                    if (let Some(r) <- attReceipts.get(rid)) {
                        refs.add(r)
                    } else {
                        attachFailure = "attachment-receipt-unknown"
                    }
                }
                if (attachFailure.size > 0) {
                    // 认不出任何一张凭证就整条拒掉：既不落半结算的消息，也不烧掉好凭证
                    emit(errFrame(idText, -32024, attachFailure))
                    continue
                }
                att.commitMessage(jsonStr(body, "data"), refs)
                for (rid in receiptIds) {
                    attReceipts.remove(rid)
                }
            }
            if (!shared.flush()) {
                // 未落盘则保留写租约与内存态，调用方可重试 flush，不得当作已提交
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            emit(okFrame(idText, "{\"events\":${shared.eventCount()},\"durable\":${shared.durableCount()}}"))
            continue
        }
        // 显式 durability 屏障：submit 只在内存可见，flush 才跨进程可见
        if (method == "session/submit") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            shared.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            emit(okFrame(idText, "{\"events\":${shared.eventCount()},\"durable\":${shared.durableCount()}}"))
            continue
        }
        if (method == "session/flush") {
            if (!leaseHeld) {
                emit(errFrame(idText, -32004, "no-pending-writes"))
                continue
            }
            if (!shared.flush()) {
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            emit(okFrame(idText, "{\"events\":${shared.eventCount()},\"durable\":${shared.durableCount()}}"))
            continue
        }
        // 只回放**已落盘**事件：cursor 之后、limit 之内，more 表示还有

        if (method == "session/terminal-output") {
            try {
                let args = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
                if (args.size() != 3) { throw Exception("bad-terminal-arguments") }
                let session = attStr(args, "sessionId")
                let cursor = args.get("cursor").getOrThrow().asInt().getValue()
                let limit = args.get("limit").getOrThrow().asInt().getValue()
                if (session != activeId) { emit(errFrame(idText, -32026, "terminal-session-changed")); continue }
                let fresh = SessionLog(p)
                if (!fresh.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
                let result = terminalOutputJson(fresh, cursor, limit)
                emit(okFrame(idText, "{\"sessionId\":\"${jsonEscapeText(session)}\",\"page\":${result}}"))
            } catch (_: Exception) { emit(errFrame(idText, -32602, "bad-terminal-arguments")) }
            continue
        }
        if (method == "session/subscribe") {
            let fresh = SessionLog(p)
            if (!fresh.load()) {
                emit(errFrame(idText, -32002, "replay-rejected"))
                continue
            }
            var cursor = jsonNum(body, "cursor")
            var limit = jsonNum(body, "limit")
            if (cursor < 0) {
                cursor = 0
            }
            if (limit <= 0 || limit > 64) {
                limit = 64
            }
            let picked = ArrayList<String>()
            var next = cursor
            var more = false
            for (ev in fresh.snapshotEvents()) {
                if (ev.seq >= cursor) {
                    if (Int64(picked.size) < limit) {
                        picked.add("{\"seq\":${ev.seq},\"type\":\"${jsonEscapeText(ev.eventType)}\"}")
                        next = ev.seq + 1
                    } else {
                        more = true
                    }
                }
            }
            var arr = "["
            for (i2 in 0..picked.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += picked[i2]
            }
            arr += "]"
            emit(okFrame(idText, "{\"events\":${arr},\"nextCursor\":${next},\"durable\":${fresh.durableCount()},\"more\":${more}}"))
            continue
        }
        if (method == "extension/list") {
            var arr = "["
            var idx: Int64 = 0
            for (n in extReg.list()) {
                if (idx > 0) {
                    arr += ","
                }
                let flag = if (extReg.requiresApproval(n)) { "true" } else { "false" }
                arr += "{\"name\":\"${n}\",\"description\":\"${extReg.describe(n)}\",\"needsApproval\":${flag}}"
                idx += 1
            }
            arr += "]"
            emit(okFrame(idText, "{\"tools\":${arr},\"misses\":${extRt.registryMisses},\"guardDenials\":${extRt.guardDenials}}"))
            continue
        }
        if (method == "extension/call") {
            // 工具事件与 session/submit 同一持久化档位：租约内内存可见，退出结算时落盘
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 审批只认工单：需要审批的工具（含未登记名，注册表按拒绝默认取值）必须带 approvalId，
            // 由 core 侧一次性消费。调用方在请求里自报「allowed-once」在这条路上完全不起作用——
            // 谁批的、批没批、批过头没有，都只能从日志里的 asked/decided 回答。
            let ticketId = jsonNum(body, "approvalId")
            let toolName = jsonStr(body, "name")
            let out = if (extReg.requiresApproval(toolName)) {
                extRt.executeWithApproval(toolName, jsonStr(body, "args"), ticketId, true, approvalDesk)
            } else {
                extRt.execute(toolName, jsonStr(body, "args"), "", true)
            }
            if (!out.allowed) {
                emit(errFrame(idText, -32010, out.why))
                continue
            }
            // 工具的回执正文现在是真内容（read 交回盘上读到的字节），可能含引号与换行：
            // 不过一遍转义就会把协议帧自己撕开。
            emit(okFrame(idText, "{\"result\":\"${jsonEscapeText(out.why)}\"}"))
            continue
        }
        if (method == "extension/dispose") {
            let gone = extReg.unregister(jsonStr(body, "name"))
            let flag = if (gone) { "true" } else { "false" }
            emit(okFrame(idText, "{\"disposed\":${flag},\"tools\":${extReg.count()}}"))
            continue
        }
        // 审批的协议面：asked/decided/expired 都进同一份日志，与 session/submit 同一持久化档位
        // （租约内内存可见，退出结算时落盘）。审批工单只在有写者时写事件，读状态不需要写者。
        if (method == "approval/ask") {
            var boundArgs: Option<String> = None
            try {
                let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
                if (let Some(value) <- params.get("args")) {
                    let exact = value.asString().getValue()
                    if (exact.size > 262144) { throw Exception("approval-arguments-too-large") }
                    boundArgs = Some(exact)
                }
            } catch (e: Exception) { emit(errFrame(idText, -32602, "bad-approval-arguments:${e.message}")); continue }
            if (jsonStr(body, "name").size == 0) { emit(errFrame(idText, -32602, "bad-approval-tool")); continue }
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let toolName = jsonStr(body, "name")
            // ttl 只允许把窗口缩短（1..桌面默认值），不接受延长：过期是 fail-closed 的方向，
            // 让调用方能拉长就等于没有过期。缺省（jsonNum 回 -1）或越界一律走默认值。
            let askedTtl = jsonNum(body, "ttl")
            let ttl = if (askedTtl >= 1 && askedTtl < approvalDesk.defaultTtl) { askedTtl } else { approvalDesk.defaultTtl }
            let aid = if (let Some(exact) <- boundArgs) {
                approvalDesk.askForCall(toolName, exact, ttl: ttl)
            } else { approvalDesk.askWithTtl(toolName, ttl) }
            emit(okFrame(idText, "{\"approvalId\":${aid},\"state\":\"pending\",\"pending\":${approvalDesk.pendingCount()}}"))
            continue
        }
        if (method == "approval/answer") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 参数名不能叫 id：本端解析器按整帧字节扫描，"id" 会先撞上 JSON-RPC 信封自己的 id
            let target = jsonNum(body, "approvalId")
            let accepted = approvalDesk.answer(target, jsonStr(body, "decision"))
            let flag = if (accepted) { "true" } else { "false" }
            emit(okFrame(idText, "{\"accepted\":${flag},\"state\":\"${approvalDesk.stateOf(target)}\"}"))
            continue
        }
        if (method == "approval/status") {
            let target2 = jsonNum(body, "approvalId")
            emit(okFrame(idText, "{\"state\":\"${approvalDesk.stateOf(target2)}\",\"pending\":${approvalDesk.pendingCount()}}"))
            continue
        }
        // 队列是会话日志里的事实：读侧按投影规矩来（持租约看内存态，否则只认已落盘），
        // 写侧与 session/submit 同一持久化档位——append 只在实例内可见，结算或 flush 才跨进程。
        if (method == "queue/describe") {
            var qTarget = shared
            if (!leaseHeld) {
                let fresh = SessionLog(p)
                if (!fresh.load()) {
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                qTarget = fresh
            }
            let inbox = AgentInbox(qTarget)
            let turnListJson = inboxListJson(inbox, "next-turn")
            let stepListJson = inboxListJson(inbox, "next-step")
            let runningFlag = if (turnBusy) { "true" } else { "false" }
            emit(okFrame(idText, "{\"nextTurn\":${turnListJson},\"nextStep\":${stepListJson},\"running\":${runningFlag},\"mutable\":true,\"bad\":${inbox.badCount}}"))
            continue
        }
        if (method == "queue/enqueue") {
            var accelerated = false
            var sendMode = "queue"
            try {
                let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
                if (let Some(value) <- params.get("accelerated")) { accelerated = value.asBool().getValue() }
                let preference = GlobalAppearanceSettings.forUser().read().busySend
                sendMode = GlobalAppearanceSettings.sendMode(preference, turnBusy, accelerated)
            } catch (e: Exception) {
                emit(errFrame(idText, -32602, "bad-send-policy"))
                continue
            }
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let text = jsonStr(body, "text")
            let rpcId = jsonStr(body, "rpcId")
            let inbox = AgentInbox(shared)
            if (rpcId.size > 0 && inbox.hasRpc(rpcId)) {
                // 同一次提交的回声：接受，但绝不复制第二条（上游 hasPromptRequest 提前 accepted）
                emit(okFrame(idText, "{\"accepted\":true,\"deduped\":true,\"id\":\"\"}"))
                continue
            }
            // 条目身份由核心铸造：界面递进来的「id」没有通路，重复 id 也就无从伪造
            let newId = "q${shared.eventCount()}"
            var receiptIds = ArrayList<String>()
            var enqueueFailure = ""
            if (attHasReceipts(body)) {
                try {
                    receiptIds = attList(JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject(), "receiptIds")
                } catch (_: Exception) {
                    enqueueFailure = "attachment-bad-request"
                }
            }
            var boundRefs = ArrayList<AttachmentRef>()
            if (enqueueFailure.size == 0) {
                for (rid in receiptIds) {
                    if (let Some(r) <- attReceipts.get(rid)) {
                        boundRefs.add(r)
                    } else {
                        // 认不出任何一张凭证就整条拒：不落半绑定的条目，也不烧掉好凭证
                        enqueueFailure = "attachment-receipt-unknown"
                        boundRefs = ArrayList<AttachmentRef>()
                        break
                    }
                }
            }
            if (enqueueFailure.size == 0) {
                try {
                    if (sendMode == "steer") { inbox.step(newId, text, rpcId, attachments: boundRefs) }
                    else { inbox.queue(newId, text, rpcId, attachments: boundRefs) }
                } catch (e: Exception) {
                    enqueueFailure = if (e.message == "inbox-empty-text") { "queue-edit-blank" } else { e.message }
                }
            }
            if (enqueueFailure.size > 0) {
                let attachError = enqueueFailure.startsWith("attachment-")
                emit(errFrame(idText, if (attachError) { Int64(-32024) } else { Int64(-32021) }, enqueueFailure))
                continue
            }
            for (rid in receiptIds) {
                // 入队即消费：凭证换成条目上的引用，同一个凭证第二次使用没有通路
                attReceipts.remove(rid)
            }
            emit(okFrame(idText, "{\"accepted\":true,\"deduped\":false,\"id\":\"${newId}\",\"mode\":\"${sendMode}\"}"))
            continue
        }
        if (method == "queue/update") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let itemId = jsonStr(body, "itemId")
            let kind = jsonStr(body, "kind")
            let text = jsonStr(body, "text")
            if (kind == "steer" && !turnBusy) {
                // 即时补充改的是「正在跑的这一轮」：没有轮次可改就是不可用，不是假装接受
                emit(errFrame(idText, -32023, "queue-steer-unavailable"))
                continue
            }
            let inbox = AgentInbox(shared)
            var updateFailure = ""
            try {
                if (kind == "remove") {
                    inbox.remove(itemId)
                } else if (kind == "edit") {
                    inbox.edit(itemId, text)
                } else if (kind == "steer") {
                    inbox.steerFromQueue(itemId)
                } else {
                    updateFailure = "queue-bad-action"
                }
            } catch (e: Exception) {
                updateFailure = if (e.message == "inbox-item-not-found") {
                    "queue-item-not-found"
                } else if (e.message == "inbox-empty-text") {
                    "queue-edit-blank"
                } else {
                    e.message
                }
            }
            if (updateFailure.size > 0) {
                emit(errFrame(idText, -32021, updateFailure))
                continue
            }
            emit(okFrame(idText, "{\"accepted\":true}"))
            continue
        }
        if (method == "attachment/upload") {
            var uploadFailure = ""
            var uploaded = ""
            try {
                // body 是整条报文，参数在 params 里：直接对信封取字段会全都读成空
                let req = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
                let kind = attStr(req, "kind")
                let name = attStr(req, "name")
                let mediaType = attStr(req, "mediaType")
                let encoded = attStr(req, "data")
                var data = Array<Byte>(0, repeat: UInt8(0))
                if (encoded.size > 0) {
                    match (fromBase64String(encoded)) {
                        case Some(bs) => data = bs
                        case None => uploadFailure = "attachment-bad-base64"
                    }
                }
                if (uploadFailure.size == 0) {
                    let att = AttachmentStore(attDir, shared, AttachmentLimits.localBackend())
                    // 先持久化、后事件：这一步只落对象，凭证在内存里，消息还没写。
                    let ref = if (kind == "image") {
                        att.saveImage(data, mediaType, name)
                    } else if (kind == "file") {
                        att.saveFile(data, name)
                    } else {
                        throw Exception("attachment-bad-kind")
                    }
                    attSeq += 1
                    let receipt = "u${attSeq}"
                    attReceipts.add(receipt, ref)
                    uploaded = "{\"receiptId\":\"${receipt}\",\"attachment\":${ref.toJson()}}"
                }
            } catch (e: Exception) {
                uploadFailure = e.message
            }
            if (uploadFailure.size > 0) {
                emit(errFrame(idText, -32024, uploadFailure))
                continue
            }
            emit(okFrame(idText, uploaded))
            continue
        }
        if (method == "ledger/stats") {
            try { emit(okFrame(idText, ledgerStatsJson())) }
            catch (e: Exception) { emit(errFrame(idText, -32020, e.message)) }
            continue
        }
        if (method == "turn/start" || method == "task/start") {
            var chosenCustom = ""
            try {
                if (let Some(value) <- JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject().get("customModelId")) {
                    chosenCustom = value.asString().getValue()
                    if (chosenCustom.size > 256) { throw Exception("bad-custom-model-id") }
                }
            } catch (_: Exception) { emit(errFrame(idText, -32602, "bad-custom-model-id")); continue }
            let customModelId = chosenCustom
            let centered = customModelId.size > 0
            let routing = HostModelRoute(customModelId,
                "${activeId}-${routingRequestId()}-${turnEpoch + 1}", activeId)
            var selected: ?AttemptPlan = None
            if (centered) {
                try { selected = Some(routing.select(preview: true)) }
                catch (e: Exception) { emit(errFrame(idText, -32040, e.message)); continue }
            }

            var configured: ModelSettingsSnapshot
            try { configured = if (centered) { ModelSettingsSnapshot("", "", "") } else { ModelSettings.forUser().read() } }
            catch (e: Exception) { emit(errFrame(idText, -32020, e.message)); continue }
            // 注册表里选定的提供商优先；没有注册表条目时才回到单路模型设置与环境变量。
            // 默认指针在校验时就保证「提供商存在且模型在其清单里」，所以这里不必再兜第二层。
            let registryView = ProviderRegistry.forUser().describe()
            var planBaseUrl = ""
            var planModel = ""
            var planRef = ""
            var planProtocol = ""
            var planImages = false
            for (p in registryView.providers) {
                if (p.id == registryView.defaultProviderId && registryView.defaultModel.size > 0) {
                    planBaseUrl = p.baseUrl
                    planModel = registryView.defaultModel
                    planRef = p.credentialRef
                    planProtocol = p.protocol
                    for (entry in p.models) {
                        if (entry.id == registryView.defaultModel) { planImages = entry.image }
                    }
                }
            }
            if (let Some(plan) <- selected) {
                planBaseUrl = plan.baseUrl; planModel = plan.modelId
                planRef = plan.credentialRef; planProtocol = plan.protocol; planImages = plan.images
            }
            let fromRegistry = planBaseUrl.size > 0
            if (fromRegistry && planProtocol != "openai-completions") {
                // 请求装配器目前只会出 Chat Completions 的体；把 Anthropic/Responses 形状的
                // 提供商当成它来发，等于对着端点说不存在的方言——宁可当场拒。
                emit(errFrame(idText, -32016, "protocol-not-supported:${planProtocol}"))
                continue
            }
            let baseUrl = if (fromRegistry) { planBaseUrl } else if (configured.baseUrl.size > 0) { configured.baseUrl } else { getVariable("SACODE_PROVIDER_BASE_URL") ?? "" }
            let model = if (fromRegistry) { planModel } else if (configured.model.size > 0) { configured.model } else { getVariable("SACODE_PROVIDER_MODEL") ?? "gpt-3.5-turbo" }
            var key = ""
            if (fromRegistry) {
                key = resolveCredentialKey(planRef)
            } else if (configured.credentialRef.size > 0) {
                if (modelKeyRef == configured.credentialRef && modelKey.size > 0) { key = modelKey } else { key = resolveCredentialKey(configured.credentialRef) }
            } else {
                key = getVariable("SACODE_PROVIDER_KEY") ?? getVariable("STEPFUN_API_KEY") ?? ""
            }
            if (method == "task/start" && baseUrl.size == 0) { emit(errFrame(idText, -32016, "model-not-configured")); continue }
            if (method == "task/start" && key.size == 0 && !baseUrl.startsWith("http://127.0.0.1:") && !baseUrl.startsWith("http://localhost:")) {
                emit(errFrame(idText, -32016, "model-credential-unavailable")); continue
            }
            if (turnBusy) {
                emit(errFrame(idText, -32001, "turn-in-flight"))
                continue
            }
            // 与 session/submit 同一持久化档位：租约内内存可见，结算时落盘
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 预算拦过一次就不再开新轮：超档必须是停下来问人，而不是自动降级继续跑。
            if (meter.over()) {
                if (leaseHeld) {
                    if (shared.flush()) {
                        leaseHeld = false
                        lease.release()
                    }
                }
                emit(errFrame(idText, -32014, "over-budget"))
                continue
            }
            // 起轮共用的身份先建：模型侧审批回调要在 turn 线程里判「这一轮还在不在」。
            let tk = TurnToken()
            // 模型工具面：todo_write + read + write 同一个 ModelToolRuntime——请求里的
            // tools、系统提示里的工具清单、执行时的注册表三者同源，与人调的 extension/*
            // 收敛到同一套实现（agent.cj 的 read/write 管线 + TodoTool）。不传 toolRuntime
            // 会落到 files=false 的默认分支只登记 todo_write，真实模型于是只调得动一个工具。
            var modelTools: ?ModelToolRuntime = None
            if (baseUrl.size > 0) {
                // 冻结再闭包：仓颉不允许捕获可变变量的 Lambda 被间接调用（同下面的 turnKey）。
                let modelDesk = approvalDesk
                let modelSessionId = activeId
                let modelRequestId = idText
                // 模型侧审批与人类调用同一条工单制度：desk 发号、一次性消费、asked/decided
                // 都进同一份日志。发起方在 turn 线程，所以发号后先把工单通知推给调用方，
                // 再在本线程等到决答——等待期间主循环照常读 stdin，cancel 追得上。
                let modelApproval: (ModelToolCall) -> Int64 = { call =>
                    let aid = modelDesk.askForCall(call.name, call.args)
                    emit(notifyFrame("approval/asked",
                        "{\"approvalId\":${aid},\"tool\":\"${jsonEscapeText(call.name)}\",\"source\":\"model\",\"sessionId\":\"${jsonEscapeText(modelSessionId)}\",\"turnRequestId\":\"${jsonEscapeText(modelRequestId)}\",\"argumentsJson\":\"${jsonEscapeText(call.args)}\"}"))
                    // 等到决答/过期/取消：过期由真实单调钟决定（默认 30s），
                    // 不给「永远等下去」留位置；取消则立刻放弃，票留着由人处置。
                    var spins: Int64 = 0
                    while (spins < 1200) {
                        if (tk.cancelled()) { break }
                        if (modelDesk.stateOf(aid) != "pending") { break }
                        sleep(25 * Duration.millisecond)
                        spins += 1
                    }
                    aid
                }
                // LSP 面与协议面同源：同一个共享 router、同一条 turn 取消令牌、
                // 同一个会话身份。换一份 router 就等于「模型问的」和「桌面问的」
                // 不是同一个插件装配表。
                // 起轮的工作目录取「本轮开始时」的会话有效目录（含 worktree 绑定）并冻结：
                // PTC/JS 执行器只认这个入参、不回读会话日志，缺了它就在宿主 cwd 里跑；
                // shell 与文件工具虽然经 SessionWorkspace(log) 解析，但会话日志尚无绑定
                // 事件时两边会各回各的落点。不传等于「模型面的 cwd 由进程 cwd 决定」。
                try {
                    turnComputer = ComputerRuntime.openFromEnvironment(shared)
                } catch (e: Exception) {
                    if (leaseHeld && shared.flush()) { leaseHeld = false; lease.release() }
                    emit(errFrame(idText, -32015, e.message))
                    continue
                }
                let computerExecutor: ?ComputerToolExecutor = if (let Some(bound) <- turnComputer) { Some(bound.executor) } else { None }
                modelTools = Some(ModelToolRuntime(shared, false, files: true, desk: modelDesk, approval: modelApproval, computer: computerExecutor,
                    workingDirectory: sessionWorkingDirectory(shared),
                    team: Some(teamRuntime.tools(activeId, activeId)), lspRouter: LspRouters.sharedRouter(), lspSession: activeId, lspToken: tk))
            }
            // 系统提示必须落日志再进请求：modelRequestJson 只从会话日志重建 messages，
            // 内存里拼一条不发进日志，模型永远收不到（「Model-visible means logged」）。
            // 只补一次：同一会话后续轮次复用盘上那条（工具集不变，内容也不变）。
            // 诊断 turn/start 不走这里——它的请求形状由本地夹具按位置钉死。
            if (method == "task/start" && baseUrl.size > 0 && !hasSystemMessage(shared)) {
                if (let Some(mt) <- modelTools) {
                    shared.append("system/message", SystemPromptBuilder(mt.registry).build())
                }
            }
            // 轮次边界：从队列里摘恰好一条（上游 core.md:275「one next-turn message at a turn
            // boundary」），送达本身是另一件事——它作为独立的 user/message 落进日志，
            // 队列事件不进模型可见历史，两条账互不冒充。
            let goalStart = method == "task/start" && GoalService(shared).snapshot().phase == "active"
            // 持续目标由 GoalRunner 每轮消费一条；宿主不能在同一轮提前再摘一条。
            if (!goalStart) {
            let admitted = AgentInbox(shared).claimTurn()
            if (admitted.size > 0) {
                if (admitted[0].attachments.size > 0) {
                    // 入队时绑上的引用，在送达这一刻落成「attachment/record + user/message」，
                    // 与直接发送走同一个提交器：两条路径写出来的事实必须是同一种形态。
                    AttachmentStore(attDir, shared, AttachmentLimits.localBackend())
                        .commitMessage(admitted[0].text, admitted[0].attachments)
                } else {
                    shared.append("user/message", admitted[0].text)
                }
            }
            }
            let limitN = jsonNum(body, "limit")
            let limit = if (limitN < 0) { Int64(2) } else { limitN }
            turnEpoch += 1
            // 产品 task/start 必须有真实配置；示例 provider 只保留给诊断 turn/start。
            var providerKind = "fake"
            if (baseUrl.size > 0) {
                // 使用共享核心装配器，实际类型为 user/message，保留已提交的对话上下文。
                // 附件仓必须一起交给装配器：有引用却没仓会让请求侧整轮失败，
                // 而不传仓等于把用户消息里的图片静默丢掉。
                let turnAtt = AttachmentStore(attDir, shared, AttachmentLimits.localBackend())
                try {
                    let imageCapability = planImages
                    // 请求里的 tools 与执行器同源：就是 ModelToolRuntime 的注册表
                    // （todo_write + read + write）。此前这里只写死 TodoTool 一个 spec，
                    // 模型看不到 read/write，调用也会被「未登记」拒。
                    let toolSpecs = modelTools.getOrThrow().specs()
                    // key 是 var，仓颉不允许捕获可变变量的 Lambda 被间接调用，先冻结成 let 再闭包。
                    let turnKey = key
                    let frozenTools = modelTools.getOrThrow()
                    let firstLog = shared
                    let first: () -> Provider = { => DeferredProvider({ =>
                        if (centered) { routing.open(firstLog, tk, turnAtt, frozenTools) }
                        else { RealSseProvider(baseUrl, turnKey, modelRequestJson(model, firstLog.snapshotEvents().toArray(), tools: toolSpecs, attachStore: turnAtt, supportsImages: imageCapability), tk) }
                    }, tk) }
                    let turnLog = shared
                    let continuation: (String) -> Provider = { request =>
                        if (centered) { routing.open(turnLog, tk, turnAtt, frozenTools) }
                        else { RealSseProvider(baseUrl, turnKey, request, tk) }
                    }
                    turnGoal = None
                    if (goalStart) {
                        let goalRun = HostGoalRun(shared, lease, meter.budgetValue())
                        turnHandle = Some(goalRun.start(first, continuation, model, tk, turnSink, frozenTools, turnAtt, if (centered) { true } else { imageCapability }))
                        turnGoal = Some(goalRun)
                    } else {
                        turnHandle = Some(ModelAgentRunner().start(first(), continuation, model, tk, shared, turnSink, false, attach: turnAtt, supportsImages: if (centered) { true } else { imageCapability }, toolRuntime: modelTools))
                    }
                    if (let Some(bound) <- turnComputer) {
                        if (let Some(handle) <- turnHandle) {
                            spawn { => try { handle.result() } finally { bound.close() } }
                        }
                    }
                    providerKind = "real"
                } catch (e: Exception) {
                    if (let Some(bound) <- turnComputer) { bound.close() }
                    turnComputer = None
                    // 构造失败（连接拒绝、HTTP 错误等）：不留半开的 turn，
                    // 先落盘已积攒的写入再归还租约，与 over-budget 路径同一兜底。
                    if (leaseHeld) {
                        if (shared.flush()) {
                            leaseHeld = false
                            lease.release()
                        }
                    }
                    if (e.message == "model-image-not-supported") {
                        emit(errFrame(idText, -32016, e.message))
                    } else {
                        emit(errFrame(idText, -32015, "provider-init-failed:${e.message}"))
                    }
                    continue
                }
            } else {
                turnGoal = None
                turnHandle = Some(TurnRunner().start(CancellableStreamProvider(tk, limit), tk, shared, turnSink))
            }
            turnBusy = true
            emit(okFrame(idText, "{\"started\":true,\"limit\":${limit},\"epoch\":${turnEpoch},\"provider\":\"${providerKind}\",\"goal\":${turnGoal.isSome()}}"))
            continue
        }
        if (method == "turn/cancel") {
            // 只是发出取消请求；终态由 turn/poll 结算，绝不在这里编一个结果
            var requested = "false"
            var wasRunning = "false"
            if (let Some(h) <- turnHandle) {
                if (h.isRunning()) {
                    wasRunning = "true"
                    h.cancel()
                    requested = "true"
                }
            }
            // 取消一个 turn 必须顺带结算它发起的在途工具调用，否则桌面上会留下
            // 「turn 已停、工具还在跑」的悬空状态。结果帧仍由 poll 交出，这里不编。
            var killed = Int64(0)
            for (cid in inflight.idsForEpoch(turnEpoch)) {
                var done = false
                if (let Some(xp) <- jsHost) {
                    if (let Some(fr) <- xp.cancelCall(cid)) {
                        done = fr.contains("\"cancelled\":true")
                    }
                }
                if (done) {
                    killed += 1
                }
            }
            emit(okFrame(idText, "{\"cancelRequested\":${requested},\"wasRunning\":${wasRunning},\"extensionCallsCancelled\":${killed},\"inflightCalls\":${inflight.count()}}"))
            continue
        }
        if (method == "turn/poll") {
            let frames = turnSink.take(64)
            var arr = "["
            for (i2 in 0..frames.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += "\"${jsonEscapeText(frames[i2])}\""
            }
            arr += "]"
            var turnText = "false"
            var runningText = "false"
            var settledText = "false"
            var tail = ""
            if (let Some(h) <- turnHandle) {
                turnText = "true"
                if (h.isRunning()) {
                    runningText = "true"
                    tail = ",\"overflow\":${turnSink.overflow()}"
                } else {
                    // 线程已收束：join 之后才有终态可报，也才允许主线程动日志
                    let r = h.result()
                    if (shared.isDurableFrozen()) {
                        turnHandle = None; turnBusy = false; turnGoal = None
                        emit(errFrameData(idText, -32026, "session-durable-frozen", "{\"finishReason\":\"${jsonEscapeText(r.finishReason)}\",\"leaseRetained\":true}"))
                        continue
                    }
                    runningText = "false"
                    settledText = "true"
                    let cFlag = if (r.cancelled) { "true" } else { "false" }
                    let iFlag = if (r.interrupted) { "true" } else { "false" }
                    let goalSettled = turnGoal.isSome()
                    if (goalSettled) { meter.rebuild() }
                    let verdict = if (goalSettled) { meter.verdict() } else { meter.settleTurn(r) }
                    // 占用分子只能在结算这一刻取：本轮正文已进日志投影，
                    // 下一次用户输入一进采样即作废，不会把上一轮的数当成本轮的占用。
                    recordTurnContextOccupancy(shared, r.usage)
                    let oFlag = if (meter.over()) { "true" } else { "false" }
                    tail = ",\"cancelled\":${cFlag},\"delivered\":${r.delivered},\"text\":\"${jsonEscapeText(r.text)}\",\"finishReason\":\"${jsonEscapeText(r.finishReason)}\",\"interrupted\":${iFlag},\"settledToolCalls\":${r.settledToolCalls},\"pendingToolCalls\":${r.pendingToolCalls},\"overflow\":${turnSink.overflow()},\"dropped\":${turnSink.dropped()},\"usage\":\"${jsonEscapeText(r.usage)}\",\"usageVerdict\":\"${verdict}\",\"used\":${meter.used()},\"budget\":${meter.budgetValue()},\"over\":${oFlag}"
                    turnHandle = None
                    if (let Some(bound) <- turnComputer) { bound.close() }
                    turnComputer = None
                    turnBusy = false
                    turnGoal = None
                    if (leaseHeld) {
                        if (if (goalSettled) { GoalCheckpoint(shared, lease).checkpoint() } else { shared.flush() }) {
                            leaseHeld = false
                            lease.release()
                        } else {
                            if (goalSettled) { throw Exception("goal-settle-checkpoint-failed") }
                            getStdErr().writeln("turn-settle-flush-failed: lease retained")
                        }
                    }
                }
            }
            emit(okFrame(idText, "{\"frames\":${arr},\"turn\":${turnText},\"running\":${runningText},\"settled\":${settledText}${tail}}"))
            continue
        }
        // 提示词增强：一次独立的模型往返，请求里只有「一条指令 + 这一条草稿」。
        // 三条分支都不写会话消息（只有用量那一笔进账，它本来就该记在同一份账上），
        // 也不碰 turnBusy——所以 turn 在跑时能润色，润色在跑时桌面也停得下来。
        if (method == "prompt/enhance") {
            let draft = jsonStr(body, "draft")
            if (draft.trimAscii().size == 0) { emit(errFrame(idText, -32602, "enhance-empty-draft")); continue }
            // 顶掉在途那一笔等于让上一次点击无声消失，所以这里也挡一次，不只靠界面。
            if (let Some(h) <- enhanceHandle) {
                if (h.isRunning()) { emit(errFrame(idText, -32001, "enhance-in-flight")); continue }
            }
            // 「这次用哪颗模型」的取值顺序与 turn/start 一致：注册表默认优先，
            // 其次单路模型设置，最后环境变量。点击即定档，之后换模型只影响下一次请求。
            var configured: ModelSettingsSnapshot
            try { configured = ModelSettings.forUser().read() }
            catch (e: Exception) { emit(errFrame(idText, -32020, e.message)); continue }
            let registryView = ProviderRegistry.forUser().describe()
            var planBaseUrl = ""
            var planModel = ""
            var planRef = ""
            var planProtocol = ""
            for (p in registryView.providers) {
                if (p.id == registryView.defaultProviderId && registryView.defaultModel.size > 0) {
                    planBaseUrl = p.baseUrl
                    planModel = registryView.defaultModel
                    planRef = p.credentialRef
                    planProtocol = p.protocol
                }
            }
            let fromRegistry = planBaseUrl.size > 0
            if (fromRegistry && planProtocol != "openai-completions") {
                emit(errFrame(idText, -32016, "protocol-not-supported:${planProtocol}")); continue
            }
            let baseUrl = if (fromRegistry) { planBaseUrl } else if (configured.baseUrl.size > 0) { configured.baseUrl } else { getVariable("SACODE_PROVIDER_BASE_URL") ?? "" }
            let model = if (fromRegistry) { planModel } else if (configured.model.size > 0) { configured.model } else { getVariable("SACODE_PROVIDER_MODEL") ?? "gpt-3.5-turbo" }
            var key = ""
            if (fromRegistry) {
                key = resolveCredentialKey(planRef)
            } else if (configured.credentialRef.size > 0) {
                if (modelKeyRef == configured.credentialRef && modelKey.size > 0) { key = modelKey } else { key = resolveCredentialKey(configured.credentialRef) }
            } else {
                key = getVariable("SACODE_PROVIDER_KEY") ?? getVariable("STEPFUN_API_KEY") ?? ""
            }
            // 没配就是没配：宁可报错，也不悄悄换一颗模型顶上——用户看到的写法
            // 来自哪一家，界面永远分辨不出来，所以这里不能替他猜。
            if (baseUrl.size == 0) { emit(errFrame(idText, -32016, "model-not-configured")); continue }
            if (key.size == 0 && !baseUrl.startsWith("http://127.0.0.1:") && !baseUrl.startsWith("http://localhost:")) {
                emit(errFrame(idText, -32016, "model-credential-unavailable")); continue
            }
            var badRequest = ""
            var rawRequest = ""
            try { rawRequest = enhanceRequestJson(model, draft) } catch (e: Exception) { badRequest = e.message }
            if (badRequest.size > 0) { emit(errFrame(idText, -32602, badRequest)); continue }
            // 请求字节、凭据、端点都在起跑前冻成不可变值：这一笔认的就是点击那一刻
            // 那颗模型与那份配置，跟之后任何一次改动都无关。
            let request = rawRequest
            let enhanceKey = key
            let tk = TurnToken()
            // 增强使用独立的 90 秒读期限，容纳推理模型的首帧等待；取消仍只作用于 tk。
            let factory: () -> Provider = { => RealSseProvider(baseUrl, enhanceKey, request, tk,
                readTimeout: 90 * Duration.second) }
            enhanceHandle = Some(EnhanceRunner().start(factory, tk))
            enhanceModel = model
            if (let Some(h) <- enhanceHandle) {
                let charge = EnhanceCharge(h, shared, meter, lease)
                enhanceCharge = Some(charge); enhanceCharges.add(charge)
            }
            emit(okFrame(idText, "{\"started\":true,\"model\":\"${jsonEscapeText(model)}\"}"))
            continue
        }
        if (method == "prompt/poll") {
            var activeText = "false"
            var runningText = "false"
            var settledText = "false"
            var tail = ""
            if (let Some(h) <- enhanceHandle) {
                activeText = "true"
                let o = h.tryOutcome()
                if (o.running) {
                    runningText = "true"
                    tail = ",\"model\":\"${jsonEscapeText(enhanceModel)}\""
                } else {
                    settledText = "true"
                    let okText = if (o.ok) { "true" } else { "false" }
                    let cancelText = if (o.cancelled) { "true" } else { "false" }
                    // 增强花的 token 和轮次花的是同一份预算，所以记在同一本账上；
                    // 但轮询是幂等读，同一笔只能进账一次。
                    var verdict = "absent"
                    if (let Some(charge) <- enhanceCharge) { charge.settle(); verdict = charge.verdict }
                    let oFlag = if (meter.over()) { "true" } else { "false" }
                    tail = ",\"model\":\"${jsonEscapeText(enhanceModel)}\",\"ok\":${okText},\"cancelled\":${cancelText},\"error\":\"${jsonEscapeText(o.error)}\",\"text\":\"${jsonEscapeText(o.text)}\",\"usage\":\"${jsonEscapeText(o.usage)}\",\"finishReason\":\"${jsonEscapeText(o.finishReason)}\",\"usageVerdict\":\"${verdict}\",\"used\":${meter.used()},\"budget\":${meter.budgetValue()},\"over\":${oFlag}"
                }
            }
            emit(okFrame(idText, "{\"active\":${activeText},\"running\":${runningText},\"settled\":${settledText}${tail}}"))
            continue
        }
        if (method == "prompt/cancel") {
            // 只发取消请求，终态仍由 prompt/poll 交出；增强被作废不得牵连那一轮 turn。
            var requested = "false"
            var wasRunning = "false"
            if (let Some(h) <- enhanceHandle) {
                if (h.isRunning()) {
                    wasRunning = "true"
                    h.cancel()
                    requested = "true"
                }
            }
            emit(okFrame(idText, "{\"cancelRequested\":${requested},\"wasRunning\":${wasRunning}}"))
            continue
        }
        if (method == "workspace/git-status" || method == "workspace/git-diff") {
            try {
                let args = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
                let expectedCount = if (method == "workspace/git-status") { 2 } else { 4 }
                if (args.size() != expectedCount) { throw Exception("bad-git-arguments") }
                let session = attStr(args, "sessionId")
                let expectedDirectory = attStr(args, "directory")
                if (session != activeId) { emit(errFrame(idText, -32026, "git-session-changed")); continue }
                let target = SessionLog(p)
                if (!target.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
                let directory = SessionWorkspace(target).directory()
                if (directory.size == 0 || directory != expectedDirectory) { emit(errFrame(idText, -32026, "git-workspace-changed")); continue }
                let kind = if (method == "workspace/git-status") { "status" } else { "diff" }
                let path = if (kind == "diff") { attStr(args, "path") } else { "" }
                let scope = if (kind == "diff") { attStr(args, "scope") } else { "" }
                let result = queryWorkspaceGit(directory, kind, path, scope)
                let limited = if (result.truncated) { "true" } else { "false" }
                emit(okFrame(idText, "{\"sessionId\":\"${jsonEscapeText(activeId)}\",\"directory\":\"${jsonEscapeText(directory)}\",\"path\":\"${jsonEscapeText(path)}\",\"scope\":\"${jsonEscapeText(scope)}\",\"output\":\"${jsonEscapeText(result.output)}\",\"diagnostic\":\"${jsonEscapeText(result.diagnostic)}\",\"exitCode\":${result.exitCode},\"truncated\":${limited},\"failure\":\"${result.failure}\"}"))
            } catch (_: Exception) { emit(errFrame(idText, -32602, "bad-git-arguments")) }
            continue
        }
        if (method == "workspace/get") {
            var target = shared
            if (!leaseHeld || workspaceFault) {
                let fresh = SessionLog(p)
                if (!fresh.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
                target = fresh
            }
            let workspace = SessionWorkspace(target, fallback: canonicalize(".").toString())
            let configured = if (workspace.directory().size > 0) { "true" } else { "false" }
            let available = if (workspace.available()) { "true" } else { "false" }
            emit(okFrame(idText, "{\"sessionId\":\"${jsonEscapeText(activeId)}\",\"revision\":${workspace.revision()},\"directory\":\"${jsonEscapeText(workspace.effectiveDirectory())}\",\"configured\":${configured},\"available\":${available},\"scope\":\"session\"}"))
            continue
        }
        if (method == "workspace/files") {
            var target2 = shared
            if (!leaseHeld || workspaceFault) {
                let fresh2 = SessionLog(p)
                if (!fresh2.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
                target2 = fresh2
            }
            let ws2 = SessionWorkspace(target2, fallback: canonicalize(".").toString())
            let dir = ws2.effectiveDirectory()
            // 子目录浏览：path 是工作区内的相对路径（目录树展开用）。
            // 逐段拒绝 ".."、反斜杠与控制字符，且规范化后必须仍落在工作区内——
            // 拼上来的路径越界就当成参数错误，不把文件系统交给协议面去猜。
            var sub = jsonStr(body, "path")
            var listing = dir
            if (sub.size > 0) {
                if (sub.size > 512 || sub.contains("\\") || sub.contains("\u{0}")) {
                    emit(errFrame(idText, -32602, "bad-workspace-path")); continue
                }
                // 先整段判定再决定拒绝：for-in 里的 continue 只跳迭代，不能当请求级拒绝用。
                var badPath = false
                for (one in sub.split("/")) {
                    if (one == ".." || one == "." || one.size == 0) { badPath = true }
                }
                if (badPath) { emit(errFrame(idText, -32602, "bad-workspace-path")); continue }
                listing = dir + "/" + sub
                try {
                    let canonListing = canonicalize(listing).toString()
                    let canonDir = canonicalize(dir).toString()
                    // 前缀必须落在目录边界上：D:\ws 不能给 D:\ws2 的内容背书。
                    let inside = canonListing.startsWith(canonDir + "/") || canonListing.startsWith(canonDir + "\\")
                    if (!inside || !FileInfo(canonListing).isDirectory()) {
                        emit(errFrame(idText, -32602, "bad-workspace-path")); continue
                    }
                } catch (e: Exception) {
                    emit(errFrame(idText, -32602, "bad-workspace-path")); continue
                }
            }
            var entries = "["
            var count = 0
            try {
                var i2 = 0
                for (info in Directory.readFrom(listing)) {
                    if (count >= 200) { break }
                    let name = info.name
                    let entryDir = if (info.isDirectory()) { "true" } else { "false" }
                    var entrySize = Int64(0)
                    if (!info.isDirectory()) { entrySize = FileInfo(listing + "/" + name).size }
                    if (count > 0) { entries = entries + "," }
                    entries = entries + "{\"name\":\"${jsonEscapeText(name)}\",\"isDir\":${entryDir},\"size\":${entrySize}}"
                    count += 1
                    i2 += 1
                }
            } catch (e: Exception) {
                entries = entries + "]"
                emit(okFrame(idText, "{\"files\":${entries},\"error\":\"${jsonEscapeText(e.message)}\"}"))
                continue
            }
            entries = entries + "]"
            emit(okFrame(idText, "{\"directory\":\"${jsonEscapeText(dir)}\",\"path\":\"${jsonEscapeText(sub)}\",\"files\":${entries}}"))
            continue
        }
        if (method == "workspace/set-directory") {
            if (approvalDesk.hasOpenTickets() || inflight.count() > 0 || jsAlive) {
                emit(errFrame(idText, -32001, "session-resources-in-flight")); continue
            }
            let wanted = jsonStr(body, "directory")
            try {
                if (wanted.size == 0 || !FileInfo(canonicalize(wanted)).isDirectory()) { throw Exception("bad-workspace-directory") }
            } catch (e: Exception) {
                emit(errFrame(idText, -32602, "bad-workspace-directory")); continue
            }
            var setDirFreshLease = false
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) { emit(errFrame(idText, -32001, "already-owned")); continue }
                if (!loadForWrite(shared, meter)) { lease.release(); emit(errFrame(idText, -32002, "replay-rejected")); continue }
                leaseHeld = true
                setDirFreshLease = true
            }
            // 活动 worktree 期间拒另绑目录：绑定与实际目录只能有一个真源。
            // 必须回读日志再判——刚接手租约时内存态才是盘上那份，未接手时读到的是
            // 上一轮的状态，两条路都放行就等于允许「界面以为在主检出、实际在工作树」。
            if (worktreeBound(shared)) {
                if (setDirFreshLease) { lease.release(); leaseHeld = false }
                emit(errFrame(idText, -32001, "worktree-active-set-directory-refused")); continue
            }
            var changed = false
            try { changed = SessionWorkspace(shared).setDirectory(wanted) } catch (e: Exception) {
                emit(errFrame(idText, -32602, "bad-workspace-directory")); continue
            }
            if (!shared.flush()) { workspaceFault = true; emit(errFrame(idText, -32003, "workspace-flush-failed")); continue }
            lease.release(); leaseHeld = false
            extRt = ToolRuntime(shared, extReg, workingDirectory: sessionWorkingDirectory(shared))
            let flag = if (changed) { "true" } else { "false" }
            emit(okFrame(idText, "{\"directory\":\"${jsonEscapeText(SessionWorkspace(shared).directory())}\",\"configured\":true,\"available\":true,\"saved\":true,\"changed\":${flag}}"))
            continue
        }
        // 会话级 worktree 的六条产品方法：入口只有这一处，Git 调用与磁盘副作用全在共享核心。
        // describe 是读面（与 workspace/get 同一档：不持租约时现读盘上那份）；其余五条与
        // workspace/set-directory 同一条写流程——资源门 → 接手租约 → 重载 → 核心调用 →
        // flush → 重建手工工具运行态，让工作面立刻跟着新目录。
        if (isWorktreeMethod(method)) {
            if (isWorktreeWriteMethod(method) && (approvalDesk.hasOpenTickets() || inflight.count() > 0 || jsAlive)) {
                emit(errFrame(idText, -32001, "session-resources-in-flight")); continue
            }
            var worktreeTarget = shared
            var worktreeFreshLease = false
            if (isWorktreeWriteMethod(method)) {
                if (!leaseHeld) {
                    if (!lease.takeoverIfStale()) { emit(errFrame(idText, -32001, "already-owned")); continue }
                    if (!loadForWrite(shared, meter)) { lease.release(); emit(errFrame(idText, -32002, "replay-rejected")); continue }
                    leaseHeld = true
                    worktreeFreshLease = true
                }
            } else if (!leaseHeld) {
                let fresh = SessionLog(p)
                if (!fresh.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
                worktreeTarget = fresh
            }
            let reply = worktreeRequest(method, body, worktreeTarget)
            if (!reply.ok) {
                // 失败的那次核心调用可能已经往内存里追加过一半事件（先记绑定、再去建目录）。
                // 不回读盘上那份，下一次成功的写会把半份绑定一起 flush 出去——绑定与实际目录
                // 就此永久分叉。租约是本轮接的才归还；本来就在手的保持在手（与既有写面一致）。
                if (worktreeFreshLease) {
                    if (!worktreeTarget.load()) { workspaceFault = true; getStdErr().writeln("worktree-rollback-replay-rejected") }
                    meter.rebuild()
                    lease.release()
                    leaseHeld = false
                }
                emit(errFrame(idText, reply.code, reply.text))
                continue
            }
            if (isWorktreeWriteMethod(method)) {
                if (!shared.flush()) { workspaceFault = true; emit(errFrame(idText, -32003, "worktree-flush-failed")); continue }
                lease.release()
                leaseHeld = false
                extRt = ToolRuntime(shared, extReg, workingDirectory: sessionWorkingDirectory(shared))
            }
            emit(okFrame(idText, reply.text))
            continue
        }
        if (method == "session/create") {
            try {
                let id = catalog.create(jsonStr(body, "title"))
                emit(okFrame(idText, "{\"id\":\"${jsonEscapeText(id)}\",\"saved\":true}"))
            } catch (e: Exception) {
                emit(errFrame(idText, -32004, e.message))
            }
            continue
        }
        if (method == "session/select") {
            // 换会话时把在途的增强作废：那笔结果属于上一个会话的输入框，
            // 留着一个已经不该被应用的迟到结果，早晚会落进错的草稿里。
            if (let Some(h) <- enhanceHandle) {
                if (h.isRunning()) { h.cancel() }
            }
            enhanceHandle = None
            enhanceModel = ""
            enhanceCharge = None
            let wanted = jsonStr(body, "sessionId")
            // 未完成审批与扩展调用仍归原会话；必须由用户先结算，不能默默丢掉。
            if (approvalDesk.hasOpenTickets() || inflight.count() > 0 || jsAlive) {
                emit(errFrame(idText, -32001, "session-resources-in-flight"))
                continue
            }
            var targetPath = ""
            try { targetPath = catalog.pathFor(wanted) } catch (e: Exception) {
                emit(errFrame(idText, -32602, e.message))
                continue
            }
            let target = SessionLog(targetPath)
            if (!target.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
            if (leaseHeld) {
                if (!shared.flush()) { emit(errFrame(idText, -32003, "flush-failed")); continue }
                lease.release()
                leaseHeld = false
            }
            if (!target.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
            let indexLease = WriteLease(catalog.indexPath())
            if (!indexLease.takeoverIfStale()) {
                emit(errFrame(idText, -32001, "already-owned")); continue
            }
            let index = SessionLog(catalog.indexPath())
            if (!index.load()) {
                indexLease.release(); emit(errFrame(idText, -32002, "catalog-index-rejected")); continue
            }
            try { catalog.select(index, wanted) } catch (e: Exception) {
                indexLease.release(); emit(errFrame(idText, -32602, e.message)); continue
            }
            if (!index.flush()) {
                // 失败保留根租约，由进程退出后按已死写者规则接管；不声称切换成功。
                selectionFault = true
                emit(errFrame(idText, -32003, "selection-flush-failed")); continue
            }
            indexLease.release()
            startupFault = false
            activeId = wanted
            p = targetPath
            shared = if (p == catalog.indexPath()) { index } else { target }
            lease = WriteLease(p)
            // 手工工具运行态跟着新会话的工作目录重建：日志里的绑定就是它的相对路径基准，
            // 不重建就会拿上一份会话的目录当基准，把文件写进别的项目里。
            extRt = ToolRuntime(shared, extReg, workingDirectory: sessionWorkingDirectory(shared))
            approvalDesk = ApprovalDesk(shared)
            executionService = None
            meter = TokenMeter(shared)
            meter.rebuild()
            turnHandle = None
            turnSink = ThreadSafeDeliveryQueue(64)
            callSink = ThreadSafeDeliveryQueue(64)
            inflight = InflightCalls()
            emit(okFrame(idText, "{\"id\":\"${jsonEscapeText(activeId)}\",\"selected\":true,\"saved\":true,\"theme\":\"${SessionAppearance(shared).theme()}\"}"))
            continue
        }
        if (method == "session/catalog") {
            try {
                var items = "["
                var comma = ""
                for (item in SessionCatalog(".").list()) {
                    let current = if (item.id == activeId) { "true" } else { "false" }
                    items += comma + "{\"id\":\"${jsonEscapeText(item.id)}\",\"title\":\"${jsonEscapeText(item.title)}\",\"durable\":${item.durable},\"status\":\"${item.status}\",\"workspaceDirectory\":\"${jsonEscapeText(item.workspaceDirectory)}\",\"current\":${current}}"
                    comma = ","
                }
                items += "]"
                let root = jsonEscapeText(canonicalize(".").toString())
                emit(okFrame(idText, "{\"root\":\"${root}\",\"entries\":${items},\"source\":\"durable-log\"}"))
            } catch (e: Exception) {
                emit(errFrame(idText, -32004, "catalog-read-failed"))
            }
            continue
        }
        if (method == "appearance/get") {
            var target = shared
            if (!leaseHeld) {
                let fresh = SessionLog(p)
                if (!fresh.load()) {
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                target = fresh
            }
            let theme = SessionAppearance(target).theme()
            emit(okFrame(idText, "{\"theme\":\"${theme}\",\"scope\":\"session\"}"))
            continue
        }
        if (method == "appearance/set-theme") {
            let wanted = jsonStr(body, "theme")
            if (!SessionAppearance.validTheme(wanted)) {
                emit(errFrame(idText, -32602, "bad-theme"))
                continue
            }
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let appearance = SessionAppearance(shared)
            let changed = appearance.setTheme(wanted)
            // 保存成功必须跨过落盘屏障；失败保留写入责任，不能释放租约。
            if (!shared.flush()) {
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            let flag = if (changed) { "true" } else { "false" }
            emit(okFrame(idText, "{\"theme\":\"${appearance.theme()}\",\"scope\":\"session\",\"saved\":true,\"changed\":${flag}}"))
            continue
        }
        if (method == "usage/status") {
            if (turnGoal.isSome()) { meter.rebuild() }
            // 读数只能由计量器给出，而计量器的账来自日志：界面没有「自己算一份」的通路。
            // 没持有租约时 shared 是空的，必须先按盘上内容重算，否则刚重启的进程会报 0。
            var mv = meter
            if (!leaseHeld) {
                let mlog = SessionLog(p)
                if (mlog.load()) {
                    let rm = TokenMeter(mlog, budget: meter.budgetValue())
                    rm.rebuild()
                    mv = rm
                }
            }
            let oFlag2 = if (mv.over()) { "true" } else { "false" }
            emit(okFrame(idText, "{\"used\":${mv.used()},\"budget\":${mv.budgetValue()},\"over\":${oFlag2},\"verdict\":\"${mv.verdict()}\",\"badUsage\":${mv.badCount}}"))
            continue
        }
        if (method == "usage/set-budget") {
            if (turnGoal.isSome()) { meter.rebuild() }
            // 预算只能收紧：调大、持平、缺参数（jsonNum 回 -1）一律 applied=false，
            // 且不改当前档位——能被界面自己抬高的防额不是防额。
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let want = jsonNum(body, "budget")
            let ok2 = meter.lowerBudget(want)
            let appliedText = if (ok2) { "true" } else { "false" }
            emit(okFrame(idText, "{\"applied\":${appliedText},\"budget\":${meter.budgetValue()},\"used\":${meter.used()}}"))
            continue
        }
        if (method == "extension/host/spawn") {
            if (jsAlive) {
                emit(errFrame(idText, -32012, "js-host-already-running"))
                continue
            }
            let xp = ExtProcess(jsonStr(body, "node"), ["server.cjs"], workingDirectory: Path(jsonStr(body, "dir")))
            if (!xp.start()) {
                getStdErr().writeln("js-host-spawn-failed: ${xp.startFailure()}")
                emit(errFrame(idText, -32011, "js-host-spawn-failed"))
                continue
            }
            var hs = ""
            if (let Some(f) <- xp.initialize()) {
                hs = f
            }
            if (hs.size == 0) {
                // 握手拿不到应答：立刻强杀结算，绝不留一个没人管的子进程
                xp.kill()
                getStdErr().writeln("js-host-handshake-timeout: received=${xp.received()}")
                emit(errFrame(idText, -32011, "js-host-handshake-timeout"))
                continue
            }
            jsHost = Some(xp)
            jsAlive = true
            emit(okFrame(idText, "{\"spawned\":true,\"handshake\":${hs}}"))
            continue
        }
        if (method == "extension/host/list") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.list()
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/load") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.load(jsonStr(body, "path"))
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/call") {
            if (!jsAlive) {
                emit(errFrame(idText, -32011, "js-host-not-spawned"))
                continue
            }
            var cid = jsonNum(body, "callId")
            if (cid <= 0) {
                callSeq += 1
                cid = callSeq
            }
            // 归属在发起这一刻定死：turn 在途就记当前轮次，否则记 0（不属于任何轮）
            let owner = if (turnBusy) { turnEpoch } else { Int64(0) }
            if (!inflight.add(cid, epoch: owner)) {
                emit(errFrame(idText, -32022, "duplicate-callId"))
                continue
            }
            var sent = false
            if (let Some(xp) <- jsHost) {
                sent = xp.callAsync(cid, jsonStr(body, "name"), jsonStr(body, "text"), callSink)
            }
            if (!sent) {
                // 帧没写出去 = 这一笔根本不存在：登记表必须退回，不能留个永远等不到帧的在途项
                inflight.settle(cid)
                emit(errFrame(idText, -32013, "js-host-no-reply"))
                continue
            }
            emit(okFrame(idText, "{\"accepted\":true,\"callId\":${cid},\"epoch\":${owner},\"inflight\":${inflight.count()}}"))
            continue
        }
        if (method == "extension/host/poll") {
            // 收帧线程只往 sink 里塞，这里才是唯一动登记表的地方
            let frames = callSink.take(64)
            var arr = "["
            for (i2 in 0..frames.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += frames[i2]
            }
            arr += "]"
            for (i2 in 0..frames.size) {
                inflight.settle(jsonNum(frames[i2], "callId"))
            }
            emit(okFrame(idText, "{\"results\":${arr},\"inflight\":${inflight.count()},\"overflow\":${callSink.overflow()},\"dropped\":${callSink.dropped()}}"))
            continue
        }
        if (method == "extension/host/cancel") {
            let cid = jsonNum(body, "callId")
            if (!inflight.has(cid)) {
                // 登记表里没这一笔：要么没发过，要么结果帧已经结算过，不能说「取消成功」
                emit(okFrame(idText, "{\"cancelled\":false,\"known\":false}"))
                continue
            }
            var cf: Option<String> = None
            if (let Some(xp) <- jsHost) {
                cf = xp.cancelCall(cid)
            }
            if (let Some(fr) <- cf) {
                var done = "false"
                if (fr.contains("\"cancelled\":true")) {
                    done = "true"
                }
                emit(okFrame(idText, "{\"cancelled\":${done},\"forwarded\":${fr}}"))
            } else {
                emit(errFrame(idText, -32013, "js-host-no-reply"))
            }
            continue
        }
        if (method == "extension/host/dispose") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.dispose(jsonStr(body, "name"))
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/close") {
            if (let Some(xp) <- jsHost) {
                let rc = xp.close()
                let flag = if (xp.forcedExit()) { "true" } else { "false" }
                jsHost = None
                jsAlive = false
                emit(okFrame(idText, "{\"exit\":${rc},\"forced\":${flag},\"received\":${xp.received()},\"unsolicited\":${xp.unsolicited()},\"late\":${xp.late()}}"))
            } else {
                emit(errFrame(idText, -32011, "js-host-not-spawned"))
            }
            continue
        }
        if (isLspMethod(method)) {
            // L1：7 个 verb 共用与模型工具面同一个 router。没有语言插件时如实失败，
            // 并把 lspSymbols 的文本线索作为「非语义结果」附在 error.data 上——
            // 空结果会被读成「这个符号没有定义」，那是谎言，不发。
            let verb = lspVerbOfMethod(method)
            var target = shared
            if (!leaseHeld || workspaceFault) {
                let fresh = SessionLog(p)
                if (!fresh.load()) { emit(errFrame(idText, -32002, "replay-rejected")); continue }
                target = fresh
            }
            let workspace = SessionWorkspace(target, fallback: canonicalize(".").toString())
            let params = lspParseParams(paramsTextOf(body), verb)
            if (!params.ok) {
                emit(errFrameData(idText, -32602, "bad-lsp-params",
                    "{\"reason\":\"${jsonEscapeText(lspReasonBadArgs())}\",\"verb\":\"${jsonEscapeText(verb)}\"}"))
                continue
            }
            // 请求身份就是这条 JSON-RPC 的 id；会话身份绑当前活动会话，
            // 迟到的应答不会打到切换后的另一会话。
            let req = lspBuildRequest(activeId, idText, verb, params, workspace.effectiveDirectory(), TurnToken())
            let resp = LspRouters.sharedRouter().route(req)
            if (resp.ok) {
                emit(okFrame(idText, lspResponseJson(resp)))
            } else {
                emit(errFrameData(idText, -32030, resp.reason, lspResponseJson(resp)))
            }
            continue
        }
        emit(errFrame(idText, -32601, "method not found"))
        } catch (e: Exception) {
            emit(errFrame(idText, if (shared.isDurableFrozen()) { Int64(-32026) } else { Int64(-32099) }, e.message))
        }
    }
    // stdin EOF 不释放活任务租约；先停止当前进程拥有的执行，再确认退出事实。
    if (executionRuns.size > 0) {
            let run = executionRuns[0]
        try { run.cancel() } catch (e: Exception) { getStdErr().writeln("host-exit-execution-stop: ${e.message}") }
        try { let result = run.wait(timeoutMs: 5000); executionSettled = result.exitObserved && result.outputComplete }
        catch (e: Exception) { executionSettled = false; getStdErr().writeln("host-exit-execution-unsettled: ${e.message}; lease retained") }
    }
    teamSchedulerToken.cancel()
    if (!teamRuntime.shutdown(timeoutMs: 1000)) { getStdErr().writeln("host-exit-team-unsettled: leases retained") }
    for (charge in enhanceCharges) {
        charge.handle.cancel(); charge.handle.result()
        if (!charge.settle()) { getStdErr().writeln("host-exit-enhance-usage: ${charge.verdict}") }
    }
    // stdin 关闭时若仍有在途 turn：先取消再 join，绝不留一个「没人回答的在途请求」，
    // 且必须在线程收束之后才落盘与归还租约。
    var turnSettled = false
    if (let Some(h) <- turnHandle) {
        h.cancel()
        let r = h.result()
        let verdict = if (shared.isDurableFrozen()) { "durable-frozen" } else if (turnGoal.isSome()) { meter.rebuild(); meter.verdict() } else { meter.settleTurn(r) }
        getStdErr().writeln("host-exit-usage: verdict=${verdict} used=${meter.used()}")
        getStdErr().writeln("host-exit-settled-turn: cancelled=${r.cancelled} delivered=${r.delivered}")
        turnHandle = None
        turnBusy = false
        turnSettled = true
    }
    if (let Some(bound) <- turnComputer) { bound.close() }
    turnComputer = None
    // 退出前必须主动结算在途工具调用：先按 callId 取消（子进程立刻回一帧 cancelled），
    // 再收束收帧线程，最后才关子进程。少了第一步，这些调用的终态只能靠子进程自己
    // shutdown 时的兜底结算，会混成 host-exiting(-32002)，分不出「本端取消的」和「宿主没了」。
    var extCalls = Int64(0)
    var extFrames = Int64(0)
    var extCancelled = Int64(0)
    var jsForced = false
    if (let Some(xp) <- jsHost) {
        for (cid in inflight.list()) {
            xp.cancelCall(cid)
            extCalls += 1
        }
        extFrames = xp.joinWaiters(3000)
        let drained = callSink.take(Int64(64))
        for (i2 in 0..drained.size) {
            if (drained[i2].contains("-32021")) {
                extCancelled += 1
            }
        }
        let rc = xp.close()
        jsForced = xp.forcedExit()
        getStdErr().writeln("host-exit-settled-js-host: exit=${rc} forced=${jsForced} inflightCalls=${extCalls}")
        jsHost = None
        jsAlive = false
    }
    let jf = if (jsForced) { "true" } else { "false" }
    let ts = if (turnSettled) { "true" } else { "false" }
    let es = if (executionSettled) { "true" } else { "false" }
    // 无 id 的通知帧：调用方（Electron 主进程 / 测试）在退出前拿到一份结算账，
    // 事后能区分「在途调用被收束」和「进程直接没了」。
    emit("{\"jsonrpc\":\"2.0\",\"method\":\"host/settled\",\"params\":{\"extensionCalls\":${extCalls},\"extensionFrames\":${extFrames},\"extensionCancelled\":${extCancelled},\"jsChildForced\":${jf},\"turnSettled\":${ts},\"executionSettled\":${es}}}")
    // 干净退出前结算未 flush 的写入：落盘成功才归还租约；失败则保留租约并报警，
    // 绝不在内存态丢失后假装写提交过（fail-closed）。
    if (leaseHeld) {
        if (executionSettled && (if (turnGoal.isSome()) { GoalCheckpoint(shared, lease).checkpoint() } else { shared.flush() })) {
            lease.release()
        } else {
            getStdErr().writeln("host-exit-with-unflushed-writes: lease retained")
        }
    }
    return 0
}
