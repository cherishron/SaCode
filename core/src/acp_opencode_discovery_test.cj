package core
import std.fs.*
import std.env.getVariable
import std.unittest.*

@Test
func acpOpenCodeDiscoveryResolvesKnownNpmShimWithoutExecutingIt() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow())))
    try {
        let packageRoot = root.join("node_modules").join("@opencode").join("cli")
        Directory.create(packageRoot.join("bin"), recursive: true)
        File.writeTo(packageRoot.join("package.json"), "{\"name\":\"@opencode/cli\",\"bin\":{\"opencode\":\"./bin/opencode.exe\"}}".toArray())
        let native = packageRoot.join("bin").join("opencode.exe")
        File.writeTo(native, "fixture-not-an-executable".toArray())
        let marker = root.join("should-not-exist").toString()
        File.writeTo(root.join("opencode.cmd"), "@echo off\r\necho must-not-run > \"${marker}\"\r\n\"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe\" %*\r\n".toArray())
        @Expect(openCodeFromWindowsSearchPath(root.toString()), canonicalize(native).toString())
        @Expect(exists(root.join("should-not-exist")), false)
    } finally { removeIfExists(root.toString(), recursive: true) }
}

@Test
func acpOpenCodeDiscoveryRejectsRelativeSearchAndForeignPackageMetadata() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow())))
    try {
        let packageRoot = root.join("node_modules").join("@opencode").join("cli")
        Directory.create(packageRoot.join("bin"), recursive: true)
        File.writeTo(packageRoot.join("package.json"), "{\"name\":\"foreign-package\",\"bin\":{\"opencode\":\"./bin/opencode.exe\"}}".toArray())
        File.writeTo(packageRoot.join("bin").join("opencode.exe"), "fixture".toArray())
        File.writeTo(root.join("opencode.cmd"), "\\node_modules\\@opencode\\cli\\bin\\opencode.exe".toArray())
        @ExpectThrows[Exception](openCodeFromWindowsSearchPath(root.toString()))
        @ExpectThrows[Exception](openCodeFromWindowsSearchPath(".;relative-folder"))
        File.writeTo(root.join("opencode.exe"), "native-fixture".toArray())
        @Expect(openCodeFromWindowsSearchPath(".;" + root.toString()), canonicalize(root.join("opencode.exe")).toString())
    } finally { removeIfExists(root.toString(), recursive: true) }
}
