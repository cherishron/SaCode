package core
import stdx.encoding.json.*

// 完成证据的**机械侧**：一条 log-only 的 `goal/evidence`，绑定开轮时的目标修订**与轮次号**。
// 两者都绑，是因为它们各挡一类挪用：修订挡住「旧目标/旧状态的结论落到新目标」，
// 轮次号挡住「早先某一轮的副作用替后面这一轮背书」。
//
// 为什么单开一种事件，而不是把「凭什么判定达成」塞进 goal/change：
//   1. goal/change 是状态，读者只问「现在是什么状态」；完成依据是另一问，
//      混进同一事件后就再也答不出「这一轮的收口依据是哪一次真实副作用」；
//   2. 修订与轮次双重绑定让证据不可跨目标、跨轮次挪用——与 completeIfEvidenced 的 CAS
//      是同一条围栏，只是这里更严：CAS 只挡住目标换了，轮次号还挡住「上一轮的副作用
//      替这一轮背书」；
//   3. 它不进 isSurfaceEvent，所以不污染桌面转录与 deriveMessages；
//      只在请求装配时折成一条 developer 消息（见 model_request.cj）。
//
// 声明侧（模型显式声明完成）不在本文件：那是上游 tool-goal 的模型工具通道，
// 需要在 ToolRuntime.pipeline 上加分支。在它接上之前，本仓的完成闸默认关闭
// （GoalRunner 的 claim 闭包恒假）——宁可目标跑到限额落阻塞，也不让「工具调用次数」
// 单独充当完成证明。
let EVIDENCE_EVENT = "goal/evidence"

public class GoalEvidence {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    // 只在「目标仍 active 且修订未变」时落证据；否则返回 false 且一条事件都不写。
    // 轮内被编辑/暂停/清除的目标不该再收到一份「完成依据」——那等于替新状态背书。
    public func record(revision: Int64, round: Int64): Bool {
        var written = false
        synchronized(log.mtx) {
            let current = GoalService(log).snapshot()
            if (current.phase == "active" && current.revision == revision) {
                let obj = JsonObject()
                obj.put("revision", JsonInt(revision))
                obj.put("round", JsonInt(round))
                log.append(EVIDENCE_EVENT, obj.toString())
                written = true
            }
        }
        return written
    }

    // 纯读：这一轮是否已经落过机械证据。完成闸读的是日志而不是内存布尔，
    // 于是「完成依据」这件事在崩溃恢复后仍然答得出来。
    public func satisfiedFor(revision: Int64, round: Int64): Bool {
        var found = false
        synchronized(log.mtx) {
            for (event in log.snapshotEvents()) {
                if (event.eventType != EVIDENCE_EVENT) {
                    continue
                }
                try {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (obj.get("revision").getOrThrow().asInt().getValue() == revision &&
                        obj.get("round").getOrThrow().asInt().getValue() == round) {
                        found = true
                    }
                } catch (_: Exception) {
                    // 读不懂的证据行不算证据。静默当成「有」会把一次记录损坏
                    // 说成目标已达成；当成「没有」只是这一轮不收口，下一轮还能重来。
                }
            }
        }
        return found
    }

    // 全量读数，给投影与诊断用。坏行按「没有」计——宁可少报也不谎报。
    public func count(): Int64 {
        var n = Int64(0)
        synchronized(log.mtx) {
            for (event in log.snapshotEvents()) {
                if (event.eventType != EVIDENCE_EVENT) {
                    continue
                }
                try {
                    JsonValue.fromStr(event.data).asObject().get("revision").getOrThrow().asInt().getValue()
                    n += Int64(1)
                } catch (_: Exception) {
                    // 同 satisfiedFor：坏行不是证据。
                }
            }
        }
        return n
    }
}