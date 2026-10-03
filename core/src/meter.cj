package core

// token 计量与预算（矩阵 53 token-meter）。三条口径先划死：
// 1) 账从会话日志重算——内存里的计数不是第二真源，崩溃重启不能「失忆」；
// 2) 超预算的那一笔不计入，也不做「先记了再红字提醒」，后者等于默认放行；
// 3) 预算只能收紧不能放宽：能被界面自己抬高的防额不是防额。
public class TokenMeter {
    let log: SessionLog
    var total: Int64
    var budget: Int64
    var rejected: Int64
    public var badCount: Int64 = 0

    public init(log: SessionLog, budget!: Int64 = 200) {
        this.log = log
        this.total = Int64(0)
        this.budget = budget
        this.rejected = Int64(0)
    }

    public func used(): Int64 {
        return total
    }

    public func budgetValue(): Int64 {
        return budget
    }

    // over 回答的是「这个会话有没有已经被预算拦过」，不是「用满了没有」：
    // 拦过一次就说明消耗越过了人工设的档位，正确的下一步是停下来，
    // 而不是换成更小的轮次继续往外花。
    public func over(): Bool {
        return rejected > Int64(0)
    }

    // 只允许收紧。调大、相等、负数都拒——放宽必须走不到这条路。
    // 收紧本身是一个事实，落进日志：否则换个进程重新起来就等于把预算洗回默认值，
    // 而「重启即放宽」正是这条不变量要堵的洞。
    public func lowerBudget(to: Int64): Bool {
        if (to < Int64(0) || to >= budget) {
            return false
        }
        budget = to
        log.append("usage/budget", "${to}")
        return true
    }

    // 返回判决码：recorded | over-budget | bad-usage。
    // 三种结果都落事件，所以「这一轮花了多少、为什么没花」都能只从日志回答。
    public func record(raw: String): String {
        let parsed = parseCount(raw)
        if (let Some(v) <- parsed) {
            if (total + v > budget) {
                rejected += 1
                log.append("usage/over-budget", "${raw}:${total}")
                return "over-budget"
            }
            total += v
            log.append("turn/usage", "${v}:${total}")
            return "recorded"
        }
        // 解析不出数字是上游契约违例：记 0 并单独计数。当成一笔大额消耗会把可诊断的
        // 格式问题变成不可诊断的拒绝。
        badCount += 1
        // 空串在日志里会塌成一条看不见的事件体，补一个哨兵词
        log.append("usage/bad-usage", if (raw == "") { "empty" } else { raw })
        return "bad-usage"
    }

    // 从日志重算总量与被拦事实。返回重算后的总量。
    public func rebuild(): Int64 {
        total = Int64(0)
        rejected = Int64(0)
        badCount = Int64(0)
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "turn/usage") {
                // 事件体是「<本次>:<当时的累计>」，重算只认本次那一列，
                // 累计列自己重新推——否则就是把旧结论当输入。
                let head = ev.data.split(":")[0]
                if (let Some(v) <- parseCount(head)) {
                    total += v
                }
            } else if (ev.eventType == "usage/over-budget") {
                rejected += 1
            } else if (ev.eventType == "usage/bad-usage") {
                badCount += 1
            } else if (ev.eventType == "usage/budget") {
                // 取日志里最紧的一档：预算是单调收紧的，取最小值既能复现当前档位，
                // 也不会被一条手写的宽松记录反向抬高。
                if (let Some(b2) <- parseCount(ev.data)) {
                    if (b2 < budget) {
                        budget = b2
                    }
                }
            }
        }
        return total
    }
}

// 只认非空的纯 ASCII 数字串；>12 位直接判非法，避免把回绕当成一次真实消耗。
func parseCount(s: String): Option<Int64> {
    let bytes = s.toArray()
    if (bytes.size == 0 || bytes.size > 12) {
        return None
    }
    var acc: Int64 = 0
    for (b in bytes) {
        let n = Int64(b)
        if (n < 48 || n > 57) {
            return None
        }
        acc = acc * 10 + (n - 48)
    }
    return Some(acc)
}
