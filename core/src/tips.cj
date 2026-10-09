package core

import std.collection.ArrayList
import std.fs.*
import std.env.*
import std.sync.*

// 使用提醒（Tips）：启动时轮换介绍本仓已支持的能力，回复后按真实上下文占用给容量提醒。
//
// 两条红线：
// 1. 提醒只能出现在展示面——不写 session.log、不进投影、不进模型上下文；
// 2. 容量提醒必须有可靠分子（上一次请求真实带走的 token 数），拿不到就闭嘴，
//    绝不用累计 usage 或事件条数凑一个看起来像占用的数。
//
// 展示历史与隐藏开关落在用户目录的独立日志里，两个入口共用同一份，
// 与会话选择无关：换会话不会重置别人的 LRU，也不会改掉显示偏好。

class TipDef {
    public let id: String
    public let text: String
    // stage 为 0 表示度过新手期后的通用轮换池；1/2/3 对应三个新手阶段。
    public let stage: Int64
    public let priority: Int64
    public init(id: String, text: String, stage: Int64, priority: Int64) {
        this.id = id
        this.text = text
        this.stage = stage
        this.priority = priority
    }
}

// 容量提醒的键由 afterReply 直接返回，不进新手轮换池。
func contextTipId(band: String, escalate: Bool): String {
    if (band == "dialogue") {
        return if (escalate) { "context-compress" } else { "context-dialogue" }
    }
    return "context-${band}"
}

// 冷却记录里的档位名白名单。注意它和 contextTipId 是两个域：
// 这里认的是 dialogue/capacity/urgent 三个档名，不是 context-* 这类提示 id。
func isTipsBand(band: String): Bool {
    return band == "dialogue" || band == "capacity" || band == "urgent"
}

public class TipsService {
    // 三档容量提醒各自独立的冷却窗口，单位是单调秒；三档互相不占对方的窗口，
    // 所以从 80% 跳到 95% 时紧急提醒不会被容量提醒的冷却吃掉。
    public static let cooldownSec: Int64 = 600
    // 中档（50%~80%）先温和提示对话变长，连着提示到第 3 次才建议压缩。
    public static let dialogueEscalateAfter: Int64 = 3

    let root: String
    let path: String

    // 只推荐本仓已经实现的能力；文案里不出现本工程不存在的指令。
    static func catalog(): Array<TipDef> {
        return [
            TipDef("read", "把文件路径直接写进消息，我会读取并按需检索这个工作区的文件。", 1, 1),
            TipDef("tools", "回复里的工具调用区块可以展开，能看到我这一轮实际调了什么、拿到了什么。", 1, 2),
            TipDef("attach", "图片和文件可以作为附件带进对话，不用先转成文字。", 1, 3),
            TipDef("settings", "主题和字号在设置里改，对所有会话生效，不会只改当前这一个。", 1, 4),
            TipDef("models", "可以在模型中心填自己的密钥与端点，模型列表按填入的凭据拉取。", 1, 5),
            TipDef("approval", "写入和执行类动作会先要你审批，审批凭据是工单号，不是自报字符串。", 2, 1),
            TipDef("goal", "给我一个持续目标，我会按轮次推进，中断后能从检查点续跑。", 2, 2),
            TipDef("team", "复杂任务可以交给智能体团队并行，成员各自隔离写入，再由主智能体审查合并。", 2, 3),
            TipDef("workspace", "改动落在工作区，随时能看差异并按文件回退。", 2, 4),
            TipDef("queue", "我还在跑的时候，你可以继续排下一条消息，不用等本轮结束。", 2, 5),
            TipDef("history", "会话记录存在本机，可以从会话列表接着上次的上下文继续。", 3, 1),
            TipDef("remote", "多个入口要共用同一会话时，起守护进程再用远程模式接入。", 3, 2),
            TipDef("batch", "重复性的批处理任务可以一次排队交给我执行。", 3, 3),
            TipDef("plugin", "支持扩展：可以挂 JS 扩展宿主，也可以接 MCP 工具。", 3, 4),
            TipDef("web", "需要外部资料时我会联网搜索并抓取网页正文，不靠记忆编。", 3, 5),
            TipDef("compress", "上下文接近上限时可以压缩，保留要点腾出空间。", 0, 1),
            TipDef("acp", "也可以把子任务委派给外部智能体（ACP），失败时我会退回自己处理。", 0, 2),
            TipDef("search", "要查本机代码时按符号名问，我会先定位再回答，不整仓扫。", 0, 3),
            TipDef("durable", "会话日志是唯一真源，UI 只是投影；崩溃后重开能回放到最后一次落盘。", 0, 4),
            // 容量提醒的文案，供两个入口直接取用。
            TipDef("context-dialogue", "这段对话已经占到 %s%% 上下文，信息开始容易前后对不齐。", 0, 101),
            TipDef("context-compress", "上下文已到 %s%%，建议先压缩再继续，把要点收拢后再往下走。", 0, 101),
            TipDef("context-capacity", "上下文只剩不到两成（已用 %s%%），新内容可能挤掉早期要点。", 0, 101),
            TipDef("context-urgent", "上下文已用 %s%%，请尽快压缩，或另开会话再继续这条线。", 0, 101)
        ]
    }

