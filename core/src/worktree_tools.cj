package core

import stdx.encoding.json.*

// 会话级 worktree 的模型声明面与执行面（计划 T3）。名字、参数、动作取值一律来自
// docs/superpowers/plans/2026-10-08-session-worktree.md 的「冻结契约」：
// enter_worktree / exit_worktree；退出动作是闭集 keep|remove（草稿里的 delete 不作数）；
// discard_changes 是可选布尔；成功载荷是 SessionWorktree.describe() 的那八个字段。
//
// 三条不留口子的规矩：
// 1) 触发口径。描述文案是模型唯一读得到的约束，而 SystemPromptBuilder 就是把注册表
//    逐条投影进系统提示——所以「只有用户显式提到 worktree 才可调用」写在这一份里，
//    不摊给各入口自己抄一遍。
// 2) 审批。exit_worktree 整条 needsApproval=true：keep 会把本会话后续所有工具的地基
//    挪回原始检出，remove 还要删目录。core 的免审批档只有一个形状——入口不发工单
//    （approval 回调回 0），这种调用在 executeWithApproval 的工单段就被拒、连执行器
//    都到不了；这里不加第二种审批，也不给任何档位留绕过位。
// 3) 不吹没跑通的能力。SessionWorktree.prepareAgent / finishAgent / cleanupAgents 只
//    到核心与协议面；SubagentLedger 只是账本，没有真实子代理执行入口就不登记工具，
//    描述里也不出现 isolation / 子代理。
public let worktreeEnterToolName: String = "enter_worktree"
public let worktreeExitToolName: String = "exit_worktree"

// 名称上限与固定目录口径同源；字符集、随机名与归属判定都归 SessionWorktree，
// 这里只核对 schema 声明过的那一条，不另立第二套名字规则。
let worktreeNameLimit: Int64 = 64

private func worktreeEnterDescription(): String {
    return "为本会话新建或复用 Git worktree：固定目录 .sacode/worktrees/<name>，分支 worktree-<name>；" +
        "进入后本会话后续所有文件与命令工具的基准目录都切到那里。" +
        "只有用户显式提到 worktree（或明确要求用它隔离本次工作）时才可调用；仅要求修 bug、改代码或建分支都不构成触发。" +
        "name 可省略，省略时由核心生成随机名；成功结果是本会话 worktree 的概况，其中 directory 与 name " +
        "就是后续相对路径的基准与退出时要报的名字。不在 Git 仓库内、或当前目录已在 worktree 内时拒绝进入（不支持嵌套）。"
}

private func worktreeExitDescription(): String {
    return "退出本会话的 worktree，并把后续工具的基准目录切回进入前的检出目录。" +
        "只有用户显式提到 worktree 时才可调用；仅要求修 bug、改代码或建分支都不构成触发。" +
        "name 必须是当前绑定的 worktree 名（enter_worktree 的结果里给出），对不上就拒绝，不会替别的目录动手。" +
        "action 只有两种：keep 解绑并保留目录，remove 删除目录。remove 必须经人工审批，" +
        "免审批档不能自动获批；删除还受三重保护——创建会话的归属、未提交文件（含未跟踪）、" +
        "未被其他本地分支或远程 ref 保留的独有提交。discard_changes 只能覆盖未提交文件这一项，" +
        "没有任何通路能强删独有提交。"
}

// 声明面：两条工具各一份 schema，都不许带没声明过的字段。
public func worktreeToolSpecs(): Array<ToolSpec> {
    return [
        ToolSpec(worktreeEnterToolName, worktreeEnterDescription(),
            "{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"name\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64}}}",
            false),
        ToolSpec(worktreeExitToolName, worktreeExitDescription(),
            "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"name\",\"action\"],\"properties\":{\"name\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":64},\"action\":{\"type\":\"string\",\"enum\":[\"keep\",\"remove\"]},\"discard_changes\":{\"type\":\"boolean\"}}}",
            true)
    ]
}

// 执行面：绑定一个 SessionWorktree（会话日志是它唯一的真源），只做参数核验、身份核验
// 与调用编排——目录、分支、删除保护与 workspace/directory 事件都在 SessionWorktree 里，
// 这里不另算一份，也不自己改会话目录。
public class WorktreeTools {
    let tree: SessionWorktree

    public init(tree: SessionWorktree) {
        this.tree = tree
    }

    // 名字由工具管线传下来：登记的名字与这里认的名字脱节就报独立失败，不猜动作。
    public func execute(name: String, args: String): ApprovalOutcome {
        if (name == worktreeEnterToolName) { return enterStep(args) }
        if (name == worktreeExitToolName) { return exitStep(args) }
        return denied("worktree-unknown-tool")
    }

