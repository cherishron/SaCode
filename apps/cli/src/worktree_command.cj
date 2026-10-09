package cli

import core.*
import std.collection.ArrayList
import std.env.*
import std.fs.*
import std.posix.chdir
import stdx.encoding.json.*

// ---------------------------------------------------------------------------
// 会话级 Worktree 的 CLI 入口（T5）。
//
// 职责边界：生命周期（建目录、建分支、绑定写日志、三重删除保护）全在共享核心
// SessionWorktree；本文件只做形态解析、路径冻结、会话归属、起轮与退出码归因。
//
// 1) --worktree 的四种形态（等号写法是唯一可靠的命名通路）：
//      --worktree                    裸标志：自动命名
//      --worktree=name               指定名称
//      --worktree=name "提示词"       指定名称 + 首轮提示词
//      --worktree=#4174              PR 编号（也接受裸 4174）
//      --worktree=https://github.com/<owner>/<repo>/pull/<N>
//    裸标志**从不吞掉下一个 token 当名称**——「--worktree 把按钮改成蓝色」里那段
//    文字只能是提示词，名称由核心生成。要命名必须用等号，这就是「等号写法必须可靠」。
//
// 2) 路径型参数在 chdir 之前按启动 cwd 转绝对（进入工作树会改进程 cwd，届时相对
//    路径会指向另一个地方）。本入口实际受理的路径型输入清单：
//      · 会话根（隐式的 "."，即启动目录）——最先冻结，catalog 与会话日志都按它解析
//      · --mcp-config <path>（含 --mcp-config=<path>）
//      · --json-file <path>（含 --json-file=<path>）
//    后两个只做到「冻结 + 逐字回显绝对路径」：本仓 CLI 至今没有 MCP 文件配置加载器，
//    也没有 --json-file 消费者（core/src/mcp*.cj 只有 McpClient/McpRegistry 这类
//    运行面，apps/cli 与 apps/host 里 grep Mcp 零命中），所以一律退 69 打 BLOCKED，
//    绝不静默忽略，也不假装读过了。
//
// 3) --worktree 与 ACP 标志互斥：**BLOCKED**。本仓三个原生入口都没有 ACP 启动标志
//    （apps/cli、apps/daemon、apps/host、apps/desktop 里 grep '--acp' 只命中
//    apps/desktop/test-support/acp-frame-probe-multi.mjs 的注释——那是驱动外部
//    ACP 二进制的探针，不是本入口的标志）。没有对手方可拦，就不写「已拦住」。
//    ACP 主机按契约走 loadSession/newSession 的 cwd 指定目录，不经这条路径。
//
// 4) remote 语义不退化成本地：--remote 时只组帧透传（见 remote.cj），绝不建目录、
//    绝不写会话日志。
//
// 退出码：0 成功；64 用法/形态非法；5 会话被他人持有；6 回放拒绝；7 落盘失败
// （此时写租约故意不归还，与 sacode call 同一档）；69 前置条件缺位（未接后端的
// 路径型参数、没配模型）；1 核心业务拒绝（名称非法、脏目录保护、独有提交保护…）。
// ---------------------------------------------------------------------------

let worktreeUsageLine = "usage: sacode --worktree[=<名称>|#<PR编号>|<github pull URL>] [--resume <会话>] [--json] [\"提示词\"]"
let prReferenceLimit: Int64 = 2147483647

// 名称形态预检：≤64 字符且只用字母/数字/._-。
// 这不是第二份「能不能建」的判定——归属、脏文件、独有提交仍由核心答。它只挡拼写级
// 错误，让 remote 通道在发帧之前就拒掉，不把注定失败的请求推给远端。
func worktreeNameShapeOk(value: String): Bool {
    if (value.size == 0 || value.size > 64) {
        return false
    }
    for (b in value.toArray()) {
        let n = Int64(b)
        let letter = (n >= 65 && n <= 90) || (n >= 97 && n <= 122)
        let digit = n >= 48 && n <= 57
        if (!letter && !digit && n != 46 && n != 95 && n != 45) {
            return false
        }
    }
    return true
}

func worktreeDigitsOnly(value: String): Bool {
    if (value.size == 0) {
        return false
    }
    for (b in value.toArray()) {
        if (b < 48 || b > 57) {
            return false
        }
    }
    return true
}

