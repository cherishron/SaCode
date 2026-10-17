package core
import std.collection.ArrayList
import std.collection.HashMap

// 委派权重选择器：纯函数、无副作用（design §2.6.1）。
// 规则按用户拍板执行：
//   1. 显式指定优先：explicitPeer 存在时直接置顶并忽略权重（REQ-W-06）
//   2. 数值权重越大越优先：按 weight 降序
//   3. 并列按产品标识字典序稳定序
//   4. 默认全部相等：未设置权重时所有协作者权重相等，回落到字典序（REQ-W-04）
//   5. 只读消费：不改写权重（spec 6.10.6）
// 只在 create 的"未显式指定"分支被引用；失败路径无引用点（REQ-W-07、REQ-FAIL-01）。
public class AcpWeightSelector {

    public init() {}

    // 选择有序候选：返回按权重降序 + 字典序稳定排列的 peer 列表。
    // explicitPeer 存在时直接置顶，其余按权重排序。
    public func select(peers: ArrayList<String>, weights: HashMap<String, Int64>,
        explicitPeer: Option<String>): ArrayList<String> {
        let result = ArrayList<String>()

        // 规则 1：显式指定优先
        if (let Some(explicit) <- explicitPeer) {
            // 显式指定的 peer 置顶（如果在 peers 中存在）
            for (p in peers) {
                if (p == explicit) {
                    result.add(p)
                }
            }
            // 其余 peer 按权重排序追加
            let rest = ArrayList<String>()
            for (p in peers) {
                if (p != explicit) {
                    rest.add(p)
                }
            }
            let sortedRest = sortByWeight(rest, weights)
            for (p in sortedRest) {
                result.add(p)
            }
            return result
        }

        // 规则 2-4：按权重降序，并列按字典序
        let sorted = sortByWeight(peers, weights)
        for (p in sorted) {
            result.add(p)
        }
        return result
    }

    // 按权重降序排序，并列按产品标识字典序稳定序。
    // 简单选择排序：peer 数量通常 1-3 个，性能不是瓶颈。
    private func sortByWeight(peers: ArrayList<String>, weights: HashMap<String, Int64>): ArrayList<String> {
        let n = peers.size
        if (n <= 1) {
            let out = ArrayList<String>()
            for (p in peers) { out.add(p) }
            return out
        }
        // 已选中的标记，避免重复选取
        let used = ArrayList<Bool>()
        for (_ in 0..n) { used.add(false) }
        let result = ArrayList<String>()
        var remaining = n
        while (remaining > 0) {
            var bestIdx: Int64 = -1
            var bestPeer = ""
            var bestWeight = Int64(0)
            var found = false
            var i: Int64 = 0
            while (i < n) {
                if (!used[i]) {
                    let w = weightOf(peers[i], weights)
                    if (!found) {
                        found = true
                        bestIdx = i
                        bestPeer = peers[i]
                        bestWeight = w
                    } else if (w > bestWeight) {
                        bestWeight = w
                        bestIdx = i
                        bestPeer = peers[i]
                    } else if (w == bestWeight) {
                        // 并列按字典序：取更小的
                        if (peers[i] < bestPeer) {
                            bestIdx = i
                            bestPeer = peers[i]
                        }
                    }
                }
                i += 1
            }
            if (!found) { break }
            result.add(bestPeer)
            used[bestIdx] = true
            remaining -= 1
        }
        return result
    }

    // 取 peer 的权重，未设置默认 0（所有未设置的权重相等）
    private func weightOf(peerId: String, weights: HashMap<String, Int64>): Int64 {
        if (let Some(w) <- weights.get(peerId)) {
            return w
        }
        return Int64(0)
    }
}