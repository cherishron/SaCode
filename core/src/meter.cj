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

    // 默认档是「失控闸门」而不是配额：真实模型一轮就要几百 token，
    // 把默认压到几百等于装好后第一条消息就把会话打死，而预算又只许收紧——没人能救回来。
    public init(log: SessionLog, budget!: Int64 = 200000) {
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

    // 历史拒绝或当前额度耗尽都必须停下来；收紧到已用额度以下也即时生效。
    public func over(): Bool {
        return rejected > Int64(0) || total >= budget
    }

    // 当前账态的判决词：给 usage/status 用，不依赖「上一轮 record 回了什么」。
    // turn/poll 结算帧带的是「这一轮的 record 结果」，这里是「账盘子的当前状态」——
    // 收紧到已用以下后，不用再跑一轮就能看出已超档。
    public func verdict(): String {
        if (over()) {
            return "over-budget"
        }
        if (total > Int64(0)) {
            return "recorded"
        }
        return "absent"
    }

    // 轮询和退出共享终态结算：收到 usage 就记账，取消不能抹掉已收到的用量。
    // 尚未收到 usage 且没有 finish 时只报告 absent，不推断实际消耗为零。
    // 调用方取得结果后清除 handle，保证一轮只结算一次。
    public func settleTurn(result: TurnResult): String {
        if (result.usage.size > 0 || result.finishReason.size > 0) {
            return record(result.usage)
        }
        return "absent"
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
