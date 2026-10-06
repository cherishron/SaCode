package core

import std.collection.*
import std.fs.*
import std.unittest.*

// 插件安装态的用例。契约：docs/evidence/backend-plugin-contract-2026-10-05.md §3。
//
// 六类行为，每类都带反证——把对应防护去掉，指名用例必须转红：
//   1. 正常安装        → 目录落位 + 事件落盘 + 冷进程回放
//   2. 重名安装        → plugin-already-installed 且不覆盖
//   3. staging 校验失败 → 最终位置什么都不留，日志里也没有事件
//   4. 孤儿包          → plugin-orphan-directory 且不自动删
//   5. 租约互斥        → 另一个写者拿到明确错误，盘上不留半装状态
//   6. 逐包降级        → 一个坏包只让自己坏，其余正常出
//
// 隔离：每条用例一个独立根目录，进出都清。仓颉单测默认并行执行，
// 共用固定目录会让某条用例的收尾删掉另一条正在读的文件（attempt_log_test.cj:9-12
// 记过同一个坑），所以隔离必须落在用例自己身上。

func psRoot(tag: String): String {
    return "core-plugin-store-${tag}"
}

func psClean(tag: String): Unit {
    let root = psRoot(tag)
    try { removeIfExists(root, recursive: true); () } catch (e: Exception) {}
}

// 造一个源插件目录。manifest 的字段可由调用方覆盖，用于造各类坏包。
func psSource(tag: String, name: String, manifestFields: String): String {
    let dir = "${psRoot(tag)}-src"
    try { removeIfExists(dir, recursive: true); () } catch (e: Exception) {}
    Directory.create(dir, recursive: true)
    // 拼装拆成两段：`"${base}}"` 这种「模板紧跟一个右花括号」的写法可读性太差，
    // 而且将来要在 base 里加字段时容易看花眼。
    let base = "{\"name\":\"${name}\",\"version\":\"0.1.0\",\"kind\":\"tool\",\"entry\":\"index.cjs\""
    let tail = if (manifestFields.size == 0) { "}" } else { ",${manifestFields}}" }
    File.writeTo("${dir}/sacode.plugin.json", (base + tail).toArray())
    File.writeTo("${dir}/index.cjs", "module.exports = { name: 'echo', handler: () => 'ok' }\n".toArray())
    return dir
}

// 造一个 manifest 正文由调用方逐字给定的源目录。检视面的拒绝路径要的是
// 「文件在场但内容不合法」，用 psSource 拼不出来（它总会拼出一份合法 JSON）。
func psSourceRaw(tag: String, suffix: String, manifestText: String): String {
    let dir = "${psRoot(tag)}-${suffix}"
    try { removeIfExists(dir, recursive: true); () } catch (e: Exception) {}
    Directory.create(dir, recursive: true)
    File.writeTo("${dir}/sacode.plugin.json", manifestText.toArray())
    File.writeTo("${dir}/index.cjs", "module.exports = { name: 'echo', handler: () => 'ok' }\n".toArray())
    return dir
}

// 安装结果的码。不用 lambda 取码：捕获可变变量的 lambda 不能被间接调用
// （宿主侧 main.cj:1384 踩过），而这里连 let 捕获都不需要。
func psInstallCode(store: PluginStore, sourcePath: String): String {
    var code = ""
    try {
        let rec = store.install(sourcePath)
        code = "ok:${rec.name}@${rec.version}"
    } catch (e: Exception) {
        code = e.message
    }
    return code
}

func psRead(path: String): String {
    return String.fromUtf8(File.readFrom(path))
}

