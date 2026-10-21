package host

import core.*
import std.collection.*
import std.fs.*
import std.sync.*
import std.time.*
import stdx.encoding.json.*

// F14 内置浏览器 Host 适配层。仅供调度方合并，main.cj 尚未分派。
//
// 边界：
// 1. 真正承载网页的是 Electron 主进程的 WebContentsView，Host 不持有页面对象、
//    不执行 JavaScript、不读取 DOM。Host 只做会话/工作区/租约/审批校验，把命令
//    以无 id 通知帧发给桌面，并记录“已请求”而非“已加载”。
// 2. 浏览器命令与 page/tool/* 分开：page/tool 操作工作台自身页面，本类操作外部网页；
//    目标身份、授权与审计不能混用。
// 3. 截图不新开读取通道：桌面把 provider envelope 交回 browser/screenshot，核心
//    materializeComputerResult 落附件仓，再以 modelToolResultData 写配对的
//    tool/result 引用；会话图片仍由 attachmentImageRead 只读已引用对象。
// 4. 写动作 click/input/scroll 必须凭 ApprovalDesk 的精确工单，工单绑定
//    browser.<action> 与 BrowserRpc.approvalArguments() 的原始参数；界面自报批准无效。
// 5. 本类不创建后台线程、不补发、不重试；桌面未执行或未回报时状态只能是
//    dispatched/unknown，不能推断成功。

let BROWSER_REQUEST_EVENT = "browser/request"
let BROWSER_RESULT_EVENT = "browser/result"
let BROWSER_CLOSE_EVENT = "browser/close"
let BROWSER_SCREENSHOT_EVENT = "browser/screenshot"
let BROWSER_DESKTOP_METHOD = "browser/desktop"

func browserNotifyDefault(method: String, params: String): Unit {
    emit(notifyFrame(method, params))
}

class BrowserCommandState {
    let commandId: String
    let action: String
    let browserId: String
    let tabId: String
    var toolName = ""
    var approvalId: Int64 = 0
    var argumentsDigest = ""
    var status = "dispatched"
    var failureKind = ""
    let attachmentIds = ArrayList<String>()
    var safeText = ""

    init(commandId: String, action: String, browserId: String, tabId: String) {
        this.commandId = commandId
        this.action = action
        this.browserId = browserId
        this.tabId = tabId
    }
}

// 一个 BrowserRpc 绑定一个真实 Host 会话写者。调用方必须在同一会话生命周期内复用实例，
// 不要把实例当作可跨会话缓存；close 只关闭浏览器视图，不释放 Host 的会话写租约。
public class BrowserRpc {
    let log: SessionLog
    let lease: WriteLease
    let desk: ApprovalDesk
    let sessionId: String
    let sessionPath: String
    let projectId: String
    let workspace: String
    let workspaceRevision: Int64
    let attachmentsDir: String
    let notify: (String, String) -> Unit
    let mtx = Mutex()
    let commands = HashMap<String, BrowserCommandState>()
    let created = HashSet<String>()
    var sequence: Int64 = 0

    public init(log: SessionLog, lease: WriteLease, desk: ApprovalDesk, sessionId: String,
        sessionPath: String, projectId: String, attachmentsDir!: String = "attachments/v1",
        notify!: (String, String) -> Unit = browserNotifyDefault) {
        if (sessionId.size == 0 || sessionId.size > 256 || projectId.size == 0 || projectId.size > 256 ||
            sessionPath.size == 0 || sessionPath.contains("\0") || attachmentsDir.size == 0 ||
            attachmentsDir.contains("\0")) {
            throw Exception("browser-bad-binding")
        }
        let source = Path(sessionPath)
        if (!source.isAbsolute() || source.fileName.size == 0) { throw Exception("browser-bad-binding") }
        let parent = canonicalize(source.parent).toString()
        this.log = log
        this.lease = lease
        this.desk = desk
        this.sessionId = sessionId
        this.sessionPath = Path(parent).join(source.fileName).toString()
        this.projectId = projectId
        this.attachmentsDir = attachmentsDir
        this.notify = notify
        let ws = SessionWorkspace(log)
        this.workspace = ws.directory()
        this.workspaceRevision = ws.revision()
        // 没有项目绑定就没有明确的浏览器目标；不允许在未知目录上建立控制面。
        if (workspace.size == 0) { throw Exception("browser-project-required") }
    }

    public static func handles(method: String): Bool {
        return method == "browser/navigate" || method == "browser/screenshot" || method == "browser/click" ||
            method == "browser/input" || method == "browser/scroll" || method == "browser/describe" ||
            method == "browser/close"
    }

