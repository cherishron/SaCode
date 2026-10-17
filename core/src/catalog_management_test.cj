package core
import std.fs.*
import std.unittest.*

@Test
func catalogCreatesNamedEmptyConversationAndPersistsSelection() {
    let root = "core-catalog-management"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let catalog = SessionCatalog(root)
    let first = catalog.create("  中文项目  ")
    let second = catalog.create("中文项目")
    @Expect(first == second, false)
    let created = SessionLog(catalog.pathFor(first))
    @Expect(created.load(), true)
    @Expect(created.deriveMessages().size, Int64(0))
    @Expect(created.durableCount(), Int64(1))
    @Expect(catalog.selectedId(), "current")
    let index = SessionLog(catalog.indexPath())
    @Expect(index.load(), true)
    catalog.select(index, first)
    @Expect(catalog.selectedId(), "current")
    @Expect(index.flush(), true)
    @Expect(SessionCatalog(root).selectedId(), first)
    @Expect(index.deriveMessages().size, Int64(0))
    var found = false
    for (item in catalog.list()) {
        if (item.id == first) { @Expect(item.title, "中文项目"); found = true }
    }
    @Expect(found, true)
    removeIfExists(root, recursive: true)
}

@Test
func catalogRejectsInvalidIdsAndTitlesWithoutWriting() {
    let root = "core-catalog-invalid-management"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let catalog = SessionCatalog(root)
    var rejected: Int64 = 0
    for (id in ["../session.log", "sessions/../current", "sessions/missing", ""]) {
        try { catalog.pathFor(id) } catch (e: Exception) { rejected += 1 }
    }
    @Expect(rejected, Int64(4))
    rejected = 0
    for (title in ["", "  ", "　", "恶意\n标题", "恶意\t标题", "末尾\n"]) {
        try { catalog.create(title) } catch (e: Exception) { rejected += 1 }
    }
    @Expect(rejected, Int64(6))
    @Expect(Directory.readFrom(root).size, Int64(0))
    removeIfExists(root, recursive: true)
}
