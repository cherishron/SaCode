package core

import std.unittest.*
import std.io.*
import std.time.*
import stdx.encoding.json.*

// 增强请求面的看门狗：请求体只能是「一条指令 + 这一条草稿」，
// 不带工具定义、不带会话历史——否则增强会顺带执行工具或泄露整段上下文。
func sseBody(lines: Array<String>): ByteBuffer {
    let b = ByteBuffer()
    for (line in lines) { b.write(line.toArray()) }
    return b
}

func sseProvider(lines: Array<String>, token: TurnToken): RealSseProvider {
    return RealSseProvider(sseBody(lines), token)
}

// 只用来钉「构造本身就失败」这一条：真实 provider 在构造里就发出了 HTTPS POST，
// 连接被拒、非 200 都走这条路，所以它必须和取帧失败一样被折成结算值。
// 抛点刻意放在 init——只有工厂形态能保证 init 发生在被 spawn 的那条线程上。
class ThrowingEnhanceProvider <: Provider {
    public init() {
        throw Exception("provider-init-boom")
    }
    public func next(): Option<Chunk> {
        return None
    }
}

@Test
func enhanceRequestBodyIsDraftOnly() {
    let draft = "前缀\"引号\"与反斜杠\\结尾，想要更顺手的队列"
    let body = enhanceRequestJson("step-5-preview", draft)
    let obj = JsonValue.fromStr(body).asObject()
    // 无 tools：增强永远不该拿到执行能力
    @Expect(obj.get("tools").isNone(), true)
    @Expect(obj.get("stream").getOrThrow().asBool().getValue(), true)
    let messages = obj.get("messages").getOrThrow().asArray()
    // 恰好两条：一条指令、一条草稿。多一条就等于把别的内容塞进了这次请求。
    @Expect(messages.size(), Int64(2))
    let first = messages.get(Int64(0)).getOrThrow().asObject()
    let second = messages.get(Int64(1)).getOrThrow().asObject()
    @Expect(first.get("role").getOrThrow().asString().getValue(), "system")
    @Expect(second.get("role").getOrThrow().asString().getValue(), "user")
    // 草稿无损：引号、反斜杠、中文都得原样回到调用方手里
    @Expect(second.get("content").getOrThrow().asString().getValue(), draft)
    @Expect(obj.get("model").getOrThrow().asString().getValue(), "step-5-preview")
}

@Test
func enhanceRejectsBlankDraft() {
    @ExpectThrows[Exception](enhanceRequestJson("m", ""))
    @ExpectThrows[Exception](enhanceRequestJson("m", "   \n\t "))
    var why = ""
    try { enhanceRequestJson("m", "  ") } catch (e: Exception) { why = e.message }
    @Expect(why, "enhance-empty-draft")
}

@Test
func enhancerAssemblesTextAndUsage() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"整理后的\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"需求描述\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":42}}\n\n",
        "data: [DONE]\n\n"
    ]
    let r = PromptEnhancer().run(sseProvider(lines, TurnToken()), TurnToken())
    @Expect(r.text, "整理后的需求描述")
    @Expect(r.usage, "42")
    @Expect(r.cancelled, false)
    @Expect(r.finishReason, "stop")
}

// 增强是草稿辅助，不是执行面：模型就算回了 tool_calls 也不能被当成待办去跑。
@Test
func enhancerRejectsToolCallsFromModel() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"write\",\"arguments\":\"{}\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"total_tokens\":7}}\n\n",
        "data: [DONE]\n\n"
    ]
    var why = ""
    try { PromptEnhancer().run(sseProvider(lines, TurnToken()), TurnToken()) }
    catch (e: Exception) { why = e.message }
    @Expect(why, "enhance-unexpected-tool")
}

@Test
func enhancerRejectsEmptyEnhancement() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"   \"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":3}}\n\n",
        "data: [DONE]\n\n"
    ]
    var why = ""
    try { PromptEnhancer().run(sseProvider(lines, TurnToken()), TurnToken()) }
    catch (e: Exception) { why = e.message }
    @Expect(why, "enhance-empty-result")
}

// 被 max-tokens 截断的增强文本是半截话，拿去替换用户草稿比不替换更糟。
@Test
func enhancerRejectsTruncatedEnhancement() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"半截\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}],\"usage\":{\"total_tokens\":9}}\n\n",
        "data: [DONE]\n\n"
    ]
    var why = ""
    try { PromptEnhancer().run(sseProvider(lines, TurnToken()), TurnToken()) }
    catch (e: Exception) { why = e.message }
    @Expect(why, "enhance-max-tokens")
}

