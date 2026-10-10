package daemon
import core.*

import std.collection.*
import std.env.*
import std.fs.*
import std.unittest.*

// 设计 §6 的 SSE 面：「SSE 帧携带事件类别、资源归属、游标或瞬时标记。持久事件授权后才发送」
// 「断线恢复……补读去重后交付」。这一档把「一条帧该长什么样」和「重连时该补哪一段」
// 收成可单测的纯函数——/sse 那个循环本体要靠真实 daemon 才能验，属运行验收面。
//
// 游标形状由服务端定义、客户端原样回带（`remote-transport.mjs` 已经在透传 `id:`）：
//     <sessionId>|<seq>
// 不合法就当作「没有游标」，绝不能把坏游标升成启动失败——否则任何人发一个坏
// Last-Event-ID 就能让这条连接建不起来，把恢复面变成 DoS 面。

func resumeFixtureRoot(name: String): String {
    let root = "${getTempDirectory().toString()}/sa-sse-${name}"
    if (!exists(root)) { Directory.create(root) }
    let catalog = SessionCatalog(root)
    let sid = catalog.create("sse-fixture")
    let log = SessionLog(catalog.pathFor(sid))
    // create() 已写过 session/title；新实例必须先 load 再 append，否则 flush 的
    // 「只增不减」守卫会因为草稿比磁盘短而拒绝落盘。
    @Expect(log.load(), true)
    log.append("user/message", "正文一")
    log.append("user/message", "正文二")
    @Expect(log.flush(), true)
    return root
}

