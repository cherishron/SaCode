package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 运行中消息队列的上游契约（冻结 639ed01，直读原文）：
// - 队列住在核心而不是界面：projection key `inbox`，两份清单 `next-turn`（排队）与
//   `next-step`（即时补充），条目类型就是 UserMessage，`MessageId` 是唯一身份；
// - 唯一持久事件是 `agent/inbox/spliced`（纯位置拼接：target/start/removedCount/inserted，
//   可选 outcome="canceled"），入列与出列都是它；`agent/inbox/claimed` 只是实时 emit，不落盘；
// - 送达窗口：每个 pre-step 摘走**全部** next-step，只有轮次边界摘走**恰好一条** next-turn
//   （core.md:275「removes the proposed batch — all next-step input plus, at a turn boundary,
//   one next-turn message — through pure deletion splices」）；
// - 被摘走的条目之后作为独立的 `user/message` 落盘（agent.ts:421），队列本身不冒充模型历史；
// - 操作 edit/remove/steer 都要求条目仍在队列里：重放同一个 remove 会抛 queue-item-not-found，
//   所以操作不幂等；edit 保留同一个 MessageId 整块替换正文，空正文按 bad-request 拒；
// - 用户取消保留队列（keepInbox），清空才写 outcome="canceled"。

func inboxRoot(name: String): String {
    let root = "core-inbox-${name}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    return root
}

func inboxLog(root: String): SessionLog {
    return SessionLog("${root}/session.log")
}

@Test
func inboxQueueReplaysFromLogAndStaysOffSurface() {
    let root = inboxRoot("replay")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    log.append("user/message", "开工")
    inbox.queue("m1", "第一条", "rpc-1")
    inbox.queue("m2", "第二条 含\"引号\"与::分隔符", "rpc-2")
    @Expect(inbox.pending("m1"), true)
    @Expect(inbox.textOf("m2"), "第二条 含\"引号\"与::分隔符")
    @Expect(log.flush(), true)
    let fresh = inboxLog(root)
    @Expect(fresh.load(), true)
    // 队列条目不进模型可见历史：只有那条 user/message 在
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = AgentInbox(fresh)
    @Expect(replayed.sizeOf("next-turn"), Int64(2))
    @Expect(replayed.textAt("next-turn", Int64(0)), "第一条")
    @Expect(replayed.textAt("next-turn", Int64(1)), "第二条 含\"引号\"与::分隔符")
    @Expect(replayed.pending("m2"), true)
    removeIfExists(root, recursive: true)
}

@Test
func inboxClaimWindowIsOnePerTurnAndAllPerStep() {
    let root = inboxRoot("window")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("q1", "排队一", "rpc-q1")
    inbox.queue("q2", "排队二", "rpc-q2")
    inbox.queue("q3", "排队三", "rpc-q3")
    inbox.step("s1", "补充一", "rpc-s1")
    inbox.step("s2", "补充二", "rpc-s2")
    // 步边界：全部即时补充被摘走，排队清单一条不动
    let stepped = inbox.claimStep()
    @Expect(stepped.size, Int64(2))
    @Expect(stepped[0].text, "补充一")
    @Expect(inbox.sizeOf("next-step"), Int64(0))
    @Expect(inbox.sizeOf("next-turn"), Int64(3))
    // 轮次边界：恰好一条，且按 FIFO 取队首
    let turned = inbox.claimTurn()
    @Expect(turned.size, Int64(1))
    @Expect(turned[0].id, "q1")
    @Expect(inbox.sizeOf("next-turn"), Int64(2))
    @Expect(inbox.pending("q1"), false)
    removeIfExists(root, recursive: true)
}

@Test
func inboxEmptyClaimDoesNotWriteAnEvent() {
    let root = inboxRoot("empty")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    let before = log.eventCount()
    @Expect(inbox.claimStep().size, Int64(0))
    @Expect(inbox.claimTurn().size, Int64(0))
    // 空摘取不许往唯一真源里刻「什么都没发生」
    @Expect(log.eventCount(), before)
    removeIfExists(root, recursive: true)
}

@Test
func inboxDuplicatePendingIdRejectedWithoutEvent() {
    let root = inboxRoot("dup")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "第一条", "rpc-1")
    let before = log.eventCount()
    var threw = false
    try {
        inbox.queue("m1", "同 id 再来一次", "rpc-9")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(log.eventCount(), before)
    @Expect(inbox.sizeOf("next-turn"), Int64(1))
    @Expect(inbox.textAt("next-turn", Int64(0)), "第一条")
    removeIfExists(root, recursive: true)
}

