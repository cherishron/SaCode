package core

// 进程提供方只消费已通过 beginStart 持久屏障的请求，不自行授权或结算。
public interface ExecutionProcessProvider {
    func execute(request: ExecutionProcessRequest): ?ShellResult
}

public class ExecutionProcessRequest {
    public let executable: String
    public let arguments: Array<String>
    public let directory: String
    public let timeoutMs: Int64
    public let outputLimit: Int64
    public let token: TurnToken
    public let onCreated: (Int64) -> Unit
    public let onStarted: (Int64) -> Unit
    public init(executable: String, arguments: Array<String>, directory: String, timeoutMs: Int64, outputLimit: Int64,
        token: TurnToken, onCreated: (Int64) -> Unit, onStarted: (Int64) -> Unit) {
        this.executable = executable
        this.arguments = arguments
        this.directory = directory
        this.timeoutMs = timeoutMs
        this.outputLimit = outputLimit
        this.token = token
        this.onCreated = onCreated
        this.onStarted = onStarted
    }
    func runShell(executor: ShellExecutor): ?ShellResult {
        return executor.run(executable, arguments, cwd: directory, timeoutMs: timeoutMs, outputLimit: outputLimit,
            cancelled: {=> token.cancelled()}, startToken: Some(token), onCreated: onCreated, onStarted: onStarted)
    }
}
