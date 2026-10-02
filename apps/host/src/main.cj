package host
import core.*

main(args: Array<String>) {
    let p = "session.log"
    let line = readln()
    let parts = line.split("	")
    if (parts.size < 2) {
        println("err	no-command")
        return 0
    }
    let cmd = parts[0]
    let lease = WriteLease(p)
    let log = SessionLog(p)
    if (cmd == "projection") {
        if (!log.load()) {
            println("err	replay-rejected")
            return 1
        }
        println("ok	${log.deriveMessages().size}	${log.events.size}")
        for (s in log.deriveMessages()) {
            println("msg	${s}")
        }
        return 0
    }
    if (cmd == "acquire") {
        if (!lease.acquire()) {
            println("err	already-owned")
            return 1
        }
        println("ok	lease-acquired")
        return 0
    }
    if (cmd == "release") {
        lease.release()
        println("ok	lease-released")
        return 0
    }
    if (cmd == "append") {
        if (!lease.acquire()) {
            println("err	already-owned")
            return 1
        }
        if (!log.load()) {
            println("err	replay-rejected")
            return 1
        }
        log.append(parts[1], parts[2])
        if (!log.flush()) {
            println("err	flush-failed")
            return 1
        }
        lease.release()
        println("ok	${log.events.size}")
        return 0
    }
    println("err	unknown-command")
    return 1
}
