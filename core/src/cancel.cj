package core

import std.collection.ArrayList
import std.sync.*
import std.io.*
import stdx.encoding.json.*

// 流记录保存完整结构；可选元数据用 JSON null 区分缺失与空字符串。
// 这是 SessionLog 中的一条事实，不引入另一个持久帧存储。
func streamChunkJson(ch: Chunk): String {
    let obj = JsonObject()
    obj.put("kind", JsonString(ch.kind))
    obj.put("text", JsonString(ch.text))
    obj.put("reason", JsonString(ch.reason))
    obj.put("choiceIndex", JsonNull())
    obj.put("toolIndex", JsonNull())
    obj.put("toolId", JsonNull())
    obj.put("toolName", JsonNull())
    if (let Some(v) <- ch.choiceIndex) { obj.put("choiceIndex", JsonInt(v)) }
    if (let Some(v) <- ch.toolIndex) { obj.put("toolIndex", JsonInt(v)) }
    if (let Some(v) <- ch.toolId) { obj.put("toolId", JsonString(v)) }
    if (let Some(v) <- ch.toolName) { obj.put("toolName", JsonString(v)) }
    if (let Some(v) <- ch.requestSeq) { obj.put("requestSeq", JsonInt(v)) }
    if (let Some(v) <- ch.elapsedMs) { obj.put("elapsedMs", JsonInt(v)) }
    return obj.toString()
}

// 流式产出的最小抽象：真实 SSE provider 与测试用的假 provider 都实现它。
// 逐帧产出（而不是先给一整个数组）是取消能在「流中间」生效的前提。
public interface Provider {
    func next(): Option<Chunk>
}

// 协作式取消令牌：仓颉的线程取消不强制停止线程，只在检查点生效。
// child() 跟随父令牌；detached() 表示「已独立发布的后台任务」，父取消不得连带杀死它。
public class TurnToken {
    let flag = AtomicBool(false)
    let parent: Option<TurnToken>
    let linked: Bool

    public init() {
        this.parent = None
        this.linked = false
    }

    init(parent: TurnToken, linked: Bool) {
        this.parent = Some(parent)
        this.linked = linked
    }

    public func cancel() {
        flag.store(true)
    }

    public func cancelled(): Bool {
        if (flag.load()) {
            return true
        }
        match (parent) {
            case Some(p) => p.cancelled() && linked
            case None => false
        }
    }

    public func child(): TurnToken {
        return TurnToken(this, true)
    }

    public func detached(): TurnToken {
        return TurnToken(this, false)
    }
}

// 投递面的最小契约：turn 线程只管投，投给单线程队列还是跨线程队列由调用方选。
public interface FrameSink {
    func offer(frame: String): Bool
}

// 有界投递队列 = 背压面。满了只回报「投不下去」，从不丢帧：
// 事件真源在 SessionLog 里，慢消费者按游标重放即可补齐。
public class DeliveryQueue <: FrameSink {
    let cap: Int64
    let frames = ArrayList<String>()
    var over: Int64 = 0

    public init(cap: Int64) {
        this.cap = cap
    }

    public func offer(frame: String): Bool {
        if (size() >= cap) {
            over += 1
            return false
        }
        frames.add(frame)
        return true
    }

    public func drain(max: Int64): ArrayList<String> {
        let out = ArrayList<String>()
        if (max <= 0) { return out }
        let n = min(size(), max)
        for (_ in 0..n) {
            out.add(frames.remove(at: 0))
        }
        return out
    }

    public func size(): Int64 {
        return Int64(frames.size)
    }

    public func overflow(): Int64 {
        return over
    }

    // 恒为 0：队列只有「追加」和「按游标取走」两条路径，没有丢弃分支。
    // 溢出计入 overflow()，事件仍可从持久日志按游标恢复。
    public func dropped(): Int64 {
        return Int64(0)
    }
}

public class TurnResult {
    public let cancelled: Bool
    public let delivered: Int64
    public let text: String
    public let finishReason: String
    public let usage: String
    public let interrupted: Bool
    public let settledToolCalls: Int64
    // 结算包含拒绝、失败和取消；目标进展只能使用成功执行的次数。
    public let successfulToolCalls: Int64
    public let pendingToolCalls: Int64

    public init(cancelled: Bool, delivered: Int64, text: String, finishReason: String, usage: String, interrupted: Bool, settledToolCalls: Int64, pendingToolCalls: Int64, successfulToolCalls!: Int64 = 0) {
        this.cancelled = cancelled
        this.delivered = delivered
        this.text = text
        this.finishReason = finishReason
        this.usage = usage
        this.interrupted = interrupted
        this.settledToolCalls = settledToolCalls
        this.successfulToolCalls = successfulToolCalls
        this.pendingToolCalls = pendingToolCalls
    }
}

public class TurnLoop {
    // 固定序：turn/start → 逐帧（先查取消点，再取下一帧）→ 终态结算
    public func run(p: Provider, token: TurnToken, log: SessionLog, sink: FrameSink): TurnResult {
        log.append("turn/start", "")
        let asm = Assembly()
        var delivered: Int64 = 0
        try {
            while (true) {
                if (token.cancelled()) { break }
                if (let Some(ch) <- p.next()) {
                    if (token.cancelled()) { break }
                    asm.push(ch)
                    delivered += 1
                    log.append("stream/chunk", streamChunkJson(ch))
                    sink.offer("${ch.kind}:${ch.text}")
                    if (!asm.interrupted) { break }
                } else { break }
            }
        } finally {
            if (let Some(resource) <- (p as Resource)) { resource.close() }
        }
        let cancelled = token.cancelled()
        var settled: Int64 = 0
        if (cancelled && delivered > 0) {
            // 取消的 turn 没有终态原因：未完成的 tool calls 逐个结算，绝不留悬挂
            for (name in asm.toolCalls) {
                log.append("tool/result", "cancelled:${name}")
                settled += 1
            }
            asm.toolCalls.clear()
            log.append("turn/cancelled", "after ${delivered} chunks")
        } else if (!cancelled && !asm.interrupted) {
            log.append("assistant/message", asm.assembledText())
        }
        return TurnResult(
            cancelled,
            delivered,
            asm.assembledText(),
            asm.finishReason,
            asm.usage,
            asm.interrupted,
            settled,
            Int64(asm.toolCalls.size)
        )
    }
}

