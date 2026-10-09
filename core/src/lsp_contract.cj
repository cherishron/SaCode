package core

// LspResponse stub
public class LspResponse {
    public var ok: Bool = true
    public var reason: String = ""
    public var verb: String = ""
    public var payload: String = ""
}

public let lspFailBadArgs: String = "bad-args"

// LspRequest stub
public class LspRequest {
    public let session: String
    public let id: String
    public let verb: String
    public let params: String
    public let root: String
    public let token: String
    public let path: String = ""
    init(session: String, id: String, verb: String, params: String, root: String, token: String) {
        this.session = session
        this.id = id
        this.verb = verb
        this.params = params
        this.root = root
        this.token = token
    }
}

// LspParams result stub
public class LspParams {
    public let ok: Bool = true
    public let path: String = ""
    public let value: String = ""
}

public func lspParseParams(args: String, verb: String): LspParams { return LspParams() }
public func lspProcessWorkspace(): String { return "" }
public func lspBuildRequest(session: String, id: String, verb: String, params: LspParams, root: String, token: TurnToken): LspRequest {
    return LspRequest(session, id, verb, params.path, root, "")
}
public func lspResponseJson(resp: LspResponse): String { return "{\"ok\":${resp.ok}}" }
public func lspOutcomeCount(resp: LspResponse): Int64 { return 0 }
public func lspVerbNames(): Array<String> { return Array<String>(0, repeat: "") }
public func lspToolName(verb: String): String { return "lsp-${verb}" }
public func lspToolDescription(verb: String): String { return "LSP ${verb}" }
public func lspToolSchema(verb: String): String { return "{}" }

// LspRouter with route method
public class LspRouter {
    public init() {}
    public static func sharedRouter(): LspRouter { return LspRouter() }
    public func route(req: LspRequest): LspResponse {
        return LspResponse()
    }
}

public class LspRouters {
    public init() {}
    public static func sharedRouter(): LspRouter { return LspRouter() }
}