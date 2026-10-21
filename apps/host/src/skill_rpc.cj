package host

import core.*
import stdx.encoding.json.*

// 技能只读适配层：列表与正文都从 SkillRegistry 读取，不解析、不缓存、不写文件。
// 会话归属由调用方在分派前核对；本类只接受 params 里的 name，不接受路径。
public class SkillRpc {
    let registry: SkillRegistry

    public init(log: SessionLog, workingDirectory!: String = "") {
        registry = SkillRegistry(log)
        let dir = SessionWorkspace(log, fallback: workingDirectory).effectiveDirectory()
        // 空目录不注册 provider：其 layers() 会把 projectRoot 拼成 "/.sa-code/skills"，
        // 等于去扫盘根。无工作区时返回空清单，而不是越界读。
        if (dir.size > 0) {
            registry.registerProvider(FilesystemSkillProvider(dir))
        }
    }

    // 可信装配方注入已就绪的注册表（测试或复用 ToolRuntime 的实例）。
    public init(registry: SkillRegistry) {
        this.registry = registry
    }

    public static func handles(method: String): Bool {
        return method == "skill/list" || method == "skill/get"
    }

    func summaryJson(summary: SkillSummary): JsonObject {
        let obj = JsonObject()
        obj.put("name", JsonString(summary.name))
        obj.put("description", JsonString(summary.description))
        obj.put("whenToUse", JsonString(summary.whenToUse))
        return obj
    }

    // params 是拆出的参数对象文本；返回值是 result JSON，由调用方封帧。
    public func dispatch(method: String, params: String): String {
        if (!SkillRpc.handles(method)) { throw Exception("skill-method-not-found") }
        var args: JsonObject
        try { args = JsonValue.fromStr(params).asObject() }
        catch (_: Exception) { throw Exception("skill-bad-arguments") }
        if (method == "skill/list") {
            if (args.size() > 1) { throw Exception("skill-bad-arguments") }
            let out = JsonArray()
            for (summary in registry.listSummaries()) {
                out.add(summaryJson(summary))
            }
            return out.toString()
        }
        if (args.size() != 1) { throw Exception("skill-bad-arguments") }
        var name = ""
        try { name = args.get("name").getOrThrow().asString().getValue() }
        catch (_: Exception) { throw Exception("skill-bad-arguments") }
        if (name.trimAscii().size == 0 || name.size > 128 || name.contains("\u{0}")) {
            throw Exception("skill-bad-arguments")
        }
        if (let Some(definition) <- registry.getSkill(name)) {
            let obj = summaryJson(definition.summary)
            obj.put("content", JsonString(definition.content))
            return obj.toString()
        }
        throw Exception("skill-not-found")
    }

    // 与现有 Host request 入口同形：body 是完整 JSON-RPC 请求，idText 是已解析的 id。
    // 未声明的方法返回 false，由调度方继续分派，不吞别的方法。
    public func request(method: String, body: String, idText: String): Bool {
        if (!SkillRpc.handles(method)) { return false }
        try {
            let params: String
            try {
                params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject().toString()
            } catch (_: Exception) {
                throw Exception("skill-bad-arguments")
            }
            emit(okFrame(idText, dispatch(method, params)))
        } catch (e: Exception) {
            let reason = if (e.message.startsWith("skill-")) { e.message } else { "skill-unavailable" }
            emit(errFrame(idText, if (reason == "skill-bad-arguments") { -32602 } else { -32003 }, reason))
        }
        return true
    }
}
