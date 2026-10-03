package core

import std.unittest.*

// Ctrl+C 的接线测试。std 没有信号 API，所以「收到中断」这一事实建立在 CFFI 的
// SetConsoleCtrlHandler 上；处理器回调运行在系统起的独立线程里，且 CFunc 不能捕获
// 环境，因此被取消对象只能经一张全局在册表交接。
// 这些用例验的是「处理器体确实取消了在册令牌」，OS 真投递那一步由 CLI 的 sig 模式
// 在真实控制台上单独取证。
//
// 计数是进程内累积的（多个用例共享同一张表），所以一律按增量断言，不比绝对值。

@Test
func installSucceedsOnceAndIsIdempotent() {
    let before = ConsoleSignals.installCount()
    @Expect(ConsoleSignals.install(), true)
    @Expect(ConsoleSignals.installed(), true)
    // 重复注册不得挂出第二个处理器：否则一次 Ctrl+C 会把同一批令牌取消多次
    @Expect(ConsoleSignals.install(), true)
    @Expect(ConsoleSignals.installCount(), before + Int64(1))
}

@Test
func signalCancelsAttachedToken() {
    let countBefore = ConsoleSignals.signalCount()
    let tok = TurnToken()
    let id = ConsoleSignals.attach(tok)
    @Expect(ConsoleSignals.attached(), Int64(1))
    ConsoleSignals.fire(UInt32(0))
    @Expect(tok.cancelled(), true)
    @Expect(ConsoleSignals.signalCount(), countBefore + Int64(1))
    @Expect(ConsoleSignals.detach(id), true)
    @Expect(ConsoleSignals.attached(), Int64(0))
}

// 摘牌之后再来中断，不得波及已经交还控制权的令牌：
// 上一轮的令牌被下一轮的 Ctrl+C 误取消，会让「谁取消的」无从判断。
@Test
func detachedTokenIgnoresLaterSignals() {
    let tok = TurnToken()
    let id = ConsoleSignals.attach(tok)
    @Expect(ConsoleSignals.detach(id), true)
    ConsoleSignals.fire(UInt32(0))
    @Expect(tok.cancelled(), false)
}

@Test
func closeEventKindIsRecorded() {
    ConsoleSignals.fire(UInt32(2))
    @Expect(ConsoleSignals.lastKind(), Int64(2))
}

// 反向：摘一个不存在的牌必须明确失败，不能假装成功（否则在册表只会单调变大）
@Test
func detachUnknownHandleFails() {
    let before = ConsoleSignals.attached()
    @Expect(ConsoleSignals.detach(Int64(987654)), false)
    @Expect(ConsoleSignals.attached(), before)
}
