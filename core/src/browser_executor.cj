package core

// 浏览器执行器：审批面(BrowserUseLedger) + 执行面(BrowserProviderClient) + 取消(TurnToken)。
// 与 bu_exec.cj 的 BrowserExecutor（headless DOM）不同：本执行器驱动真实浏览器 provider。
// 职责：先落审计事件，再委托 provider 子进程执行，取消在每步检查。
// 类名用 BrowserToolExecutor 避免与 bu_exec.cj 的 BrowserExecutor 冲突。

public class BrowserToolExecutor {
    let ledger: BrowserUseLedger
    let client: BrowserProviderClient

    public init(ledger: BrowserUseLedger, client: BrowserProviderClient) {
        this.ledger = ledger
        this.client = client
    }

    public func perform(verb: String, args: String,
                        token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000): BrowserProviderResult {
        if (token.cancelled()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "cancelled", "browser-cancelled")
        }
        // 审计：先落 browser-use/action
        try {
            ledger.perform(verb, args)
        } catch (e: Exception) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "bad-verb", e.message)
        }
        if (token.cancelled()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "cancelled", "browser-cancelled-after-audit")
        }
        let result = client.invoke(verb, args, token: token, timeoutMs: timeoutMs)
        // 审计：执行结果
        if (result.ok) {
            ledger.log.append("browser/exec", "${verb}::0")
        } else {
            ledger.log.append("browser/exec", "${verb}::-1")
        }
        return result
    }
}