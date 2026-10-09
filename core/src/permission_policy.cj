package core

public class PermissionPolicy {
    private static func isWriteTool(name: String): Bool {
        return name == "write" || name == "edit" || name == "bash" || name == "pwsh" || name == "run_code"
    }

    private static func buildShellAllow(cmd: String): Bool {
        let prefixes = ["npm run build", "npm run test", "npm test", "npm run lint", "npm run typecheck",
            "cargo build", "cargo test", "cargo check",
            "make", "make build", "make test",
            "go build", "go test",
            "pnpm build", "pnpm test", "yarn build", "yarn test"]
        for (p in prefixes) {
            if (cmd.startsWith(p)) { return true }
        }
        return false
    }

    private static func autoToolAllow(name: String): Bool {
        let allow = ["read", "grep", "glob", "web_fetch", "web_search", "ls", "cat", "head", "tail", "wc", "file"]
        for (a in allow) {
            if (name == a) { return true }
        }
        return false
    }

    public func decide(mode: String, toolOrCommand: String): String {
        if (mode == "plan") {
            return if (isWriteTool(toolOrCommand)) { "deny" } else { "allow" }
        }
        if (mode == "build") {
            if (!isWriteTool(toolOrCommand)) { return "allow" }
            if (toolOrCommand == "bash" || toolOrCommand == "pwsh") { return "ask" }
            // shell 命令带空格，需在调用方区分；这里只判工具名，shell 白名单由调用方传完整命令
            return "allow"
        }
        if (mode == "auto") {
            if (!isWriteTool(toolOrCommand)) { return "allow" }
            if (autoToolAllow(toolOrCommand)) { return "allow" }
            // 不在白名单的工具走模型分类器兜底（调用方实现）；这里返回 ask 让调用方决定
            return "ask"
        }
        if (mode == "yolo") {
            return "allow"
        }
        throw Exception("unknown-approval-mode")
    }
}
