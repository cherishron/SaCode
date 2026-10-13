package core

public class PermissionPolicy {
    private static func isWriteTool(name: String): Bool {
        return name == "write" || name == "edit" || name == "bash" || name == "pwsh" || name == "run_code"
    }

    private static func autoToolAllow(name: String): Bool {
        // LSP rename仅返回变更预览，真正写入仍走F08审查。
        let allow = ["read", "grep", "glob", "web_fetch", "web_search", "ls", "cat", "head", "tail", "wc", "file",
            "lsp_define", "lsp_lookup", "lsp_references", "lsp_implementation", "lsp_call_hierarchy", "lsp_diagnostics", "lsp_rename"]
        for (a in allow) {
            if (name == a) { return true }
        }
        return false
    }

    public func decide(mode: String, toolOrCommand: String): String {
        if (mode == "plan") {
            return if (autoToolAllow(toolOrCommand)) { "allow" } else { "deny" }
        }
        if (mode == "build") {
            if (!isWriteTool(toolOrCommand)) { return if (autoToolAllow(toolOrCommand)) { "allow" } else { "ask" } }
            if (toolOrCommand == "bash" || toolOrCommand == "pwsh") { return "ask" }
            // 本层只判工具名；shell 仍按上一分支返回 ask，不按命令前缀绕过审批。
            return "allow"
        }
        if (mode == "auto") {
            if (!isWriteTool(toolOrCommand)) { return if (autoToolAllow(toolOrCommand)) { "allow" } else { "ask" } }
            if (autoToolAllow(toolOrCommand)) { return "allow" }
            // 不在白名单的工具走模型分类器兜底（调用方实现）；这里返回 ask 让调用方决定
            return "ask"
        }
        if (mode == "yolo") {
            return if (isWriteTool(toolOrCommand) || autoToolAllow(toolOrCommand)) { "allow" } else { "ask" }
        }
        throw Exception("unknown-approval-mode")
    }
}
