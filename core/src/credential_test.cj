package core

import std.fs.*
import std.collection.*
import std.unittest.*

// 凭证缝（上游 credentials 子系统，冻结 639ed01 的硬规约）：配置面只携带引用（POSIX 环境变量名），
// 值由分层 provider 持有；消费方每次操作重新解析；空值在所有层都不算存在；由活环境供值的引用不可写。
let credFile = "core-test-credseam.env"

// 假的一层活进程环境：可以在测试中途改，用来模拟「环境影子撤掉之后文件层才可见」
class FakeEnvLayer {
    var name = ""
    var value = ""
    func supply(ref: String, v: String): Unit {
        name = ref
        value = v
    }
    func lookup(key: String): String {
        if (key == name && value.size > 0) { return value }
        return ""
    }
}

func credCleanup(): Unit {
    if (exists(credFile)) {
        try { removeIfExists(credFile, recursive: false) } catch (e: Exception) {}
    }
}

func credStore(env: FakeEnvLayer): CredentialStore {
    let lookup: (String) -> String = { key => env.lookup(key) }
    return CredentialStore(credFile, lookup)
}

// 引用名只接受 POSIX 环境变量语法：带短横线的提供商 id 不能直接当引用用
@Test
func credentialRefMustBePosixEnvSyntax() {
    credCleanup()
    let env = FakeEnvLayer()
    var rejected = Int64(0)
    for (bad in ["has-dash", "2leading", "with space", "", "with.dot", "with=equals"]) {
        try {
            credStore(env).resolve(bad)
        } catch (e: Exception) {
            if (e.message == "bad-credential-ref") { rejected += 1 }
        }
    }
    @Expect(rejected, 6)
    var accepted = Int64(0)
    for (ok in ["STEPFUN_API_KEY", "_LEADING", "Mix3d_1"]) {
        if (credStore(env).resolve(ok).isNone()) { accepted += 1 }
    }
    @Expect(accepted, 3)
    credCleanup()
}

// 活进程环境压过用户文件层：这一档写了也不生效，必须当场拒绝而不是假装保存成功
@Test
func credentialEnvLayerShadowsUserFileAndIsNotWritable() {
    credCleanup()
    let env = FakeEnvLayer()
    let s = credStore(env)
    // 没有环境供值时先正常落一层文件
    s.set("SA_KEY", "来自文件")
    @Expect(s.describe("SA_KEY").source, "user-file")
    @Expect(s.describe("SA_KEY").writable, true)
    // 环境开始供同一个引用：读面立刻改口，写面必须拒绝
    env.supply("SA_KEY", "来自环境")
    @Expect(s.resolve("SA_KEY").getOrThrow().source, "env")
    @Expect(s.describe("SA_KEY").writable, false)
    var refused = ""
    try { s.set("SA_KEY", "写不进去") } catch (e: Exception) { refused = e.message }
    @Expect(refused, "credential-read-only")
    @Expect(s.resolve("SA_KEY").getOrThrow().value, "来自环境")
    // 环境影子撤掉后，文件层原值仍在
    env.supply("SA_KEY", "")
    @Expect(s.resolve("SA_KEY").getOrThrow().source, "user-file")
    @Expect(s.describe("SA_KEY").writable, true)
    credCleanup()
}

// 空值即缺席：写空串等于撤销，盘上不该留下一个「存在但为空」的条目
@Test
func credentialEmptyValueMeansAbsentEverywhere() {
    credCleanup()
    let s = credStore(FakeEnvLayer())
    s.set("SA_KEY", "先写一个值")
    @Expect(s.resolve("SA_KEY").isSome(), true)
    s.set("SA_KEY", "")
    @Expect(s.resolve("SA_KEY").isNone(), true)
    @Expect(s.describe("SA_KEY").configured, false)
    let text = String.fromUtf8(File.readFrom(credFile))
    @Expect(text.contains("SA_KEY"), false)
    credCleanup()
}

// describe 是给配置面用的读面，永远不带值；读面上出现明文就是泄漏
@Test
func credentialDescribeNeverCarriesTheValue() {
    credCleanup()
    let s = credStore(FakeEnvLayer())
    s.set("SA_KEY", "绝不该出现在读面上的明文")
    let info = s.describe("SA_KEY")
    @Expect(info.configured, true)
    @Expect(info.source, "user-file")
    @Expect(info.writable, true)
    @Expect(info.safeSummary().contains("明文"), false)
    credCleanup()
}

// 每次操作重新解析：外部改盘之后立即生效，旋转密钥要能落到下一次请求，不需要重启进程
@Test
func credentialResolveReReadsStoreEachOperation() {
    credCleanup()
    let s = credStore(FakeEnvLayer())
    s.set("SA_KEY", "第一版")
    @Expect(s.resolve("SA_KEY").getOrThrow().value, "第一版")
    File.writeTo(credFile, "SA_KEY=第二版\n".toArray())
    @Expect(s.resolve("SA_KEY").getOrThrow().value, "第二版")
    s.unset("SA_KEY")
    @Expect(s.resolve("SA_KEY").isNone(), true)
    credCleanup()
}

// 值不接受换行与控制字符：文件层是逐行 KEY=VALUE，塞进换行等于注入另一条凭证
@Test
func credentialValueRejectsLineBreaksAndControlBytes() {
    credCleanup()
    let s = credStore(FakeEnvLayer())
    var rejected = Int64(0)
    for (bad in ["带\n换行", "带\r回车", "带\t制表", "带\u{0007}铃"]) {
        try { s.set("SA_KEY", bad) } catch (e: Exception) {
            if (e.message == "bad-credential-value") { rejected += 1 }
        }
    }
    @Expect(rejected, 4)
    @Expect(s.resolve("SA_KEY").isNone(), true)
    credCleanup()
}

// 盘上是别人写的畸形行也不能骗出「已配置」：无等号、空键、只有键的都得当缺席
@Test
func credentialMalformedStoreLinesAreNotConfigured() {
    credCleanup()
    let s = credStore(FakeEnvLayer())
    File.writeTo(credFile, "没有等号的一行\nSA_KEY=\n=novalue\n".toArray())
    @Expect(s.resolve("SA_KEY").isNone(), true)
    @Expect(s.describe("SA_KEY").configured, false)
    // 同键出现两次以最后一次为准，不是第一次
    File.writeTo(credFile, "SA_KEY=旧值\nSA_KEY=新值\n".toArray())
    @Expect(s.resolve("SA_KEY").getOrThrow().value, "新值")
    // 写入时不得留下重复条目
    s.set("OTHER", "并存的另一条")
    let text = String.fromUtf8(File.readFrom(credFile))
    var kept = Int64(0)
    for (line in text.split("\n")) {
        if (line.startsWith("SA_KEY=")) {
            kept += 1
        }
    }
    @Expect(kept, Int64(1))
    @Expect(s.resolve("OTHER").getOrThrow().value, "并存的另一条")
    credCleanup()
}