// PR 编号：允许 '#' 前缀；零与越界都判非法（非零退出，不发帧、不建目录）。
func worktreePrNumber(value: String): Option<String> {
    var body = value
    if (body.startsWith("#")) {
        body = body[1..]
    }
    if (!worktreeDigitsOnly(body)) {
        return None
    }
    var n: Int64 = 0
    for (b in body.toArray()) {
        n = n * 10 + Int64(b - 48)
        if (n > prReferenceLimit) {
            return None
        }
    }
    if (n < 1) {
        return None
    }
    return Some(body)
}

// 只认 https://github.com/<owner>/<repo>/pull/<N>。带尾斜杠、非 https、非 github
// 都不是这个形态——宁可拒掉也不替用户猜一个 remote。
func worktreePullUrl(value: String): Option<String> {
    let head = "https://github.com/"
    if (!value.startsWith(head)) {
        return None
    }
    let parts = value[head.size..].split("/")
    if (Int64(parts.size) != 4) {
        return None
    }
    if (parts[0].size == 0 || parts[1].size == 0 || parts[2] != "pull") {
        return None
    }
    if (worktreePrNumber(parts[3]).isNone()) {
        return None
    }
    return Some(value)
}

// 引用值分两类：PR 引用（编号或 URL）与工作树名称。
// 判不出来就抛 usage——绝不把陌生形态当名称交给核心猜。
class WorktreeRef {
    public let byReference: Bool
    public let value: String

    public init(byReference!: Bool, value: String) {
        this.byReference = byReference
        this.value = value
    }
}

func classifyWorktreeValue(value: String): WorktreeRef {
    if (value.size == 0) {
        throw Exception("worktree-usage:引用为空")
    }
    if (let Some(n) <- worktreePrNumber(value)) {
        return WorktreeRef(byReference: true, value: n)
    }
    if (let Some(u) <- worktreePullUrl(value)) {
        return WorktreeRef(byReference: true, value: u)
    }
    // 纯数字或带 '#' 的都是「PR 引用」这一类，哪怕编号非法也不回退成名称——
    // 否则 `--worktree=0` 会悄悄建出一个名叫 0 的工作树。
    if (worktreeDigitsOnly(value) || value.startsWith("#")) {
        throw Exception("worktree-usage:PR 编号非法 ${value}")
    }
    if (value.startsWith("-") || !worktreeNameShapeOk(value)) {
        throw Exception("worktree-usage:名称非法 ${value}")
    }
    return WorktreeRef(byReference: false, value: value)
}

// —— 启动目录冻结 ---------------------------------------------------------------
// 绝对形态一次判掉 Windows 与 POSIX：盘符前缀、前导 / 或 \（含 UNC）。
func absoluteShape(value: String): Bool {
    let bs = value.toArray()
    if (Int64(bs.size) >= 2) {
        let first = Int64(bs[0])
        let second = Int64(bs[1])
        let letter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122)
        if (letter && second == 58) {
            return true
        }
    }
    if (Int64(bs.size) >= 1) {
        let head = Int64(bs[0])
        if (head == 47 || head == 92) {
            return true
        }
    }
    return false
}

// 相对路径按启动 cwd 拼接。刻意不碰文件系统：canonicalize 对不存在的路径会抛，
// 而这里的职责恰恰是「用户给的路径哪怕还不存在，也必须先变成绝对的」。
func absoluteAt(base: String, value: String): String {
    if (absoluteShape(value)) {
        return value
    }
    if (value == "." || value == "./") {
        return base
    }
    let bs = base.toArray()
    if (Int64(bs.size) > 1) {
        let last = Int64(bs[Int64(bs.size) - 1])
        if (last == 92 || last == 47) {
            return "${base}${value}"
        }
    }
    return "${base}/${value}"
}

class PathOption {
    public let flag: String
    public let value: String

    public init(flag: String, value: String) {
        this.flag = flag
        this.value = value
    }
}

// —— 会话入口的参数解析 ---------------------------------------------------------
class CliSessionArgs {
    public var hasWorktree: Bool = false
    public var ref: Option<WorktreeRef> = None
    public var prompt: String = ""
    public var sessionId: String = ""
    public var asJson: Bool = false
    public var pathOptions: ArrayList<PathOption> = ArrayList<PathOption>()

