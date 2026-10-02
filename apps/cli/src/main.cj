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

    if (mode != "all" && mode != "stream" && mode != "tool" && mode != "ext" && mode != "cancel" && mode != "projection" && mode != "seed") {
        getStdErr().writeln("usage: dsh [seed|projection|all|stream|tool|ext|cancel]")
        return 64
    }

    if (mode == "projection") {
        let sl = SessionLog("session.log")
        if (!sl.load()) {
            println("err\treplay-rejected")
            return 1
        }
        println("ok\t${sl.deriveMessages().size}\t${sl.events.size}")
        for (s in sl.deriveMessages()) {
            println("msg\t${s}")
        }
        return 0
    }

    if (mode == "seed") {
        let lease = WriteLease("session.log")
        if (!lease.acquire()) {
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
        println("ok\tseeded\t${sl.events.size}")
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
        for (ev in log.events) {
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
        let rt = ToolRuntime(log, reg)
        let allow = rt.execute("write", "probe-tool.txt hello", "allowed-once", true)
        expect("allowed-once 放行并执行", allow.allowed && allow.why == "ok:probe-tool.txt")
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
        expect("tool/call 持久但不进模型历史", !projHasToolCall && r.events.size >= 6)
    }

    if (failures == 0) { println("ALL PASS"); return 0 }
    println("FAILURES=${failures}")
    return 1
}
