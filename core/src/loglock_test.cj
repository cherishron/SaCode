package core

import std.unittest.*
import std.collection.ArrayList
import std.sync.*
import std.fs.*

// 会话日志的并发面：turn 线程在写的同时，桌面要能读投影、CLI 也能读投影。
// 这里钉的是「唯一真相源不被并发写坏」，不是「读起来大概对」。

func lockPath(tag: String): String {
    return "core-lock-${tag}.log"
}

func lockClean(tag: String) {
    removeIfExists(lockPath(tag), recursive: false)
    removeIfExists("${lockPath(tag)}.lease", recursive: false)
}

@Test
func concurrentAppendersKeepSeqContiguous() {
    let p = lockPath("conc")
    lockClean("conc")
    let log = SessionLog(p)
    // 栅栏：4 个写者必须同一时刻冲进 append，否则测不到 size→add 之间的竞争
    // （上一版没有栅栏，摘掉锁的变异体照样绿，等于白测）
    let gate = SyncCounter(4)
    let hs = ArrayList<Future<Int64>>()
    var t: Int64 = 0
    while (t < 4) {
        let id = t
        hs.add(spawn { =>
            gate.dec()
            gate.waitUntilZero()
            var i: Int64 = 0
            while (i < 80) {
                log.append("user/message", "w${id}-${i}")
                i += 1
            }
            Int64(80)
        })
        t += 1
    }
    for (f in hs) {
        f.get()
    }
    @Expect(log.eventCount(), Int64(320))
    @Expect(log.verifySeqContiguous(), true)
    // 序号重复是两个写者同时读到同一个 size 的结果，必须为 0
    let snap = log.snapshotEvents()
    var dup: Int64 = 0
    for (a in snap) {
        for (b in snap) {
            if (a.seq == b.seq && a.data != b.data) {
                dup += 1
            }
        }
    }
    @Expect(dup, Int64(0))
    @Expect(log.flush(), true)
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(r.eventCount(), Int64(320))
    lockClean("conc")
}

@Test
func projectionStaysConsistentWhileAnotherThreadAppends() {
    let p = lockPath("live")
    lockClean("live")
    let log = SessionLog(p)
    log.append("system/message", "sys")
    let w = spawn { =>
        var i: Int64 = 0
        while (i < 60) {
            log.append("user/message", "live-${i}")
            i += 1
        }
        Int64(60)
    }
    var prev: Int64 = 0
    var monotone = true
    var crashed = false
    var rounds: Int64 = 0
    while (rounds < 60) {
        try {
            let n = Int64(log.deriveMessages().size)
            if (n < prev) {
                monotone = false
            }
            prev = n
        } catch (e: Exception) {
            crashed = true
        }
        rounds += 1
    }
    w.get()
    @Expect(crashed, false)
    @Expect(monotone, true)
    @Expect(log.eventCount(), Int64(61))
    @Expect(log.verifySeqContiguous(), true)
    lockClean("live")
}

@Test
func durabilityCountersAreVisiblePerSnapshot() {
    let p = lockPath("count")
    lockClean("count")
    let log = SessionLog(p)
    var i: Int64 = 0
    while (i < 5) {
        log.append("user/message", "n${i}")
        i += 1
    }
    // 未 flush 前：内存可见但跨进程不可见
    @Expect(log.eventCount(), Int64(5))
    @Expect(log.durableCount(), Int64(0))
    @Expect(log.pendingCount(), Int64(5))
    @Expect(log.flush(), true)
    @Expect(log.durableCount(), Int64(5))
    @Expect(log.pendingCount(), Int64(0))
    lockClean("count")
}

// 更强的并发写证据：上一版四个写者只做纯内存 append，本运行时的 spawn 在纯 CPU
// 循环里没有抢占点，摘掉锁也测不出来（已在方案 §8 决策 17 记为「守卫断言不是证据」）。
// 这条让每个写者真的落盘——flush 走文件系统调用，那里才有真交错；同时另开一条
// 线程不停从磁盘重放，任何一次重放都必须自洽：要么拿到整行，要么什么都没拿到。
@Test
func appendFlushAndReplayInterleaveWithoutTearing() {
    let p = lockPath("flush")
    lockClean("flush")
    let log = SessionLog(p)
    let gate = SyncCounter(3)
    let hs = ArrayList<Future<Int64>>()
    var t: Int64 = 0
    while (t < 3) {
        let id = t
        hs.add(spawn { =>
            gate.dec()
            gate.waitUntilZero()
            var i: Int64 = 0
            while (i < 40) {
                log.append("user/message", "f${id}-${i}")
                log.flush()
                i += 1
            }
            Int64(40)
        })
        t += 1
    }
    var selfConsistent = true
    var rounds: Int64 = 0
    while (rounds < 60) {
        let r = SessionLog(p)
        if (!r.load()) {
            selfConsistent = false
        }
        if (r.events.size > Int64(0) && !r.verifySeqContiguous()) {
            selfConsistent = false
        }
        sleep(5 * Duration.millisecond)
        rounds += 1
    }
    var k: Int64 = 0
    while (k < hs.size) {
        try {
            hs[k].get(4000 * Duration.millisecond)
        } catch (e: Exception) {
            selfConsistent = false
        }
        k += 1
    }
    @Expect(selfConsistent, true)
    @Expect(log.eventCount(), Int64(120))
    @Expect(log.verifySeqContiguous(), true)
    let fin = SessionLog(p)
    @Expect(fin.load(), true)
    @Expect(fin.eventCount(), Int64(120))
    // 撕裂的行（半行落盘）在这里现形：每行必须是三字段
    let txt = String.fromUtf8(File.readFrom(p))
    var lines: Int64 = 0
    var bad: Int64 = 0
    for (line in txt.split("\n")) {
        if (line.size > 0) {
            lines += 1
            if (line.split("\t").size != 3) {
                bad += 1
            }
        }
    }
    @Expect(lines, Int64(120))
    @Expect(bad, Int64(0))
    lockClean("flush")
}