@Test
func inboxEditKeepsIdAndRejectsBlankWithoutEvent() {
    let root = inboxRoot("edit")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "原正文", "rpc-1")
    inbox.edit("m1", "改过的正文")
    @Expect(inbox.textAt("next-turn", Int64(0)), "改过的正文")
    @Expect(inbox.textOf("m1"), "改过的正文")
    @Expect(inbox.pending("m1"), true)
    let before = log.eventCount()
    var threw = false
    try {
        inbox.edit("m1", "   ")
    } catch (e: Exception) {
        threw = true
    }
    // 空正文按 bad-request 拒：一条只改空白的拼接落进日志就成了「用户发过空白」
    @Expect(threw, true)
    @Expect(log.eventCount(), before)
    @Expect(inbox.textAt("next-turn", Int64(0)), "改过的正文")
    removeIfExists(root, recursive: true)
}

@Test
func inboxOperationsRejectMissingAndAlreadyClaimedId() {
    let root = inboxRoot("gone")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "第一条", "rpc-1")
    inbox.remove("m1")
    var threw = false
    try {
        inbox.remove("m1")
    } catch (e: Exception) {
        threw = true
    }
    // 操作不幂等：重放同一个 remove 必须报 queue-item-not-found，
    // 否则界面上「删两次」和「删一条已经没了的」就分不开
    @Expect(threw, true)
    var threwEdit = false
    try {
        inbox.edit("ghost", "正文")
    } catch (e: Exception) {
        threwEdit = true
    }
    @Expect(threwEdit, true)
    var threwSteer = false
    try {
        inbox.steerFromQueue("ghost")
    } catch (e: Exception) {
        threwSteer = true
    }
    @Expect(threwSteer, true)
    removeIfExists(root, recursive: true)
}

@Test
func inboxSteerMovesQueuedRowPreservingIdentity() {
    let root = inboxRoot("steer")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "要即时补充的一条", "rpc-1")
    inbox.queue("m2", "继续排队", "rpc-2")
    inbox.steerFromQueue("m1")
    @Expect(inbox.sizeOf("next-turn"), Int64(1))
    @Expect(inbox.sizeOf("next-step"), Int64(1))
    @Expect(inbox.textAt("next-step", Int64(0)), "要即时补充的一条")
    // MessageId 是唯一身份：换清单不能换 id
    @Expect(inbox.textOf("m1"), "要即时补充的一条")
    @Expect(inbox.pending("m2"), true)
    // 即时补充排在下一个步边界，不占轮次边界的队首
    let stepped = inbox.claimStep()
    @Expect(stepped.size, Int64(1))
    @Expect(stepped[0].id, "m1")
    removeIfExists(root, recursive: true)
}

@Test
func inboxUserCancelKeepsQueueAndOnlyClearIsAFact() {
    let root = inboxRoot("cancel")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "取消后还要留着", "rpc-1")
    inbox.step("s1", "补充也留着", "rpc-s1")
    let before = log.eventCount()
    // 用户按停止：核心只撤这一轮，未送达的条目留给后面（core.md:283「no canceled inbox splice is logged」）
    inbox.keepOnCancel()
    @Expect(log.eventCount(), before)
    @Expect(inbox.sizeOf("next-turn"), Int64(1))
    @Expect(inbox.sizeOf("next-step"), Int64(1))
    // 清空是另一件事：它自己是一条带 outcome 的持久事实，两份清单各落一条拼接
    inbox.clear()
    @Expect(inbox.sizeOf("next-turn"), Int64(0))
    @Expect(inbox.sizeOf("next-step"), Int64(0))
    @Expect(inbox.clearedCount(), Int64(2))
    @Expect(log.flush(), true)
    let fresh = inboxLog(root)
    @Expect(fresh.load(), true)
    let replayed = AgentInbox(fresh)
    @Expect(replayed.sizeOf("next-turn"), Int64(0))
    @Expect(replayed.sizeOf("next-step"), Int64(0))
    // 内存里的读数与从日志重算的读数必须是同一个数，否则「账」就有了第二真源
    @Expect(replayed.clearedCount(), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func inboxUnreadableSpliceIsCountedNotSilentlyEmpty() {
    let root = inboxRoot("bad")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "能读的一条", "rpc-1")
    // 手写一条读不懂的拼接：正文不是 JSON，target 也不在闭集里
    log.append("agent/inbox/spliced", "这不是 JSON")
    log.append("agent/inbox/spliced", "{\"target\":\"elsewhere\",\"start\":0,\"removedCount\":1,\"inserted\":[]}")
    inbox.queue("m2", "后面还有", "rpc-2")
    @Expect(inbox.sizeOf("next-turn"), Int64(2))
    @Expect(log.flush(), true)
    let fresh = inboxLog(root)
    @Expect(fresh.load(), true)
    let replayed = AgentInbox(fresh)
    // 读不懂的拼接单独计数：静默当成「队列空了」会把一次记录损坏说成用户没排队
    @Expect(replayed.badCount, Int64(2))
    // 坏记录不能把整份队列读数拖下去：好的那两条照旧在，顺序也在
    @Expect(replayed.sizeOf("next-turn"), Int64(2))
    @Expect(replayed.textAt("next-turn", Int64(0)), "能读的一条")
    @Expect(replayed.textAt("next-turn", Int64(1)), "后面还有")
    removeIfExists(root, recursive: true)
}