    // 入门提示的文案（不含比例）。
    public static func textFor(id: String): String {
        for (tip in catalog()) {
            if (tip.id == id) { return tip.text }
        }
        return ""
    }

    // 容量提醒的文案：把 %s 换成真实占用比例。
    public static func contextTextFor(id: String, percent: Int64): String {
        for (tip in catalog()) {
            if (tip.id == id) { return tip.text.replace("%s", "${percent}") }
        }
        return ""
    }

    // CLI 闸门：默认拒绝。自测、headless、批处理、远程订阅、管道与机器输出
    // 一律不出提示——协议帧和 stdout 的制表符行是给程序读的。
    public static func cliEligible(mode: String, interactive: Bool, machineOutput: Bool, pipedOutput: Bool): Bool {
        if (!interactive || machineOutput || pipedOutput) { return false }
        return mode == "call" || mode == "tools" || mode == "tips"
    }

    public static func forUser(): TipsService {
        let override = getVariableSafe("SACODE_USER_SETTINGS_DIR")
        var home = getVariableSafe("USERPROFILE")
        if (home.size == 0) { home = getVariableSafe("HOME") }
        if (override.size == 0 && home.size == 0) { throw Exception("settings-home-unavailable") }
        let directory = if (override.size > 0) { override } else { "${home}/.sacode/user" }
        if (!exists(directory)) { Directory.create(directory, recursive: true) }
        return TipsService(directory)
    }

    public init(directory: String) {
        root = canonicalize(directory).toString()
        if (!FileInfo(root).isDirectory()) { throw Exception("bad-tips-directory") }
        path = "${root}/tips-history.log"
    }

    public func historyPath(): String { return path }

    public func hidden(): Bool { return read().hiddenTips }

    public func sessionCount(): Int64 { return read().sessionCount }

    // 启动提醒：每个真人会话开场取一条。新手期按阶段优先介绍基础操作，
    // 度过 15 次后转入通用池；同阶段内先按优先级、同级按最近最少展示轮换。
    public func startup(accessibility: Bool): String {
        if (accessibility) { return "" }
        let state = read()
        if (state.hiddenTips) { return "" }
        let session = state.sessionCount + 1
        let stage: Int64 = if (session <= 5) { 1 } else if (session <= 10) { 2 } else if (session <= 15) { 3 } else { 0 }
        var picked = ""
        var bestPriority: Int64 = -1
        var bestShown: Int64 = -1
        for (tip in catalog()) {
            if (tip.stage != stage || tip.id.size == 0) { continue }
            if (tip.priority > 100) { continue }
            let shown = state.shownAt(tip.id)
            if (bestPriority < 0 || shown < bestShown || (shown == bestShown && tip.priority < bestPriority)) {
                picked = tip.id
                bestPriority = tip.priority
                bestShown = shown
            }
        }
        if (picked.size == 0) { return "" }
        state.markShown(picked, session)
        state.sessionCount = session
        write(state)
        return picked
    }