    // 供桌面在 approval/ask 前计算精确参数；同一 action + params 必须得到同一字符串。
    // 只包含动作语义字段，不包含 sessionId/projectId/approvalId 等会话信封字段。
    public static func approvalArguments(action: String, params: JsonObject): String {
        let out = JsonObject()
        out.put("action", JsonString(action))
        if (action == "navigate") {
            out.put("url", JsonString(browserString(params, "url")))
        } else if (action == "click") {
            out.put("browserId", JsonString(browserString(params, "browserId")))
            out.put("tabId", JsonString(browserString(params, "tabId")))
            let ref = browserOptionalString(params, "ref") ?? ""
            if (ref.size > 0) {
                out.put("ref", JsonString(browserSafeRef(ref)))
            } else {
                let hasX = browserCopyNumber(out, params, "x")
                let hasY = browserCopyNumber(out, params, "y")
                if (!hasX || !hasY) { throw Exception("browser-bad-arguments") }
            }
        } else if (action == "input") {
            out.put("browserId", JsonString(browserString(params, "browserId")))
            out.put("tabId", JsonString(browserString(params, "tabId")))
            let text = browserString(params, "text")
            if (text.size == 0 || text.size > 16384) { throw Exception("browser-bad-arguments") }
            out.put("ref", JsonString(browserSafeRef(browserString(params, "ref"))))
            out.put("text", JsonString(text))
        } else if (action == "scroll") {
            out.put("browserId", JsonString(browserString(params, "browserId")))
            out.put("tabId", JsonString(browserString(params, "tabId")))
            let hasX = browserCopyNumber(out, params, "x")
            let hasY = browserCopyNumber(out, params, "y")
            let hasDX = browserCopyNumber(out, params, "deltaX")
            let hasDY = browserCopyNumber(out, params, "deltaY")
            if (!hasDX && !hasDY && !(hasX && hasY)) { throw Exception("browser-bad-arguments") }
        } else {
            throw Exception("browser-bad-arguments")
        }
        return out.toString()
    }

    public func requestJson(method: String, params: JsonObject, activeId: String): String {
        return synchronized(mtx) {
            if (!BrowserRpc.handles(method)) { throw Exception("browser-method-not-found") }
            browserCheckBinding(params, activeId, method != "browser/describe")
            if (method == "browser/navigate") { return browserNavigate(params) }
            if (method == "browser/screenshot") { return browserScreenshot(params) }
            if (method == "browser/click") { return browserPointerAction("click", params) }
            if (method == "browser/input") { return browserPointerAction("input", params) }
            if (method == "browser/scroll") { return browserPointerAction("scroll", params) }
            if (method == "browser/describe") { return browserDescribe(params) }
            return browserClose(params)
        }
    }

    // Host 分派合并时调用。不是本类的方法返回 false，不发协议帧。
    public func handle(method: String, body: String, idText: String, activeId: String): Bool {
        if (!BrowserRpc.handles(method)) { return false }
        try {
            let envelope = JsonValue.fromStr(body).asObject()
            let params = envelope.get("params").getOrThrow().asObject()
            emit(okFrame(idText, requestJson(method, params, activeId)))
        } catch (e: Exception) {
            let reason = browserRpcReason(e.message)
            let code: Int64 = if (browserBadArguments(reason)) {
                -32602
            } else if (reason == "browser-session-changed" || reason == "browser-project-changed" ||
                reason == "browser-workspace-changed") {
                -32024
            } else {
                -32030
            }
            emit(errFrame(idText, code, reason))
        }
        return true
    }

    func browserCheckBinding(params: JsonObject, activeId: String, writer: Bool): Unit {
        let sid = browserString(params, "sessionId")
        let pid = browserString(params, "projectId")
        if (sid.size == 0 || sid.size > 256 || pid.size == 0 || pid.size > 256) {
            throw Exception("browser-bad-arguments")
        }
        if (sid != sessionId || activeId != sessionId) { throw Exception("browser-session-changed") }
        if (pid != projectId) { throw Exception("browser-project-changed") }
        let ws = SessionWorkspace(log)
        if (ws.directory() != workspace || ws.revision() != workspaceRevision) {
            throw Exception("browser-workspace-changed")
        }
        if (writer) {
            if (log.isDurableFrozen()) { throw Exception("browser-persistence-failed") }
            if (!lease.protects(sessionPath)) { throw Exception("browser-not-writer") }
        }
    }

    func browserIdentity(): String {
        return "browser-" + sha256Hex((sessionId + ":" + projectId + ":" + workspace).toArray())[0..16]
    }

    func browserPartition(): String {
        return "persist:browser-" + sha256Hex((sessionId + ":" + projectId).toArray())[0..16]
    }

    func browserNowSeconds(): Int64 {
        return DateTime.nowUTC().toUnixTimeStamp().toSeconds()
    }

    func browserNowMillis(): Int64 {
        return DateTime.nowUTC().toUnixTimeStamp().toMilliseconds()
    }

    func browserNewCommandId(action: String): String {
        sequence += 1
        let now = browserNowMillis()
        let digest = sha256Hex((sessionId + ":" + projectId + ":" + action + ":" + now.toString() + ":" +
            sequence.toString()).toArray())
        return "browser-" + action + "-" + now.toString() + "-" + sequence.toString() + "-" + digest[0..8]
    }

    func browserResolveBrowser(params: JsonObject): String {
        let expected = browserIdentity()
        if (let Some(requested) <- browserOptionalString(params, "browserId")) {
            if (requested.size > 256) { throw Exception("browser-bad-arguments") }
            // 首次从面板进入时 browserId 只是空占位；空串不代表另一个目标。
            if (requested.size > 0 && requested != expected) { throw Exception("browser-target-mismatch") }
        }
        return expected
    }

    func browserResolveTab(params: JsonObject, required: Bool): String {
        let value = browserOptionalString(params, "tabId")
        if (let Some(tabId) <- value) {
            if (tabId.size == 0) {
                if (required) { throw Exception("browser-tab-required") }
                return "1"
            }
            return browserValidTabId(tabId)
        }
        if (required) { throw Exception("browser-tab-required") }
        return "1"
    }

