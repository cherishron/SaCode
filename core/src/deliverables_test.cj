package core
import std.fs.*
import std.unittest.*

// 产出物上游契约（178 行）：`deliverables/presented` 与 `workspace/changes` 都是
// log-only 会话事件（不进模型请求）；前者每次成功 present 工具追加一条，携带
// { turn, callId, files }；后者在顶层轮停止时追加一条，携带 { turn }。
// 本切片只落事件语义（不接 present 工具与 workspaceChanges.summary 服务）。

@Test
func deliverablesPresentedEventIsLogOnlyAndReplayable() {
    let root = "core-deliverables-roundtrip"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    log.append("user/message", "把报告写出来")
    let d = DeliverablesService(log)
    d.present(1, "call-A", ["report.md", "chart.png"])
    @Expect(log.flush(), true)

    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let last = DeliverablesService(fresh).lastPresented()
    @Expect(last.turn, "1")
    @Expect(last.callId, "call-A")
    @Expect(last.files, "report.md,chart.png")
    // log-only：模型历史只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func workspaceChangesMarksTurnBoundaryOnly() {
    let root = "core-deliverables-ws"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let d = DeliverablesService(log)
    d.recordTurnEnd(3)
    d.recordTurnEnd(4)
    // 每次轮结束都落一条 workspace/changes——即便同 turn 二次记录也不 dedup，
    // 让日志诚实反映「这一 turn 结束了几次」。
    @Expect(d.lastTurn(), "4")
    @Expect(log.snapshotEvents().size, Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func deliverablesEmptyFileListStillPersists() {
    let root = "core-deliverables-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let d = DeliverablesService(log)
    d.present(2, "call-B", [])
    let last = d.lastPresented()
    @Expect(last.turn, "2")
    @Expect(last.files, "")
    // 空文件列表也要落事件——上游 present 工具即使没声明任何文件也标过一次交付。
    @Expect(log.snapshotEvents().size, Int64(1))
    removeIfExists(root, recursive: true)
}