    public init() {}

    public func nameValue(): String {
        if (let Some(r) <- ref) {
            return if (r.byReference) { "" } else { r.value }
        }
        return ""
    }

    public func referenceValue(): String {
        if (let Some(r) <- ref) {
            return if (r.byReference) { r.value } else { "" }
        }
        return ""
    }

    public func byReference(): Bool {
        if (let Some(r) <- ref) {
            return r.byReference
        }
        return false
    }
}

// 命令行里有没有「会话入口」的意图：--worktree 或 --resume 任一命中。
// 只按这两个标志路由，其余子命令一律保持既有形状。
func cliSessionRequested(args: Array<String>): Bool {
    for (a in args) {
        if (a == "--worktree" || a == "--resume" || a.startsWith("--worktree=") || a.startsWith("--resume=")) {
            return true
        }
    }
    return false
}

func requireValue(args: Array<String>, at: Int64, flag: String): String {
    if (at + 1 >= Int64(args.size)) {
        throw Exception("worktree-usage:${flag} 缺值")
    }
    let value = args[at + 1]
    if (value.size == 0 || value.startsWith("--")) {
        throw Exception("worktree-usage:${flag} 的值非法")
    }
    return value
}

// 解析 --worktree / --resume / --json / 提示词 / 路径型参数。
// 前提：已经确认不是 remote（remote 的同一形态在 remote.cj 里组帧）。
func parseCliSessionArgs(args: Array<String>, startupDir: String): CliSessionArgs {
    let out = CliSessionArgs()
    var seenWorktree = false
    var seenSession = false
    let promptParts = ArrayList<String>()
    var i: Int64 = 0
    while (i < Int64(args.size)) {
        let a = args[i]
        if (a == "--worktree") {
            // 裸标志：自动命名，且不吃后一个 token——那只能是提示词。
            if (seenWorktree) {
                throw Exception("worktree-usage:--worktree 重复")
            }
            seenWorktree = true
            out.hasWorktree = true
        } else if (a.startsWith("--worktree=")) {
            if (seenWorktree) {
                throw Exception("worktree-usage:--worktree 重复")
            }
            seenWorktree = true
            out.hasWorktree = true
            out.ref = Some(classifyWorktreeValue(a[11..]))
        } else if (a == "--json") {
            out.asJson = true
        } else if (a == "--resume") {
            if (seenSession) {
                throw Exception("worktree-usage:会话选择重复")
            }
            seenSession = true
            out.sessionId = requireValue(args, i, a)
            i += 1
        } else if (a == "--session") {
            if (seenSession) {
                throw Exception("worktree-usage:会话选择重复")
            }
            seenSession = true
            out.sessionId = requireValue(args, i, a)
            i += 1
        } else if (a.startsWith("--resume=")) {
            if (seenSession) {
                throw Exception("worktree-usage:会话选择重复")
            }
            seenSession = true
            out.sessionId = inlineOptionValue(a, 9, "--resume")
        } else if (a.startsWith("--session=")) {
            if (seenSession) {
                throw Exception("worktree-usage:会话选择重复")
            }
            seenSession = true
            out.sessionId = inlineOptionValue(a, 10, "--session")
        } else if (a == "--mcp-config" || a == "--json-file") {
            out.pathOptions.add(PathOption(a, absoluteAt(startupDir, requireValue(args, i, a))))
            i += 1
        } else if (a.startsWith("--mcp-config=")) {
            out.pathOptions.add(PathOption("--mcp-config", absoluteAt(startupDir, inlineOptionValue(a, 13, "--mcp-config"))))
        } else if (a.startsWith("--json-file=")) {
            out.pathOptions.add(PathOption("--json-file", absoluteAt(startupDir, inlineOptionValue(a, 12, "--json-file"))))
        } else if (a.startsWith("--")) {
            throw Exception("worktree-usage:未知选项 ${a}")
        } else {
            promptParts.add(a)
        }
        i += 1
    }
    if (!out.hasWorktree && out.sessionId.size == 0) {
        throw Exception("worktree-usage:--resume 或 --worktree 至少要给一个")
    }
    var joined = ""
    for (part in promptParts) {
        if (joined.size > 0) {
            joined += " "
        }
        joined += part
    }
    out.prompt = joined
    return out
}