    // 回复后的容量提醒。usedTokens/contextWindow 任一不可靠即返回空——
    // 宁可没有提醒，也不给一个编出来的比例。
    public func afterReply(usedTokens: Int64, contextWindow: Int64, nowSec: Int64, accessibility: Bool): String {
        if (accessibility) { return "" }
        let state = read()
        if (state.hiddenTips) { return "" }
        if (usedTokens < 0 || contextWindow <= 0) { return "" }
        let percent = usedTokens * 100 / contextWindow
        let band = if (percent >= 95) { "urgent" } else if (percent >= 80) { "capacity" } else if (percent >= 50) { "dialogue" } else { "" }
        if (band.size == 0) { return "" }
        let last = state.cooldownAt(band)
        if (last >= 0 && nowSec - last < cooldownSec) { return "" }
        var escalate = false
        if (band == "dialogue") {
            state.dialogueEmitted += 1
            escalate = state.dialogueEmitted >= dialogueEscalateAfter
        }
        let id = contextTipId(band, escalate)
        state.setCooldown(band, nowSec)
        write(state)
        return id
    }

    public func setHidden(value: Bool): Bool {
        let state = read()
        if (state.hiddenTips == value) { return false }
        state.hiddenTips = value
        write(state)
        return true
    }

    private func read(): TipsState {
        // 每次调用都重读磁盘：两个入口共享同一份历史，缓存会漏掉另一入口的改动。
        if (exists(path) && canonicalize(path).parent.toString() != root) {
            throw Exception("tips-path-rejected")
        }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) { throw Exception("tips-replay-rejected") }
        let state = TipsState()
        for (event in log.snapshotEvents()) {
            let kind = event.eventType
            if (kind == "tips/hidden") {
                state.hiddenTips = event.data == "1"
            } else if (kind == "tips/session") {
                state.sessionCount = tipParseCount(event.data)
            } else if (kind == "tips/dialogue") {
                state.dialogueEmitted = tipParseCount(event.data)
            } else if (kind == "tips/shown") {
                state.applyShown(event.data)
            } else if (kind == "tips/cooldown") {
                state.applyCooldown(event.data)
            } else {
                // 损坏要显式失败：回默认值再落盘会把有效历史覆盖掉。
                throw Exception("tips-replay-rejected")
            }
        }
        return state
    }

    private func write(state: TipsState): Unit {
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("tips-already-owned") }
        var temporary = ""
        try {
            let file = File.createTemp(Path(root))
            temporary = file.info.path.toString()
            file.close()
            let draft = SessionLog(temporary)
            if (state.hiddenTips) { draft.append("tips/hidden", "1") }
            if (state.sessionCount > 0) { draft.append("tips/session", "${state.sessionCount}") }
            if (state.dialogueEmitted > 0) { draft.append("tips/dialogue", "${state.dialogueEmitted}") }
            let shown = state.latestShown()
            var i: Int64 = 0
            while (i < state.shownIds.size) {
                if (shown[i] >= 0) {
                    draft.append("tips/shown", "${state.shownIds[i]}\t${shown[i]}")
                }
                i += 1
            }
            let cooldowns = state.latestCooldowns()
            var j: Int64 = 0
            while (j < state.cooldownBands.size) {
                if (cooldowns[j] >= 0) {
                    draft.append("tips/cooldown", "${state.cooldownBands[j]}\t${cooldowns[j]}")
                }
                j += 1
            }
            if (!draft.flush()) { throw Exception("tips-flush-failed") }
            rename(temporary, to: path, overwrite: true)
        } finally {
            if (temporary.size > 0) {
                try { removeIfExists(temporary, recursive: false) } catch (_: Exception) {}
            }
            lease.release()
        }
    }
}

// 一次读到的展示态；字段可改，供 startup/afterReply 就地更新后整份回写。
class TipsState {
    var hiddenTips: Bool = false
    var sessionCount: Int64 = 0
    var dialogueEmitted: Int64 = 0
    let shownIds = ArrayList<String>()
    let shownSeqs = ArrayList<Int64>()
    let cooldownBands = ArrayList<String>()
    let cooldownTimes = ArrayList<Int64>()

    func shownAt(id: String): Int64 {
        // 后写覆盖先写：回放按顺序追加，取最后一条命中即为当前值。
        var found: Int64 = 0
        var i: Int64 = 0
        while (i < shownIds.size) {
            if (shownIds[i] == id) { found = shownSeqs[i] }
            i += 1
        }
        return found
    }

    func markShown(id: String, seq: Int64): Unit {
        shownIds.add(id)
        shownSeqs.add(seq)
    }