@Test
func pluginStoreInstallsAndReplaysFromColdProcess() {
    let tag = "happy"
    psClean(tag)
    let base = psRoot(tag)
    let src = psSource(tag, "@local/sacode-tool-echo", "")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    // 目录落位在最终位置，staging 不留
    @Expect(exists("${base}/plugins/local-sacode-tool-echo/sacode.plugin.json"), true)
    @Expect(exists("${base}/plugins/local-sacode-tool-echo/index.cjs"), true)
    // 事件落盘，且租约已归还
    @Expect(exists("${base}/plugins.log"), true)
    @Expect(exists("${base}/plugins.log.lease"), false)
    @Expect(psRead("${base}/plugins.log").contains("plugin/install"), true)
    // 冷进程回放：换一个实例（不继承任何进程内状态）必须读回同一个包
    let cold = PluginStore(base)
    let view = cold.describe()
    @Expect(view.packages.size, Int64(1))
    @Expect(view.packages[0].name, "@local/sacode-tool-echo")
    @Expect(view.packages[0].version, "0.1.0")
    @Expect(view.packages[0].title, "sacode-tool-echo")
    @Expect(view.packages[0].installed, true)
    @Expect(view.packages[0].enabled, true)
    @Expect(view.packages[0].error, "")
    @Expect(view.packages[0].rows.size, Int64(0))
    @Expect(view.revision, Int64(1))
    @Expect(cold.revisionOf(), Int64(1))
    @Expect(cold.has("@local/sacode-tool-echo"), true)
    // 反证：把 reload 从 describe 里摘掉，这条冷进程断言必须转红
    // （进程内 records 非空时它会假装有数据，而冷实例是空的）。
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreRejectsReinstallWithoutOverwriting() {
    let tag = "reinstall"
    psClean(tag)
    let base = psRoot(tag)
    let src = psSource(tag, "@local/sacode-tool-echo", "")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    // 用户可能改过插件内容：覆盖等于把用户的改动悄悄换掉
    File.writeTo("${base}/plugins/local-sacode-tool-echo/index.cjs", "module.exports = { name: 'echo', handler: () => 'user-edited' }\n".toArray())
    @Expect(psInstallCode(store, src), "plugin-already-installed")
    // 不覆盖：盘上那份还是用户改过的
    @Expect(psRead("${base}/plugins/local-sacode-tool-echo/index.cjs").contains("user-edited"), true)
    // 也不多一条事件：重名被拒是一次拒绝，不是一次安装
    @Expect(store.revisionOf(), Int64(1))
    // staging 不留垃圾
    @Expect(Directory.readFrom("${base}/plugins").size, Int64(1))
    // 反证：把 overwrite 改成 true，`user-edited` 那条必须转红。
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreLeavesNothingWhenStagingValidationFails() {
    let tag = "badmanifest"
    psClean(tag)
    let base = psRoot(tag)
    // 缺 entry：结构位一个默认值都不给
    let src = psSource(tag, "@local/sacode-tool-broken", "\"version\":\"0.2.0\"")
    try { removeIfExists("${src}/sacode.plugin.json"); () } catch (e: Exception) {}
    File.writeTo("${src}/sacode.plugin.json", "{\"name\":\"@local/sacode-tool-broken\",\"version\":\"0.2.0\"}".toArray())
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "plugin-rejected")
    // 最终位置什么都没有，日志里也没有事件——校验不过绝不在落盘之后才发现
    @Expect(exists("${base}/plugins"), true)
    @Expect(Directory.readFrom("${base}/plugins").size, Int64(0))
    @Expect(exists("${base}/plugins.log"), false)
    @Expect(exists("${base}/plugins.log.lease"), false)
    // 反证：把校验挪到 rename 之后，`plugins.log` 不存在那条必须转红。
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreReportsOrphanDirectoryWithoutDeletingIt() {
    let tag = "orphan"
    psClean(tag)
    let base = psRoot(tag)
    // 手工造出「崩在落位与事件之间」的形态：目录在，日志里没有。
    let orphan = "${base}/plugins/local-sacode-tool-echo"
    Directory.create(orphan, recursive: true)
    File.writeTo("${orphan}/sacode.plugin.json", "{\"name\":\"@local/sacode-tool-echo\",\"version\":\"0.1.0\",\"entry\":\"index.cjs\"}".toArray())
    let src = psSource(tag, "@local/sacode-tool-echo", "")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "plugin-orphan-directory")
    // 不自动删：那可能是用户刚装到一半的包，删了就无法挽回
    @Expect(exists(orphan), true)
    @Expect(exists("${base}/plugins.log"), false)
    // 它也不出现在清单里：没有事件的包不是已安装的包
    @Expect(store.describe().packages.size, Int64(0))
    // 反证：把「不自动删」改成落位前先清目标，exists(orphan) 那条必须转红。
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreRefusesSecondWriterWithoutHalfInstall() {
    let tag = "busy"
    psClean(tag)
    let base = psRoot(tag)
    // 租约的独占临时文件落在 base 里，所以 base 必须先存在——
    // 否则拿租约那一步会因为目录不存在而失败，测到的就不是「忙」而是「目录没有」。
    Directory.create(base, recursive: true)
    let src = psSource(tag, "@local/sacode-tool-echo", "")
    // 另一个写者持着 plugins.log 的租约（可能是崩溃前留下的，也可能是另一个入口）
    let other = WriteLease("${base}/plugins.log")
    @Expect(other.acquire(), true)
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "plugin-busy")
    // 拿不到租约时盘上什么都不留：一次「忙」不该永久变成一个孤儿包
    @Expect(exists("${base}/plugins"), true)
    @Expect(Directory.readFrom("${base}/plugins").size, Int64(0))
    @Expect(exists("${base}/plugins.log"), false)
    // 反证：把租约检查挪到 rename 之后，`plugins 目录为空`那条必须转红。
    other.release()
    // 租约还回之后同一个安装必须成功——证明拒绝确实只因忙，不是因为包有问题
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreDegradesOneBrokenPackageWithoutAffectingOthers() {
    let tag = "degrade"
    psClean(tag)
    let base = psRoot(tag)
    let good = psSource(tag, "@local/sacode-tool-echo", "")
    let alsoGood = psSource("${tag}b", "@local/sacode-tool-base", "")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, good), "ok:@local/sacode-tool-echo@0.1.0")
    @Expect(psInstallCode(store, alsoGood), "ok:@local/sacode-tool-base@0.1.0")
    // 把其中一个包的 manifest 弄坏：它只该让自己坏
    File.writeTo("${base}/plugins/local-sacode-tool-echo/sacode.plugin.json", "{ 这不是 JSON".toArray())
    let view = store.describe()
    @Expect(view.packages.size, Int64(2))
    var broken = 0
    var healthy = 0
    for (p in view.packages) {
        if (p.name == "@local/sacode-tool-echo") {
            broken += 1
            // 坏包仍然可见，且带着 manifest 自己的码——安装时能告诉用户具体哪条规则被违反
            @Expect(p.error, "plugin-rejected")
            @Expect(p.rows.size, Int64(0))
        } else {
            healthy += 1
            @Expect(p.error, "")
        }
    }
    @Expect(broken, Int64(1))
    @Expect(healthy, Int64(1))
    // 目录整个消失也是同一族降级：报 plugin-not-found，不连坐
    try { removeIfExists("${base}/plugins/local-sacode-tool-base", recursive: true); () } catch (e: Exception) {}
    let after = store.describe()
    var missing = 0
    for (p in after.packages) {
        if (p.name == "@local/sacode-tool-base") {
            missing += 1
            @Expect(p.error, "plugin-not-found")
        }
    }
    @Expect(missing, Int64(1))
    // 反证：把 viewOf 的 try/catch 改成整份 describe 抛异常，前两条 @Expect 必须转红。
    psClean(tag)
    try { removeIfExists(good, recursive: true); () } catch (e: Exception) {}
    try { removeIfExists(alsoGood, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreUninstallRemovesDirectoryAndKeepsRevisionCas() {
    let tag = "uninstall"
    psClean(tag)
    let base = psRoot(tag)
    let src = psSource(tag, "@local/sacode-tool-echo", "")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    // 过期修订号必须先拒，且盘上什么都不动
    var stale = ""
    try {
        store.uninstall("@local/sacode-tool-echo", Int64(99))
    } catch (e: Exception) {
        stale = e.message
    }
    @Expect(stale, "settings-conflict")
    @Expect(store.has("@local/sacode-tool-echo"), true)
    // 正确修订号：目录与事件都走
    store.uninstall("@local/sacode-tool-echo", Int64(1))
    @Expect(exists("${base}/plugins/local-sacode-tool-echo"), false)
    @Expect(store.has("@local/sacode-tool-echo"), false)
    @Expect(psRead("${base}/plugins.log").contains("plugin/uninstall"), true)
    // 冷进程回放：卸载也是日志事实，不是进程内状态
    @Expect(PluginStore(base).has("@local/sacode-tool-echo"), false)
    // 反证：把 guardRevision 的 `!=` 改成 `>=`，settings-conflict 那条必须转红。
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginStoreRejectsReplayCorruptionInsteadOfHalfInventory() {
    let tag = "corrupt"
    psClean(tag)
    let base = psRoot(tag)
    let first = psSource(tag, "@local/sacode-tool-echo", "")
    let second = psSource("${tag}b", "@local/sacode-tool-base", "")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, first), "ok:@local/sacode-tool-echo@0.1.0")
    @Expect(psInstallCode(store, second), "ok:@local/sacode-tool-base@0.1.0")
    // 中段挖掉第一帧：剩下的 seq 从 1 开始，连续性断了。
    // 必须先装两个包——只装一个时挖掉唯一一帧会得到空文件，而空文件的回放是合法的，
    // 那样测到的是「空日志」而不是「回放被拒」。
    let lines = psRead("${base}/plugins.log").split("\n")
    var kept = ""
    var comma = ""
    var i: Int64 = 0
    while (i < Int64(lines.size)) {
        if (i != 0) {
            kept += comma + lines[i]
            comma = "\n"
        }
        i += 1
    }
    File.writeTo("${base}/plugins.log", kept.toArray())
    var code = ""
    try {
        let view = store.describe()
        code = "ok:${view.packages.size}"
    } catch (e: Exception) {
        code = e.message
    }
    @Expect(code, "plugin-replay-rejected")
    // 反证：把 reload 的 load 失败改成 return（静默从空开始），这条必须转红。
    psClean(tag)
    try { removeIfExists(first, recursive: true); () } catch (e: Exception) {}
    try { removeIfExists(second, recursive: true); () } catch (e: Exception) {}
}

// —— 下面是「插件清单接线」这一片（docs/evidence/plugin-manager-contract-2026-10-05.md §3.1/§3.3）。
// 宿主不自己拼 JSON：清单视图与安装前检视都由核心序列化，宿主只做转发与错误映射。
// 这两条序列化面一旦缺字段，界面就会「猜默认值」——猜出来的清单就是伪造快照，
// 正是这份契约在 §3 开头明令禁止的做法。

@Test
func pluginInventoryJsonOnEmptyStoreSaysAvailableAndEmpty() {
    let tag = "jsonempty"
    psClean(tag)
    let text = PluginStore(psRoot(tag)).describe().asJson()
    // 空清单是「还没装」，不是「本部署不管理插件」：available 必须为 true，
    // 否则界面会把空态渲染成错误态，用户以为后端坏了。
    @Expect(text.contains("\"available\":true"), true)
    @Expect(text.contains("\"revision\":0"), true)
    @Expect(text.contains("\"packages\":[]"), true)
    // 反证：把 available 硬写成 false，第一条断言必须转红。
    psClean(tag)
}

@Test
func pluginInventoryJsonCarriesPackageAndRowFields() {
    let tag = "jsonshape"
    psClean(tag)
    let base = psRoot(tag)
    let src = psSource(tag, "@local/sacode-tool-echo",
        "\"tools\":[{\"name\":\"echo\",\"description\":\"回显一条消息\"}]")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    let text = PluginStore(base).describe().asJson()
    @Expect(text.contains("\"available\":true"), true)
    @Expect(text.contains("\"revision\":1"), true)
    @Expect(text.contains("\"name\":\"@local/sacode-tool-echo\""), true)
    @Expect(text.contains("\"version\":\"0.1.0\""), true)
    // 契约要求 installed 与 enabled 是两个独立字段：少了任何一个，
    // 「装了但没启用」这种状态在界面上就无处表达。
    @Expect(text.contains("\"installed\":true"), true)
    @Expect(text.contains("\"enabled\":true"), true)
    @Expect(text.contains("\"rows\":["), true)
    @Expect(text.contains("\"rowId\":\"echo\""), true)
    // 装了但未激活 ⇒ pending：phase 由生命周期事实投影，不再是 enabled 硬编码。
    // 旧断言恒 active，正是这次要修掉的假成功。
    @Expect(text.contains("\"phase\":\"pending\""), true)
    // 坏包字段在没有错误时必须是 JSON 的 null，不能是空串——
    // 界面按 null 判「无错误」，空串会被当成一条看不见的错误文案。
    @Expect(text.contains("\"error\":null"), true)
    @Expect(text.contains("\"readOnlyReason\":null"), true)
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginInspectDescribesSourceWithoutTouchingStore() {
    let tag = "inspectok"
    psClean(tag)
    let base = psRoot(tag)
    // 检视面只认绝对路径（相对路径要经宿主的工作目录才能落到盘上，两入口的 CWD 不同），
    // 所以夹具也得给绝对形态——否则测到的是「路径形态」而不是「检视零副作用」。
    let src = canonicalize(psSource(tag, "@local/sacode-tool-echo",
        "\"description\":\"一个用来验证检视面的本地包\"")).toString()
    let store = PluginStore(base)
    let text = store.inspectSource(src)
    @Expect(text.contains("\"status\":\"accepted\""), true)
    @Expect(text.contains("\"name\":\"@local/sacode-tool-echo\""), true)
    @Expect(text.contains("\"version\":\"0.1.0\""), true)
    @Expect(text.contains("\"description\":\"一个用来验证检视面的本地包\""), true)
    // 检视必须零副作用：还没确认就落位，等于把「预览」变成「安装」。
    @Expect(store.revisionOf(), Int64(0))
    @Expect(exists("${base}/plugins.log"), false)
    @Expect(exists("${base}/plugins"), false)
    // 反证：让 inspectSource 走 install 的 staging 落位路径，最后两条必须转红。
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginInspectRefusesMissingAndBrokenSource() {
    let tag = "inspectbad"
    psClean(tag)
    let base = psRoot(tag)
    let store = PluginStore(base)
    // 坏 manifest 的目录先建出来，再借它的绝对形态造一个「父目录存在、子目录不存在」的路径：
    // canonicalize 需要一个能解析的起点，而不存在的目录本身解不出绝对路径。
    let badDir = canonicalize(psSourceRaw(tag, "badjson", "{not json")).toString()
    let missing = "${badDir}/no-such-child"
    // 目录不存在：problem 必须是 not-found，界面据此说「找不到这个包」。
    @Expect(store.inspectSource(missing).contains("\"status\":\"refused\""), true)
    @Expect(store.inspectSource(missing).contains("\"problem\":\"not-found\""), true)
    // manifest 坏了：解析层的码原样带出，不压成 unknown——
    // 用户能看到「哪一条规则被违反」才有下一步可走。
    let bad = store.inspectSource(badDir)
    @Expect(bad.contains("\"status\":\"refused\""), true)
    @Expect(bad.contains("\"problem\":\"invalid\""), true)
    @Expect(bad.contains("plugin-rejected"), true)
    // 形态不对（相对路径）也要如实说 invalid，而不是当成一个不存在的目录报 not-found：
    // 后者会把用户指向「路径打错了」，而真正的原因是协议面只接绝对路径。
    @Expect(store.inspectSource("core-plugin-store-relative-src").contains("\"problem\":\"invalid\""), true)
    // 拒绝同样不留痕迹
    @Expect(store.revisionOf(), Int64(0))
    psClean(tag)
    try { removeIfExists(badDir, recursive: true); () } catch (e: Exception) {}
}
