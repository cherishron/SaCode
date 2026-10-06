package core

import std.fs.*
import std.collection.*
import std.unittest.*

// 文件系统扩展工具测试：glob 模式匹配、grep 内容搜索、edit 编辑。

func fsToolsFile(tag: String): String {
    return "core-fstools-${tag}.txt"
}

func fsToolsCleanup(tag: String) {
    removeIfExists(fsToolsFile(tag), recursive: false)
}

@Test
func globMatchPatternWildcard() {
    // * 匹配不含 / 的任意字符
    @Expect(globMatchPattern("test.txt", "test.txt"), true)
    @Expect(globMatchPattern("anything.txt", "*.txt"), true)
    @Expect(globMatchPattern("test.txt", "test.txt"), true)
    @Expect(globMatchPattern("test.txt", "test.*"), true)
    @Expect(globMatchPattern("test.txt", "t?.txt"), true)
    @Expect(globMatchPattern("test.txt", "test"), false)
    @Expect(globMatchPattern("test.txt", "*.md"), false)
}

@Test
func globMatchPatternDoubleStar() {
    // ** 匹配含 / 的任意字符
    @Expect(globMatchPattern("a/b/c.txt", "**"), true)
    @Expect(globMatchPattern("a.txt", "**"), true)
    @Expect(globMatchPattern("a/b/c.txt", "*/c.txt"), true)
}

@Test
func globFilesReturnsMatchingFiles() {
    // 创建测试文件并验证 glob 查找
    let f1 = fsToolsFile("glob1")
    let f2 = fsToolsFile("glob2")
    File.writeTo(f1, "content1".toArray())
    File.writeTo(f2, "content2".toArray())
    
    let results = globFiles("core-fstools-glob*.txt", ".")
    var found1 = false
    var found2 = false
    for (r in results) {
        if (r.contains("glob1")) { found1 = true }
        if (r.contains("glob2")) { found2 = true }
    }
    @Expect(found1, true)
    @Expect(found2, true)
    
    removeIfExists(f1, recursive: false)
    removeIfExists(f2, recursive: false)
}

@Test
func grepFilesReturnsMatchingLines() {
    // 创建测试文件并验证 grep 搜索
    let f = fsToolsFile("grep1")
    let content = "line1\nhello world\nline3\nanother hello\n"
    File.writeTo(f, content.toArray())
    
    let results = grepFiles("hello", f)
    @Expect(results.size, Int64(2))
    if (results.size > 0) {
        @Expect(results[0].contains("hello world"), true)
        @Expect(results[1].contains("another hello"), true)
    }
    
    removeIfExists(f, recursive: false)
}

@Test
func grepFilesNoMatch() {
    // 搜索无匹配
    let f = fsToolsFile("grep2")
    let content = "line1\nline2\n"
    File.writeTo(f, content.toArray())
    
    let results = grepFiles("nonexistent", f)
    @Expect(results.size, Int64(0))
    
    removeIfExists(f, recursive: false)
}

@Test
func editFileReplacesString() {
    // edit 工具：读取文件 → 替换字符串 → 写回
    let f = fsToolsFile("edit1")
    let original = "Hello World\nThis is a test\n"
    File.writeTo(f, original.toArray())
    
    // 先读取建立观察
    let log = SessionLog("core-fstools-edit1.log")
    let reg = ToolRegistry()
    reg.register(ToolSpec("read", "read", "path", false))
    reg.register(ToolSpec("edit", "edit", "path old_string new_string", true))
    let rt = ToolRuntime(log, reg)
    
    // 读取
    let readResult = rt.execute("read", "{\"path\":\"${f}\"}", "", true)
    @Expect(readResult.allowed, true)
    
    // 编辑
    let editArgs = "{\"path\":\"${f}\",\"old_string\":\"World\",\"new_string\":\"DSH\"}"
    let editResult = rt.execute("edit", editArgs, "", true)
    @Expect(editResult.allowed, true)
    
    // 验证结果
    let result = String.fromUtf8(File.readFrom(f))
    @Expect(result.contains("Hello DSH"), true)
    @Expect(result.contains("World"), false)
    
    removeIfExists(f, recursive: false)
    removeIfExists("core-fstools-edit1.log", recursive: false)
}

@Test
func editFileNotFoundReturnsError() {
    // edit 找不到 old_string 时返回错误
    let f = fsToolsFile("edit2")
    File.writeTo(f, "Hello World".toArray())
    
    let log = SessionLog("core-fstools-edit2.log")
    let reg = ToolRegistry()
    reg.register(ToolSpec("read", "read", "path", false))
    reg.register(ToolSpec("edit", "edit", "path old_string new_string", true))
    let rt = ToolRuntime(log, reg)
    
    let readResult = rt.execute("read", "{\"path\":\"${f}\"}", "", true)
    @Expect(readResult.allowed, true)
    
    let editArgs = "{\"path\":\"${f}\",\"old_string\":\"NONEXISTENT\",\"new_string\":\"x\"}"
    let editResult = rt.execute("edit", editArgs, "", true)
    @Expect(editResult.allowed, false)
    @Expect(editResult.why.contains("edit-not-found"), true)
    
    removeIfExists(f, recursive: false)
    removeIfExists("core-fstools-edit2.log", recursive: false)
}

@Test
func lspSymbolsExtractsFunctionNames() {
    // LSP 符号提取
    let f = fsToolsFile("lsp1")
    let content = "func hello() {}\nclass Foo {}\nfunc bar() {}\n"
    File.writeTo(f, content.toArray())
    
    let symbols = lspSymbols(f)
    var foundHello = false
    var foundFoo = false
    for (s in symbols) {
        if (s.contains("hello")) { foundHello = true }
        if (s.contains("Foo")) { foundFoo = true }
    }
    @Expect(foundHello, true)
    @Expect(foundFoo, true)
    
    removeIfExists(f, recursive: false)
}

@Test
func lspSymbolsEmptyFile() {
    // 空文件返回空列表
    let f = fsToolsFile("lsp2")
    File.writeTo(f, "".toArray())
    
    let symbols = lspSymbols(f)
    @Expect(symbols.size, Int64(0))
    
    removeIfExists(f, recursive: false)
}
