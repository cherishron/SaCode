package host
import core.*
import std.io.*

main(args: Array<String>) {
    let p = "session.log"
    let line = readln()
    let parts = line.split("	")
    if (parts.size < 2) {
        println("err	no-command")
        return 0
    }
    let log = SessionLog(p)
    let cmd = parts[0]
    if (cmd == "projection") {
        if (!log.load()) {
            println("err	replay-rejected")
            return 1
        }
        let m = log.deriveMessages()
        println("ok	${m.size}	${log.events.size}")
        for (s in m) {
            println("msg	${s}")
        }
        return 0
    }
    if (cmd == "append") {
        if (!log.load()) {
            println("err	replay-rejected")
            return 1
        }
        log.append(parts[1], parts[2])
        if (!log.flush()) {
            println("err	flush-failed")
            return 1
        }
        println("ok	${log.events.size}")
        return 0
    }
    println("err	unknown-command")
    return 1
}
