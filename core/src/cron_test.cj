package core
import std.unittest.*

@Test
func cronParseStarMatchesAll() {
    let spec = CronSpec.parse("* * * * *")
    @Expect(spec.matchesMinute(0), true)
    @Expect(spec.matchesMinute(30), true)
    @Expect(spec.matchesMinute(59), true)
    @Expect(spec.matchesHour(0), true)
    @Expect(spec.matchesHour(23), true)
}

@Test
func cronParseNumberMatchesExact() {
    let spec = CronSpec.parse("5 3 * * *")
    @Expect(spec.matchesMinute(5), true)
    @Expect(spec.matchesMinute(6), false)
    @Expect(spec.matchesHour(3), true)
    @Expect(spec.matchesHour(4), false)
}

@Test
func cronParseRangeMatchesInclusive() {
    let spec = CronSpec.parse("1-5 * * * *")
    @Expect(spec.matchesMinute(1), true)
    @Expect(spec.matchesMinute(3), true)
    @Expect(spec.matchesMinute(5), true)
    @Expect(spec.matchesMinute(6), false)
    @Expect(spec.matchesMinute(0), false)
}

@Test
func cronParseStepMatchesInterval() {
    let spec = CronSpec.parse("*/15 * * * *")
    @Expect(spec.matchesMinute(0), true)
    @Expect(spec.matchesMinute(15), true)
    @Expect(spec.matchesMinute(30), true)
    @Expect(spec.matchesMinute(45), true)
    @Expect(spec.matchesMinute(7), false)
}

@Test
func cronParseListMatchesMembers() {
    let spec = CronSpec.parse("0,15,30,45 * * * *")
    @Expect(spec.matchesMinute(0), true)
    @Expect(spec.matchesMinute(15), true)
    @Expect(spec.matchesMinute(30), true)
    @Expect(spec.matchesMinute(45), true)
    @Expect(spec.matchesMinute(10), false)
}

@Test
func cronParseRangeStepMatches() {
    let spec = CronSpec.parse("10-50/10 * * * *")
    @Expect(spec.matchesMinute(10), true)
    @Expect(spec.matchesMinute(20), true)
    @Expect(spec.matchesMinute(50), true)
    @Expect(spec.matchesMinute(5), false)
    @Expect(spec.matchesMinute(0), false)
}

@Test
func cronMatchFullTime() {
    let spec = CronSpec.parse("30 14 * * *")
    @Expect(spec.matches(30, 14, 15, 6, 2), true)
    @Expect(spec.matches(31, 14, 15, 6, 2), false)
    @Expect(spec.matches(30, 15, 15, 6, 2), false)
}

@Test
func cronDomDowOrSemantics() {
    let spec = CronSpec.parse("0 0 1 * 1")
    @Expect(spec.matches(0, 0, 1, 6, 1), true)
    @Expect(spec.matches(0, 0, 15, 6, 1), true)
    @Expect(spec.matches(0, 0, 15, 6, 2), false)
}

@Test
func cronDomDowAndWhenOneIsStar() {
    let spec1 = CronSpec.parse("0 0 1 * *")
    @Expect(spec1.matches(0, 0, 1, 6, 2), true)
    @Expect(spec1.matches(0, 0, 2, 6, 2), false)
    let spec2 = CronSpec.parse("0 0 * * 1")
    @Expect(spec2.matches(0, 0, 15, 6, 1), true)
    @Expect(spec2.matches(0, 0, 15, 6, 2), false)
}

@Test
func cronSundayIsZeroOrSeven() {
    let spec1 = CronSpec.parse("0 0 * * 0")
    @Expect(spec1.matches(0, 0, 15, 6, 0), true)
    @Expect(spec1.matches(0, 0, 15, 6, 7), true)
    let spec2 = CronSpec.parse("0 0 * * 7")
    @Expect(spec2.matches(0, 0, 15, 6, 0), true)
    @Expect(spec2.matches(0, 0, 15, 6, 7), true)
}

@Test
func cronParseRejectsTooFewFields() {
    var caught = false
    try { CronSpec.parse("* * *") }
    catch (_: Exception) { caught = true }
    @Expect(caught, true)
}