    // enter_worktree：只接受 {name?: string}。省略 name 就是让核心生成随机名；
    // 显式给了空串或超长串是模型自己的形状错误，不猜成「那就随机吧」。
    // 解析段与生效段分开：enter 抛的是「不让进」，不能报成参数错。
    private func enterStep(args: String): ApprovalOutcome {
        var name = ""
        var named = false
        var shaped = false
        if (let Some(object) <- parseObject(args)) {
            try {
                if (keysDeclared(object, ["name"])) {
                    if (let Some(given) <- stringField(object, "name")) { name = given; named = true }
                    shaped = true
                }
            } catch (_: Exception) { shaped = false }
        }
        if (!shaped || (named && !nameWithinLimit(name))) { return denied("worktree-bad-args") }
        try {
            // 返回值是实际目录的绝对路径（冻结契约）。空串等于实现没履约，
            // 不能让它冒充成功去改后续工具的基准目录。
            let directory = tree.enter(name)
            if (directory.size == 0) { return denied("worktree-enter-refused::empty-directory") }
        } catch (e: Exception) {
            // 不在 Git 仓库内、已在 worktree 里（不支持嵌套）、非法名、归属不属于本会话，
            // 都由 SessionWorktree 拒绝；原样带上原因，模型才答得出该改哪一句。
            return denied("worktree-enter-refused::${e.message}")
        }
        return ApprovalOutcome(true, tree.describe())
    }

    // exit_worktree：{name, action, discard_changes?}。动作闭集在运行期再校验一遍——
    // Schema 只是声明面，批过的工单也不能把 delete 带进 SessionWorktree。
    private func exitStep(args: String): ApprovalOutcome {
        var name = ""
        var action = ""
        var discard = false
        var shaped = false
        if (let Some(object) <- parseObject(args)) {
            try {
                if (keysDeclared(object, ["name", "action", "discard_changes"])) {
                    // 必填项缺位或类型不对会在 getOrThrow / asString 处抛，被同一段收口成
                    // worktree-bad-args：声明面的 required 在运行期也算数。
                    name = object.get("name").getOrThrow().asString().getValue()
                    action = object.get("action").getOrThrow().asString().getValue()
                    if (let Some(flag) <- object.get("discard_changes")) { discard = flag.asBool().getValue() }
                    shaped = true
                }
            } catch (_: Exception) { shaped = false }
        }
        if (!shaped || !nameWithinLimit(name) || !isExitAction(action)) { return denied("worktree-bad-args") }
        // 身份核验在任何副作用之前：没有绑定、或名字不是本会话当前绑定的那一个，都拒不碰目录
        // ——审批批过也不代表可以拿去动别的 worktree。
        if (!tree.active()) { return denied("worktree-not-active") }
        if (name != tree.name()) { return denied("worktree-name-mismatch") }
        try {
            // 退出摘要不进载荷：模型、Host、桌面三面都只认 describe() 那八个字段。
            let _ = tree.exit(action, discardChanges: discard)
        } catch (e: Exception) {
            // 脏目录、独有提交、归属不明都从这里出来：三重保护没有任何强制通路能越过它。
            return denied("worktree-exit-refused::${e.message}")
        }
        // 绑定没解开就是没退成功：后续工具的地基还指着 worktree，报拒绝而不是假成功。
        if (tree.active()) { return denied("worktree-exit-refused::still-bound") }
        return ApprovalOutcome(true, tree.describe())
    }

    private func isExitAction(action: String): Bool {
        return action == "keep" || action == "remove"
    }

    // 名字本身：非空且不超上限。字符集、随机名、嵌套与归属都归 SessionWorktree 判。
    private func nameWithinLimit(name: String): Bool {
        return name.size > 0 && name.size <= worktreeNameLimit
    }

    private func denied(reason: String): ApprovalOutcome {
        let error = JsonObject()
        error.put("error", JsonString(reason))
        return ApprovalOutcome(false, error.toString(), structured: true)
    }

    // 参数一次读清：不 trim、不改写、不补默认值。模型给的原始串就是审批工单绑定的那一份，
    // 改写了它，审批说的和执行的做的就不是同一件事。
    private func parseObject(args: String): Option<JsonObject> {
        if (!args.trimAscii().startsWith("{")) { return None }
        try { return Some(JsonValue.fromStr(args).asObject()) } catch (_: Exception) { return None }
    }

    // additionalProperties:false 的执行侧核对：用已知键计数，多一个字段就拒。
    private func keysDeclared(object: JsonObject, allowed: Array<String>): Bool {
        var known: Int64 = 0
        for (key in allowed) {
            if (object.get(key).isSome()) { known += 1 }
        }
        return object.size() == known
    }

    // 字段只按声明的类型读：非字符串会在这里抛，由调用段的 catch 归一成 worktree-bad-args。
    private func stringField(object: JsonObject, field: String): Option<String> {
        if (let Some(value) <- object.get(field)) {
            return Some(value.asString().getValue())
        }
        return None
    }
}