@Test
func inboxRpcIdIsTheAdmissionDedupKey() {
    let root = inboxRoot("rpc")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    inbox.queue("m1", "同一次请求的回声", "rpc-1")
    // 界面把「已入列」和「自己发出去还没回执」对齐靠 rpcId，不靠正文文本
    @Expect(inbox.hasRpc("rpc-1"), true)
    @Expect(inbox.hasRpc("rpc-2"), false)
    inbox.remove("m1")
    @Expect(inbox.hasRpc("rpc-1"), false)
    @Expect(log.flush(), true)
    let fresh = inboxLog(root)
    @Expect(fresh.load(), true)
    @Expect(AgentInbox(fresh).hasRpc("rpc-1"), false)
    removeIfExists(root, recursive: true)
}

// 上游 file-upload 生成面（attachment.en.md L341-355，直读）：
// 「Bind receipts while one prompt enters an Agent inbox … binding kept after commit until
// queue or history observation retires its receipts」——排队那一刻凭证就绑到这条 prompt 上，
// 提交成功后仍保留，直到队列或历史观测把它结算掉。所以引用是队列条目的事实，不是界面外挂。
@Test
func inboxQueueCarriesAttachmentRefsAcrossReplay() {
    let root = inboxRoot("queue-att")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    let refs = ArrayList<AttachmentRef>()
    refs.add(AttachmentRef("sha256:aaaa", "image", "image/png", Int64(33), Int64(2), Int64(1), "a.png"))
    inbox.queue("m1", "带一张图的排队", "rpc-1", attachments: refs)
    @Expect(inbox.items("next-turn")[0].attachments.size, Int64(1))
    @Expect(log.flush(), true)
    let fresh = inboxLog(root)
    @Expect(fresh.load(), true)
    let replayed = AgentInbox(fresh)
    @Expect(replayed.items("next-turn")[0].attachments[0].attachmentId, "sha256:aaaa")
    @Expect(replayed.items("next-turn")[0].attachments[0].mediaType, "image/png")
    // 队列本身仍然是 log-only：引用跟着条目落盘，但一个字都不进模型可见历史
    @Expect(fresh.deriveMessages().size, Int64(0))
    removeIfExists(root, recursive: true)
}

// 反向钉子：没有引用的条目不能顺手多写一个键——报文形态要与这次改动之前逐字相同，
// 否则「队列事件形状」这条被冻住的契约就悄悄变了。
@Test
func inboxQueueWithoutRefsKeepsSpliceShapeUnchanged() {
    let root = inboxRoot("queue-plain")
    let log = inboxLog(root)
    AgentInbox(log).queue("m1", "纯文字排队", "rpc-1")
    var data = ""
    for (event in log.snapshotEvents()) {
        if (event.eventType == "agent/inbox/spliced") { data = event.data }
    }
    @Expect(data.contains("\"attachments\""), false)
    @Expect(data.contains("sha256:"), false)
    removeIfExists(root, recursive: true)
}

// 改正文是整块替换文本，不是重建一条新消息：绑在这条 prompt 上的引用必须跟着走，
// 否则「编辑一下」就等于把用户选的图静默丢掉。
@Test
func inboxEditKeepsBoundAttachmentRefs() {
    let root = inboxRoot("queue-edit")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    let refs = ArrayList<AttachmentRef>()
    refs.add(AttachmentRef("sha256:bbbb", "image", "image/png", Int64(33), Int64(2), Int64(1), "b.png"))
    inbox.queue("m1", "原话", "rpc-1", attachments: refs)
    inbox.edit("m1", "改了正文")
    @Expect(inbox.items("next-turn")[0].text, "改了正文")
    @Expect(inbox.items("next-turn")[0].attachments.size, Int64(1))
    @Expect(inbox.items("next-turn")[0].attachments[0].attachmentId, "sha256:bbbb")
    removeIfExists(root, recursive: true)
}

// 「即时补充」只是换一张清单，不是重打一条：绑着的引用要跟着条目从 next-turn 走到 next-step。
@Test
func inboxSteerKeepsBoundAttachmentRefs() {
    let root = inboxRoot("queue-steer")
    let log = inboxLog(root)
    let inbox = AgentInbox(log)
    let refs = ArrayList<AttachmentRef>()
    refs.add(AttachmentRef("sha256:cccc", "image", "image/png", Int64(33), Int64(2), Int64(1), "c.png"))
    inbox.queue("m1", "排队后要转成即时补充", "rpc-1", attachments: refs)
    inbox.steerFromQueue("m1")
    @Expect(inbox.sizeOf("next-turn"), Int64(0))
    @Expect(inbox.items("next-step")[0].attachments.size, Int64(1))
    @Expect(inbox.items("next-step")[0].attachments[0].attachmentId, "sha256:cccc")
    removeIfExists(root, recursive: true)
}
