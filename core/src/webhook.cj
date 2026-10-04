package core
import std.collection.ArrayList

// 与上游 `WebhookRule` + `WebhookRuntime` 对齐的 registry 切片。
// `dispatch()` 快照当前匹配 rules、按 kind 匹配、返回处理条数；
// 本切片未接真回调（属宿主面），只统计数量以钉住「fire-and-forget」
// 语义——**没有**队列、重试、去重、执行状态、崩溃回放、完成回执。
public class WebhookRuleRecord {
    public let id: String
    public let kind: String
    public var active: Bool
    public init(id: String, kind: String) {
        this.id = id
        this.kind = kind
        this.active = true
    }
}

public class WebhookRuntime {
    let rules = ArrayList<WebhookRuleRecord>()

    // 单槽 rule id：重复 id（包括已注销后的同 id）抛；首次 kind 保留。
    public func register(id: String, kind: String): Unit {
        for (r in rules) {
            if (r.id == id) {
                throw Exception("duplicate-webhook-rule-id")
            }
        }
        rules.add(WebhookRuleRecord(id, kind))
    }

    // 未知 id 与「已注销再注销」同族：都抛。
    public func unregister(id: String): Unit {
        for (r in rules) {
            if (r.id == id) {
                if (!r.active) {
                    throw Exception("webhook-rule-already-unregistered")
                }
                r.active = false
                return
            }
        }
        throw Exception("unknown-webhook-rule-id")
    }

    // 返回按 kind 匹配到的 active 规则数；未匹配返回 0（不抛）。
    public func dispatch(deliveryId: String, kind: String): Int64 {
        var count = Int64(0)
        for (r in rules) {
            if (r.active && r.kind == kind) {
                count += Int64(1)
            }
        }
        return count
    }
}
