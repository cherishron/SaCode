package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 代理团队上游契约（M3）：`ctx.agentTeam` 提供多代理 roster + 消息转发；
// `join(agentId, role)` 加入；`leave(agentId)` 退出；`broadcast(text)` 扇出。
// 本切片以 log-only `agent-team/membership` 与 `agent-team/broadcast` 事件近似。

@Test
func agentTeamJoinAndBroadcast() {
    let root = "core-team-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let team = AgentTeam(log)
    team.join("a1", "leader")
    team.join("a2", "worker")
    @Expect(team.members().size, Int64(2))
    team.broadcast("开工")
    @Expect(team.messageCount(), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func agentTeamLeaveRemoves() {
    let root = "core-team-leave"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let team = AgentTeam(log)
    team.join("a1", "leader")
    team.leave("a1")
    @Expect(team.members().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func agentTeamRejectsEmptyAgentId() {
    let root = "core-team-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let team = AgentTeam(log)
    var threw = false
    try {
        team.join("", "leader")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(team.members().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func agentTeamEventsAreLogOnlyAcrossReplay() {
    let root = "core-team-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let team = AgentTeam(log)
    log.append("user/message", "开工")
    team.join("a1", "leader")
    team.broadcast("hello")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = AgentTeam(fresh)
    @Expect(replayed.members().size, Int64(1))
    @Expect(replayed.messageCount(), Int64(1))
    removeIfExists(root, recursive: true)
}