    func browserNavigate(params: JsonObject): String {
        browserAllowedFields(params, ["sessionId", "projectId", "browserId", "tabId", "url", "bounds"])
        let browserId = browserResolveBrowser(params)
        let tabId = browserResolveTab(params, false)
        let url = browserSafeUrl(browserString(params, "url"))
        let bounds = browserBounds(params)
        browserDenyPlanMode("browser.navigate")
        let command = BrowserCommandState(browserNewCommandId("navigate"), "navigate", browserId, tabId)
        command.toolName = "browser.navigate"
        command.argumentsDigest = sha256Hex(url.toArray())
        // 审计只留去掉查询串/片段的地址；桌面执行需要完整地址（含查询参数）。
        let auditTarget = JsonObject()
        auditTarget.put("url", JsonString(browserAuditUrl(url)))
        let desktopTarget = JsonObject()
        desktopTarget.put("url", JsonString(url))
        browserRecordRequest(command, auditTarget)
        let create = !created.contains(browserId)
        let desktop = browserEmitCommand(command, desktopTarget, bounds, create)
        created.add(browserId)
        let out = browserBaseResponse(command)
        out.put("desktop", desktop)
        return out.toString()
    }

    func browserPointerAction(action: String, params: JsonObject): String {
        let allowed: Array<String> = if (action == "input") {
            ["sessionId", "projectId", "browserId", "tabId", "ref", "text", "approvalId"]
        } else if (action == "click") {
            ["sessionId", "projectId", "browserId", "tabId", "ref", "x", "y", "approvalId"]
        } else {
            ["sessionId", "projectId", "browserId", "tabId", "x", "y", "deltaX", "deltaY", "approvalId"]
        }
        browserAllowedFields(params, allowed)
        let browserId = browserResolveBrowser(params)
        let tabId = browserResolveTab(params, true)
        if (!browserTabOpen(browserId, tabId)) { throw Exception("browser-tab-unknown") }
        let toolName = "browser." + action
        browserDenyPlanMode(toolName)
        let auditTarget = browserActionTarget(action, params)
        let desktopTarget = browserDesktopActionTarget(action, params)
        let approvalText = BrowserRpc.approvalArguments(action, params)
        browserConsumeExact(params, toolName, approvalText)
        let command = BrowserCommandState(browserNewCommandId(action), action, browserId, tabId)
        command.toolName = toolName
        command.approvalId = browserOptionalInt(params, "approvalId") ?? Int64(0)
        command.argumentsDigest = sha256Hex(approvalText.toArray())
        browserRecordRequest(command, auditTarget)
        let desktop = browserEmitCommand(command, desktopTarget, None, false)
        let out = browserBaseResponse(command)
        out.put("desktop", desktop)
        return out.toString()
    }

