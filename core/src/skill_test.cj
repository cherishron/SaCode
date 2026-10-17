package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 技能上游契约（M4）：`ctx.skills` 提供可发现的 skill 集合。本切片以 log-only
// `skill/register` 事件承载 `<name>::<description>`；`list()` 返回按顺序的
// 名称；`describe(name)` 取描述；`uninstall(name)` 软删。

@Test
func skillRegisterThenListAndDescribe() {
    let root = "core-skill-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sk = SkillRegistry(log)
    sk.register("pdf-tools", "PDF 处理")
    sk.register("csv-tools", "CSV 处理")
    @Expect(sk.list().size, Int64(2))
    @Expect(sk.list()[0], "pdf-tools")
    @Expect(sk.describe("csv-tools"), "CSV 处理")
    removeIfExists(root, recursive: true)
}

@Test
func skillRejectsEmptyNameOrDescription() {
    let root = "core-skill-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sk = SkillRegistry(log)
    var threwName = false
    try {
        sk.register("", "x")
    } catch (e: Exception) {
        threwName = true
    }
    @Expect(threwName, true)
    var threwDesc = false
    try {
        sk.register("pdf", "")
    } catch (e: Exception) {
        threwDesc = true
    }
    @Expect(threwDesc, true)
    @Expect(sk.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func skillUninstallRemovesFromList() {
    let root = "core-skill-drop"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sk = SkillRegistry(log)
    sk.register("pdf", "PDF 处理")
    sk.uninstall("pdf")
    @Expect(sk.list().size, Int64(0))
    @Expect(sk.describe("pdf"), "")
    removeIfExists(root, recursive: true)
}

@Test
func skillEventsAreLogOnlyAcrossReplay() {
    let root = "core-skill-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let sk = SkillRegistry(log)
    log.append("user/message", "开工")
    sk.register("pdf", "PDF 处理")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(SkillRegistry(fresh).describe("pdf"), "PDF 处理")
    removeIfExists(root, recursive: true)
}

// 技能注册把 `<name>::<description>` 编码进一条事件，`::` 就是字段分隔符。
// 名字或描述里带它，回放时字段会错切——注册必须当场拒，且一条事件都不留。
@Test
func skillRegisterRejectsFieldsCarryingThePairDelimiter() {
    let root = "core-skill-delimi"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let reg = SkillRegistry(log)
    var badName = ""
    try {
        reg.register("a::b", "描述")
        badName = "accepted"
    } catch (e: Exception) {
        badName = e.message
    }
    @Expect(badName, "skill-delimiter-in-name")

    var badDesc = ""
    try {
        reg.register("ok", "前::后")
        badDesc = "accepted"
    } catch (e: Exception) {
        badDesc = e.message
    }
    @Expect(badDesc, "skill-delimiter-in-description")

    @Expect(log.eventCount(), Int64(0))
    @Expect(reg.list().size, Int64(0))
    reg.register("ok", "能用")
    @Expect(reg.list().size, Int64(1))
    @Expect(reg.describe("ok"), "能用")
    removeIfExists(root, recursive: true)
}