// 跑在独立仓颉线程上的 turn：取消由另一个线程发起（桌面 stop / CLI 中断）。
// Future.cancel() 只是「请求」，真正生效的是 token —— 所以 handle 两个都做，
// 但只有 token 是可信的那一条路。
public class TurnHandle {
    let token: TurnToken
    let future: Future<TurnResult>

    init(token: TurnToken, future: Future<TurnResult>) {
        this.token = token
        this.future = future
    }

    public func cancel() {
        token.cancel()
        future.cancel()
    }

    public func isRunning(): Bool {
        if (let Some(_) <- future.tryGet()) {
            return false
        }
        return true
    }

    public func result(): TurnResult {
        return future.get()
    }

    // 未就绪时给「无终态」占位：finishReason 空 + interrupted，调用方据此判「还在跑」
    public func tryResult(): TurnResult {
        match (future.tryGet()) {
            case Some(r) => r
            case None => TurnResult(false, Int64(0), "", "", "", true, Int64(0), Int64(0))
        }
    }
}

public class TurnRunner {
    public func start(p: Provider, token: TurnToken, log: SessionLog, sink: FrameSink): TurnHandle {
        let loop = TurnLoop()
        let f = spawn { =>
            loop.run(p, token, log, sink)
        }
        return TurnHandle(token, f)
    }
}

// 两个入口的取消烟测用假 provider：前 limit 帧立刻产出，之后停在帧间，
// 只有取消信号能让它收束。这样「流中被打断」是确定时刻，不靠 sleep 赌时序。
// 真实 SSE provider 的对应物是「连接不断就不产出」，协作式取消的路径完全一样。
public class CancellableStreamProvider <: Provider {
    let chunks = ArrayList<Chunk>()
    let token: TurnToken
    var i: Int64 = 0
    let limit: Int64

    public init(token: TurnToken, limit: Int64) {
        this.token = token
        this.limit = limit
        chunks.add(Chunk("text", "你好，", ""))
        chunks.add(Chunk("text", "world", ""))
        chunks.add(Chunk("tool-call-delta", "read", ""))
        chunks.add(Chunk("usage", "12", ""))
        chunks.add(Chunk("finish", "", "stop"))
    }

    public func next(): Option<Chunk> {
        if (i < limit && i < Int64(chunks.size)) {
            let c = chunks[i]
            i += 1
            return Some(c)
        }
        if (i >= Int64(chunks.size)) {
            // 全部帧已产出：这就是正常收束，不该等人来取消
            return None
        }
        // 停在帧间等取消：真实 SSE 的对应物是「连接不断但不产出」
        var spins: Int64 = 0
        while (!token.cancelled() && spins < 3000) {
            sleep(1 * Duration.millisecond)
            spins += 1
        }
        return None
    }
}

// 跨线程投递队列：内部就是 DeliveryQueue，只是所有读写都在锁里。
// 语义不变：满了回报 false（背压信号），从不丢帧，等消费者按游标取走。
public class ThreadSafeDeliveryQueue <: FrameSink {
    let mtx = Mutex()
    let cond: Condition
    let queue: DeliveryQueue

    public init(cap: Int64) {
        this.queue = DeliveryQueue(cap)
        // condition() 必须在持有锁时创建
        mtx.lock()
        this.cond = mtx.condition()
        mtx.unlock()
    }

    public func offer(frame: String): Bool {
        mtx.lock()
        let ok = queue.offer(frame)
        if (ok) {
            cond.notify()
        }
        mtx.unlock()
        return ok
    }

    public func take(max: Int64): ArrayList<String> {
        mtx.lock()
        let out = queue.drain(max)
        mtx.unlock()
        return out
    }

    public func size(): Int64 {
        mtx.lock()
        let n = queue.size()
        mtx.unlock()
        return n
    }

    public func overflow(): Int64 {
        mtx.lock()
        let n = queue.overflow()
        mtx.unlock()
        return n
    }

    public func dropped(): Int64 {
        return queue.dropped()
    }

    // 有界等待：超时返回空数组而不是抛，读循环据此继续下一轮。
    // 唤醒可能在没帧时发生，所以每一轮都重新查队列。
    public func await(maxWaitMs: Int64): ArrayList<String> {
        var waited: Int64 = 0
        var out = ArrayList<String>()
        var done = false
        while (!done && waited <= maxWaitMs) {
            mtx.lock()
            if (queue.size() > 0) {
                out = queue.drain(64)
                done = true
            } else if (waited >= maxWaitMs) {
                // 最后一轮只做「再看一眼队列」，不再挂零时长等待
                done = true
            } else {
                let left = maxWaitMs - waited
                let slice = if (left > 50) { 50 } else { left }
                cond.wait(timeout: slice * Duration.millisecond)
                waited += slice
            }
            mtx.unlock()
        }
        return out
    }
}
