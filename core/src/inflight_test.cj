package core

import std.unittest.*

// 在途登记的语义：取消只认「还在途」的那笔，结算过的不能再被取消。

@Test
func inflightAddRejectsDuplicateCallId() {
    let f = InflightCalls()
    @Expect(f.add(Int64(7)), true)
    @Expect(f.add(Int64(7)), false)
    @Expect(f.count(), Int64(1))
    @Expect(f.has(Int64(7)), true)
    @Expect(f.has(Int64(8)), false)
}

@Test
func inflightSettleRemovesOnlyThatCallAndTwiceFails() {
    let f = InflightCalls()
    f.add(Int64(1))
    f.add(Int64(2))
    @Expect(f.settle(Int64(1)), true)
    @Expect(f.settle(Int64(1)), false)
    @Expect(f.count(), Int64(1))
    @Expect(f.has(Int64(2)), true)
    @Expect(f.settle(Int64(99)), false)
}

// 快照独立：调用方清空自己的副本不能把登记表清空（与 ToolRegistry.list 同一约定）
@Test
func inflightListIsSnapshot() {
    let f = InflightCalls()
    f.add(Int64(3))
    f.add(Int64(4))
    let snap = f.list()
    @Expect(snap.size, Int64(2))
    snap.clear()
    @Expect(f.count(), Int64(2))
    @Expect(f.has(Int64(3)), true)
}
