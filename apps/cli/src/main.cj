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

main(args: Array<String>) {
    let mode = if (args.size > 0) { args[0] } else { "all" }

    if (mode != "all" && mode != "stream" && mode != "tool" && mode != "ext" && mode != "cancel" && mode != "extjs" && mode != "projection" && mode != "seed" && mode != "sig") {
        getStdErr().writeln("usage: dsh [seed|projection|all|stream|tool|ext|cancel|extjs|sig]")
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
        sl.append("system/message", "you are dsh")
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

    if (failures == 0) { println("ALL PASS"); return 0 }
    println("FAILURES=${failures}")
    return 1
}
