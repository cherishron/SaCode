package core
import std.fs.*
import std.unittest.*

// 作用域上游契约：`SessionScope` 是嵌套的权限/上下文栈，工具读取按「最后进入」
// 生效；`enter(name)` / `exit(name)` 必须严格 LIFO（退出非栈顶 → 拒绝）；作用域
// 变更是 log-only 事件（`scope/enter` / `scope/exit`），不进 `isSurfaceEvent`
// 白名单——模型历史只看到用户/助手/tool-result。

@Test
func scopeResolvePrefersTopOfStack() {
    let root = "core-scope-top"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let stack = ScopeStack(log)
    stack.enter("read-only")
    stack.enter("workspace-write")
    @Expect(stack.current(), "workspace-write")
    stack.exit("workspace-write")
    @Expect(stack.current(), "read-only")
    removeIfExists(root, recursive: true)
}

@Test
func scopeExitNonTopRejected() {
    let root = "core-scope-nonlifo"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let stack = ScopeStack(log)
    stack.enter("a")
    stack.enter("b")
    var threw = false
    try {
        stack.exit("a")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 拒绝之后 b 仍在栈顶、事件不落。
    @Expect(stack.current(), "b")
    removeIfExists(root, recursive: true)
}

@Test
func scopeEventsAreLogOnlyAcrossReplay() {
    let root = "core-scope-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let stack = ScopeStack(log)
    stack.enter("read-only")
    stack.enter("workspace-write")
    log.append("user/message", "开工")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = ScopeStack(fresh)
    @Expect(replayed.current(), "workspace-write")
    // 关键：scope/enter 不进 surface——deriveMessages 只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}
