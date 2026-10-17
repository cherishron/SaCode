package core
import std.unittest.*

// LSP 上游契约（M4）：`ctx.lsp` 语言服务协议窄化——本切片只做符号（symbol）
// 注册表：`define(symbolId, kind, location)` + `lookup(symbolId)` + `rename(...)`。
// 空 symbolId/kind/location 抛；重名走 noop（不覆盖原位置）。

@Test
func lspDefineAndLookup() {
    let r = LspSymbolRegistry()
    r.define("sym-1", "function", "src/main.cj:10")
    @Expect(r.lookup("sym-1"), "src/main.cj:10")
    @Expect(r.count(), Int64(1))
}

@Test
func lspRejectsEmptyFields() {
    let r = LspSymbolRegistry()
    var threw = false
    try {
        r.define("", "function", "x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(r.count(), Int64(0))
}

@Test
func lspDuplicateDefineIsNoop() {
    let r = LspSymbolRegistry()
    r.define("sym-1", "function", "src/main.cj:10")
    r.define("sym-1", "function", "src/other.cj:20")
    @Expect(r.lookup("sym-1"), "src/main.cj:10")
    @Expect(r.count(), Int64(1))
}

@Test
func lspRenameUpdatesLocation() {
    let r = LspSymbolRegistry()
    r.define("sym-1", "function", "src/main.cj:10")
    r.rename("sym-1", "src/main.cj:20")
    @Expect(r.lookup("sym-1"), "src/main.cj:20")
    var threw = false
    try {
        r.rename("ghost", "x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}
