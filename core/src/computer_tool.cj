package core

import std.collection.ArrayList
import stdx.encoding.json.*

// 按 CUA 0.20.11 的声明暴露参数；不臆造原生数值上限。
// observationId 是本项目的观察凭据，由独立 provider 校验并消费新鲜观察。
func computerSchema(verb: String, action: Bool): String {
    let schema = JsonObject()
    schema.put("type", JsonString("object"))
    schema.put("additionalProperties", JsonBool(false))
    let properties = JsonObject()
    let required = JsonArray()
    properties.put("pid", JsonValue.fromStr(##"{"type":"integer","minimum":1}"##))
    if (verb != "windows.list") {
        properties.put("windowId", JsonValue.fromStr(##"{"type":"integer","minimum":1}"##))
        required.add(JsonString("pid"))
        required.add(JsonString("windowId"))
    }
    if (action) {
        properties.put("observationId", JsonValue.fromStr(##"{"type":"string","format":"uuid","pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"}"##))
        required.add(JsonString("observationId"))
    }
    let point = verb == "click" || verb == "double_click" || verb == "right_click" || verb == "scroll"
    let exact = verb == "type" || verb == "press_key" || verb == "hotkey"
    if (point || exact || verb == "set_value") {
        properties.put("elementToken", JsonValue.fromStr(##"{"type":"string"}"##))
    }
    if (point) {
        properties.put("x", JsonValue.fromStr(##"{"type":"number"}"##))
        properties.put("y", JsonValue.fromStr(##"{"type":"number"}"##))
        schema.put("oneOf", JsonValue.fromStr(##"[{"required":["windowId","x","y"],"not":{"required":["elementToken"]}},{"required":["elementToken"],"not":{"anyOf":[{"required":["x"]},{"required":["y"]}]}}]"##))
    } else if (exact) {
        schema.put("oneOf", JsonValue.fromStr(##"[{"required":["windowId"],"not":{"required":["elementToken"]}},{"required":["elementToken"]}]"##))
    } else if (verb == "set_value") {
        required.add(JsonString("elementToken"))
    }
    if (action && verb != "set_value") {
        properties.put("deliveryMode", JsonValue.fromStr(##"{"type":"string","enum":["background","foreground"]}"##))
    }
    match (verb) {
        case "windows.list" => properties.put("onScreenOnly", JsonValue.fromStr(##"{"type":"boolean"}"##))
        case "window.observe" =>
            properties.put("disableDiff", JsonValue.fromStr(##"{"type":"boolean","const":true}"##))
            properties.put("includeScreenshot", JsonValue.fromStr(##"{"type":"boolean"}"##))
            for (key in ["maxElements", "maxDepth"]) {
                properties.put(key, JsonValue.fromStr(##"{"type":"number"}"##))
            }
            properties.put("maxTextChars", JsonValue.fromStr(##"{"type":"number","minimum":512}"##))
        case "click" =>
            properties.put("button", JsonValue.fromStr(##"{"type":"string","enum":["left","right","middle"]}"##))
            properties.put("count", JsonValue.fromStr(##"{"type":"number"}"##))
        case "right_click" => properties.put("modifier", JsonValue.fromStr(##"{"type":"array","items":{"type":"string"}}"##))
        case "drag" =>
            for (key in ["fromX", "fromY", "toX", "toY"]) {
                properties.put(key, JsonValue.fromStr(##"{"type":"number"}"##))
                required.add(JsonString(key))
            }
            for (key in ["durationMs", "steps"]) { properties.put(key, JsonValue.fromStr(##"{"type":"number"}"##)) }
            properties.put("button", JsonValue.fromStr(##"{"type":"string","enum":["left","right","middle"]}"##))
            properties.put("modifier", JsonValue.fromStr(##"{"type":"array","items":{"type":"string"}}"##))
        case "scroll" =>
            required.add(JsonString("direction"))
            properties.put("direction", JsonValue.fromStr(##"{"type":"string","enum":["up","down","left","right"]}"##))
            properties.put("by", JsonValue.fromStr(##"{"type":"string","enum":["line","page"]}"##))
            properties.put("amount", JsonValue.fromStr(##"{"type":"number"}"##))
        case "type" =>
            required.add(JsonString("text"))
            properties.put("text", JsonValue.fromStr(##"{"type":"string"}"##))
            properties.put("delayMs", JsonValue.fromStr(##"{"type":"number"}"##))
        case "press_key" =>
            required.add(JsonString("key"))
            properties.put("key", JsonValue.fromStr(##"{"type":"string"}"##))
            properties.put("modifiers", JsonValue.fromStr(##"{"type":"array","items":{"type":"string"}}"##))
        case "hotkey" =>
            required.add(JsonString("keys"))
            properties.put("keys", JsonValue.fromStr(##"{"type":"array","items":{"type":"string"}}"##))
        case "set_value" =>
            required.add(JsonString("value"))
            properties.put("value", JsonValue.fromStr(##"{"type":"string"}"##))
        case "verify_state" =>
            required.add(JsonString("expect"))
            properties.put("expect", JsonValue.fromStr(##"{"type":"array","items":{"type":"object"}}"##))
            for (key in ["timeoutMs", "stableSamples"]) { properties.put(key, JsonValue.fromStr(##"{"type":"number"}"##)) }
            properties.put("includeScreenshot", JsonValue.fromStr(##"{"type":"boolean"}"##))
        case _ => ()
    }
    properties.put("pid", JsonValue.fromStr(##"{"type":"integer","minimum":1,"maximum":4294967295}"##))
    if (verb != "windows.list") {
        properties.put("windowId", JsonValue.fromStr(##"{"type":"integer","minimum":1,"maximum":9007199254740991}"##))
    }
    for ((key, low, high) in [("count", 1, 3), ("durationMs", 0, 10000), ("steps", 1, 200), ("amount", 1, 50), ("delayMs", 0, 10000), ("timeoutMs", 0, 10000), ("stableSamples", 1, 5), ("maxElements", 1, 100000), ("maxDepth", 1, 256), ("maxTextChars", 512, 262144)]) {
        if (properties.containsKey(key)) {
            properties.put(key, JsonValue.fromStr("{\"type\":\"integer\",\"minimum\":${low},\"maximum\":${high}}"))
        }
    }
    schema.put("properties", properties)
    schema.put("required", required)
    return schema.toString()
}

public func computerToolSpecs(): Array<ToolSpec> {
    let out = ArrayList<ToolSpec>()
    let verbs = ["windows.list", "windows.get", "window.observe", "click", "double_click", "right_click", "drag", "scroll", "type", "press_key", "hotkey", "set_value", "verify_state"]
    let descriptions = ["列出桌面窗口。", "读取指定窗口。", "观察窗口并取得新鲜观察凭据，可附截图。", "按坐标或元素凭据点击。", "按坐标或元素凭据双击。", "按坐标或元素凭据右击。", "在指定窗口拖动。", "按方向滚动。", "向精确目标输入文本。", "向精确目标发送按键。", "向精确目标发送组合键。", "设置已观察元素的值。", "验证窗口状态与稳定性。"]
    for (i in 0..verbs.size) {
        let action = i >= 3 && i < 12
        out.add(ToolSpec("computer.${verbs[i]}", descriptions[i], computerSchema(verbs[i], action), action))
    }
    return out.toArray()
}