    // 只接受已配对 browser.screenshot 工具调用的结果。截图是“物化完成”而非“命令已发出”，
    // 因此不先写 browser/request，避免崩溃后留下无法结算的孤儿工具调用。
    func browserScreenshot(params: JsonObject): String {
        browserAllowedFields(params, ["sessionId", "projectId", "browserId", "tabId", "toolCallId", "result"])
        let browserId = browserResolveBrowser(params)
        let tabId = browserResolveTab(params, true)
        if (!browserTabOpen(browserId, tabId)) { throw Exception("browser-tab-unknown") }
        let toolCallId = browserString(params, "toolCallId")
        if (toolCallId.size == 0 || toolCallId.size > 256) { throw Exception("browser-screenshot-tool-call-required") }
        let resultValue = params.get("result").getOrThrow()
        let resultText = if (let JsonKind.JsString <- resultValue.kind()) {
            resultValue.asString().getValue()
        } else {
            resultValue.toString()
        }
        if (resultText.size == 0 || resultText.size > 33554432) { throw Exception("browser-bad-arguments") }
        let events = log.snapshotEvents().toArray()
        if (!browserPendingScreenshotCall(events, toolCallId, tabId)) {
            throw Exception("browser-screenshot-tool-call-not-pending")
        }
        let store = AttachmentStore(attachmentsDir, log, AttachmentLimits.localBackend())
        let materialized = materializeComputerResult(resultText, Some(store))
        // 成功必须有真实物化引用；ok:true 但没有图片仍是失败，不能给模型一个空截图。
        let ok = materialized.refs.size > 0 && browserResultOk(resultText, Int64(materialized.refs.size))
        // 失败动作即使带着诊断截图也不发布引用，避免把失败画面当成可继续消费的输入。
        let published: ArrayList<AttachmentRef> = if (ok) { materialized.refs } else { ArrayList<AttachmentRef>() }
        let failureKind = if (ok) { "" } else { browserResultFailure(resultText) }
        let content = if (ok) {
            "浏览器截图已物化；附件引用 ${published.size} 个"
        } else {
            "浏览器截图失败或未产生图片；未发布图片引用"
        }
        // 先确认调用仍处于未结算状态，再写 tool/result；不能用截图抹掉旧的协议错误。
        log.append("tool/result", modelToolResultData(toolCallId, content, refs: published))
        let record = JsonObject()
        record.put("version", JsonInt(1))
        record.put("browserId", JsonString(browserId))
        record.put("tabId", JsonString(tabId))
        record.put("toolCallId", JsonString(toolCallId))
        record.put("ok", JsonBool(ok))
        record.put("failureKind", JsonString(failureKind))
        let ids = JsonArray()
        for (ref in published) { ids.add(JsonString(ref.attachmentId)) }
        record.put("attachmentIds", ids)
        record.put("at", JsonInt(browserNowSeconds()))
        log.append(BROWSER_SCREENSHOT_EVENT, record.toString())
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("browser-persistence-failed")
        }
        let out = JsonObject()
        out.put("ok", JsonBool(ok))
        out.put("status", JsonString(if (ok) { "completed" } else { "failed" }))
        out.put("browserId", JsonString(browserId))
        out.put("tabId", JsonString(tabId))
        out.put("toolCallId", JsonString(toolCallId))
        out.put("attachmentIds", ids)
        out.put("failureKind", JsonString(failureKind))
        return out.toString()
    }

    func browserDescribe(params: JsonObject): String {
        browserAllowedFields(params, ["sessionId", "projectId", "browserId", "tabId", "commandId"])
        let browserId = browserResolveBrowser(params)
        let wantedTab = browserOptionalString(params, "tabId") ?? ""
        if (wantedTab.size > 0) { browserValidTabId(wantedTab) }
        let wantedCommand = browserOptionalString(params, "commandId") ?? ""
        if (wantedCommand.size > 256) { throw Exception("browser-bad-arguments") }
        let events = log.snapshotEvents().toArray()
        let requests = HashMap<String, JsonObject>()
        let requestSeq = HashMap<String, Int64>()
        let results = HashMap<String, JsonObject>()
        let commandOrder = ArrayList<String>()
        let commandSeen = HashSet<String>()
        let tabOrder = ArrayList<String>()
        let tabUrls = HashMap<String, String>()
        var open = false
        var lastClose: Int64 = -1
        var lastScreenshot: ?JsonObject = None
        for (event in events) {
            if (event.eventType == BROWSER_REQUEST_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId) {
                        let cid = browserJsonString(obj, "commandId")
                        if (commandSeen.add(cid)) { commandOrder.add(cid) }
                        requests[cid] = obj
                        requestSeq[cid] = event.seq
                        if (browserJsonStringOr(obj, "action", "") == "navigate") {
                            let tab = browserJsonStringOr(obj, "tabId", "")
                            if (!tabUrls.contains(tab)) { tabOrder.add(tab) }
                            var auditUrl = ""
                            if (let Some(target) <- obj.get("target")) {
                                if (let JsonKind.JsObject <- target.kind()) {
                                    auditUrl = browserJsonStringOr(target.asObject(), "url", "")
                                }
                            }
                            tabUrls[tab] = auditUrl
                            open = true
                        }
                    }
                } catch (_: Exception) {}
            } else if (event.eventType == BROWSER_RESULT_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId) {
                        results[browserJsonString(obj, "commandId")] = obj
                    }
                } catch (_: Exception) {}
            } else if (event.eventType == BROWSER_CLOSE_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId) {
                        open = false
                        lastClose = event.seq
                    }
                } catch (_: Exception) {}
            } else if (event.eventType == BROWSER_SCREENSHOT_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId) { lastScreenshot = Some(obj) }
                } catch (_: Exception) {}
            }
        }
        if (wantedTab.size > 0 && !tabUrls.contains(wantedTab)) { throw Exception("browser-tab-unknown") }
        let commandArray = JsonArray()
        for (cid in commandOrder) {
            let request = requests.get(cid).getOrThrow()
            let tab = browserJsonStringOr(request, "tabId", "")
            if (wantedTab.size > 0 && tab != wantedTab) { continue }
            if (wantedCommand.size > 0 && cid != wantedCommand) { continue }
            let row = JsonObject()
            row.put("commandId", JsonString(cid))
            row.put("action", JsonString(browserJsonStringOr(request, "action", "")))
            row.put("browserId", JsonString(browserId))
            row.put("tabId", JsonString(tab))
            row.put("toolName", JsonString(browserJsonStringOr(request, "toolName", "")))
            row.put("approvalId", JsonInt(browserJsonIntOr(request, "approvalId", Int64(0))))
            row.put("argumentsDigest", JsonString(browserJsonStringOr(request, "argumentsDigest", "")))
            var status = "dispatched"
            var failure = ""
            var refs = JsonArray()
            if (let Some(result) <- results.get(cid)) {
                status = browserJsonStringOr(result, "status", "unknown")
                failure = browserJsonStringOr(result, "failureKind", "")
                if (let Some(values) <- result.get("attachmentIds")) {
                    if (let JsonKind.JsArray <- values.kind()) { refs = values.asArray() }
                }
            } else if (lastClose >= 0 && requestSeq.get(cid).getOrThrow() < lastClose) {
                status = "unknown"
                failure = "browser-close-unconfirmed"
            } else if (let Some(state) <- commands.get(cid)) {
                // 结果事件写失败时内存里仍是 unknown；不能把日志缺口显示成 dispatched。
                if (state.status != "dispatched") {
                    status = state.status
                    failure = state.failureKind
                }
            }
            row.put("status", JsonString(status))
            row.put("failureKind", JsonString(failure))
            row.put("attachmentIds", refs)
            commandArray.add(row)
        }
        if (wantedCommand.size > 0 && commandArray.size() == 0) { throw Exception("browser-command-not-found") }
        let tabs = JsonArray()
        for (tab in tabOrder) {
            if (wantedTab.size > 0 && tab != wantedTab) { continue }
            let row = JsonObject()
            row.put("tabId", JsonString(tab))
            row.put("url", JsonString(tabUrls.get(tab).getOrThrow()))
            row.put("title", JsonString(""))
            // Host 没有读取 WebContentsView，不能把“已请求”写成 running/background/stopped。
            row.put("controlState", JsonString("unknown"))
            tabs.add(row)
        }
        let view = JsonObject()
        view.put("status", JsonString(if (open) { "open-requested" } else if (lastClose >= 0) { "closed-requested" } else { "unknown" }))
        view.put("created", JsonBool(false))
        view.put("partition", JsonString(browserPartition()))
        view.put("transport", JsonString("host-notification"))
        let out = JsonObject()
        out.put("ok", JsonBool(true))
        out.put("sessionId", JsonString(sessionId))
        out.put("projectId", JsonString(projectId))
        out.put("browserId", JsonString(browserId))
        out.put("view", view)
        out.put("tabs", tabs)
        out.put("commands", commandArray)
        var shotValue: JsonValue = JsonNull()
        if (let Some(shot) <- lastScreenshot) {
            if (wantedTab.size == 0 || browserJsonStringOr(shot, "tabId", "") == wantedTab) {
                shotValue = shot
            }
        }
        out.put("lastScreenshot", shotValue)
        out.put("executorAvailable", JsonBool(false))
        return out.toString()
    }

    func browserClose(params: JsonObject): String {
        browserAllowedFields(params, ["sessionId", "projectId", "browserId", "reason"])
        let browserId = browserResolveBrowser(params)
        let reason = browserReason(params)
        let record = JsonObject()
        record.put("version", JsonInt(1))
        record.put("browserId", JsonString(browserId))
        record.put("reason", JsonString(reason))
        record.put("at", JsonInt(browserNowSeconds()))
        if (!browserViewOpen(browserId)) {
            // 已记录关闭但上次通知失败时，重试必须还能把 close 送到桌面。
            let desktop = browserCloseDesktop(browserId, record)
            let out = JsonObject()
            out.put("ok", JsonBool(true))
            out.put("closed", JsonBool(true))
            out.put("alreadyClosed", JsonBool(true))
            out.put("browserId", JsonString(browserId))
            out.put("pendingOutcome", JsonString("unknown"))
            out.put("desktop", desktop)
            return out.toString()
        }
        log.append(BROWSER_CLOSE_EVENT, record.toString())
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("browser-persistence-failed")
        }
        for ((_, command) in commands) {
            if (command.browserId == browserId && command.status == "dispatched") {
                command.status = "unknown"
                command.failureKind = "browser-close-unconfirmed"
            }
        }
        created.remove(browserId)
        let desktop = browserCloseDesktop(browserId, record)
        let out = JsonObject()
        out.put("ok", JsonBool(true))
        out.put("closed", JsonBool(true))
        out.put("alreadyClosed", JsonBool(false))
        out.put("browserId", JsonString(browserId))
        out.put("pendingOutcome", JsonString("unknown"))
        out.put("desktop", desktop)
        return out.toString()
    }

    func browserCloseDesktop(browserId: String, target: JsonObject): JsonObject {
        let desktop = JsonObject()
        desktop.put("sessionId", JsonString(sessionId))
        desktop.put("projectId", JsonString(projectId))
        desktop.put("browserId", JsonString(browserId))
        desktop.put("commandId", JsonString(browserNewCommandId("close")))
        desktop.put("action", JsonString("close"))
        desktop.put("create", JsonBool(false))
        desktop.put("partition", JsonString(browserPartition()))
        desktop.put("target", target)
        try {
            notify(BROWSER_DESKTOP_METHOD, desktop.toString())
        } catch (_: Exception) {
            throw Exception("browser-desktop-unavailable")
        }
        return desktop
    }

    func browserRecordRequest(command: BrowserCommandState, target: JsonObject): Unit {
        let record = JsonObject()
        record.put("version", JsonInt(1))
        record.put("commandId", JsonString(command.commandId))
        record.put("action", JsonString(command.action))
        record.put("browserId", JsonString(command.browserId))
        record.put("tabId", JsonString(command.tabId))
        record.put("toolName", JsonString(command.toolName))
        record.put("approvalId", JsonInt(command.approvalId))
        record.put("argumentsDigest", JsonString(command.argumentsDigest))
        record.put("target", target)
        record.put("at", JsonInt(browserNowSeconds()))
        log.append(BROWSER_REQUEST_EVENT, record.toString())
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("browser-persistence-failed")
        }
        commands[command.commandId] = command
    }

    func browserRecordResult(command: BrowserCommandState): Unit {
        let record = JsonObject()
        record.put("version", JsonInt(1))
        record.put("commandId", JsonString(command.commandId))
        record.put("action", JsonString(command.action))
        record.put("browserId", JsonString(command.browserId))
        record.put("tabId", JsonString(command.tabId))
        record.put("status", JsonString(command.status))
        record.put("failureKind", JsonString(command.failureKind))
        let ids = JsonArray()
        for (id in command.attachmentIds) { ids.add(JsonString(id)) }
        record.put("attachmentIds", ids)
        record.put("safeText", JsonString(command.safeText))
        record.put("at", JsonInt(browserNowSeconds()))
        log.append(BROWSER_RESULT_EVENT, record.toString())
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("browser-persistence-failed")
        }
    }

    func browserEmitCommand(command: BrowserCommandState, target: JsonObject,
        bounds: ?JsonObject, create: Bool): JsonObject {
        let desktop = JsonObject()
        desktop.put("sessionId", JsonString(sessionId))
        desktop.put("projectId", JsonString(projectId))
        desktop.put("browserId", JsonString(command.browserId))
        desktop.put("tabId", JsonString(command.tabId))
        desktop.put("commandId", JsonString(command.commandId))
        desktop.put("action", JsonString(command.action))
        desktop.put("create", JsonBool(create))
        desktop.put("partition", JsonString(browserPartition()))
        desktop.put("target", target)
        if (let Some(value) <- bounds) { desktop.put("bounds", value) }
        try {
            notify(BROWSER_DESKTOP_METHOD, desktop.toString())
        } catch (_: Exception) {
            command.status = "unknown"
            command.failureKind = "browser-desktop-unavailable"
            try { browserRecordResult(command) } catch (_: Exception) {}
            throw Exception("browser-desktop-unavailable")
        }
        return desktop
    }

    func browserBaseResponse(command: BrowserCommandState): JsonObject {
        let out = JsonObject()
        out.put("ok", JsonBool(true))
        out.put("status", JsonString(command.status))
        out.put("browserId", JsonString(command.browserId))
        out.put("tabId", JsonString(command.tabId))
        out.put("commandId", JsonString(command.commandId))
        // Host 只发出命令，没有观察 WebContentsView；调用方不得把 dispatched 当成功。
        out.put("confirmed", JsonBool(false))
        return out
    }

    func browserConsumeExact(params: JsonObject, toolName: String, arguments: String): Unit {
        let approvalId = browserOptionalInt(params, "approvalId") ?? Int64(0)
        if (approvalId <= 0) { throw Exception("browser-approval-required") }
        let grant = desk.consumeExactForCall(approvalId, toolName, arguments)
        if (grant == "allowed-once") { return }
        let bound = desk.toolOf(approvalId)
        if (bound.size > 0 && bound != toolName) { throw Exception("approval-tool-mismatch:${bound}") }
        if (bound == toolName && !desk.argumentsMatch(approvalId, arguments)) {
            throw Exception("approval-arguments-mismatch")
        }
        throw Exception("approval-not-granted:${desk.stateOf(approvalId)}")
    }

    func browserDenyPlanMode(toolName: String): Unit {
        if (PermissionPolicy().decide(ModeController(log).current(), toolName) == "deny") {
            throw Exception("approval-mode-denied")
        }
    }

    func browserTabOpen(browserId: String, tabId: String): Bool {
        var open = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == BROWSER_REQUEST_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId &&
                        browserJsonString(obj, "tabId") == tabId &&
                        browserJsonString(obj, "action") == "navigate") {
                        open = true
                    }
                } catch (_: Exception) {}
            } else if (event.eventType == BROWSER_CLOSE_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId) { open = false }
                } catch (_: Exception) {}
            }
        }
        return open
    }

    func browserViewOpen(browserId: String): Bool {
        var open = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == BROWSER_REQUEST_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId &&
                        browserJsonString(obj, "action") == "navigate") {
                        open = true
                    }
                } catch (_: Exception) {}
            } else if (event.eventType == BROWSER_CLOSE_EVENT) {
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (browserJsonString(obj, "browserId") == browserId) { open = false }
                } catch (_: Exception) {}
            }
        }
        return open
    }
}