@Test
func renderedDurableFrameCarriesIdEventAndDataLines() {
    let text = SseFrame.renderDurable(sessionId: "sessions/a", seq: "1",
        eventType: "user/message", data: "正文")
    // SSE 的帧边界是空行；少了它客户端会把两帧当一帧解析。
    @Expect((text.indexOf("id: sessions/a|1\n") ?? Int64(-1)) == Int64(0), true)
    @Expect((text.indexOf("event: durable\n") ?? Int64(-1)) >= Int64(0), true)
    @Expect(text.endsWith("\n\n"), true)
    // 归属与游标要同时出现在 data 里：客户端只读 data 也能自己续游标。
    @Expect((text.indexOf("\"sessionId\":\"sessions/a\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"seq\":\"1\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"eventType\":\"user/message\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"data\":\"正文\"") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func ephemeralFrameIsMarkedAndCarriesNoCursor() {
    // §6 的「游标或瞬时标记」二选一：瞬时帧不能带 id，否则客户端会拿它去补读，
    // 把「重连后重放瞬时文本」当成可承诺的行为。
    let text = SseFrame.renderLive("{\"jsonrpc\":\"2.0\",\"method\":\"x\"}")
    @Expect((text.indexOf("id:") ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf("event: ephemeral\n") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("data: {\"jsonrpc\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect(text.endsWith("\n\n"), true)
}

@Test
func lastEventIdShapeIsValidatedNotGuessed() {
    let ok = SseFrame.parseLastEventId("sessions/a|7")
    @Expect(ok.valid, true)
    @Expect(ok.sessionId, "sessions/a")
    @Expect(ok.seq, "7")
    // 缺分隔符、分隔符两侧空、非十进制、负数、超长——全部归「没有游标」。
    @Expect(SseFrame.parseLastEventId("7").valid, false)
    @Expect(SseFrame.parseLastEventId("").valid, false)
    @Expect(SseFrame.parseLastEventId("sessions/a|").valid, false)
    @Expect(SseFrame.parseLastEventId("|7").valid, false)
    @Expect(SseFrame.parseLastEventId("sessions/a|abc").valid, false)
    @Expect(SseFrame.parseLastEventId("sessions/a|-1").valid, false)
    var longId = ""
    for (_ in 0..200) { longId += "a" }
    @Expect(SseFrame.parseLastEventId("${longId}|1").valid, false)
}

@Test
func backfillStartsAfterTheCarriedCursorAndCollectsItsOwnIds() {
    let root = resumeFixtureRoot("backfill")
    let catalog = SessionCatalog(root)
    let sid = catalog.list()[0].id
    // 夹具里 seq 0 是 session/title，1/2 是两条正文。带 seq 0 的游标 → 只补 1、2。
    let r = SseResume.build(root: root, lastEventId: "${sid}|0", limit: Int64(200))
    @Expect(Int64(r.frames.size), Int64(2))
    @Expect((r.frames[0].indexOf("id: ${sid}|1\n") ?? Int64(-1)) == Int64(0), true)
    @Expect((r.frames[1].indexOf("id: ${sid}|2\n") ?? Int64(-1)) == Int64(0), true)
    @Expect(Int64(r.ids.size), Int64(2))
    @Expect(r.ids[0], "${sid}|1")
    // 游标已在末尾 → 补读为空，但不算错误（连接照常建，直播继续）。
    let tail = SseResume.build(root: root, lastEventId: "${sid}|2", limit: Int64(200))
    @Expect(Int64(tail.frames.size), Int64(0))
    @Expect(Int64(tail.ids.size), Int64(0))
    // 不带游标 → 一律不补：首订阅的客户端要的是直播，不是整本历史。
    let fresh = SseResume.build(root: root, lastEventId: "", limit: Int64(200))
    @Expect(Int64(fresh.frames.size), Int64(0))
}

@Test
func badCursorOrUnknownSessionNeverBreaksStreamSetup() {
    let root = resumeFixtureRoot("badcursor")
    let catalog = SessionCatalog(root)
    let sid = catalog.list()[0].id
    // 坏游标、不存在的会话、越界游标都必须回「空补读」而不是抛出：
    // /sse 建流路径上任何异常都会变成远程可触发的连接失败。
    @Expect(Int64(SseResume.build(root: root, lastEventId: "nonsense", limit: Int64(50)).frames.size), Int64(0))
    @Expect(Int64(SseResume.build(root: root, lastEventId: "sessions/nope|1", limit: Int64(50)).frames.size), Int64(0))
    @Expect(Int64(SseResume.build(root: root, lastEventId: "${sid}|9999", limit: Int64(50)).frames.size), Int64(0))
    // limit 越界同样不补，也不要把限额悄悄折进合法区间。
    @Expect(Int64(SseResume.build(root: root, lastEventId: "${sid}|0", limit: Int64(0)).frames.size), Int64(0))
    @Expect(Int64(SseResume.build(root: root, lastEventId: "${sid}|0", limit: Int64(201)).frames.size), Int64(0))
}

@Test
func closeFrameCarriesTheRecoverableReason() {
    // §6「超过任一限额关闭并给出可恢复原因」：关闭原因要在流里说清楚，
    // 只写进 daemon 的 stderr 等于让客户端只能靠猜——它分不清该重连还是该补读。
    let text = SseFrame.renderClose(SSE_CLOSE_BYTE_OVERFLOW)
    @Expect((text.indexOf("event: close\n") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"reason\":\"byte-overflow\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect(text.endsWith("\n\n"), true)
    @Expect((SseFrame.renderClose("").indexOf("\"reason\":\"\"") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func deliveredLookupOnlyDropsExactlyTheSameCursor() {
    // 去重必须只按「同一个游标串」判，别的都不丢：
    // 空 id（瞬时帧）永远留着，seq 差一位也永远留着。误丢一条通知比重复一条难查得多。
    let ids = ArrayList<String>()
    ids.add("sessions/a|1")
    ids.add("sessions/a|2")
    @Expect(SseFrame.delivered(ids: ids, id: "sessions/a|1"), true)
    @Expect(SseFrame.delivered(ids: ids, id: "sessions/a|2"), true)
    @Expect(SseFrame.delivered(ids: ids, id: "sessions/a|3"), false)
    @Expect(SseFrame.delivered(ids: ids, id: "sessions/b|1"), false)
    @Expect(SseFrame.delivered(ids: ids, id: ""), false)
    @Expect(SseFrame.delivered(ids: ArrayList<String>(), id: "sessions/a|1"), false)
}

@Test
func liveFrameIdMatchesBackfillIdSoDuplicatesCanBeDropped() {
    // 补读去重的依据只可能是同一个游标串：宿主的通知里带 sessionId 与 seq 时，
    // 从直播帧取出的 id 必须与补读帧的 id 逐字相等，否则「去重」只是愿望。
    let live = "{\"jsonrpc\":\"2.0\",\"method\":\"session/notify\",\"params\":{\"sessionId\":\"sessions/a\",\"seq\":1}}"
    @Expect(SseFrame.idOf(live), "sessions/a|1")
    @Expect(SseFrame.idOf("{\"jsonrpc\":\"2.0\",\"method\":\"x\",\"params\":{\"sessionId\":\"sessions/a\"}}"), "")
    @Expect(SseFrame.idOf("{\"jsonrpc\":\"2.0\",\"method\":\"x\",\"params\":{\"seq\":3}}"), "")
    @Expect(SseFrame.idOf("not json at all"), "")
    // seq 允许写成数字或字符串两种形状，取出来的游标必须是同一个。
    @Expect(SseFrame.idOf("{\"params\":{\"sessionId\":\"s\",\"seq\":\"4\"}}"), "s|4")
}
