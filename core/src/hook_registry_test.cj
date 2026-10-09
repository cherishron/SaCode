package core

import std.unittest.*

@Test
public func testHookEventEnumExists() {
    let e = HookEvent.PreToolUse
    assert(e != null)
}