// 只接受不含凭据的 HTTP(S) 地址；重定向与内网范围的逐跳复核由持有 WebContentsView
// 的桌面主进程执行，Host 不关闭 TLS 校验，也不把这里当成完整 URL 分类器。
func browserSafeUrl(value: String): String {
    if (value.size == 0 || value.size > 4096) { throw Exception("browser-bad-url") }
    if (!value.startsWith("http://") && !value.startsWith("https://")) { throw Exception("browser-bad-url") }
    for (b in value.toArray()) {
        if (b < 32 || b == 127) { throw Exception("browser-bad-url") }
    }
    var cut = value.size
    if (let Some(index) <- value.indexOf("?")) { if (index < cut) { cut = index } }
    if (let Some(index) <- value.indexOf("#")) { if (index < cut) { cut = index } }
    let withoutQuery = value[0..cut]
    let schemeEnd = withoutQuery.indexOf("://").getOrThrow()
    let authorityStart = schemeEnd + 3
    var authorityEnd = withoutQuery.size
    if (let Some(index) <- withoutQuery.indexOf("/", authorityStart)) { authorityEnd = index }
    let authority = withoutQuery[authorityStart..authorityEnd]
    if (authority.size == 0 || authority.contains("@") || authority.contains(" ") ||
        authority.contains("\t") || authority.contains("\\")) {
        throw Exception("browser-bad-url")
    }
    return value
}

