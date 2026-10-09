package core

import std.collection.*
import std.fs.*
import std.sync.*
import std.time.*

// 跨实例占位随租约保持到 close；完成不等于已归还写权。
let teamRunnerClaimsMutex = Mutex()
let teamRunnerClaims = HashSet<String>()

public class TeamMemberPoll {
    public let frames: Array<String>
    public let result: ?TurnResult

    public init(frames: Array<String>, result: ?TurnResult) {
        this.frames = frames
        this.result = result
    }
}

class TeamRunnerMember {
    let log: SessionLog
    let lease: WriteLease
    let owner: String
    let sink = ThreadSafeDeliveryQueue(1024)
    var handle: ?TurnHandle = None
    var released = false
    let failed = AtomicBool(false)

    init(log: SessionLog, lease: WriteLease) {
        this.log = log
        this.lease = lease
        this.owner = lease.ownerToken()
    }

    func freeze(): Unit {
        failed.store(true)
        log.freezeAfterDurableFailure()
    }
}

// 只持有执行态与流帧，不创建第二份消息历史；恢复日志不会自动启动模型。
public class TeamMemberRunner {
    let mtx = Mutex()
    let members = HashMap<String, TeamRunnerMember>()
    var closing = false

    public init() {}

    public func start(id: String, log: SessionLog, lease: WriteLease,
        first: Provider, nextProvider: (String) -> Provider, model: String,
        toolRuntime: ModelToolRuntime, token!: TurnToken = TurnToken(),
        maxSteps!: Int64 = 16, attach!: ?AttachmentStore = None,
        supportsImages!: Bool = false): Unit {
        synchronized(mtx) {
            if (closing) { throw Exception("team-runner-closed") }
            if (id.size == 0 || members.contains(id)) { throw Exception("team-runner-duplicate-or-empty-id") }
            if (maxSteps < 1 || maxSteps > 128) { throw Exception("bad-agent-step-limit") }
            if (log.isDurableFrozen() || !lease.protects(log.path)) { throw Exception("team-runner-unowned-or-frozen-log") }
            let member = TeamRunnerMember(log, lease)
            synchronized(teamRunnerClaimsMutex) {
                if (teamRunnerClaims.contains(member.owner)) { throw Exception("team-runner-session-owned") }
                teamRunnerClaims.add(member.owner)
            }
            try {
                let actual = ModelAgentRunner().start(first, nextProvider, model, token, log,
                    member.sink, false, maxSteps: maxSteps, attach: attach,
                    supportsImages: supportsImages, toolRuntime: Some(toolRuntime))
                // 结算 Future 包住真实 handle：只有执行线程已 join 且检查点成功才公开终态。
                let settled = spawn { =>
                    try {
                        let result = actual.result()
                        if (lease.ownerToken() != member.owner || !log.durableCheckpointBatched(lease)) {
                            member.freeze()
                        }
                        result
                    } catch (_: Exception) {
                        member.freeze()
                        TurnResult(true, 0, "", "error:team-member-settlement", "", true, 0, 0)
                    }
                }
                member.handle = Some(TurnHandle(token, settled))
                members[id] = member
            } catch (e: Exception) {
                synchronized(teamRunnerClaimsMutex) { teamRunnerClaims.remove(member.owner) }
                throw e
            }
        }
    }

    public func running(id: String): Bool {
        synchronized(mtx) {
            if (let Some(member) <- members.get(id)) { return member.handle.getOrThrow().isRunning() }
            return false
        }
    }

    public func cancel(id: String): Unit {
        synchronized(mtx) {
            if (let Some(member) <- members.get(id)) { member.handle.getOrThrow().cancel() }
        }
    }

    public func poll(id: String): TeamMemberPoll {
        synchronized(mtx) {
            let member = members.get(id).getOrThrow()
            if (member.failed.load() || member.log.isDurableFrozen()) { throw Exception("team-member-durable-failed") }
            let handle = member.handle.getOrThrow()
            let result: ?TurnResult = if (handle.isRunning()) { None } else { Some(handle.result()) }
            // Future 刚结算时也须重查冻结标记，不能把未持久结果当成功回执。
            if (member.failed.load() || member.log.isDurableFrozen()) { throw Exception("team-member-durable-failed") }
            return TeamMemberPoll(member.sink.take(1024).toArray(), result)
        }
    }

    // 共用单调截止时间，不对每个成员重复等待整个超时；超时保留未 join 成员写权。
    public func close(timeoutMs!: Int64 = 1000): Bool {
        synchronized(mtx) {
            closing = true
            for ((_, member) in members) {
                if (!member.released) { member.handle.getOrThrow().cancel() }
            }
            let begin = MonoTime.now()
            while (true) {
                var allReleased = true
                for ((_, member) in members) {
                    if (member.released) { continue }
                    let handle = member.handle.getOrThrow()
                    if (handle.isRunning()) { allReleased = false; continue }
                    handle.result()
                    // 原凭据易主后无权归还新租约；release 本身仍验证盘上归属。
                    if (member.lease.ownerToken() == member.owner && member.lease.protects(member.log.path)) {
                        if (!member.lease.release()) { allReleased = false; continue }
                    }
                    synchronized(teamRunnerClaimsMutex) { teamRunnerClaims.remove(member.owner) }
                    member.released = true
                }
                if (allReleased) { return true }
                if ((MonoTime.now() - begin).toMilliseconds() >= max(0, timeoutMs)) { return false }
                sleep(Duration.millisecond)
            }
            return false
        }
    }
}
