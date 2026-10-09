package core
import std.collection.ArrayList

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
    let hookRegistry = HookRegistry()

    public func register(id: String, kind: String): Unit {
        for (r in rules) {
            if (r.id == id) {
                throw Exception("duplicate-webhook-rule-id")
            }
        }
        rules.add(WebhookRuleRecord(id, kind))
    }

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

    public func dispatch(deliveryId: String, kind: String): HookResult {
        let input = HookInput(
            sessionId: "",
            transcriptPath: "",
            cwd: "",
            hookEventName: "WebhookDelivery",
            timestamp: 0,
            eventSpecific: HookEventData.Webhook(deliveryId, kind)
        )
        return hookRegistry.dispatch(HookEvent.WebhookDelivery, input, kind)
    }
}
