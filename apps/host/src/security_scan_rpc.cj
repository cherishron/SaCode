package host

import core.*
import std.collection.ArrayList
import stdx.encoding.json.*

// 仅接线：业务规则、报告模型与写回前置全部在 core SecurityScan 内，本文件不重写。
// 会话日志与写租约由调用方持有：扫描和报告读取都不写工作区；历史只存内存 run 表。
// 自动修复不在此落盘：draft 必须继续走 execution/review-apply，本文件不发写操作。
// private 方法不会泄露完整报告正文；freshness 与 draft 的敏感来源也不写入日志。
public class SecurityScanRpc {
    let log: SessionLog
    let activeId: String
    let workspace: String

    public init(log: SessionLog, activeId: String, workspace!: String = "") {
        this.log = log
        this.activeId = activeId
        this.workspace = if (workspace.size > 0) { workspace } else { SessionWorkspace(log).directory() }
    }

    func scan(): SecurityScan {
        return SecurityScan(SessionWorkspace(log), activeId)
    }

    func requestIdOf(args: JsonObject): String {
        return args.get("requestId").getOrThrow().asString().getValue()
    }

    public func request(method: String, body: String, id: String): Unit {
        try {
            let args = JsonValue.fromStr(paramsTextOf(body)).asObject()
            if (args.get("sessionId").getOrThrow().asString().getValue() != activeId) {
                throw Exception("scan-session-changed")
            }
            if (method == "security/describe") {
                if (args.size() != 1) { throw Exception("scan-bad-arguments") }
                emit(okFrame(id, scan().describe()))
            } else if (method == "security/scan") {
                if (args.size() != 3) { throw Exception("scan-bad-arguments") }
                let scope = ArrayList<SecurityScanFile>()
                for (row in args.get("scope").getOrThrow().asArray().getItems()) {
                    let item = row.asObject()
                    scope.add(
                        SecurityScanFile(item.get("path").getOrThrow().asString().getValue(),
                            item.get("digest").getOrThrow().asString().getValue()))
                }
                emit(okFrame(id, scan().run(scope.toArray(), requestIdOf(args))))
            } else if (method == "security/freshness") {
                if (args.size() != 2) { throw Exception("scan-bad-arguments") }
                emit(okFrame(id, scan().freshness(args.get("scanId").getOrThrow().asString().getValue())))
            } else if (method == "security/fixDraft") {
                if (args.size() != 3) { throw Exception("scan-bad-arguments") }
                let ids = ArrayList<String>()
                for (row in args.get("findingIds").getOrThrow().asArray().getItems()) { ids.add(row.asString().getValue()) }
                emit(
                    okFrame(id,
                        scan().fixDraft(args.get("scanId").getOrThrow().asString().getValue(), ids.toArray())))
            } else if (method == "security/prepareFixReview") {
                // 需要调用方的ExecutionService、AttachmentStore与ApprovalDesk去接既有审查记录；
                // 仅凭本文件不能凭空构造执行记录，缺依赖直接拒，不伪造。
                throw Exception("scan-fix-requires-execution-context")
            } else {
                throw Exception("scan-method-unknown")
            }
        } catch (e: Exception) {
            let reason = if (e.message.startsWith("scan-")) { e.message } else { "scan-unavailable" }
            emit(errFrame(id, -32003, reason))
        }
    }
}
