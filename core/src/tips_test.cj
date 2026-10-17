package core

import std.fs.*
import std.env.*
import std.unittest.*

// 每条夹具使用独占临时目录，不清理任何既有目录。
func tipsTestRoot(): String {
    let base = getVariable("TMP") ?? getVariable("TEMP") ?? "."
    let file = File.createTemp(Path(base))
    let path = file.info.path.toString()
    file.close()
    remove(path)
    Directory.create(path)
    return path
}

@Test
func tipsNewcomerStagesAndLruSurviveRestart() {
    let root = tipsTestRoot()
    let tips = TipsService(root)
    @Expect(tips.startup(false), "read")
    for (_ in 1..5) { tips.startup(false) }
    @Expect(TipsService(root).startup(false), "approval")
    for (_ in 6..10) { tips.startup(false) }
    @Expect(TipsService(root).startup(false), "history")
    for (_ in 11..15) { tips.startup(false) }
    let first = TipsService(root).startup(false)
    let second = TipsService(root).startup(false)
    @Expect(first != second, true)
    @Expect(TipsService(root).sessionCount(), Int64(17))
}

@Test
func tipsThresholdsUseExactBoundariesAndIndependentCooldowns() {
    let root = tipsTestRoot()
    let tips = TipsService(root)
    @Expect(tips.afterReply(499, 1000, 1000, false), "")
    @Expect(tips.afterReply(500, 1000, 1000, false), "context-dialogue")
    @Expect(tips.afterReply(799, 1000, 1001, false), "")
    @Expect(tips.afterReply(800, 1000, 1001, false), "context-capacity")
    @Expect(tips.afterReply(949, 1000, 1002, false), "")
    @Expect(tips.afterReply(950, 1000, 1002, false), "context-urgent")
    @Expect(TipsService(root).afterReply(950, 1000, 1003, false), "")
    @Expect(tips.afterReply(950, 1000, 1602, false), "context-urgent")
}

@Test
func tipsModerateBandSuggestsCompressionAfterSeveralReminders() {
    let tips = TipsService(tipsTestRoot())
    @Expect(tips.afterReply(50, 100, 1000, false), "context-dialogue")
    @Expect(tips.afterReply(50, 100, 1600, false), "context-dialogue")
    @Expect(tips.afterReply(50, 100, 2200, false), "context-compress")
}

@Test
func tipsHiddenAndAccessibilityDoNotConsumeHistory() {
    let root = tipsTestRoot()
    let tips = TipsService(root)
    tips.setHidden(true)
    @Expect(TipsService(root).hidden(), true)
    @Expect(tips.startup(false), "")
    @Expect(tips.afterReply(95, 100, 1000, false), "")
    @Expect(tips.sessionCount(), Int64(0))
    TipsService(root).setHidden(false)
    @Expect(tips.startup(true), "")
    @Expect(tips.afterReply(95, 100, 1000, true), "")
    @Expect(tips.startup(false), "read")
}

@Test
func tipsMissingReliableUsageDoesNotRemind() {
    let tips = TipsService(tipsTestRoot())
    @Expect(tips.afterReply(-1, 100, 1000, false), "")
    @Expect(tips.afterReply(95, 0, 1000, false), "")
    @Expect(tips.afterReply(95, -1, 1000, false), "")
    @Expect(tips.afterReply(95, 100, 1000, false), "context-urgent")
}

@Test
func tipsCliGateRejectsMachineModesAndPipes() {
    for (mode in ["all", "stream", "seed", "projection", "headless", "batch", "remote", "sig", "realstream"]) {
        @Expect(TipsService.cliEligible(mode, true, false, false), false)
    }
    @Expect(TipsService.cliEligible("call", false, false, false), false)
    @Expect(TipsService.cliEligible("call", true, true, false), false)
    @Expect(TipsService.cliEligible("call", true, false, true), false)
    @Expect(TipsService.cliEligible("call", true, false, false), true)
    @Expect(TipsService.cliEligible("tools", true, false, false), true)
}

@Test
func tipsPersistenceRejectsCorruptionAndProtectsLease() {
    let root = tipsTestRoot()
    let tips = TipsService(root)
    tips.startup(false)
    let owner = WriteLease(tips.historyPath())
    @Expect(owner.acquire(), true)
    var refused = false
    try { tips.setHidden(true) } catch (_: Exception) { refused = true }
    @Expect(refused, true)
    owner.release()
    File.writeTo(tips.historyPath(), "corrupt".toArray())
    var corrupt = false
    try { tips.startup(false) } catch (_: Exception) { corrupt = true }
    @Expect(corrupt, true)
    @Expect(String.fromUtf8(File.readFrom(tips.historyPath())), "corrupt")
}

@Test
func tipsContextSampleInvalidatedByNewModelVisibleContent() {
    let base = getVariable("TMP") ?? getVariable("TEMP") ?? "."
    let file = File.createTemp(Path(base))
    let log = SessionLog(file.info.path.toString())
    file.close()
    log.append("assistant/message", "答复")
    recordContextOccupancy(log, 95)
    @Expect(currentContextTokens(log), Int64(95))
    log.append("turn/usage", "999999")
    @Expect(currentContextTokens(log), Int64(95))
    log.append("user/message", "新输入")
    @Expect(currentContextTokens(log), Int64(-1))
}
