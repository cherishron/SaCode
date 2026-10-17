package core
import std.fs.*
import std.unittest.*

@Test
func workspacePersistsCanonicalDirectoryWithoutModelMessages() {
    let root="core-workspace-test"
    removeIfExists(root, recursive: true)
    Directory.create("${root}/中文 项目", recursive: true)
    let path="${root}/session.log"
    let log=SessionLog(path)
    let workspace=SessionWorkspace(log, fallback: "默认目录")
    @Expect(workspace.effectiveDirectory(), "默认目录")
    @Expect(workspace.setDirectory("${root}/中文 项目"), true)
    @Expect(workspace.setDirectory("${root}/中文 项目"), false)
    @Expect(log.flush(), true)
    let fresh=SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(SessionWorkspace(fresh).directory(), canonicalize("${root}/中文 项目").toString())
    @Expect(fresh.deriveMessages().size, Int64(0))
    removeIfExists("${root}/中文 项目", recursive: true)
    @Expect(SessionWorkspace(fresh).available(), false)
    @Expect(SessionWorkspace(fresh).directory().size > 0, true)
    removeIfExists(root, recursive: true)
}

@Test
func workspaceRejectsFilesAndMissingDirectoriesWithoutWriting() {
    let root="core-workspace-invalid"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    File.writeTo("${root}/file.txt", "正文".toArray())
    let log=SessionLog("${root}/session.log")
    var rejected: Int64=0
    for (path in ["", "${root}/file.txt", "${root}/missing"]) {
        try { SessionWorkspace(log).setDirectory(path) }
        catch (e: Exception) { rejected += 1 }
    }
    @Expect(rejected, Int64(3))
    @Expect(log.eventCount(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func workspaceRelativeToolsUseProjectDirectoryWithSpaces() {
    let root="core-workspace-tools"
    removeIfExists(root, recursive: true)
    Directory.create("${root}/中文 项目", recursive: true)
    let log=SessionLog("${root}/session.log")
    SessionWorkspace(log).setDirectory("${root}/中文 项目")
    let registry=ToolRegistry()
    registry.register(ToolSpec("write", "写入", "path content", true))
    registry.register(ToolSpec("read", "读取", "path", false))
    let runtime=ToolRuntime(log,registry)
    @Expect(runtime.execute("write", "workspace-only.txt 中文正文", "allowed-once", true).allowed, true)
    @Expect(String.fromUtf8(File.readFrom("${root}/中文 项目/workspace-only.txt")), "中文正文")
    @Expect(runtime.execute("read", "workspace-only.txt", "", true).allowed, true)
    @Expect(exists("workspace-only.txt"), false)
    removeIfExists(root, recursive: true)
}