func browserAuditUrl(value: String): String {
    var cut = value.size
    if (let Some(index) <- value.indexOf("?")) { if (index < cut) { cut = index } }
    if (let Some(index) <- value.indexOf("#")) { if (index < cut) { cut = index } }
    return value[0..cut]
}

func browserValidTabId(value: String): String {
    if (value.size == 0 || value.size > 8) { throw Exception("browser-bad-arguments") }
    for (b in value.toArray()) {
        if (b < 48 || b > 57) { throw Exception("browser-bad-arguments") }
    }
    if (value == "0") { throw Exception("browser-bad-arguments") }
    return value
}

func browserBounds(params: JsonObject): Option<JsonObject> {
    if (let Some(value) <- params.get("bounds")) {
        if (let JsonKind.JsObject <- value.kind()) {
            let input = value.asObject()
            if (input.size() != 4) { throw Exception("browser-bad-arguments") }
            let out = JsonObject()
            for (key in ["x", "y", "width", "height"]) {
                if (!input.containsKey(key)) { throw Exception("browser-bad-arguments") }
                let field = input.get(key).getOrThrow()
                if (let JsonKind.JsInt <- field.kind()) {
                    let number = field.asInt().getValue()
                    if (number < 0 || number > 100000) { throw Exception("browser-bad-arguments") }
                    if ((key == "width" || key == "height") && number <= 0) {
                        throw Exception("browser-bad-arguments")
                    }
                    out.put(key, JsonInt(number))
                } else if (let JsonKind.JsFloat <- field.kind()) {
                    let number = field.asFloat().getValue()
                    if (number < 0.0 || number > 100000.0) { throw Exception("browser-bad-arguments") }
                    if ((key == "width" || key == "height") && number <= 0.0) {
                        throw Exception("browser-bad-arguments")
                    }
                    out.put(key, JsonFloat(number))
                } else {
                    throw Exception("browser-bad-arguments")
                }
            }
            return Some(out)
        }
        throw Exception("browser-bad-arguments")
    }
    return None
}

