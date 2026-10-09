package core

import stdx.encoding.json.*

// 计算机执行器只记录会话事实并委托提供者；已发送动作按提供者终态结算。
public class ComputerToolExecutor {
    let log: SessionLog
    let invoke: (String, String, TurnToken) -> ComputerProviderResult

    public init(log: SessionLog, invoke: (String, String, TurnToken) -> ComputerProviderResult) {
        this.log = log
        this.invoke = invoke
    }

    public func perform(verb: String, argsJson: String,
                        token!: TurnToken = TurnToken()): ComputerProviderResult {
        if (token.cancelled()) {
            return ComputerProviderResult(false, verb, "{}", "cancelled", "计算机调用前已取消")
        }
        match (verb) {
            case "windows.list" | "windows.get" | "window.observe" | "click" |
                 "double_click" | "right_click" | "drag" | "scroll" | "type" |
                 "press_key" | "hotkey" | "set_value" | "verify_state" => ()
            case _ => return ComputerProviderResult(false, verb, "{}", "bad-verb", "未知计算机操作")
        }
        try {
            JsonValue.fromStr(argsJson).asObject()
        } catch (_: Exception) {
            return ComputerProviderResult(false, verb, "{}", "invalid-args", "计算机调用参数必须是合法 JSON 对象")
        }
        if (token.cancelled()) {
            return ComputerProviderResult(false, verb, "{}", "cancelled", "计算机调用前已取消")
        }
        // 校验不重编码参数：审计嵌入原始 JSON，调用也交回同一字符串。
        log.append("computer-use/action", "{\"verb\":${JsonString(verb).toString()},\"args\":${argsJson}}")
        let result = try {
            invoke(verb, argsJson, token)
        } catch (e: Exception) {
            ComputerProviderResult(false, verb, "{}", "provider-error", e.message)
        }
        // 审计保留终态，但图像字节只经附件仓发布，不进入执行日志。
        let auditContent = computerImageSafeJson(JsonValue.fromStr(result.content)).toString()
        log.append("computer/exec", "{\"verb\":${JsonString(result.verb).toString()},\"ok\":${result.ok},\"failureKind\":${JsonString(result.failureKind).toString()},\"message\":${JsonString(result.message).toString()},\"content\":${auditContent}}")
        return result
    }
}
