package core
import std.fs.*
import std.unittest.*

// Jobs 上游契约（499 行）：`JobId = <kind>-N` 单调分配；`JobStatus`
// 五态 running/stopping/completed/killed/failed。本切片实现 registry
// 的状态机与非法转换拒绝，不接子进程/背压/output ring（属 subprocess 与
// agent.cj 主战场，避开并发冲突）。

@Test
func jobStartAssignsKindPrefixedSequentialId() {
    let store = JobStore()
    let a = store.start("bash", "跑一次测试")
    let b = store.start("bash", "再跑一次")
    let c = store.start("subagent", "起一个子代理")
    @Expect(a, "bash-1")
    @Expect(b, "bash-2")
    @Expect(c, "subagent-1")
    @Expect(store.get(a).status, "running")
}

@Test
func jobStatusTransitionRejectsTerminalToRunning() {
    let store = JobStore()
    let id = store.start("bash", "一次性")
    store.mark(id, "completed")
    @Expect(store.get(id).status, "completed")
    var threw = false
    try {
        store.mark(id, "running")
    } catch (e: Exception) {
        threw = true
    }
    // 终态不可回退——completed/killed/failed 都不允许再转回 running。
    @Expect(threw, true)
    @Expect(store.get(id).status, "completed")
}

@Test
func jobKillGoesThroughStoppingToKilled() {
    let store = JobStore()
    let id = store.start("bash", "长任务")
    store.mark(id, "stopping")
    store.mark(id, "killed")
    @Expect(store.get(id).status, "killed")
    @Expect(store.list().size, Int64(1))
}

@Test
func jobUnknownIdRejectedWithoutMutation() {
    let store = JobStore()
    store.start("bash", "唯一")
    var threw = false
    try {
        store.mark("bash-99", "completed")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(store.get("bash-1").status, "running")
}