func inlineOptionValue(token: String, cut: Int64, flag: String): String {
    let value = token[cut..]
    if (value.size == 0 || value.startsWith("--")) {
        throw Exception("worktree-usage:${flag} 的值非法")
    }
    return value
}

// —— worktree 子命令的文法（remote 通道共用这一份，不各写一遍） -----------------
// 严格形状：子命令固定集；退出动作只认 keep|remove；--discard-changes 只配 exit；
// 值最多一个；--session/--resume 只接受一次。
class WorktreeCommand {
    public let method: String
    public let name: String
    public let reference: String
    public let action: String
    public let discardChanges: Bool
    public let agentId: String
    public let sessionId: String
    public let mutating: Bool

    public init(method: String, name: String, reference: String, action: String,
        discardChanges: Bool, agentId: String, sessionId: String, mutating: Bool) {
        this.method = method
        this.name = name
        this.reference = reference
        this.action = action
        this.discardChanges = discardChanges
        this.agentId = agentId
        this.sessionId = sessionId
        this.mutating = mutating
    }

    // 冻结契约里 worktree/enter 的 name 与 reference 二选一，缺名称就是让核心自动命名。
    // remote 通道把 --session 摘在传输层，所以这里允许调用方补上生效的会话 ID。
    public func paramsJson(session: String): String {
        let effectiveSession = if (sessionId.size > 0) { sessionId } else { session }
        let obj = JsonObject()
        obj.put("sessionId", JsonString(effectiveSession))
        if (method == "worktree/enter") {
            if (reference.size > 0) {
                obj.put("reference", JsonString(reference))
            } else {
                obj.put("name", JsonString(name))
            }
        }
        if (method == "worktree/exit") {
            obj.put("action", JsonString(action))
            obj.put("discardChanges", JsonBool(discardChanges))
        }
        if (method == "worktree/agent-prepare" || method == "worktree/agent-finish") {
            obj.put("agentId", JsonString(agentId))
        }
        return obj.toString()
    }
}

func parseWorktreeCommand(verbs: Array<String>): WorktreeCommand {
    if (Int64(verbs.size) < 1) {
        throw Exception("worktree-usage:缺少子命令")
    }
    let sub = verbs[0]
    var value = ""
    var hasValue = false
    var discard = false
    var sessionId = ""
    var seenSession = false
    var i: Int64 = 1
    while (i < Int64(verbs.size)) {
        let a = verbs[i]
        if (a == "--discard-changes") {
            discard = true
        } else if (a == "--session" || a == "--resume") {
            if (seenSession) {
                throw Exception("worktree-usage:会话选择重复")
            }
            seenSession = true
            sessionId = requireValue(verbs, i, a)
            i += 1
        } else if (a.startsWith("--")) {
            throw Exception("worktree-usage:未知选项 ${a}")
        } else if (hasValue) {
            throw Exception("worktree-usage:多余的参数 ${a}")
        } else {
            value = a
            hasValue = true
        }
        i += 1
    }
    if (sub == "describe" || sub == "cleanup") {
        if (hasValue || discard) {
            throw Exception("worktree-usage:${sub} 不接受参数")
        }
        let readMethod = if (sub == "describe") { "worktree/describe" } else { "worktree/cleanup" }
        return WorktreeCommand(readMethod, "", "", "", false, "", sessionId, false)
    }
    if (sub == "enter") {
        if (!hasValue) {
            return WorktreeCommand("worktree/enter", "", "", "", false, "", sessionId, true)
        }
        let ref = classifyWorktreeValue(value)
        let enterName = if (ref.byReference) { "" } else { ref.value }
        let enterReference = if (ref.byReference) { ref.value } else { "" }
        return WorktreeCommand("worktree/enter", enterName, enterReference, "", false, "", sessionId, true)
    }
    if (sub == "exit") {
        // 冻结契约：退出动作取值只有 keep / remove。草稿里出现过的 delete 一律不认。
        if (!hasValue) {
            throw Exception("worktree-usage:exit 缺动作 keep|remove")
        }
        if (value != "keep" && value != "remove") {
            throw Exception("worktree-usage:退出动作只认 keep|remove，收到 ${value}")
        }
        return WorktreeCommand("worktree/exit", "", "", value, discard, "", sessionId, true)
    }
    if (sub == "agent-prepare" || sub == "agent-finish") {
        if (!hasValue) {
            throw Exception("worktree-usage:${sub} 缺 agent id")
        }
        if (discard) {
            throw Exception("worktree-usage:--discard-changes 只配 exit")
        }
        if (!worktreeNameShapeOk(value)) {
            throw Exception("worktree-usage:agent id 形态非法 ${value}")
        }
        return WorktreeCommand("worktree/${sub}", "", "", "", false, value, sessionId, sub == "agent-prepare")
    }
    throw Exception("worktree-usage:未知子命令 ${sub}")
}

