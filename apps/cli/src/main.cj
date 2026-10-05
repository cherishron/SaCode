package cli
import core.*
import std.fs.*
import std.collection.ArrayList
import std.env.*

var failures: Int64 = 0

func expect(label: String, got: Bool) {
    if (got) {
        println("PASS ${label}")
    } else {
        println("FAIL ${label}")
        failures += 1
    }
}

// 目标驱动自测用的轮次计数：闭包只捕获这个可变对象，避开捕获 var 的编译器限制。
class CliRoundTick {
    var n: Int64 = 0
    func bump(): Unit {
        n += 1
    }
}

// CLI 交付面的三块：内置工具注册表（与桌面入口同一份 core 语义）、审批应答的三态判定、
// 结构化输出。都是纯函数或就地构造，好让 headless 自测能直接断言而不靠标准输入赌时序。
func builtinTools(): ToolRegistry {
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写临时工作区文件", "path content", true))
    reg.register(ToolSpec("read", "读文件并记录版本标记", "path", false))
    return reg
}

// 「读不到应答」和「答了不批」是两件事：前者返回空串（不作答，工单留在 pending），
// 后者返回 denied。两者都必须让执行被拒，但只有后者会在日志里留下 decided。
func decideAnswer(line: Option<String>): String {
    if (let Some(l) <- line) {
        let t = l.trimAscii()
        if (t == "y" || t == "Y" || t == "yes" || t == "Yes" || t == "YES") {
            return "allowed-once"
        }
        return "denied"
    }
    return ""
}

func toolsList(reg: ToolRegistry): ArrayList<String> {
    return reg.list()
}

// 落盘 TSV 只转义会劈行的四个字符，JSON 还要额外转义引号——两件事不能用同一个函数。
func jsonEscape(s: String): String {
    let out = ArrayList<Byte>()
    for (b in s.toArray()) {
        let n = Int64(b)
        if (n == 92) {
            out.add(92)
            out.add(92)
        } else if (n == 34) {
            out.add(92)
            out.add(34)
        } else if (n == 10) {
            out.add(92)
            out.add(110)
        } else if (n == 13) {
            out.add(92)
            out.add(114)
        } else if (n == 9) {
            out.add(92)
            out.add(116)
        } else {
            out.add(b)
        }
    }
    return String.fromUtf8(out.toArray())
}

func callJson(name: String, args: String, out: ApprovalOutcome, code: Int64): String {
    let ok = if (out.allowed) { "true" } else { "false" }
    return "{\"tool\":\"${jsonEscape(name)}\",\"args\":\"${jsonEscape(args)}\",\"ok\":${ok},\"why\":\"${jsonEscape(out.why)}\",\"exit\":${code}}"
}

func toolsJson(reg: ToolRegistry): String {
    var s = "["
    var first = true
    for (n in reg.list()) {
        if (!first) {
            s += ","
        }
        first = false
        let ap = if (reg.requiresApproval(n)) { "true" } else { "false" }
        s += "{\"name\":\"${jsonEscape(n)}\",\"params\":\"${jsonEscape(reg.paramsOf(n))}\",\"approval\":${ap},\"description\":\"${jsonEscape(reg.describe(n))}\"}"
    }
    s += "]"
    return s
}

// 退出码按失败族分开：0 放行并执行成功，3 审批没过，4 工具不存在，8 执行期失败。
// 写操作还带「工单状态」这一行诊断，答得出是被审批拦的还是被管线拦的。
func callExitCode(allowed: Bool, stage: String): Int64 {
    if (allowed) {
        return Int64(0)
    }
    if (stage == "approval-denied") {
        return Int64(3)
    }
    if (stage == "unregistered" || stage == "unknown-tool") {
        return Int64(4)
    }
    return Int64(8)
}

// 要不要发工单：注册表说有这个工具、且它标了需审批，才向用户要一个应答。
// 未登记的工具直接由 executeWithApproval 拒掉——先要号再拒等于让用户回答一个跑不了的动作，
// 还会在日志里留下一条指向不存在工具的 approval/asked。
func needsTicket(reg: ToolRegistry, name: String): Bool {
    return reg.has(name) && reg.requiresApproval(name)
}

func hasFlag(args: Array<String>, flag: String): Bool {
    for (a in args) {
        if (a == flag) {
            return true
        }
    }
    return false
}

// 位置参数：本 CLI 的 flag 都不带值，认得的 flag 只有 --json，其余一律照位置参数收下。
func positionals(args: Array<String>, from: Int64): ArrayList<String> {
    let out = ArrayList<String>()
    var i: Int64 = from
    while (i < Int64(args.size)) {
        let a = args[i]
        if (a != "--json") {
            out.add(a)
        }
        i += 1
    }
    return out
}

// 附件断言的夹具：PNG 头部只写到「读得出宽高」为止（签名 + IHDR 长度/类型/宽高/深度位深）。
// core/src/attach_test.cj 里的同形夹具是测试文件，不会链进 CLI 二进制，交付面自带一份。
func attPng(width: Int64, height: Int64): Array<Byte> {
    let out = ArrayList<Byte>()
    for (v in [UInt8(137), UInt8(80), UInt8(78), UInt8(71), UInt8(13), UInt8(10), UInt8(26), UInt8(10), UInt8(0), UInt8(0), UInt8(0), UInt8(13), UInt8(73), UInt8(72), UInt8(68), UInt8(82)]) {
        out.add(v)
    }
    for (n in [width, height]) {
        out.add(UInt8((n / 16777216) % 256))
        out.add(UInt8((n / 65536) % 256))
        out.add(UInt8((n / 256) % 256))
        out.add(UInt8(n % 256))
    }
    for (v in [UInt8(8), UInt8(6), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0)]) {
        out.add(v)
    }
    return out.toArray()
}

func attObjectCount(dir: String): Int64 {
    // 「一条都没落盘」正是要证的形态，此时目录还没建；Directory.readFrom 对
    // 不存在的目录是抛而不是交回空清单，所以先探一次。
    if (!exists(dir)) {
        return Int64(0)
    }
    var n = Int64(0)
    for (info in Directory.readFrom(dir)) {
        if (info.isRegular()) {
            n += 1
        }
    }
    return n
}

func attBytesEq(a: Array<Byte>, b: Array<Byte>): Bool {
    if (a.size != b.size) {
        return false
    }
    for (i in 0..Int64(a.size)) {
        if (a[i] != b[i]) {
            return false
        }
    }
    return true
}

