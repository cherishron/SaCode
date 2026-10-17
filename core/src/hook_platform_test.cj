package core
import std.collection.*
import std.env.*
import std.unittest.*

@When[os == "Windows"]
@Test
func testHookWindowsShellSelectionIgnoresEnvironmentOS() {
    let saved = getVariable("OS")
    try {
        removeVariable("OS")
        let missing = HookExecutor.executeCommand("exit 2", None, HashMap<String, String>(), hxInput(), 2000)
        @Expect(missing.decision, HookDecision.Deny)
        setVariable("OS", "Linux")
        let changed = HookExecutor.executeCommand("exit 2", None, HashMap<String, String>(), hxInput(), 2000)
        @Expect(changed.decision, HookDecision.Deny)
    } finally {
        if (let Some(value) <- saved) { setVariable("OS", value) } else { removeVariable("OS") }
    }
}