    func cooldownAt(band: String): Int64 {
        var found: Int64 = -1
        var i: Int64 = 0
        while (i < cooldownBands.size) {
            if (cooldownBands[i] == band) { found = cooldownTimes[i] }
            i += 1
        }
        return found
    }

    func setCooldown(band: String, at: Int64): Unit {
        cooldownBands.add(band)
        cooldownTimes.add(at)
    }

    // 落盘前把同一个键的旧值挤掉：否则每轮追加会让历史只增不减，
    // 也让「同一档冷却」在同一份快照里出现两次。
    func latestShown(): ArrayList<Int64> {
        let out = ArrayList<Int64>()
        var i: Int64 = 0
        while (i < shownIds.size) {
            var last = i
            var j = i + 1
            while (j < shownIds.size) {
                if (shownIds[j] == shownIds[i]) { last = j }
                j += 1
            }
            if (last == i) { out.add(shownSeqs[i]) } else { out.add(-1) }
            i += 1
        }
        return out
    }

    func latestCooldowns(): ArrayList<Int64> {
        let out = ArrayList<Int64>()
        var i: Int64 = 0
        while (i < cooldownBands.size) {
            var last = i
            var j = i + 1
            while (j < cooldownBands.size) {
                if (cooldownBands[j] == cooldownBands[i]) { last = j }
                j += 1
            }
            if (last == i) { out.add(cooldownTimes[i]) } else { out.add(-1) }
            i += 1
        }
        return out
    }

    func applyShown(data: String): Unit {
        let parts = data.split("\t")
        if (parts.size != 2 || parts[0].size == 0) { throw Exception("tips-replay-rejected") }
        markShown(parts[0], tipParseCount(parts[1]))
    }

    func applyCooldown(data: String): Unit {
        let parts = data.split("\t")
        if (parts.size != 2 || !isTipsBand(parts[0])) { throw Exception("tips-replay-rejected") }
        setCooldown(parts[0], tipParseCount(parts[1]))
    }
}

func tipParseCount(value: String): Int64 {
    // 只收非负十进制，避免把控制字符或溢出当成有效历史。
    if (value.size == 0) { throw Exception("tips-replay-rejected") }
    var total: Int64 = 0
    for (byte in value.toArray()) {
        if (byte < 48 || byte > 57) { throw Exception("tips-replay-rejected") }
        total = total * 10 + Int64(byte - 48)
    }
    return total
}

func getVariableSafe(name: String): String {
    return getVariable(name) ?? ""
}

// 上下文占用采样：把「上一次请求真实带走的 token 数」按当时的模型可见内容登记，
// 之后只有内容没变才交回同一个数。累计 usage、turn/usage 这类不进模型的事件
// 不会作废它；新的用户或助手消息一进采样就失效，返回 -1 让容量提醒闭嘴。
class OccupancySample {
    let key: String
    var usedTokens: Int64
    public init(key: String, usedTokens: Int64) {
        this.key = key
        this.usedTokens = usedTokens
    }
}

func occupancyKey(log: SessionLog): String {
    let messages = log.deriveMessages()
    let tail = if (messages.size > 0) { messages[messages.size - 1] } else { "" }
    return "${messages.size}\t${tail}"
}

let occupancySamples = ArrayList<OccupancySample>()
let occupancyMtx = Mutex()

public func recordContextOccupancy(log: SessionLog, usedTokens: Int64): Unit {
    if (usedTokens < 0) { return }
    let key = occupancyKey(log)
    var recorded = false
    synchronized(occupancyMtx) {
        // 采样只留最近若干条，够了就整份丢弃：陈旧采样最坏的后果是提醒缺席，不是误报。
        if (occupancySamples.size > 8) { occupancySamples.clear() }
        for (sample in occupancySamples) {
            if (!recorded && sample.key == key) {
                sample.usedTokens = usedTokens
                recorded = true
            }
        }
        if (!recorded) { occupancySamples.add(OccupancySample(key, usedTokens)) }
    }
}

public func currentContextTokens(log: SessionLog): Int64 {
    let key = occupancyKey(log)
    var found: Int64 = -1
    synchronized(occupancyMtx) {
        for (sample in occupancySamples) {
            if (sample.key == key) { found = sample.usedTokens }
        }
    }
    return found
}
