package core
import std.unittest.*

@Test
func approvalCancelSettlesOnlyItsTicketAndRejectsLateGrant() {
    let log = SessionLog("")
    let desk = ApprovalDesk(log)
    let first = desk.askForCall("edit", "one")
    let second = desk.askForCall("edit", "two")
    @Expect(desk.cancel(first), true)
    @Expect(desk.cancel(first), false)
    @Expect(desk.stateOf(first), "cancelled")
    @Expect(desk.answer(first, "allowed-once"), false)
    @Expect(desk.stateOf(second), "pending")
    @Expect(desk.answer(second, "allowed-once"), true)
    @Expect(desk.cancel(second), true)
    @Expect(desk.consumeExactForCall(second, "edit", "two"), "")
    @Expect(desk.hasOpenTickets(), false)
    var count = Int64(0)
    for (event in log.snapshotEvents()) { if (event.eventType == "approval/cancelled") { count += 1 } }
    @Expect(count, Int64(2))
}
