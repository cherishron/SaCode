package core
import std.collection.ArrayList
import std.collection.HashMap
import std.unittest.*

// AcpWeightSelector 单测（任务 6.3）。
// 验收：正向 排序稳定可复现；失败/越权 缺省不随机、显式覆盖生效；恢复/并发 纯函数无状态。

@Test
func acpWeightExplicitPeerGoesFirst() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("codebuddy")
    peers.add("opencode")
    peers.add("qoder")
    let weights = HashMap<String, Int64>()
    weights["opencode"] = Int64(100)
    weights["codebuddy"] = Int64(50)
    let result = sel.select(peers, weights, Some("qoder"))
    @Expect(result.size, Int64(3))
    @Expect(result[0], "qoder")
    @Expect(result[1], "opencode")
    @Expect(result[2], "codebuddy")
}

@Test
func acpWeightDescendingOrderByWeight() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("opencode")
    peers.add("codebuddy")
    peers.add("qoder")
    let weights = HashMap<String, Int64>()
    weights["opencode"] = Int64(10)
    weights["codebuddy"] = Int64(50)
    weights["qoder"] = Int64(30)
    let result = sel.select(peers, weights, None)
    @Expect(result.size, Int64(3))
    @Expect(result[0], "codebuddy")
    @Expect(result[1], "qoder")
    @Expect(result[2], "opencode")
}

@Test
func acpWeightTieBreakByLexicographicOrder() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("qoder")
    peers.add("opencode")
    peers.add("codebuddy")
    let weights = HashMap<String, Int64>()
    // 所有权重相等（都设为 10）
    weights["qoder"] = Int64(10)
    weights["opencode"] = Int64(10)
    weights["codebuddy"] = Int64(10)
    let result = sel.select(peers, weights, None)
    @Expect(result.size, Int64(3))
    @Expect(result[0], "codebuddy")
    @Expect(result[1], "opencode")
    @Expect(result[2], "qoder")
}

@Test
func acpWeightDefaultAllEqualFallsBackToLexicographic() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("qoder")
    peers.add("opencode")
    peers.add("codebuddy")
    // 空权重表：所有 peer 权重默认 0（相等）
    let weights = HashMap<String, Int64>()
    let result = sel.select(peers, weights, None)
    @Expect(result.size, Int64(3))
    @Expect(result[0], "codebuddy")
    @Expect(result[1], "opencode")
    @Expect(result[2], "qoder")
}

@Test
func acpWeightExplicitPeerNotInListReturnsOriginal() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("opencode")
    peers.add("codebuddy")
    let weights = HashMap<String, Int64>()
    weights["opencode"] = Int64(10)
    // 显式指定不在列表中的 peer：只排原有的
    let result = sel.select(peers, weights, Some("nonexistent"))
    @Expect(result.size, Int64(2))
    @Expect(result[0], "opencode")
    @Expect(result[1], "codebuddy")
}

@Test
func acpWeightSinglePeerReturnsSingle() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("opencode")
    let weights = HashMap<String, Int64>()
    let result = sel.select(peers, weights, None)
    @Expect(result.size, Int64(1))
    @Expect(result[0], "opencode")
}

@Test
func acpWeightEmptyPeersReturnsEmpty() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    let weights = HashMap<String, Int64>()
    let result = sel.select(peers, weights, None)
    @Expect(result.size, Int64(0))
}

@Test
func acpWeightPartialWeightsUnsetDefaultZero() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("opencode")
    peers.add("codebuddy")
    peers.add("qoder")
    let weights = HashMap<String, Int64>()
    // 只有 codebuddy 设了权重，其余默认 0
    weights["codebuddy"] = Int64(5)
    let result = sel.select(peers, weights, None)
    @Expect(result.size, Int64(3))
    @Expect(result[0], "codebuddy")
    // opencode 和 qoder 权重都是 0，按字典序
    @Expect(result[1], "opencode")
    @Expect(result[2], "qoder")
}

@Test
func acpWeightStableAcrossCalls() {
    let sel = AcpWeightSelector()
    let peers = ArrayList<String>()
    peers.add("qoder")
    peers.add("opencode")
    peers.add("codebuddy")
    let weights = HashMap<String, Int64>()
    weights["opencode"] = Int64(10)
    weights["codebuddy"] = Int64(10)
    // 连续两次调用结果必须一致（纯函数无状态）
    let r1 = sel.select(peers, weights, None)
    let r2 = sel.select(peers, weights, None)
    @Expect(r1.size, Int64(3))
    @Expect(r2.size, Int64(3))
    @Expect(r1[0], r2[0])
    @Expect(r1[1], r2[1])
    @Expect(r1[2], r2[2])
    // codebuddy 和 opencode 权重相等(10)，字典序 codebuddy 在前
    @Expect(r1[0], "codebuddy")
    @Expect(r1[1], "opencode")
    @Expect(r1[2], "qoder")
}