// —— 会话归属 -------------------------------------------------------------------
// 会话按工作目录归属：根永远取启动目录（chdir 之前冻结的那一份）。于是 --worktree
// 只改「会话的有效目录」，不会把会话日志搬进工作树、也不会开出第二个会话库。
class ResolvedSession {
    public let id: String
    public let path: String

    public init(id: String, path: String) {
        this.id = id
        this.path = path
    }
}

func resolveSession(catalogRoot: String, sessionId: String): ResolvedSession {
    let catalog = SessionCatalog(catalogRoot)
    let id = if (sessionId.size > 0) { sessionId } else { catalog.selectedId() }
    return ResolvedSession(id, catalog.pathFor(id))
}

func acquireLease(session: ResolvedSession): WriteLease {
    let owned = WriteLease(session.path)
    if (!owned.takeoverIfStale()) {
        throw Exception(if (owned.held()) { "already-owned" } else { "lease-acquire-failed:${owned.acquisitionFailure()}" })
    }
    return owned
}

// 会话句柄：日志实例与叠在它上面的工作树视图。工作树缺绑定时回落到会话有效目录，
// 有效目录又回落到启动目录——这条回落链就是「会话按工作目录归属」的实现形状。
class SessionHandle {
    public let log: SessionLog
    public let worktree: SessionWorktree

    public init(log: SessionLog, worktree: SessionWorktree) {
        this.log = log
        this.worktree = worktree
    }
}

func loadSession(session: ResolvedSession, startupDir: String): SessionHandle {
    let log = SessionLog(session.path)
    if (!log.load()) {
        throw Exception("replay-rejected")
    }
    let workspace = SessionWorkspace(log, fallback: startupDir)
    return SessionHandle(log, SessionWorktree(log, fallback: workspace.effectiveDirectory()))
}

func settleSession(log: SessionLog, lease: WriteLease): Unit {
    // 落盘失败时故意留着租约：内存态不能冒充已提交的事实（与 sacode call 同一档）。
    if (!log.flush()) {
        throw Exception("flush-failed")
    }
    lease.release()
}

// —— 模型前置条件 ---------------------------------------------------------------
// 起轮与 sacode realstream 同源：只吃 SACODE_PROVIDER_* 这组环境变量。
// 没配就跑不出真轮次，宁可退 69 也不合成一条假回复。
class ProviderConfig {
    public let baseUrl: String
    public let key: String
    public let model: String

    public init(baseUrl: String, key: String, model: String) {
        this.baseUrl = baseUrl
        this.key = key
        this.model = model
    }
}

func providerConfig(): ProviderConfig {
    let baseUrl = getVariable("SACODE_PROVIDER_BASE_URL") ?? ""
    let key = getVariable("SACODE_PROVIDER_KEY") ?? (getVariable("STEPFUN_API_KEY") ?? "")
    let model = getVariable("SACODE_PROVIDER_MODEL") ?? "gpt-3.5-turbo"
    return ProviderConfig(baseUrl, key, model)
}

func worktreeExitCode(message: String): Int64 {
    if (message.startsWith("worktree-usage") || message.startsWith("unknown-session")) {
        return Int64(64)
    }
    if (message.startsWith("worktree-not-wired")) {
        return Int64(69)
    }
    if (message == "already-owned" || message.startsWith("lease-acquire-failed")) {
        return Int64(5)
    }
    if (message == "replay-rejected") {
        return Int64(6)
    }
    if (message == "flush-failed") {
        return Int64(7)
    }
    return Int64(1)
}

