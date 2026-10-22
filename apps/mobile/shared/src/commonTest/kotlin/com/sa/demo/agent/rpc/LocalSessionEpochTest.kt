package com.sa.demo.agent.rpc

import com.sa.demo.auth.LocalSessionEpoch
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class LocalSessionEpochTest {
    @Test fun logout_blocks_delayed_secret_write() {
        val old = LocalSessionEpoch.current()
        var wrote = false
        LocalSessionEpoch.clearSession { }
        assertFailsWith<IllegalStateException> {
            LocalSessionEpoch.ifCurrent(old) { wrote = true }
        }
        assertFalse(wrote)
    }
}
