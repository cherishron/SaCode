package cli

main(args: Array<String>) {
    let p = "session.log"
    if (args.size > 0 && args[args.size - 1] == "replay") {
        let r = SessionLog(p)
        if (!r.load()) { println("FAIL 跨进程回放读取失败"); return 1 }
        let m = r.deriveMessages()
        println("跨进程 load: events=${r.events.size} 投影=${m.size} seq连续=${r.verifySeqContiguous()}")
        for (s in m) { println("  ${s}") }
        if (r.events.size == 6 && m.size == 3 && r.verifySeqContiguous()) { return 0 }
        return 1
    }
    let log = SessionLog(p)
    log.append("turn/start", "t1")
    log.append("system/message", "you are dsh")
    log.append("user/message", "hello")
    log.append("tool/call", "read a.txt")
    log.append("assistant/message", "hi there")
    log.append("turn/end", "completed")
    if (!log.flush()) { println("FAIL flush"); return 1 }
    println("写入 append=${log.events.size} 已落盘=${log.flushedCount} 投影=${log.deriveMessages().size}")
    return 0
}