main(args: Array<String>) {
    let mode = if (args.size > 0) { args[0] } else { "all" }

    if (mode != "all" && mode != "stream" && mode != "tool" && mode != "ext" && mode != "cancel" && mode != "extjs" && mode != "projection" && mode != "seed" && mode != "sig" && mode != "headless" && mode != "tools" && mode != "call" && mode != "realstream" && mode != "att" && mode != "goal") {
        getStdErr().writeln("usage: dsh [seed|projection|all|stream|tool|ext|cancel|extjs|sig|headless|tools|call|realstream|att|goal]")
        return 64
    }

    if (mode == "projection") {
        let sl = SessionLog("session.log")
        if (!sl.load()) {
            println("err\treplay-rejected")
            return 1
        }
        println("ok\t${sl.deriveMessages().size}\t${sl.eventCount()}")
        for (s in sl.deriveMessages()) {
            println("msg\t${s}")
        }
        return 0
    }

    if (mode == "seed") {
        let lease = WriteLease("session.log")
        if (!lease.takeoverIfStale()) {
            println("err	already-owned")
            return 1
        }
        let sl = SessionLog("session.log")
        sl.append("turn/start", "t1")
        sl.append("system/message", SystemPromptBuilder(builtinTools()).build())
        sl.append("user/message", "hello")
        sl.append("tool/call", "read a.txt")
        sl.append("assistant/message", "hi there")
        sl.append("turn/end", "completed")
        if (!sl.flush()) {
            lease.release()
            println("err\tflush-failed")
            return 1
        }
        lease.release()
        println("ok\tseeded\t${sl.eventCount()}")
        return 0
    }

    if (mode == "all" || mode == "stream") {
        let asm = Assembly()
        for (ch in FakeProvider().script()) { asm.push(ch) }
        expect("流式装配拼回多字节半帧", asm.assembledText() == "你好，world")
        expect("usage 被记录", asm.usage == "12")
        expect("finish 后进入终态", !asm.interrupted && asm.finishReason == "stop")
        expect("正常结束保留 tool call", asm.toolCalls.size == 1)
        asm.push(Chunk("text", "late", ""))
        expect("finish 之后的 chunk 被丢弃", asm.assembledText() == "你好，world")

        let asm2 = Assembly()
        for (ch in FakeProvider().script()) { asm2.push(ch) }
        let a3 = Assembly()
        a3.push(Chunk("tool-call-delta", "read", ""))
        a3.push(Chunk("finish", "", "max-tokens"))
        expect("max-tokens 作废全部 tool calls", a3.toolCalls.size == 0)
        let a4 = Assembly()
        a4.push(Chunk("usage", "9", ""))
        expect("缺 finish 时保持 interrupted", a4.interrupted)

        // 干净收束的助手正文必须落进日志并能在重启后回放。CLI 与桌面吃的是同一套核心，
        // 这里不落盘就等于两个入口的对话只活在一次进程里。
        let sp = "settle-cli.log"
        removeIfExists(sp, recursive: false)
        removeIfExists("${sp}.lease", recursive: false)
        let slog = SessionLog(sp)
        let stk = TurnToken()
        let sr = TurnLoop().run(CancellableStreamProvider(stk, 5), stk, slog, DeliveryQueue(8))
        expect("干净收束不落取消态", !sr.cancelled && sr.finishReason == "stop")
        expect("结算文本与装配同源", sr.text == "你好，world")
        var settleAssistant: Int64 = 0
        for (ev in slog.snapshotEvents()) {
            if (ev.eventType == "assistant/message") {
                settleAssistant += 1
            }
        }
        expect("助手正文落 assistant/message 且只落一次", settleAssistant == Int64(1))
        slog.flush()
        let slog2 = SessionLog(sp)
        var replayed = false
        if (slog2.load()) {
            for (m in slog2.deriveMessages()) {
                if (m == "assistant/message: 你好，world") {
                    replayed = true
                }
            }
        }
        expect("重启后从日志回放助手正文", replayed)
        removeIfExists(sp, recursive: false)
        removeIfExists("${sp}.lease", recursive: false)

        // 计量与预算：CLI 入口要能只靠核心回答「这一轮花了多少、还让不让跑下一轮」。
        // 这里不借宿主，直接用同一份 core，两个入口因此共享同一套账。
        let mp = "meter-cli.log"
        removeIfExists(mp, recursive: false)
        removeIfExists("${mp}.lease", recursive: false)
        let mlog = SessionLog(mp)
        let mt = TokenMeter(mlog, budget: Int64(20))
        expect("usage 累加并记账", mt.record("12") == "recorded" && mt.used() == Int64(12))
        expect("超预算的一笔不计入", mt.record("12") == "over-budget" && mt.used() == Int64(12))
        expect("拦过一次即视为超档", mt.over())
        expect("预算只可收紧不可放宽", mt.lowerBudget(Int64(15)) && !mt.lowerBudget(Int64(99)))
        expect("乱码 usage 记 0 并单独计数", mt.record("twelve") == "bad-usage" && mt.used() == Int64(12))
        mlog.flush()
        let mlog2 = SessionLog(mp)
        let mt2 = TokenMeter(mlog2, budget: Int64(20))
        // 换一个新实例、只靠日志重算：崩溃重启不许「失忆」
        expect("账能从会话日志重算", mlog2.load() && mt2.rebuild() == Int64(12))
        expect("重算后仍记得被拦过", mt2.over())
        expect("重算后下一笔照样拦得住", mt2.record("9") == "over-budget" && mt2.used() == Int64(12))
        let tightened = TokenMeter(SessionLog("meter-cli-tightened.log"))
        tightened.record("12")
        expect("收紧到已用额度以下即时停轮", tightened.lowerBudget(Int64(5)) && tightened.over())
        let cancelledUsage = TurnResult(true, Int64(4), "", "", "12", true, Int64(0), Int64(0))
        let exitMeter = TokenMeter(SessionLog("meter-cli-exit.log"))
        expect("取消仍保留已报告 usage", exitMeter.settleTurn(cancelledUsage) == "recorded" && exitMeter.used() == Int64(12))
        removeIfExists(mp, recursive: false)
        removeIfExists("${mp}.lease", recursive: false)
    }

    if (mode == "all" || mode == "cancel") {
        // turn 跑在独立线程上，主线程从另一个线程发起取消：
        // 桌面 stop 与 CLI 中断走的就是同一条协作式路径。
        let p = "cancel-session.log"
        removeIfExists(p, recursive: false)
        let tk = TurnToken()
        let log = SessionLog(p)
        let q = ThreadSafeDeliveryQueue(2)
        let h = TurnRunner().start(CancellableStreamProvider(tk, 2), tk, log, q)
        // 「已在流中」要有可观察证据：生产线程投出过帧才算，isRunning 只说明还没结束
        var spins: Int64 = 0
        while (q.size() == 0 && spins < 3000) {
            sleep(1 * Duration.millisecond)
            spins += 1
        }
        expect("turn 在独立线程上产出过帧", q.size() > 0)
        h.cancel()
        let r = h.result()
        expect("取消在流中生效", r.cancelled && r.delivered == Int64(2))
        expect("已产出的部分文本保留", r.text == "你好，world")
        expect("取消的 turn 没有终态原因", r.interrupted && r.finishReason == "")
        expect("不留悬挂 tool call", r.pendingToolCalls == Int64(0))
        var hasCancelled = false
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "turn/cancelled") { hasCancelled = true }
        }
        expect("日志留下 turn/cancelled", hasCancelled)
        expect("背压只报信号不丢帧", q.dropped() == Int64(0) && q.size() <= Int64(2))
        expect("结算后线程退出", !h.isRunning())
        let handed = tk.detached()
        expect("已独立发布的后台任务不被连带取消", !handed.cancelled())
        log.flush()
        removeIfExists(p, recursive: false)
        println("cancel\tcancelled=${r.cancelled}\tdelivered=${r.delivered}\tsettled=${r.settledToolCalls}")
    }

    // 附件在产品交付面的断言：npm 平台包里的 dsh.exe 离线跑的就是这一段——内容寻址落盘、
    // 准入拒绝不留对象、先持久化后事件这三条装机后就成立，不靠网络也不靠桌面壳。
    // 抛断一律用「赋值的 try/catch」：把 lambda 塞进断言宏会解到 unclosed delimiter。
    if (mode == "all" || mode == "att") {
        let attRoot = "att-check"
        let attDir = "${attRoot}/attachments/v1"
        let attPath = "${attRoot}/session.log"
        removeIfExists(attRoot, recursive: true)
        Directory.create(attRoot, recursive: true)
        let attLog = SessionLog(attPath)
        let store = AttachmentStore(attDir, attLog, AttachmentLimits.localBackend())
        let png = attPng(Int64(2), Int64(1))

        expect("交付包内的摘要实现对上公开测试向量", sha256Hex([UInt8(97), UInt8(98), UInt8(99)]) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

        let img = store.saveImage(png, "image/png", "a.png")
        expect("图片引用 id 就是它的 sha256", img.attachmentId == "sha256:${sha256Hex(png)}")
        expect("对象按内容名落在 attachments/v1 下", exists(store.hostPath(img.attachmentId)))
        // 权威读直接调真函数，但把它包进 try：读不到就是这条断言该红，
        // 不能让未捕获异常把后面的断言全部咽掉（变异反证要靠完整的红集合归因）。
        var backEq = false
        try {
            backEq = attBytesEq(store.read(img.attachmentId), png)
        } catch (e: Exception) {
            backEq = false
        }
        expect("读回逐字节等于提交字节", backEq)
        expect("引用里带着按容器头部认出的固有宽高", img.width == Int64(2) && img.height == Int64(1))

        let emptyFile = store.saveFile(Array<Byte>(0, repeat: UInt8(0)), "C:/远端/奇怪的.txt")
        expect("通用文件不设准入额度：空文件照落盘", emptyFile.bytes == Int64(0) && exists(store.hostPath(emptyFile.attachmentId)))
        expect("引用只留末段名，不把提交方的路径存进来", emptyFile.name == "奇怪的.txt")

        let settled = attObjectCount(attDir)
        var code = ""
        try {
            let sunk = store.saveImage(png, "image/jpeg", "b.jpg")
            code = "no-throw:${sunk.attachmentId}"
        } catch (e: Exception) {
            code = e.message
        }
        expect("声称 jpeg 而头部是 png：拒", code == "attachment-media-type-mismatch")
        expect("拒绝不留半个对象", attObjectCount(attDir) == settled)

        code = ""
        try {
            let sunk = store.saveImage(attPng(Int64(9000), Int64(1)), "image/png", "big.png")
            code = "no-throw:${sunk.attachmentId}"
        } catch (e: Exception) {
            code = e.message
        }
        expect("单边超上限拒收（本仓不做规范化缩放）", code == "attachment-image-dimension-exceeded")

        // 批量：整批里有一个不合格成员时，合格成员也不能被发布出去。
        // 两个成员都用「新对象」的字节，否则命中已存在的同名对象，计数看不出有没有落盘。
        code = ""
        try {
            let pair = ArrayList<ImageInput>()
            pair.add(ImageInput(attPng(Int64(1), Int64(1)), "image/png", "ok.png"))
            pair.add(ImageInput(attPng(Int64(3), Int64(4)), "image/gif", "liar.gif"))
            let sunk = store.saveImages(pair)
            code = "no-throw:${Int64(sunk.size)}"
        } catch (e: Exception) {
            code = e.message
        }
        expect("批量先全量校验再整体发布", code == "attachment-media-type-mismatch" && attObjectCount(attDir) == settled)

        // 不透明 id 的下游后果：拿外来串去派生路径就是目录穿越，必须在形态上就拒掉。
        code = ""
        try {
            let sunk = store.read("../../core/src/attach.cj")
            code = "no-throw:${Int64(sunk.size)}"
        } catch (e: Exception) {
            code = e.message
        }
        expect("外来 id 一律拒，不据它派生路径", code == "attachment-bad-id")

        let stray = store.saveFile([UInt8(1), UInt8(2), UInt8(3)], "stray.bin")
        File.writeTo(store.hostPath(stray.attachmentId), [UInt8(9), UInt8(9)])
        code = ""
        try {
            let sunk = store.read(stray.attachmentId)
            code = "no-throw:${Int64(sunk.size)}"
        } catch (e: Exception) {
            code = e.message
        }
        expect("对象被篡改后读回被拒", code == "attachment-corrupt-object")

        let refs = ArrayList<AttachmentRef>()
        refs.add(img)
        store.commitMessage("带一张图的问题", refs)
        // 冷实例必须显式 load()：SessionLog 构造不读盘，不 load 的「看不到」是空的而非证据。
        let cold = SessionLog(attPath)
        expect("未 flush 的 append 不跨进程：冷实例加载后一条消息都没有", cold.load() && cold.deriveMessages().size == Int64(0))
        expect("未 flush 的引用事件同样不跨进程", cold.snapshotEvents().size == Int64(0))
        let warm = SessionLog(attPath)
        expect("flush 后冷实例能加载出这条消息", attLog.flush() && warm.load() && warm.deriveMessages().size == Int64(1))

        var recordAt = Int64(-1)
        var userAt = Int64(-1)
        var step = Int64(0)
        for (ev in attLog.snapshotEvents()) {
            if (ev.eventType == "attachment/record" && recordAt < Int64(0)) {
                recordAt = step
            }
            if (ev.eventType == "user/message") {
                userAt = step
            }
            step += 1
        }
        expect("引用事件排在它服务的那条用户消息之前", recordAt >= Int64(0) && userAt > recordAt)
        let recordText = store.entries()[0]
        expect("引用事件只带引用与元数据，不带 blob", recordText.contains(sha256Hex(png)) && !recordText.contains("base64") && !recordText.contains("data:"))
        expect("投影把引用配回它服务的那条消息", store.refsForMessage().size == Int64(1))
        expect("引用事件是会话日志里的事实：冷实例回放照样取到", AttachmentStore(attDir, warm, AttachmentLimits.localBackend()).entries().size == Int64(1))

        // 装配点物化：图片只有在拼模型请求那一刻才变成字节，日志里始终只有引用。
        let req = modelRequestJson("m", attLog.snapshotEvents().toArray(), attachStore: store, supportsImages: true)
        expect("模型请求在装配点物化出图片 part", req.contains("\"type\":\"image_url\"") && req.contains("data:image/png;base64,"))
        expect("物化后的消息同时带文字 part", req.contains("\"type\":\"text\",\"text\":\"带一张图的问题\""))
        expect("会话日志侧不出现 base64", !attLog.snapshotEvents()[0].data.contains("base64"))

        removeIfExists(attRoot, recursive: true)
        println("att\tobjects=${settled}\trecordAt=${recordAt}\tuserAt=${userAt}")
    }

    // Ctrl+C 的端到端取证：由外部驱动（PowerShell 的 GenerateConsoleCtrlEvent）向本进程
    // 所在控制台发中断。这里验的是 DSH 那条不变量——中断不是就地终止进程，
    // 而是走与桌面 stop 同一条协作式取消：turn 在检查点收束、未落盘的写入结算、写租约归还。
    // 退出码约定 130（128+SIGINT）；内部断言有任何一条 FAIL 时退 1，避免「被杀也算过」。
    if (mode == "sig") {
        let p = "sig-session.log"
        removeIfExists(p, recursive: false)
        removeIfExists("${p}.lease", recursive: false)
        expect("中断处理器注册成功", ConsoleSignals.install())
        let lease = WriteLease(p)
        expect("写入前拿到写租约", lease.takeoverIfStale())
        let tk = TurnToken()
        let log = SessionLog(p)
        let q = ThreadSafeDeliveryQueue(8)
        let id = ConsoleSignals.attach(tk)
        let hitsBefore = ConsoleSignals.signalCount()
        let h = TurnRunner().start(CancellableStreamProvider(tk, 2), tk, log, q)
        // 握手行：驱动看到这行才发中断，同时确认被中断的就是这个 pid。
        // stdout 被重定向到文件时是块缓冲，不 flush 驱动就永远等不到这行。
        println("sig\thandoff\tpid=${ownProcessId()}")
        getStdOut().flush()
        var waited: Int64 = 0
        while (h.isRunning() && waited < Int64(8000)) {
            sleep(10 * Duration.millisecond)
            waited += Int64(10)
        }
        // 没等到中断时也必须收束：provider 在帧间的自旋是「等取消」的，
        // 本运行时的 sleep(1ms) 实际粒度可到十几毫秒，放着不管就是几十秒挂死。
        if (ConsoleSignals.signalCount() == hitsBefore) {
            tk.cancel()
        }
        let r = h.result()
        ConsoleSignals.detach(id)
        let gotSignal = ConsoleSignals.signalCount() > hitsBefore
        expect("中断确实送达处理器", gotSignal)
        // 后两条必须以「真的收到过中断」为前提：上面的兜底取消也会让 r.cancelled 变 true，
        // 不设前提就是把自测的收束报成中断的功劳。
        expect("在途 turn 因中断收束", r.cancelled && gotSignal)
        expect("中断类型是 Ctrl+C 或 Ctrl+Break", (ConsoleSignals.lastKind() == Int64(0) || ConsoleSignals.lastKind() == Int64(1)) && gotSignal)
        var sawCancelled = false
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "turn/cancelled") {
                sawCancelled = true
            }
        }
        expect("取消的 turn 留下 turn/cancelled", sawCancelled && gotSignal)
        expect("未落盘的写入就地结算", log.flush())
        expect("写租约归还", lease.release())
        expect("租约文件已消失", !lease.held())
        expect("在册表清空", ConsoleSignals.attached() == Int64(0))
        let code = if (failures > 0) { 1 } else { 130 }
        println("sig\tcancelled=${r.cancelled}\tdelivered=${r.delivered}\tkind=${ConsoleSignals.lastKind()}\thits=${ConsoleSignals.signalCount() - hitsBefore}\tcode=${code}")
        removeIfExists(p, recursive: false)
        return code
    }

    if (mode == "ext") {
        // 注册表是 CLI 与桌面两个入口的唯一真源：这里跑完整生命周期并断言残留为 0
        let reg = ToolRegistry()
        let lst = ListenerRegistry()
        reg.register(ToolSpec("write", "写临时文件", "path content", true))
        reg.register(ToolSpec("read", "读文件", "path", false))
        expect("重名注册被拒", !reg.register(ToolSpec("write", "覆盖", "x", false)))
        let h1 = lst.on("tool/call")
        let h2 = lst.on("turn/start")
        let rt = ToolRuntime(SessionLog("ext-session.log"), reg)
        let called = rt.execute("write", "probe-ext.txt hi", "allowed-once", true)
        expect("内置工具经审批后执行", called.allowed)
        removeIfExists("probe-ext.txt", recursive: false)
        let ghost = rt.execute("no.such.tool", "x", "allowed-once", true)
        expect("未登记工具被拒", !ghost.allowed && ghost.why == "unregistered-tool:no.such.tool")
        expect("未登记计数为 1", rt.registryMisses == Int64(1))
        expect("卸载已注册工具", reg.unregister("write"))
        expect("重复卸载同一 name 失败", !reg.unregister("write"))
        reg.unregister("read")
        expect("注册残留为 0", reg.count() == Int64(0))
        lst.off(h1)
        lst.off(h2)
        expect("监听残留为 0", lst.count() == Int64(0))
        println("ext\ttools=${reg.count()}\tlisteners=${lst.count()}\tmisses=${rt.registryMisses}")
    }

    if (mode == "all" || mode == "tool") {
        let p = "tool-session.log"
        let log = SessionLog(p)
        let reg = ToolRegistry()
        reg.register(ToolSpec("write", "写临时文件", "path content", true))
        reg.register(ToolSpec("read", "读文件并记录版本标记", "path", false))
        let rt = ToolRuntime(log, reg)
        if (exists("probe-tool.txt")) {
            rt.execute("read", "probe-tool.txt", "", true)
        }
        let allow = rt.execute("write", "probe-tool.txt hello", "allowed-once", true)
        expect("allowed-once 放行并执行", allow.allowed && allow.why == "ok:probe-tool.txt")
        // 读侧的同一套语义也得从这个入口走一遍：两个入口共用同一个 core
        let got = rt.execute("read", "probe-tool.txt", "", true)
        expect("read 交回盘上真实读到的正文", got.allowed && got.why == "hello")
        // 第三方把正文改成等长的另一串之后，旧认知不能拿去覆盖
        File.writeTo("probe-tool.txt", "hellp".toArray())
        let stale = rt.execute("write", "probe-tool.txt next", "allowed-once", true)
        expect("等长外部改动被识别为版本过期并拒绝", !stale.allowed && stale.why == "fs-stale-version:probe-tool.txt")
        expect("拒绝发生在写之前，盘上仍是第三方那一份", rt.lastDetail.stage == "fs-stale-version" && String.fromUtf8(File.readFrom("probe-tool.txt")) == "hellp")
        let alias = rt.execute("write", "./probe-tool.txt next", "allowed-once", true)
        expect("路径别名不能绕过观察版本", !alias.allowed && alias.why == "fs-stale-version:./probe-tool.txt")
        File.writeTo("probe-unseen.txt", "external".toArray())
        let unseen = rt.execute("write", "probe-unseen.txt overwrite", "allowed-once", true)
        expect("已有文件未经观察不得覆盖", !unseen.allowed && unseen.why == "fs-not-observed:probe-unseen.txt")
        removeIfExists("probe-unseen.txt", recursive: false)
        File.writeTo("probe-tool.txt", "hello".toArray())
        let gone = rt.execute("read", "no-such-dir/probe-none.txt", "", true)
        expect("读不到的路径归一成 not-found", !gone.allowed && gone.why == "not-found:no-such-dir/probe-none.txt")
        let noAnswer = rt.execute("write", "x.txt y", "none", true)
        expect("无应答者 fail-closed 拒绝", !noAnswer.allowed && noAnswer.why == "approval-not-allowed-once")
        let guard = rt.execute("write", "z.txt w", "allowed-once", false)
        expect("guard 终局拒绝", !guard.allowed && guard.why == "guard-denied")
        expect("审批拒绝未产生副作用", !exists("x.txt"))
        log.flush()
        let r = SessionLog(p)
        r.load()
        let proj = r.deriveMessages()
        var projHasToolCall = false
        for (s in proj) {
            if (s.contains("tool/call")) { projHasToolCall = true }
        }
        expect("tool/call 持久但不进模型历史", !projHasToolCall && r.eventCount() >= Int64(6))
        // 用例自己写的文件自己收掉，否则工作区会留一枚伪「产物」被误提交
        removeIfExists("probe-tool.txt", recursive: false)
    }

    if (mode == "all" || mode == "headless") {
        // CLI 的 headless/结构化交付面（方案 §「CLI 有交互/headless/结构化模式」）：
        // 审批凭据只能是工单号；读不到应答就是「没有应答者」，它和「答了不批」都必须让执行被拒，
        // 差别只落在日志里那条 approval/decided 有没有被写出来。
        let hp = "headless-session.log"
        removeIfExists(hp, recursive: false)
        removeIfExists("${hp}.lease", recursive: false)
        let hlog = SessionLog(hp)
        let desk = ApprovalDesk(hlog)
        let reg = builtinTools()
        let rt = ToolRuntime(hlog, reg)
        expect("EOF 读不到应答判为不作答", decideAnswer(None) == "")
        expect("y 判为一次放行", decideAnswer(Some("y")) == "allowed-once")
        expect("YES 带空白也判为放行", decideAnswer(Some(" YES ")) == "allowed-once")
        expect("n 判为拒绝", decideAnswer(Some("n")) == "denied")
        expect("乱码应答判为拒绝而不是放行", decideAnswer(Some("always")) == "denied")
        // 无应答者：不作答（不写 decided），工单停在 pending，执行必须被拒
        let t1 = desk.ask("write")
        let a1 = decideAnswer(None)
        if (a1 != "") { desk.answer(t1, a1) }
        let r1 = rt.executeWithApproval("write", "probe-headless.txt x", t1, true, desk)
        expect("无应答者执行被拒", !r1.allowed && r1.why == "approval-not-granted:pending")
        expect("拒绝不产生副作用", !exists("probe-headless.txt"))
        var sawDecided = false
        for (ev in hlog.snapshotEvents()) {
            if (ev.eventType == "approval/decided") { sawDecided = true }
        }
        expect("没应答就不许留下 decided", !sawDecided)
        // 答 y：放行、真写盘、读回同一份，且工单用过即失效
        let t2 = desk.ask("write")
        desk.answer(t2, decideAnswer(Some("y")))
        let r2 = rt.executeWithApproval("write", "probe-headless.txt hello", t2, true, desk)
        expect("答 y 放行并写出正文", r2.allowed && r2.why == "ok:probe-headless.txt")
        expect("盘上确实是那份正文", exists("probe-headless.txt") && String.fromUtf8(File.readFrom("probe-headless.txt")) == "hello")
        expect("同一工单不可重用", desk.consume(t2, "write") == "")
        let r3 = rt.executeWithApproval("write", "probe-headless.txt again", t2, true, desk)
        expect("重用工单被拒", !r3.allowed && r3.why == "approval-not-granted:used")
        // 答 n：写下 decided:denied，执行同样被拒
        let t4 = desk.ask("write")
        desk.answer(t4, decideAnswer(Some("n")))
        let r4 = rt.executeWithApproval("write", "probe-headless.txt nope", t4, true, desk)
        expect("答 n 拒绝执行", !r4.allowed && r4.why == "approval-not-granted:denied")
        var decidedDenied = false
        for (ev in hlog.snapshotEvents()) {
            if (ev.eventType == "approval/decided" && ev.data.contains(":denied")) { decidedDenied = true }
        }
        expect("答了不批要留下 decided", decidedDenied)
        // 免审批的工具不该被要求出示工单
        let r5 = rt.executeWithApproval("read", "probe-headless.txt", Int64(-1), true, desk)
        expect("免审批工具不要求工单", r5.allowed && r5.why == "hello")
        // 结构化输出：stdout 只有一行 JSON，正文里的引号与换行必须转义；诊断走 stderr
        let js = callJson("write", "a.txt he\"llo\nworld", r2, Int64(0))
        expect("JSON 结果是单行", !js.contains("\n") && js.startsWith("{") && js.endsWith("}"))
        expect("JSON 内正文的引号与换行已转义", js.contains("\\\"") && js.contains("\\n") && !js.contains("llo\nworld"))
        expect("JSON 带工具名、放行状态与退出码", js.contains("\"tool\":\"write\"") && js.contains("\"ok\":true") && js.contains("\"exit\":0"))
        // 工具清单只能出自注册表这一份真源
        expect("清单条目数等于注册表", Int64(toolsList(reg).size) == reg.count())
        let tj = toolsJson(reg)
        expect("清单标出需审批与免审批", tj.contains("\"name\":\"write\"") && tj.contains("\"approval\":true") && tj.contains("\"approval\":false"))
        // 系统提示从注册表组装：不是硬编一条 "you are dsh"，
        // 而是把已登记工具的名与描述追加在角色定义之后
        let sp = SystemPromptBuilder(reg).build()
        expect("系统提示含角色定义", sp.contains("you are dsh"))
        expect("系统提示含已登记工具名", sp.contains("write") && sp.contains("read"))
        expect("系统提示含工具描述", sp.contains("写临时工作区文件"))
        expect("JSON 转义函数不吞反斜杠", jsonEscape("a\\b") == "a\\\\b")
        // 退出码必须按失败族分开：调用方要答得出「被谁拦的」，不能全挤成 1
        expect("放行退 0", callExitCode(true, "ok") == Int64(0))
        expect("审批没过退 3", callExitCode(false, "approval-denied") == Int64(3))
        expect("工具不存在退 4", callExitCode(false, "unregistered") == Int64(4) && callExitCode(false, "unknown-tool") == Int64(4))
        expect("执行期失败另退 8", callExitCode(false, "not-found") == Int64(8) && callExitCode(false, "fs-stale-version") == Int64(8))
        // 没登记的工具不该发工单：先要号再拒，等于让用户回答一个根本跑不了的动作，
        // 日志里还留下一条指向不存在工具的 approval/asked。
        expect("需审批的已登记工具才发工单", needsTicket(reg, "write"))
        expect("免审批工具不发工单", !needsTicket(reg, "read"))
        expect("未登记工具不发工单", !needsTicket(reg, "nosuch"))
        // 工单号跨进程不复用，在 CLI 交付面上的表现：把日志落盘、换一个 SessionLog
        // 对象回放，再开一张桌子——必须接在已有最大号之后，而不是又从 1 开始。
        // 一次 `dsh call` 就是一个新进程，从 1 重来会让日志里出现两条同号的 asked。
        hlog.flush()
        let rlog = SessionLog(hp)
        expect("重启回放能读回已落盘日志", rlog.load())
        let desk2 = ApprovalDesk(rlog)
        let t6 = desk2.ask("write")
        expect("重启后发号接在日志上的最大号之后", t6 > t4)
        var askedTotal: Int64 = 0
        var askedDistinct: Int64 = 0
        let seenIds = ArrayList<String>()
        for (ev in rlog.snapshotEvents()) {
            if (ev.eventType == "approval/asked") {
                askedTotal += 1
                let head = ev.data.split(":")[0]
                var fresh = true
                for (x in seenIds) {
                    if (x == head) { fresh = false }
                }
                if (fresh) {
                    seenIds.add(head)
                    askedDistinct += 1
                }
            }
        }
        expect("日志里每条 asked 的号互不相同", askedTotal == askedDistinct)
        // 本块共发过 4 张号（t1/t2/t4 三张 + 重启后的 t6）；t3 是复用 t2，不发新号
        expect("日志上的 asked 条数等于发号次数", askedTotal == Int64(4) && askedDistinct == Int64(4))
        // 上一进程发过的号在新桌子上既不该应答也不该消费
        expect("重启后旧号不能在新桌子上改判", !desk2.answer(t2, "denied") && desk2.consume(t2, "write") == "")
        hlog.flush()
        removeIfExists(hp, recursive: false)
        removeIfExists("${hp}.lease", recursive: false)
        removeIfExists("probe-headless.txt", recursive: false)
    }

    if (mode == "extjs") {
        // 第二个入口：CLI 用同一份 core 把 JS 扩展宿主作为子进程拉起来跑完整生命周期。
        // 用法：dsh extjs [node 命令] [extjs 目录]
        let nodeCmd = if (args.size > 1) { args[1] } else { "node" }
        // 目录优先级：显式参数 > DSH_EXTJS_DIR（npm 安装态由启动包装指到包内 extjs/）> 仓库相对 "extjs"。
        // 从 npm 装出来的 dsh 没有仓库目录可退，缺这一档就会在 WorkingDirectory 上炸掉。
        let hostDir = if (args.size > 2) {
            args[2]
        } else if (let Some(d) <- getVariable("DSH_EXTJS_DIR")) {
            d
        } else {
            "extjs"
        }
        let xp = ExtProcess(nodeCmd, ["server.cjs"], workingDirectory: Path(hostDir))
        expect("仓颉核心能拉起 JS 扩展宿主", xp.start())
        if (xp.alive()) {
            var hand = ""
            if (let Some(f) <- xp.initialize()) {
                hand = f
            }
            expect("握手帧来自子进程真实应答", hand.contains("protocolVersion"))
            var ld = ""
            if (let Some(f) <- xp.load("example/echo.cjs")) {
                ld = f
            }
            expect("JS 工具注册后可列出", ld.contains("example.echo"))
            var cl = ""
            if (let Some(f) <- xp.call("example.echo", "from-cli")) {
                cl = f
            }
            expect("JS 工具经管道调用回传结果", cl.contains("from-cli"))
            xp.dispose("example.echo")
            var af = ""
            if (let Some(f) <- xp.list()) {
                af = f
            }
            expect("卸载后注册残留为 0", !af.contains("example.echo"))
            var ur = ""
            if (let Some(f) <- xp.call("no.such.tool", "x")) {
                ur = f
            }
            // 未登记工具必须由宿主明确拒绝，而不是本端替它编一个终态
            expect("未登记工具由宿主明确拒绝", ur.contains("unknown-tool"))
            // 两入口共用同一条「发出 + 独立线程收帧 + 按 callId 取消」的路径：
            // CLI 也走一遍，不能只有桌面入口验过。
            xp.load("example/delayed.cjs")
            let sink = ThreadSafeDeliveryQueue(8)
            expect("可取消的调用能异步发出", xp.callAsync(Int64(4242), "example.delayed", "cli-async", sink))
            var ack = ""
            if (let Some(f) <- xp.cancelCall(Int64(4242))) {
                ack = f
            }
            expect("在途调用按 callId 取消成功", ack.contains("\"cancelled\":true"))
            var fr = ""
            var spins: Int64 = 0
            while (fr.size == 0 && spins < 200) {
                let got = sink.take(Int64(8))
                if (got.size > 0) {
                    fr = got[0]
                } else {
                    sleep(20 * Duration.millisecond)
                    spins += 1
                }
            }
            expect("取消的终态帧由 sink 交出", fr.contains("-32021"))
            expect("收帧线程全部收束", xp.joinWaiters(Int64(2000)) == Int64(1) && xp.inflightWaiters() == Int64(0))
            let rc = xp.close()
            expect("宿主优雅退出而非被强杀", rc == Int64(0) && !xp.forcedExit())
            var after = true
            if (let Some(_) <- xp.initialize()) {
                after = false
            }
            expect("子进程收束后不得再有应答", after)
        } else {
            println("FAIL 宿主起不来：${xp.startFailure()}")
            failures += 1
        }
        println("extjs\treceived=${xp.received()}\tunsolicited=${xp.unsolicited()}\tlate=${xp.late()}\texit=${xp.exitCode()}")
    }

    if (mode == "tools") {
        // 交付面：清单只出自注册表这一份真源，和桌面入口看到的一样。
        let reg = builtinTools()
        if (hasFlag(args, "--json")) {
            println(toolsJson(reg))
        } else {
            for (n in toolsList(reg)) {
                let need = if (reg.requiresApproval(n)) { "approval" } else { "free" }
                println("tool\t${n}\t${need}\t${reg.describe(n)}")
            }
        }
        return 0
    }

    if (mode == "call") {
        // headless 的一次工具调用：审批凭据只能是核心发的工单号，应答从标准输入读一行。
        // 读不到（EOF / 重定向到空设备）就是「没有应答者」——不作答、不猜一个「批过了」，
        // 让 executeWithApproval 按 pending 拒掉。诊断与提示一律走 stderr，stdout 只放结果。
        let ps = positionals(args, 1)
        if (Int64(ps.size) == 0) {
            getStdErr().writeln("usage: dsh call <tool> [args...] [--json]")
            return 64
        }
        let toolName = ps[0]
        var toolArgs = ""
        var pi: Int64 = 1
        while (pi < Int64(ps.size)) {
            if (pi > 1) {
                toolArgs += " "
            }
            toolArgs += ps[pi]
            pi += 1
        }
        let asJson = hasFlag(args, "--json")
        let lease = WriteLease("session.log")
        if (!lease.takeoverIfStale()) {
            getStdErr().writeln("err\talready-owned")
            return 5
        }
        let log = SessionLog("session.log")
        if (!log.load()) {
            lease.release()
            getStdErr().writeln("err\treplay-rejected")
            return 6
        }
        let reg = builtinTools()
        let desk = ApprovalDesk(log)
        let rt = ToolRuntime(log, reg)
        var approvalId: Int64 = Int64(-1)
        if (needsTicket(reg, toolName)) {
            approvalId = desk.ask(toolName)
            getStdErr().writeln("approval\task\t${approvalId}\t${toolName}")
            getStdErr().writeln("prompt\t允许一次？[y/N]")
            getStdErr().flush()
            let ans = decideAnswer(getStdIn().readln())
            if (ans == "") {
                getStdErr().writeln("approval\tno-answerer\t${approvalId}")
            } else if (!desk.answer(approvalId, ans)) {
                getStdErr().writeln("approval\tanswer-rejected\t${approvalId}")
            }
        }
        let out = rt.executeWithApproval(toolName, toolArgs, approvalId, true, desk)
        let stage = rt.lastDetail.stage
        var code: Int64 = callExitCode(out.allowed, stage)
        if (log.flush()) {
            lease.release()
        } else {
            getStdErr().writeln("err\tflush-failed\tlease-retained")
            code = if (code == 0) { 7 } else { code }
        }
        if (asJson) {
            println(callJson(toolName, toolArgs, out, code))
        } else {
            let verdict = if (out.allowed) { "ok" } else { "denied" }
            println("call\t${toolName}\t${verdict}\t${stage}\t${out.why}")
        }
        getStdErr().writeln("approval\tstate\t${if (approvalId < 0) { "n/a" } else { desk.stateOf(approvalId) }}")
        return code
    }

    if (mode == "realstream") {
        // 真实 SSE 轮：用 RealSseProvider 对本机夹具跑完整一轮并断言。
        // env 经 shell 透传；baseUrl 空串时合法 skip（本机没起夹具）。
        let baseUrl = getVariable("DSH_PROVIDER_BASE_URL") ?? ""
        let model = getVariable("DSH_PROVIDER_MODEL") ?? "gpt-3.5-turbo"
        var key = getVariable("DSH_PROVIDER_KEY") ?? ""
        if (key.size == 0) {
            key = getVariable("STEPFUN_API_KEY") ?? ""
        }
        if (baseUrl.size == 0) {
            println("skip: DSH_PROVIDER_BASE_URL unset")
            return 0
        }
        let reqBody = "{\"model\":\"${jsonEscapeText(model)}\",\"messages\":[{\"role\":\"user\",\"content\":\"${jsonEscapeText("hello")}\"}],\"stream\":true}"
        let sp = "realstream-cli.log"
        removeIfExists(sp, recursive: false)
        removeIfExists("${sp}.lease", recursive: false)
        let log = SessionLog(sp)
        let tk = TurnToken()
        let p = RealSseProvider(baseUrl, key, reqBody, tk)
        let sr = TurnLoop().run(p, tk, log, DeliveryQueue(8))
        expect("真实流自然收束", !sr.cancelled && sr.finishReason == "stop")
        expect("夹具正文", sr.text == "first")
        expect("夹具用量", sr.usage == "22")
        expect("三帧交付", sr.delivered == Int64(3))
        expect("未被中断", !sr.interrupted)
        log.flush()
        let rlog = SessionLog(sp)
        var replayed = false
        if (rlog.load()) {
            for (m in rlog.deriveMessages()) {
                if (m.contains("assistant/message: first")) {
                    replayed = true
                }
            }
        }
        expect("落盘后回放助手正文", replayed)
        removeIfExists(sp, recursive: false)
        removeIfExists("${sp}.lease", recursive: false)
        println("realstream\tcancelled=${sr.cancelled}\tdelivered=${sr.delivered}\ttext=${sr.text}\tusage=${sr.usage}\tfinish=${sr.finishReason}")
    }

    if (mode == "all" || mode == "goal") {
        // 目标模式 CLI 一致性：与桌面共用同一份 core 目标引擎——生命周期 CAS、分隔符护栏、
        // 崩溃恢复、跨轮驱动「没拿到证据不收口」。goal-cli.log 用后即删，不碰别的模式的日志。
        let gp = "goal-cli.log"
        removeIfExists(gp, recursive: false)
        let glog = SessionLog(gp)
        let gsvc = GoalService(glog)
        let created = gsvc.create("复刻到底")
        expect("goal 建立 active rev1 id=goal-1", created.phase == "active" && created.revision == Int64(1) && created.id == "goal-1")
        // 陈旧 CAS：不改目标、不留事件（日志不谎称改过）。
        let revBefore = gsvc.snapshot().revision
        let evtBefore = glog.eventCount()
        var staleMsg = ""
        try {
            gsvc.edit(Int64(0), "改写")
            staleMsg = "accepted"
        } catch (e: Exception) {
            staleMsg = e.message
        }
        expect("goal 陈旧修订被拒且不留事件", staleMsg == "stale-goal-revision" && glog.eventCount() == evtBefore && gsvc.snapshot().revision == revBefore)
        // 暂停→恢复：状态迁移与修订递增。
        gsvc.pause(Int64(1))
        let paused = gsvc.snapshot()
        gsvc.resume(Int64(2))
        let resumed = gsvc.snapshot()
        expect("goal 暂停/恢复迁移", paused.phase == "paused" && resumed.phase == "active" && resumed.revision == Int64(3))
        // 分隔符护栏：objective 含 `|` 在写入处被拒，revision 不进。
        var delimMsg = ""
        try {
            gsvc.edit(Int64(3), "甲|乙")
            delimMsg = "accepted"
        } catch (e: Exception) {
            delimMsg = e.message
        }
        expect("goal objective 含分隔符被拒", delimMsg == "bad-goal-content" && gsvc.snapshot().revision == Int64(3))
        // 崩溃恢复：flush→重载，从 goal/change 条数重算 phase/revision。
        let flushed = glog.flush()
        let reload = SessionLog(gp)
        let loaded = reload.load()
        let reSnap = GoalService(reload).snapshot()
        expect("goal 崩溃恢复 active rev3", flushed && loaded && reSnap.phase == "active" && reSnap.revision == Int64(3))
        // 跨轮驱动：连续跑，第 2 轮才给证据 → 经 CAS 收口；goal/round 落 2 条。
        let dsched = GoalScheduler(glog, { => Int64(0) })
        let tick = CliRoundTick()
        let dres = GoalDriver(dsched, gsvc).run(Int64(10), Int64(100000), Int64(0), { => false }, { =>
            tick.bump()
            RoundOutcome(true, tick.n >= Int64(2))
        })
        expect("goal 驱动连续跑到有证据收口", dres.stopReason == "completed" && dres.rounds == Int64(2) && gsvc.snapshot().phase == "complete")
        expect("goal 驱动 goal/round 落 2 条 log-only", dsched.roundsDone() == Int64(2))
        // 无证据撞轮数上限 → applyStop 落 goal-round-limit 阻塞，不空转。
        let gp2 = "goal-cli-limit.log"
        removeIfExists(gp2, recursive: false)
        let llog = SessionLog(gp2)
        let lsvc = GoalService(llog)
        lsvc.create("拿不到证据")
        let lsched = GoalScheduler(llog, { => Int64(0) })
        let lres = GoalDriver(lsched, lsvc).run(Int64(2), Int64(100000), Int64(0), { => false }, { => RoundOutcome(true, false) })
        let lsnap = lsvc.snapshot()
        expect("goal 无证据撞轮数上限落阻塞", lres.stopReason == "round-limit" && lres.rounds == Int64(2) && lsnap.phase == "blocked" && lsnap.blockedReason == "goal-round-limit")
        // 入口级组合证据：目标存成 log-only 的 goal/change，模型历史看不见它；只有注入系统提示，
        // 正文才经 modelRequestJson 进请求体。两条对照（都建了同一个 goal）钉住「注入是唯一通路」。
        let reqPath = "goal-cli-req.log"
        let plainPath = "goal-cli-plain.log"
        removeIfExists(reqPath, recursive: false)
        removeIfExists(plainPath, recursive: false)
        let rreg = ToolRegistry()
        let rlog = SessionLog(reqPath)
        let rg = GoalService(rlog).create("GOAL-REPLICATE-49-MODULES")
        rlog.append("system/message", SystemPromptBuilder(rreg).build(goal: rg, rounds: Int64(2), elapsed: Int64(9)))
        rlog.append("user/message", "继续")
        let rbody = modelRequestJson("test-model", rlog.snapshotEvents().toArray())
        let plog = SessionLog(plainPath)
        GoalService(plog).create("GOAL-REPLICATE-49-MODULES")
        plog.append("system/message", SystemPromptBuilder(rreg).build())
        plog.append("user/message", "继续")
        let pbody = modelRequestJson("test-model", plog.snapshotEvents().toArray())
        expect("注入后目标正文进入模型请求体", rbody.contains("GOAL-REPLICATE-49-MODULES"))
        expect("不注入则 log-only 目标进不了模型请求体", !pbody.contains("GOAL-REPLICATE-49-MODULES"))
        removeIfExists(gp, recursive: false)
        removeIfExists(gp2, recursive: false)
        removeIfExists(reqPath, recursive: false)
        removeIfExists(plainPath, recursive: false)
    }

    if (failures == 0) { println("ALL PASS"); return 0 }
    println("FAILURES=${failures}")
    return 1
}
