package cli

import std.collection.HashMap
import std.env.*
import stdx.encoding.json.*

// 此入口仅翻译远程团队协议；不导入 Host 可执行包、不创建本地团队或会话状态。
private func teamCommandUsage(): Int64 {
    getStdErr().writeln("usage: sacode team <describe|member-create|message-send|message-broadcast|task-create|task-assign|task-claim|task-complete|member-stop> --remote <1..65535> --session <id> [参数]")
    getStdErr().writeln("参数：member-create --name --role；message-send --target --text；message-broadcast --text；task-create --title [--dependencies <JSON字符串数组>]；task-assign --task-id --member-id；task-claim --task-id；task-complete --task-id --result；member-stop --member-id。每个参数后须带值。")
    getStdErr().writeln("仅远程入口；daemon 的 team/* 接线未完成时返回真实错误，不回退本地。身份由服务端绑定，不接受客户端 actor。")
    return 64
}

func runTeamCommand(args: Array<String>): Int64 {
    if (args.size < 2 || args[0] != "team") { return teamCommandUsage() }
    // 方法与字段均固定，不接受任意 RPC、JSON 参数对象或客户端自报身份。
    let method = match (args[1]) {
        case "describe" => "team/describe"
        case "member-create" => "team/member/create"
        case "message-send" => "team/message/send"
        case "message-broadcast" => "team/message/broadcast"
        case "task-create" => "team/task/create"
        case "task-assign" => "team/task/assign"
        case "task-claim" => "team/task/claim"
        case "task-complete" => "team/task/complete"
        case "member-stop" => "team/member/stop"
        case _ => ""
    }
    if (method.size == 0) { return teamCommandUsage() }
    let fields: Array<String> = match (args[1]) {
        case "member-create" => ["name", "role"]
        case "message-send" => ["target", "text"]
        case "message-broadcast" => ["text"]
        case "task-create" => ["title"]
        case "task-assign" => ["taskId", "memberId"]
        case "task-claim" => ["taskId"]
        case "task-complete" => ["taskId", "result"]
        case "member-stop" => ["memberId"]
        case _ => []
    }
    let values = HashMap<String, String>()
    var i: Int64 = 2
    while (i < args.size) {
        if (i + 1 >= args.size) { return teamCommandUsage() }
        let key = match (args[i]) {
            case "--remote" => "remote"
            case "--session" => "teamSessionId"
            case "--name" => "name"
            case "--role" => "role"
            case "--target" => "target"
            case "--text" => "text"
            case "--title" => "title"
            case "--dependencies" => "dependencies"
            case "--task-id" => "taskId"
            case "--member-id" => "memberId"
            case "--result" => "result"
            case _ => ""
        }
        var allowed = key == "remote" || key == "teamSessionId" ||
            (args[1] == "task-create" && key == "dependencies")
        for (field in fields) { if (field == key) { allowed = true } }
        if (key.size == 0 || !allowed || values.contains(key) || args[i + 1].trimAscii().size == 0) {
            return teamCommandUsage()
        }
        values[key] = args[i + 1]
        i += 2
    }
    if (!values.contains("remote") || !values.contains("teamSessionId")) { return teamCommandUsage() }
    let portText = values["remote"]
    if (portText.size == 0 || portText.size > 5) { return teamCommandUsage() }
    var port: Int64 = 0
    for (b in portText.toArray()) {
        if (b < 48 || b > 57) { return teamCommandUsage() }
        port = port * 10 + Int64(b - 48)
    }
    if (port < 1 || port > 65535) { return teamCommandUsage() }
    let params = JsonObject()
    params.put("teamSessionId", JsonString(values["teamSessionId"]))
    for (field in fields) {
        if (!values.contains(field)) { return teamCommandUsage() }
        params.put(field, JsonString(values[field]))
    }
    if (args[1] == "task-create") {
        var dependencies = JsonArray()
        if (values.contains("dependencies")) {
            try {
                dependencies = JsonValue.fromStr(values["dependencies"]).asArray()
                for (n in 0..dependencies.size()) {
                    if (dependencies.get(n).getOrThrow().asString().getValue().trimAscii().size == 0) {
                        return teamCommandUsage()
                    }
                }
            } catch (_: Exception) { return teamCommandUsage() }
        }
        params.put("dependencies", dependencies)
    }
    // 响应信封及 error.data 全由已有 runRemote 原样输出；本端不编业务结果、不重试变更。
    let code = runRemote(["--remote", portText, "rpc", method, params.toString()])
    if (code == 1) {
        getStdErr().writeln("团队远程请求失败，请查看真实 RPC/网络错误；若 daemon 未提供 team/*，则接线未完成。本入口不提供本地团队回退。")
    }
    return code
}