func browserActionTarget(action: String, params: JsonObject): JsonObject {
    let out = JsonObject()
    out.put("action", JsonString(action))
    if (action == "input") {
        let text = browserString(params, "text")
        if (text.size == 0 || text.size > 16384) { throw Exception("browser-bad-arguments") }
        for (b in text.toArray()) { if (b == 0) { throw Exception("browser-bad-arguments") } }
        out.put("ref", JsonString(browserSafeRef(browserString(params, "ref"))))
        out.put("textBytes", JsonInt(Int64(text.size)))
        // 输入内容可能是口令或隐私；日志只留摘要，不落原文。
        out.put("textDigest", JsonString(sha256Hex(text.toArray())))
    } else if (action == "click") {
        let ref = browserOptionalString(params, "ref") ?? ""
        if (ref.size > 0) {
            out.put("ref", JsonString(browserSafeRef(ref)))
        } else {
            let hasX = browserCopyNumber(out, params, "x")
            let hasY = browserCopyNumber(out, params, "y")
            if (!hasX || !hasY) { throw Exception("browser-bad-arguments") }
        }
    } else if (action == "scroll") {
        let hasX = browserCopyNumber(out, params, "x")
        let hasY = browserCopyNumber(out, params, "y")
        let hasDX = browserCopyNumber(out, params, "deltaX")
        let hasDY = browserCopyNumber(out, params, "deltaY")
        if (!hasDX && !hasDY && !(hasX && hasY)) { throw Exception("browser-bad-arguments") }
    } else {
        throw Exception("browser-bad-arguments")
    }
    return out
}

// 桌面执行目标不落日志：输入文本、完整 URL 等只经通知/响应交给可信主进程。
func browserDesktopActionTarget(action: String, params: JsonObject): JsonObject {
    let out = JsonObject()
    out.put("action", JsonString(action))
    if (action == "input") {
        let text = browserString(params, "text")
        if (text.size == 0 || text.size > 16384) { throw Exception("browser-bad-arguments") }
        for (b in text.toArray()) { if (b == 0) { throw Exception("browser-bad-arguments") } }
        out.put("ref", JsonString(browserSafeRef(browserString(params, "ref"))))
        out.put("text", JsonString(text))
    } else if (action == "click") {
        let ref = browserOptionalString(params, "ref") ?? ""
        if (ref.size > 0) {
            out.put("ref", JsonString(browserSafeRef(ref)))
        } else {
            let hasX = browserCopyNumber(out, params, "x")
            let hasY = browserCopyNumber(out, params, "y")
            if (!hasX || !hasY) { throw Exception("browser-bad-arguments") }
        }
    } else if (action == "scroll") {
        let hasX = browserCopyNumber(out, params, "x")
        let hasY = browserCopyNumber(out, params, "y")
        let hasDX = browserCopyNumber(out, params, "deltaX")
        let hasDY = browserCopyNumber(out, params, "deltaY")
        if (!hasDX && !hasDY && !(hasX && hasY)) { throw Exception("browser-bad-arguments") }
    } else {
        throw Exception("browser-bad-arguments")
    }
    return out
}

func browserSafeRef(value: String): String {
    if (value.size == 0 || value.size > 512) { throw Exception("browser-bad-arguments") }
    for (b in value.toArray()) { if (b < 32 || b == 127) { throw Exception("browser-bad-arguments") } }
    return value
}

func browserReason(params: JsonObject): String {
    if (let Some(value) <- browserOptionalString(params, "reason")) {
        if (value == "user" || value == "session-switch" || value == "shutdown" || value == "emergency") {
            return value
        }
    }
    return "user"
}

func browserPendingScreenshotCall(events: Array<SessionEvent>, toolCallId: String, tabId: String): Bool {
    let pending = HashMap<String, String>()
    let pendingTab = HashMap<String, String>()
    for (event in events) {
        if (event.eventType == "assistant/message") {
            if (let Some(wire) <- modelWireMessage(event.data)) {
                try {
                    let obj = JsonValue.fromStr(wire).asObject()
                    if (let Some(values) <- obj.get("tool_calls")) {
                        let calls = values.asArray()
                        for (index in 0..calls.size()) {
                            let call = calls.get(index).getOrThrow().asObject()
                            let id = call.get("id").getOrThrow().asString().getValue()
                            let function = call.get("function").getOrThrow().asObject()
                            let name = function.get("name").getOrThrow().asString().getValue()
                            var argTab = ""
                            if (let Some(args) <- function.get("arguments")) {
                                if (let JsonKind.JsString <- args.kind()) {
                                    try {
                                        let parsed = JsonValue.fromStr(args.asString().getValue()).asObject()
                                        if (let Some(value) <- parsed.get("tabId")) {
                                            if (let JsonKind.JsInt <- value.kind()) {
                                                argTab = value.asInt().getValue().toString()
                                            } else if (let JsonKind.JsString <- value.kind()) {
                                                argTab = value.asString().getValue()
                                            }
                                        }
                                    } catch (_: Exception) {}
                                }
                            }
                            pending[id] = name
                            pendingTab[id] = argTab
                        }
                    }
                } catch (_: Exception) {}
            }
        } else if (event.eventType == "tool/result") {
            if (let Some(wire) <- modelWireMessage(event.data)) {
                try {
                    let obj = JsonValue.fromStr(wire).asObject()
                    let id = obj.get("tool_call_id").getOrThrow().asString().getValue()
                    pending.remove(id)
                    pendingTab.remove(id)
                } catch (_: Exception) {}
            }
        }
    }
    if (let Some(name) <- pending.get(toolCallId)) {
        if (name != "browser.screenshot") { return false }
        if (let Some(argTab) <- pendingTab.get(toolCallId)) { return argTab == tabId }
    }
    return false
}

