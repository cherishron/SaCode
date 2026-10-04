package core
import std.collection.*

// Shell 记录：log-only `shell/exec` 事件承载 `<id>::<argvJoined>::<cwd>`；
// 三字段任一空各自抛；`entries()` 从事件流回放取 ArrayList。
//
// 本切片假设 id/argvJoined/cwd 不含 `::`；argv 拼接用空格。
public class ShellLedger {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func record(id: String, argvJoined: String, cwd: String): Unit {
        if (id.size == 0) {
            throw Exception("shell-empty-id")
        }
        if (argvJoined.size == 0) {
            throw Exception("shell-empty-argv")
        }
        if (cwd.size == 0) {
            throw Exception("shell-empty-cwd")
        }
        log.append("shell/exec", "${id}::${argvJoined}::${cwd}")
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "shell/exec") {
                out.add(event.data)
            }
        }
        return out
    }
}
