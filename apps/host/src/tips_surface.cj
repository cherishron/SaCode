package host

import core.*
import stdx.encoding.json.*
import std.env.*
import std.time.*

// 使用提醒的宿主面。两个读数都只在这里解析：
// 分子 = 上一次请求真实带走的 token 数（上游报的 usage），分母 = 模型注册表里的窗口；
// 渲染层没有「自己算一份占用」的通路，任一不可靠就不出容量提醒（宁可闭嘴）。

func isTipsMethod(method: String): Bool {
    return method == "tips/get" || method == "tips/startup"
        || method == "tips/after-reply" || method == "tips/set-hidden"
}

// 墙上秒：冷却窗口要跨进程比（CLI 与桌面宿主共用同一份历史），
// 单调钟换进程就没有可比性，所以这里用 UTC 时间戳。
func tipsNowSec(): Int64 {
    return DateTime.nowUTC().toUnixTimeStamp().toMilliseconds() / 1000
}

// 无障碍以主进程显式传入为准（它才知道屏幕阅读器真实状态），
// 其次是宿主启动时的环境变量；不做任何「猜一个」。
func tipsAccessibilityFromEnv(): Bool {
    return (getVariable("SACODE_ACCESSIBILITY") ?? "") == "1"
}

func tipParseCapacity(value: String): Int64 {
    // 注册表里是带后缀的字符串（"128K"/"1M"）。口径与渲染层 parseCapacity 对齐：
    // 数字 + 可选单个 k/K/m/M；小数、空串、其他字符一律判为不可靠。
    let bs = value.toArray()
    var i: Int64 = 0
    var acc: Int64 = 0
    var digits: Int64 = 0
    while (i < bs.size && bs[i] >= 48 && bs[i] <= 57) {
        acc = acc * 10 + Int64(bs[i] - 48)
        digits += 1
        i += 1
    }
    if (digits == 0) { return -1 }
    if (i == bs.size) { return acc }
    if (i != bs.size - 1) { return -1 }
    let last = bs[i]
    if (last == 107 || last == 75) { return acc * 1000 }
    if (last == 109 || last == 77) { return acc * 1000000 }
    return -1
}

func tipParseTokens(raw: String): Int64 {
    // usage 块只有上游报的数才认；空串与非数字都是「没有读数」。
    let bs = raw.toArray()
    if (bs.size == 0) { return -1 }
    var acc: Int64 = 0
    for (b in bs) {
        if (b < 48 || b > 57) { return -1 }
        acc = acc * 10 + Int64(b - 48)
    }
    return acc
}

func tipsWindowTokens(): Int64 {
    try {
        let registry = ProviderRegistry.forUser()
        let wanted = registry.activeModel()
        for (spec in registry.activeProvider().models) {
            if (spec.id == wanted) { return tipParseCapacity(spec.contextWindow) }
        }
    } catch (_: Exception) {
        return -1
    }
    return -1
}

// 回合结算时登记一次采样。fingerprint 由日志的模型可见投影算出，
// 之后新的用户/助手消息一进采样就作废——累计预算（turn/usage）永远不当占用用。
func recordTurnContextOccupancy(log: SessionLog, rawUsage: String): Unit {
    let value = tipParseTokens(rawUsage)
    if (value < 0) { return }
    recordContextOccupancy(log, value)
}

func tipsPercentOf(used: Int64, window: Int64): Int64 {
    if (used < 0 || window <= 0) { return -1 }
    return used * 100 / window
}

func tipsSurfaceRequest(method: String, body: String, idText: String, log: SessionLog): Unit {
    var accessibility = tipsAccessibilityFromEnv()
    var hidden = false
    try {
        let request = JsonValue.fromStr(body).asObject()
        if (let Some(value) <- request.get("method")) {
            if (value.asString().getValue() != method) { throw Exception("bad-tips-request") }
        } else {
            throw Exception("bad-tips-request")
        }
        if (let Some(value) <- request.get("params")) {
            let params = value.asObject()
            if (let Some(field) <- params.get("accessibility")) { accessibility = field.asBool().getValue() }
            if (method == "tips/set-hidden") {
                if (let Some(field) <- params.get("hidden")) {
                    hidden = field.asBool().getValue()
                } else {
                    throw Exception("bad-tips-request")
                }
            }
        }
    } catch (_: Exception) {
        emit(errFrame(idText, -32602, "bad-tips-params"))
        return
    }
    try {
        let tips = TipsService.forUser()
        if (method == "tips/set-hidden") {
            let changed = tips.setHidden(hidden)
            emit(okFrame(idText, "{\"hidden\":${boolText(tips.hidden())},\"saved\":true,\"changed\":${boolText(changed)}}"))
            return
        }
        if (method == "tips/startup") {
            let id = tips.startup(accessibility)
            emit(okFrame(idText, "{\"id\":\"${jsonEscapeText(id)}\",\"text\":\"${jsonEscapeText(TipsService.textFor(id))}\",\"hidden\":${boolText(tips.hidden())}}"))
            return
        }
        let used = currentContextTokens(log)
        let window = tipsWindowTokens()
        let percent = tipsPercentOf(used, window)
        if (method == "tips/get") {
            emit(okFrame(idText, "{\"hidden\":${boolText(tips.hidden())},\"used\":${used},\"window\":${window},\"percent\":${percent},\"reliable\":${boolText(percent >= 0)}}"))
            return
        }
        let id = tips.afterReply(used, window, tipsNowSec(), accessibility)
        let text = if (percent >= 0) { TipsService.contextTextFor(id, percent) } else { TipsService.textFor(id) }
        emit(okFrame(idText, "{\"id\":\"${jsonEscapeText(id)}\",\"text\":\"${jsonEscapeText(text)}\",\"percent\":${percent},\"used\":${used},\"window\":${window}}"))
    } catch (e: Exception) {
        let code: Int64 = if (e.message == "tips-already-owned") { -32001 } else { -32003 }
        emit(errFrame(idText, code, e.message))
    }
}
