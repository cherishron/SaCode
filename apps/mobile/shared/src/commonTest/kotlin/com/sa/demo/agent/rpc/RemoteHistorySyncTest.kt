package com.sa.demo.agent.rpc

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class RemoteHistorySyncTest {
    private fun event(seq: Int) = RemoteDurableEvent(seq.toString(), "user/message", "message-$seq")
    @Test fun pages_merge_without_duplicates() {
        val first = RemoteHistorySync.merge(RemoteHistorySnapshot(), RemoteEventPage("g", "1", true, null, listOf(event(0), event(1))))
        val second = RemoteHistorySync.merge(first, RemoteEventPage("g", "2", false, null, listOf(event(1), event(2))))
        assertEquals(listOf("0", "1", "2"), second.events.map { it.seq })
        assertEquals("2", second.nextSeq)
    }
    @Test fun gap_resets_cursor_instead_of_skipping_to_server_horizon() {
        val reset = RemoteHistorySync.merge(RemoteHistorySnapshot("old", "12", listOf(event(12))), RemoteEventPage("new", "99", false, "generation-mismatch", emptyList()))
        assertEquals("", reset.nextSeq)
        assertEquals(emptyList(), reset.events)
        assertEquals("generation-mismatch", reset.resetReason)
    }
    @Test fun stalled_cursor_and_generation_changes_are_not_silently_accepted() {
        assertFailsWith<IllegalArgumentException> {
            RemoteHistorySync.merge(RemoteHistorySnapshot("g", "1"), RemoteEventPage("g", "1", true, null, emptyList()))
        }
        assertFailsWith<IllegalArgumentException> {
            RemoteHistorySync.merge(RemoteHistorySnapshot("old"), RemoteEventPage("new", "", false, null, emptyList()))
        }
    }
    @Test fun switching_target_invalidates_old_callbacks() {
        val epoch = RemoteConnectionEpoch()
        val old = epoch.current()
        epoch.advance()
        assertFalse(epoch.accepts(old))
    }
}