func browserResultOk(result: String, refs: Int64): Bool {
    try {
        let obj = JsonValue.fromStr(result).asObject()
        if (let Some(value) <- obj.get("ok")) {
            // 显式 ok 必须是布尔；类型不对按失败处理，不能回退成“有图片就算成功”。
            if (let JsonKind.JsBool <- value.kind()) { return value.asBool().getValue() }
            return false
        }
    } catch (_: Exception) {}
    return refs > 0
}

func browserResultFailure(result: String): String {
    try {
        let obj = JsonValue.fromStr(result).asObject()
        if (let Some(value) <- obj.get("failureKind")) {
            let text = value.asString().getValue()
            if (text.size > 0 && text.size <= 128) {
                // 只接受稳定标识符形态，防止 provider 把路径/URL/异常正文带进日志。
                var safe = true
                for (b in text.toArray()) {
                    if (!((b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 45)) {
                        safe = false
                        break
                    }
                }
                if (safe) { return text }
            }
        }
    } catch (_: Exception) {}
    return "browser-screenshot-failed"
}

func browserJsonString(obj: JsonObject, key: String): String {
    return obj.get(key).getOrThrow().asString().getValue()
}

func browserJsonStringOr(obj: JsonObject, key: String, fallback: String): String {
    if (let Some(value) <- obj.get(key)) {
        if (let JsonKind.JsString <- value.kind()) { return value.asString().getValue() }
    }
    return fallback
}

func browserJsonIntOr(obj: JsonObject, key: String, fallback: Int64): Int64 {
    if (let Some(value) <- obj.get(key)) {
        if (let JsonKind.JsInt <- value.kind()) { return value.asInt().getValue() }
    }
    return fallback
}

func browserString(params: JsonObject, key: String): String {
    if (let Some(value) <- params.get(key)) {
        if (let JsonKind.JsString <- value.kind()) { return value.asString().getValue() }
    }
    throw Exception("browser-bad-arguments")
}

func browserOptionalString(params: JsonObject, key: String): Option<String> {
    if (let Some(value) <- params.get(key)) {
        if (let JsonKind.JsNull <- value.kind()) { return None }
        if (let JsonKind.JsString <- value.kind()) { return Some(value.asString().getValue()) }
        throw Exception("browser-bad-arguments")
    }
    return None
}

func browserOptionalInt(params: JsonObject, key: String): Option<Int64> {
    if (let Some(value) <- params.get(key)) {
        if (let JsonKind.JsInt <- value.kind()) { return Some(value.asInt().getValue()) }
        throw Exception("browser-bad-arguments")
    }
    return None
}

// 坐标/滚动量只接受 JSON number；字符串坐标会被拒绝，不能靠隐式转换混过审批参数。
func browserCopyNumber(out: JsonObject, params: JsonObject, key: String): Bool {
    if (let Some(value) <- params.get(key)) {
        if (let JsonKind.JsInt <- value.kind()) {
            out.put(key, JsonInt(value.asInt().getValue()))
            return true
        }
        if (let JsonKind.JsFloat <- value.kind()) {
            out.put(key, JsonFloat(value.asFloat().getValue()))
            return true
        }
        throw Exception("browser-bad-arguments")
    }
    return false
}

func browserAllowedFields(params: JsonObject, allowed: Array<String>): Unit {
    for ((key, _) in params.getFields()) {
        var found = false
        for (name in allowed) {
            if (key == name) { found = true; break }
        }
        if (!found) { throw Exception("browser-bad-arguments") }
    }
}

func browserBadArguments(reason: String): Bool {
    return reason == "browser-bad-arguments" || reason == "browser-bad-url" ||
        reason == "browser-approval-required" || reason == "approval-arguments-mismatch" ||
        reason == "browser-command-not-found" || reason == "browser-tab-required" ||
        reason == "browser-tab-unknown" || reason == "browser-screenshot-tool-call-required" ||
        reason == "browser-screenshot-tool-call-not-pending" || reason == "browser-target-mismatch"
}

// 只回稳定原因，不把异常里的路径、URL、输入文本或凭据回显到协议面。
func browserRpcReason(message: String): String {
    if (browserBadArguments(message)) { return message }
    for (known in ["browser-session-changed", "browser-project-changed", "browser-workspace-changed",
        "browser-not-writer", "browser-persistence-failed", "browser-desktop-unavailable",
        "browser-project-required", "browser-method-not-found", "browser-persistence-unavailable",
        "approval-mode-denied"]) {
        if (message == known) { return known }
    }
    if (message.startsWith("approval-not-granted:")) { return message }
    if (message.startsWith("approval-tool-mismatch:")) { return message }
    if (message.startsWith("browser-")) { return message }
    return "browser-bad-arguments"
}