func reportWorktreeFailure(e: Exception): Int64 {
    let code = worktreeExitCode(e.message)
    if (code == 64) {
        getStdErr().writeln(worktreeUsageLine)
    }
    getStdErr().writeln("worktree: ${e.message}")
    return code
}

// —— 本地 worktree 子命令：接真目录 ---------------------------------------------
func runWorktreeCommand(args: Array<String>): Int64 {
    var lease: Option<WriteLease> = None
    var held = false
    try {
        let startupDir = canonicalize(".").toString()
        let verbs = sliceFrom(args, 1)
        let command = parseWorktreeCommand(verbs)
        let session = resolveSession(startupDir, command.sessionId)
        let log = SessionLog(session.path)
        if (command.mutating) {
            let owned = acquireLease(session)
            lease = Some(owned)
            held = true
        }
        if (!log.load()) {
            if (held) {
                if (let Some(owned) <- lease) { owned.release() }
                held = false
            }
            throw Exception("replay-rejected")
        }
        let workspace = SessionWorkspace(log, fallback: startupDir)
        let worktree = SessionWorktree(log, fallback: workspace.effectiveDirectory())
        var result = ""
        if (command.method == "worktree/enter") {
            let directory = if (command.reference.size > 0) {
                worktree.enterPullRequest(command.reference)
            } else {
                worktree.enter(command.name)
            }
            let obj = JsonObject()
            let shownName = if (command.reference.size > 0) { command.reference } else { worktree.name() }
            obj.put("name", JsonString(shownName))
            obj.put("branch", JsonString(worktree.branch()))
            obj.put("directory", JsonString(directory))
            result = obj.toString()
        } else if (command.method == "worktree/describe") {
            result = worktree.describe()
        } else if (command.method == "worktree/exit") {
            result = worktree.exit(command.action, discardChanges: command.discardChanges)
        } else if (command.method == "worktree/agent-prepare") {
            let obj = JsonObject()
            obj.put("directory", JsonString(worktree.prepareAgent(command.agentId)))
            // 这是目录与账本生命周期，不是子代理执行器：没有真子进程起来就如实写 false。
            obj.put("executorStarted", JsonBool(false))
            result = obj.toString()
        } else if (command.method == "worktree/agent-finish") {
            result = worktree.finishAgent(command.agentId)
        } else {
            let obj = JsonObject()
            obj.put("cleaned", JsonInt(worktree.cleanupAgents()))
            result = obj.toString()
        }
        if (command.mutating) {
            if (let Some(owned) <- lease) {
                settleSession(log, owned)
                held = false
            }
        }
        println(result)
        getStdOut().flush()
        return 0
    } catch (e: Exception) {
        if (held) {
            if (let Some(owned) <- lease) { owned.release() }
        }
        return reportWorktreeFailure(e)
    }
}

func sliceFrom(args: Array<String>, from: Int64): Array<String> {
    let out = ArrayList<String>()
    var i: Int64 = from
    while (i < Int64(args.size)) {
        out.add(args[i])
        i += 1
    }
    return out.toArray()
}

