package core

import std.unittest.*

@Test
func modelCatalogCancellationPreventsCommit() {
    let request = ModelCatalogRequest(1000)
    @Expect(request.cancel(), true)
    @Expect(request.cancel(), false)
    @Expect(request.reason(), "model-pull-cancelled")
    var denied = false
    try { request.beginCommit() } catch (e: Exception) { denied = e.message == "model-pull-cancelled" }
    @Expect(denied, true)
}

@Test
func modelCatalogCommitAdmissionWinsBeforeCancel() {
    let request = ModelCatalogRequest(1000)
    request.beginCommit()
    @Expect(request.cancel(), false)
    @Expect(request.reason(), "")
    @Expect(request.finish(), "")
}

@Test
func modelCatalogDeadlinePreventsLateCommit() {
    let request = ModelCatalogRequest(100)
    sleep(Duration.millisecond * 120)
    @Expect(request.reason(), "model-pull-deadline")
    @Expect(request.cancel(), false)
    var denied = false
    try { request.beginCommit() } catch (e: Exception) { denied = e.message == "model-pull-deadline" }
    @Expect(denied, true)
}

@Test
func modelCatalogFinishedErrorDoesNotBecomeTimeout() {
    let request = ModelCatalogRequest(100)
    @Expect(request.finish(), "")
    sleep(Duration.millisecond * 120)
    @Expect(request.reason(), "")
    @Expect(request.cancel(), false)
}

@Test
func modelCatalogRejectsUnboundedBudget() {
    var rejected: Int64 = 0
    for (budget in [Int64(0), Int64(99), Int64(25001)]) {
        try { ModelCatalogRequest(budget) } catch (_: Exception) { rejected += 1 }
    }
    @Expect(rejected, Int64(3))
}

@Test
func modelCatalogCancellationCommitRaceHasOneWinner() {
    for (_ in 0..30) {
        let request = ModelCatalogRequest(1000)
        let commit = spawn { =>
            try { request.beginCommit(); true } catch (_: Exception) { false }
        }
        let cancelled = request.cancel()
        let admitted = commit.get()
        @Expect(cancelled != admitted, true)
    }
}