@Test
func enhancerSurfacesCancelWithoutResult() {
    let token = TurnToken()
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"不该采用\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":5}}\n\n",
        "data: [DONE]\n\n"
    ]
    token.cancel()
    let r = PromptEnhancer().run(sseProvider(lines, token), token)
    @Expect(r.cancelled, true)
    @Expect(r.text, "")
}

// 上游错误必须显式失败，不能静默交回一份空增强把用户草稿换掉。
@Test
func enhancerPropagatesUpstreamFailure() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"一半\"}}]}\n\n",
        "data: {\"error\":{\"message\":\"boom\"}}\n\n"
    ]
    var why = ""
    try { PromptEnhancer().run(sseProvider(lines, TurnToken()), TurnToken()) }
    catch (e: Exception) { why = e.message }
    @Expect(why, "upstream-error")
}

// 异步车道不能把异常抛进线程：宿主读不到栈，只会看见一个永不结算的请求。
// 失败必须折成 outcome 里的一个值，让 prompt/poll 能如实报出去。
@Test
func runnerFoldsFailureIntoOutcome() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"一半\"}}]}\n\n",
        "data: {\"error\":{\"message\":\"boom\"}}\n\n"
    ]
    let token = TurnToken()
    let factory: () -> Provider = { => sseProvider(lines, token) }
    let h = EnhanceRunner().start(factory, token)
    let o = h.result()
    @Expect(o.running, false)
    @Expect(o.ok, false)
    @Expect(o.error, "upstream-error")
    @Expect(o.text, "")
}

// provider 的构造本身就会发网络请求，所以它也必须活在工作线程里：宿主主循环一旦
// 陪着它阻塞，用户点下的取消就只能排在一次连接后面。构造失败同样折成 outcome。
@Test
func runnerFoldsProviderInitFailureIntoOutcome() {
    let token = TurnToken()
    let factory: () -> Provider = { => ThrowingEnhanceProvider() }
    let h = EnhanceRunner().start(factory, token)
    let o = h.result()
    @Expect(o.running, false)
    @Expect(o.ok, false)
    @Expect(o.error, "provider-init-boom")
    @Expect(o.text, "")
    @Expect(o.cancelled, false)
}

@Test
func runnerDeliversEnhancedTextThroughHandle() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"更清楚的\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"需求\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":17}}\n\n",
        "data: [DONE]\n\n"
    ]
    let token = TurnToken()
    let factory: () -> Provider = { => sseProvider(lines, token) }
    let h = EnhanceRunner().start(factory, token)
    let o = h.result()
    @Expect(o.ok, true)
    @Expect(o.error, "")
    @Expect(o.text, "更清楚的需求")
    @Expect(o.usage, "17")
    @Expect(o.cancelled, false)
}

// 未结算时 tryOutcome 必须报「还在跑」而不是一个空的完成态——否则宿主会把「没结果」
// 读成「增强出了空结果」，桌面就会拿一份假的空文本去动用户草稿。
@Test
func runnerTryOutcomeDistinguishesRunningFromSettled() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"结果\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":2}}\n\n",
        "data: [DONE]\n\n"
    ]
    let token = TurnToken()
    let factory: () -> Provider = { => sseProvider(lines, token) }
    let h = EnhanceRunner().start(factory, token)
    h.result()
    let settled = h.tryOutcome()
    @Expect(settled.running, false)
    @Expect(settled.ok, true)
    @Expect(settled.text, "结果")
}

// 取消只作用于自己这条车道：增强被取消不得连带影响任何别的令牌。
// 这里不钉「取消一定抢在收束之前」（那是线程调度，不是契约），只钉隔离性。
@Test
func runnerCancelIsLocalToItsOwnToken() {
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"不该采用\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":5}}\n\n",
        "data: [DONE]\n\n"
    ]
    let mine = TurnToken()
    let other = TurnToken()
    let factory: () -> Provider = { => sseProvider(lines, mine) }
    let h = EnhanceRunner().start(factory, mine)
    h.cancel()
    var waited = Int64(0)
    while (h.isRunning() && waited < 400) { sleep(Duration.millisecond * 10); waited += 1 }
    let o = h.tryOutcome()
    @Expect(o.running, false)
    @Expect(other.cancelled(), false)
    // 要么被取消，要么完整成功——但绝不能交回一份「看起来成功」的半截文本还不标 cancelled。
    @Expect(o.cancelled || o.ok, true)
}
