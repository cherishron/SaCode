package core

import std.unittest.*

// 直接对登记表下针：子进程集成用例只能证明「链路通」，
// 证明不了「帧只会被自己那条 id 认领」——那需要在途多条且应答乱序，
// 靠真实时序做黑盒测试会飘，所以这里用可控的 put/take 顺序钉死。

@Test
func replyTablePairsByNotArrivalOrder() {
    let t = ReplyTable(4)
    t.track(1)
    t.track(2)
    // 后登记的 id 先回：等 1 的等待方不能把 2 的帧认领走
    t.put(2, "second")
    let w1 = spawn { => t.take(1, 300) }
    sleep(60 * Duration.millisecond)
    t.put(1, "first")
    var o1 = ""
    if (let Some(x) <- w1.get()) {
        o1 = x
    }
    @Expect(o1, "first")
    var o2 = ""
    if (let Some(x) <- t.take(2, 300)) {
        o2 = x
    }
    @Expect(o2, "second")
    @Expect(t.late(), Int64(0))
    @Expect(t.unsolicited(), Int64(0))
}

@Test
func replyTableBooksLateAndStraySeparately() {
    let t = ReplyTable(4)
    t.track(9)
    var got = false
    if (let Some(_) <- t.take(9, 60)) {
        got = true
    }
    @Expect(got, false)
    // 等待方收手后要显式摘掉登记（ExtProcess.request 就是这么串的），
    // 否则这条 id 还在「在途」名单里，后来的帧就该正常入表而不是记迟到
    t.untrack(9)
    t.put(9, "too-late")
    @Expect(t.late(), Int64(1))
    @Expect(t.unsolicited(), Int64(0))
    // 从来没人登记过（id 为 null 的 parse-error 帧就是 -1）：记无主账
    t.put(-1, "no-id")
    @Expect(t.unsolicited(), Int64(1))
    @Expect(t.late(), Int64(1))
}

@Test
func replyTableBackpressuresWithoutDropping() {
    let t = ReplyTable(2)
    t.track(1)
    t.track(2)
    t.track(3)
    t.put(1, "a")
    t.put(2, "b")
    // 表已满：第三条只能卡在回压里等位置，不许被丢掉
    let p3 = spawn { => t.put(3, "c") }
    sleep(80 * Duration.millisecond)
    @Expect(t.overflow() >= Int64(1), true)
    var o1 = ""
    if (let Some(x) <- t.take(1, 300)) {
        o1 = x
    }
    @Expect(o1, "a")
    p3.get()
    var o3 = ""
    if (let Some(x) <- t.take(3, 300)) {
        o3 = x
    }
    @Expect(o3, "c")
    @Expect(t.dropped(), Int64(0))
}