// —— 会话入口：--worktree 进真目录并起真轮；--resume 只恢复归属不切 cwd ----------
// 顺序是合同的一部分：解析 → 冻结路径 → 校验前置（未接后端 / 没配模型在这里就退）
// → 才允许核心建目录 → chdir → 起轮 → 落盘 → 归还租约。
// 前面任一步失败都不会留下半成品目录。建目录之后失败（例如 chdir 失败）不回滚工作树：
// 那是已完成的绑定，而删除本身受三重保护——拿删除当回滚等于绕过保护。
func runCliSession(args: Array<String>): Int64 {
    var lease: Option<WriteLease> = None
    var held = false
    try {
        let startupDir = canonicalize(".").toString()
        let parsed = parseCliSessionArgs(args, startupDir)
        // 路径型参数已按启动 cwd 冻结；后端没接就点名回显，绝不静默忽略。
        if (Int64(parsed.pathOptions.size) > 0) {
            var listed = ""
            for (opt in parsed.pathOptions) {
                if (listed.size > 0) {
                    listed += ","
                }
                listed += "${opt.flag}=${opt.value}"
            }
            throw Exception("worktree-not-wired BLOCKED: 路径已按启动目录冻结(${listed})，但本入口还没有 --mcp-config/--json-file 后端")
        }
        if (parsed.prompt.size == 0) {
            throw Exception("worktree-usage:缺少提示词")
        }
        let provider = providerConfig()
        if (provider.baseUrl.size == 0) {
            throw Exception("worktree-not-wired BLOCKED: 没有配置模型（SACODE_PROVIDER_BASE_URL 未设），不起假轮次")
        }
        let session = resolveSession(startupDir, parsed.sessionId)
        let owned = acquireLease(session)
        lease = Some(owned)
        held = true
        let pair = loadSession(session, startupDir)
        let log = pair.log
        let worktree = pair.worktree
        let beforeDirectory = worktree.directory()
        var prompt = parsed.prompt
        if (parsed.hasWorktree) {
            let entered = if (parsed.byReference()) {
                worktree.enterPullRequest(parsed.referenceValue())
            } else {
                worktree.enter(parsed.nameValue())
            }
            // --resume 与 --worktree 同时给：以后者为准，且必须把覆盖说出来。
            if (parsed.sessionId.size > 0 && beforeDirectory.size > 0 && beforeDirectory != entered) {
                getStdErr().writeln("worktree\t--worktree 覆盖了 --resume ${session.id} 的目录 from=${beforeDirectory} to=${entered}")
                getStdErr().flush()
                prompt = "${parsed.prompt}（注意：--resume 的目录已被 --worktree 覆盖为 ${entered}）"
            }
            // 只有启动 --worktree 才切进程 cwd，且必须在首次模型交互之前；恢复绑定不切。
            // Cangjie 1.1.3 的 std.env 只有 getWorkingDirectory()，改 cwd 的唯一有文档
            // 通路是 std.posix.chdir（官方标注 deprecated，但 Windows 目标在支持面上）。
            if (chdir(entered) != 0) {
                throw Exception("worktree-chdir-failed:${entered}")
            }
        }
        // 首次起轮前补上系统提示：与 sacode seed / 宿主 task/start 同一做法——
        // 工具清单出自 builtinTools() 这一份注册表，两个入口因此看到同一句话。
        var hasSystemMessage = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == "system/message") { hasSystemMessage = true }
        }
        if (!hasSystemMessage) {
            log.append("system/message", SystemPromptBuilder(builtinTools()).build())
        }
        log.append("user/message", prompt)
        let token = TurnToken()
        let body = modelRequestJson(provider.model, log.snapshotEvents().toArray())
        let turn = TurnLoop().run(RealSseProvider(provider.baseUrl, provider.key, body, token), token, log, DeliveryQueue(8))
        settleSession(log, owned)
        held = false
        let obj = JsonObject()
        obj.put("session", JsonString(session.id))
        obj.put("log", JsonString(session.path))
        obj.put("directory", JsonString(worktree.directory()))
        obj.put("originalDirectory", JsonString(worktree.originalDirectory()))
        obj.put("branch", JsonString(worktree.branch()))
        obj.put("name", JsonString(worktree.name()))
        obj.put("cwd", JsonString(getWorkingDirectory().toString()))
        obj.put("delivered", JsonInt(turn.delivered))
        obj.put("finishReason", JsonString(turn.finishReason))
        obj.put("reply", JsonString(turn.text))
        if (parsed.asJson) {
            println(obj.toString())
        } else {
            println("session\t${session.id}")
            println("log\t${session.path}")
            println("worktree\tname=${worktree.name()}\tbranch=${worktree.branch()}\tdir=${worktree.directory()}\tcwd=${getWorkingDirectory().toString()}")
            println("turn\tdelivered=${turn.delivered}\tfinish=${turn.finishReason}")
            println("reply\t${turn.text}")
        }
        getStdOut().flush()
        // 没拿到终态原因就是没收束：日志已经写下事实，但退出码必须说「这一轮没跑完」，
        // 不能把 interrupted/取消报成成功（与 sacode call 按失败族分档同一条规矩）。
        if (turn.cancelled || turn.interrupted || turn.finishReason.size == 0) {
            getStdErr().writeln("worktree: 轮次未收束 cancelled=${turn.cancelled} interrupted=${turn.interrupted}")
            return Int64(8)
        }
        return 0
    } catch (e: Exception) {
        if (held) {
            if (let Some(owned) <- lease) { owned.release() }
        }
        return reportWorktreeFailure(e)
    }
}
