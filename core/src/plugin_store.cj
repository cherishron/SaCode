package core

import std.collection.*
import std.fs.*
import stdx.encoding.json.*

// 插件安装态。这是「一切皆插件」契约（docs/evidence/backend-plugin-contract-2026-10-05.md
// §3）的 step-2 落地：目录布局、四步原子安装、事件回放、逐包降级。
//
// 四条纪律，逐条对应契约里写明的理由：
//
//   1. **事件在文件之后**。先原子落位、再追加事件。崩在中间得到的是「有目录无事件」的
//      孤儿包——它在磁盘上看得见、下次安装撞名时会报出来、可以人工清理；反过来（先事件
//      后文件）会得到一条指向不存在目录的记录，清单里永远显示一个「装了但打不开」的
//      插件，而用户没有任何办法修好它。前者可见可清理，后者静默永久。
//
//   2. **校验发生在 staging 里，不在落位之后**。校验的是「即将被 rename 进最终位置的那
//      一份字节」，不是源目录此刻的内容——源目录在拷贝与落位之间可能被改过（TOCTOU）。
//      校验不过时删掉 staging，日志里一条事件都没有。
//
//   3. **落位不覆盖**。rename(overwrite:false)：目标已存在就失败。覆盖等于把用户可能改过
//      的插件内容悄悄换掉。
//
//   4. **写日志必须持租约**。ProviderRegistry.commit（provider_registry.cj:562-572）没用
//      租约，两个入口同时改 providers.log 会互相覆盖——那是已知欠账，不是可效法的先例。
//      插件安装期间有子进程在跑、界面在轮询，并发窗口比提供商配置大得多。
//
// 与契约的一处**有意偏离**，写在这里免得下次当成 bug 改回去：契约 §3.2 的字面顺序是
// 「落位 → 拿租约 → 追加事件 → 还租约」。本实现把租约提前到 rename 之前持有，跨过
// rename + append + flush 再释放。理由是字面顺序下，`acquire()` 失败时目录已经落位，
//      于是一次「忙」会永久变成一个孤儿包；而持有租约后 acquire 失败时盘上什么都不留。
//      「事件在文件之后」这条实质纪律两种顺序都满足，改动只让失败语义更干净。

let pluginManifestFileName = "sacode.plugin.json"

// 插件包体量与文件数上限：拷贝是本地 I/O，但不该无界。
// 超限在 staging 阶段就拒，不留半个包。
let pluginPackageBytesLimit = Int64(32 * 1024 * 1024)
let pluginPackageFileLimit = Int64(4096)

// 一个已安装插件的日志事实。字段全是 let：调用方拿到的是回放快照，
// 改动它不会反向影响注册表。
public class PluginRecord {
    public let name: String
    public let version: String
    public let directory: String
    public let enabled: Bool
    public let installed: Bool

    public init(name: String, version: String, directory: String, enabled: Bool, installed: Bool) {
        this.name = name
        this.version = version
        this.directory = directory
        this.enabled = enabled
        this.installed = installed
    }
}

// describe() 的一行。error 非空表示这个包自己坏了——它仍然出现在清单里，
// 因为「消失的插件」比「看得见的坏插件」更难排查（上游 skills 的 rank 分层与
// 本仓 plugins-page.ts 的「失败优先排序」都要求坏包可见）。
public class PluginRowView {
    public let rowId: String
    public let title: String
    public let moduleName: String
    public let entryId: String
    public let description: String
    public let descriptionZhCN: String
    public let enabled: Bool
    public let phase: String
    public let readOnlyReason: String

    public init(rowId: String, title: String, moduleName: String, entryId: String,
        description: String, descriptionZhCN: String, enabled: Bool, phase: String,
        readOnlyReason: String) {
        this.rowId = rowId
        this.title = title
        this.moduleName = moduleName
        this.entryId = entryId
        this.description = description
        this.descriptionZhCN = descriptionZhCN
        this.enabled = enabled
        this.phase = phase
        this.readOnlyReason = readOnlyReason
    }
}

public class PluginPackageView {
    public let name: String
    public let version: String
    public let title: String
    public let description: String
    public let descriptionZhCN: String
    public let kind: String
    public let directory: String
    public let installed: Bool
    public let optional: Bool
    public let enabled: Bool
    public let error: String
    public let rows: Array<PluginRowView>

    public init(name: String, version: String, title: String, description: String,
        descriptionZhCN: String, kind: String, directory: String, installed: Bool,
        optional: Bool, enabled: Bool, error: String, rows: Array<PluginRowView>) {
        this.name = name
        this.version = version
        this.title = title
        this.description = description
        this.descriptionZhCN = descriptionZhCN
        this.kind = kind
        this.directory = directory
        this.installed = installed
        this.optional = optional
        this.enabled = enabled
        this.error = error
        this.rows = rows
    }
}

public class PluginInventory {
    public let available: Bool
    public let revision: Int64
    public let packages: Array<PluginPackageView>

    public init(available: Bool, revision: Int64, packages: Array<PluginPackageView>) {
        this.available = available
        this.revision = revision
        this.packages = packages
    }
}

// 拷贝预算。仓颉的函数参数按值传递，把「已拷了多少」写成两个 Int64 形参时，
// 子目录里加的量回不到父调用——上限会退化成「每个目录各一份」。
// 所以必须装在一个可变引用里递下去（approval_test.cj 的假钟用的是同一条办法：
// 可推进的状态放进不可变引用，推进只改它内部的字段）。
class CopyBudget {
    var bytes: Int64
    var files: Int64
    init() {
        bytes = Int64(0)
        files = Int64(0)
    }
}

public class PluginStore {
    let base: String
    var records = ArrayList<PluginRecord>()
    var revision = Int64(0)

    public init(base: String) {
        this.base = base
    }

    // 事件日志即真源；与 providers.log 同一条纪律——每次操作都从盘上重放，
    // 另一个入口改过之后不能还拿旧视图去判断冲突。
    public func logPath(): String {
        return "${base}/plugins.log"
    }

    public func packagesRoot(): String {
        return "${base}/plugins"
    }

    public func revisionOf(): Int64 {
        reload()
        return revision
    }

    public func has(name: String): Bool {
        reload()
        return find(name).name.size > 0
    }

    // 包名到目录名：`@local/x` → `local-x`。连续分隔符合一，
    // 规整前的原始 name 只存在于事件里，卸载时据此定位目录。
    public func directoryOf(name: String): String {
        return "${packagesRoot()}/${slugOf(name)}"
    }

    public func describe(): PluginInventory {
        reload()
        let out = ArrayList<PluginPackageView>()
        for (rec in records) {
            out.add(viewOf(rec))
        }
        return PluginInventory(true, revision, out.toArray())
    }

    // 四步原子安装。顺序不能反，理由见文件头注释第 1、2 条。
    public func install(sourcePath: String): PluginRecord {
        if (!FileInfo(sourcePath).isDirectory()) {
            throw Exception("plugin-source-not-found")
        }
        // —— 第 1 步：拷贝到 staging（不持锁）——
        let staging = newStagingPath()
        try {
            copyTree(sourcePath, staging)
            // —— 第 2 步：在 staging 里解析校验（不持锁）——
            // 校验的是即将被 rename 进最终位置的那一份字节，不是源目录此刻的内容。
            let manifest = parsePluginManifest(readManifestText(staging))
            let final = directoryOf(manifest.name)
            if (exists(final)) {
                // 撞名要分两种：日志里有记录 = 装过了；没有 = 崩在落位与事件之间的孤儿。
                // 合并成一个码，用户就分不出该「卸载重装」还是该「清理目录」。
                removeIfExists(staging, recursive: true)
                // 码先落成 let 再抛：if 表达式直接当 Exception 的参数在本仓没有先例，
                // 而「一个码两条处置」这段逻辑值得被单独一行说清。
                let clash = if (has(manifest.name)) { "plugin-already-installed" } else { "plugin-orphan-directory" }
                throw Exception(clash)
            }
            // —— 第 3、4 步：持租约跨过落位与事件，失败时盘上不留半装状态 ——
            let lease = leaseForLog()
            if (!lease.acquire()) {
                removeIfExists(staging, recursive: true)
                throw Exception("plugin-busy")
            }
            try {
                rename(staging, to: final, overwrite: false)
                commit("plugin/install", installEventData(manifest.name, manifest.version, slugOf(manifest.name)))
            } catch (e: Exception) {
                // 落位或落账失败：还回租约，让下一个写者能进。
                // 此时目录可能已在最终位置而事件没落——那就是契约里写明的孤儿包形态，
                // 由下次安装撞名时报出，不在这里偷偷删掉（那可能是用户刚装到一半的包）。
                lease.release()
                throw e
            }
            if (!lease.release()) {
                // 事件已经 flush 成功，状态是对的；只剩租约残留，由 takeoverIfStale 接管。
                // 不谎报失败——那会让人重装一个其实已经装好的包。
                // 空分支是有意的：这里没有可做的事，写一行日志会污染宿主的 stderr 诊断面。
            }
            reload()
            let done = find(manifest.name)
            if (done.name.size == 0) {
                throw Exception("plugin-install-not-replayed")
            }
            return done
        } catch (e: Exception) {
            removeIfExists(staging, recursive: true)
            throw e
        }
    }

    public func uninstall(name: String, expectedRevision: Int64): Unit {
        reload()
        let rec = find(name)
        if (rec.name.size == 0) {
            throw Exception("plugin-not-found")
        }
        guardRevision(expectedRevision)
        let lease = leaseForLog()
        if (!lease.acquire()) {
            throw Exception("plugin-busy")
        }
        try {
            commit("plugin/uninstall", textEventData("name", name))
        } finally {
            lease.release()
        }
        // 事件落账之后才动目录：先删目录再落账，崩在中间会得到一条指向不存在目录的记录。
        removeIfExists(rec.directory, recursive: true)
        reload()
    }

    public func setEnabled(name: String, on: Bool, expectedRevision: Int64): Unit {
        reload()
        if (find(name).name.size == 0) {
            throw Exception("plugin-not-found")
        }
        guardRevision(expectedRevision)
        let lease = leaseForLog()
        if (!lease.acquire()) {
            throw Exception("plugin-busy")
        }
        try {
            commit("plugin/enabled", enabledEventData(name, on))
        } finally {
            lease.release()
        }
    }

    // 崩溃残留租约的接管：与 session.log 同一函数、同一判据（pid 判活）。
    // 安装途中进程死掉不会让 plugins.log 永久锁死。
    public func takeover(): Bool {
        return leaseForLog().takeoverIfStale()
    }

    // 租约的独占临时文件落在 base 里，所以 base 必须先存在。
    // 少了这一行，第一次安装前拿租约会因为目录不存在而失败，却被报成 plugin-busy——
    // 一个和「忙」无关的误导性错误，用户会以为是另一个入口占着。
    private func leaseForLog(): WriteLease {
        if (!exists(base)) { Directory.create(base, recursive: true) }
        return WriteLease(logPath())
    }

    private func find(name: String): PluginRecord {
        for (rec in records) {
            if (rec.name == name) {
                return rec
            }
        }
        return PluginRecord("", "", "", false, false)
    }

    private func guardRevision(expectedRevision: Int64): Unit {
        if (expectedRevision >= 0 && expectedRevision != revision) {
            // 冲突与拒绝必须分开：合并成「操作失败」就丢掉了「别人先改过，请重新读取」
            // 这条唯一可执行的信息（provider_registry.cj:556-560 同一条理由）。
            throw Exception("settings-conflict")
        }
    }

    private func commit(eventType: String, data: String): Unit {
        let log = SessionLog(logPath())
        if (exists(logPath()) && (!log.load() || log.isTruncatedTail())) {
            throw Exception("plugin-replay-rejected")
        }
        log.append(eventType, data)
        if (!log.flush()) {
            throw Exception("plugin-flush-failed")
        }
    }

    private func reload(): Unit {
        records = ArrayList<PluginRecord>()
        revision = Int64(0)
        if (!exists(logPath())) {
            return
        }
        let log = SessionLog(logPath())
        if (!log.load() || log.isTruncatedTail()) {
            throw Exception("plugin-replay-rejected")
        }
        for (ev in log.snapshotEvents()) {
            revision += 1
            if (ev.eventType == "plugin/install") {
                let obj = eventObject(ev.data)
                let rec = PluginRecord(
                    textFieldOf(obj, "name"),
                    textFieldOf(obj, "version"),
                    "${packagesRoot()}/${textFieldOf(obj, "directory")}",
                    true,
                    true
                )
                var replaced = false
                var i: Int64 = 0
                while (i < Int64(records.size)) {
                    if (records[i].name == rec.name) {
                        records[i] = rec
                        replaced = true
                    }
                    i += 1
                }
                if (!replaced) {
                    records.add(rec)
                }
            } else if (ev.eventType == "plugin/uninstall") {
                let wanted = textFieldOf(eventObject(ev.data), "name")
                let kept = ArrayList<PluginRecord>()
                for (rec in records) {
                    if (rec.name != wanted) {
                        kept.add(rec)
                    }
                }
                records = kept
            } else if (ev.eventType == "plugin/enabled") {
                let obj = eventObject(ev.data)
                let target = textFieldOf(obj, "name")
                let on = boolFieldOf(obj, "enabled")
                var i: Int64 = 0
                while (i < Int64(records.size)) {
                    if (records[i].name == target) {
                        records[i] = PluginRecord(records[i].name, records[i].version,
                            records[i].directory, on, records[i].installed)
                    }
                    i += 1
                }
            }
        }
    }

    // 逐包降级：一个坏包只让自己坏。日志回放被拒是唯一的连坐情形——
    // 那时整份清单都不可信，必须整体报错而不是返回半份。
    private func viewOf(rec: PluginRecord): PluginPackageView {
        let dir = rec.directory
        if (!exists(dir) || !FileInfo(dir).isDirectory()) {
            return degraded(rec, "plugin-not-found")
        }
        let manifestPath = "${dir}/${pluginManifestFileName}"
        if (!exists(manifestPath) || !FileInfo(manifestPath).isRegular()) {
            return degraded(rec, "plugin-manifest-missing")
        }
        var manifest: PluginManifest
        try {
            manifest = parsePluginManifest(readTextFile(manifestPath))
        } catch (e: Exception) {
            // 解析失败沿用 manifest 自己的码（plugin-rejected / plugin-tool-shadowing），
            // 不统一压成 plugin-rejected——安装时能告诉用户具体哪一条规则被违反，
            // 清单里也该是同一句话。
            return degraded(rec, e.message)
        }
        let rows = ArrayList<PluginRowView>()
        for (decl in manifest.tools) {
            rows.add(PluginRowView(
                decl.name,
                decl.name,
                manifest.name,
                decl.name,
                decl.description,
                "",
                rec.enabled,
                if (rec.enabled) { "active" } else { "" },
                ""
            ))
        }
        return PluginPackageView(
            manifest.name,
            manifest.version,
            manifest.title,
            manifest.description,
            manifest.descriptionZhCN,
            manifest.kind,
            dir,
            true,
            manifest.optional,
            rec.enabled,
            "",
            rows.toArray()
        )
    }

    private func degraded(rec: PluginRecord, code: String): PluginPackageView {
        return PluginPackageView(rec.name, rec.version, rec.name, "", "", "", rec.directory,
            true, false, rec.enabled, code, [])
    }

    // 唯一临时目录名：借 createTemp 拿一个保证不撞名的文件名，再把那个临时文件删掉、
    // 用同一个名字建目录。不自己拼 pid+时钟——那两条在快速连续安装时会撞。
    private func newStagingPath(): String {
        let parent = packagesRoot()
        Directory.create(parent, recursive: true)
        let probe = File.createTemp(Path(parent))
        let unique = probe.info.path.fileName
        probe.close()
        removeIfExists(probe.info.path.toString(), recursive: false)
        return "${parent}/${unique}"
    }

    // 递归拷贝，带两道闸：单包字节数与文件数上限；目录必须仍在源目录内
    // （挡住符号链接目录把遍历带出插件目录——文件级符号链接按内容拷贝，不传播链接）。
    // 预算必须装在可变引用里递下去：按值传参时子目录里加的量回不到父调用，
    // 上限就变成了「每个目录各一份」而不是「整个包一份」。
    private func copyTree(source: String, target: String): Unit {
        Directory.create(target, recursive: true)
        let sourceRoot = canonicalize(source).toString()
        copyTreeInto(source, target, sourceRoot, CopyBudget())
    }

    private func copyTreeInto(source: String, target: String, sourceRoot: String, budget: CopyBudget): Unit {
        for (info in Directory.readFrom(source)) {
            let from = "${source}/${info.name}"
            let to = "${target}/${info.name}"
            if (FileInfo(from).isDirectory()) {
                // 目录逃逸闸：canonicalize 之后父目录必须还是源目录。
                // 这一道同时挡掉 `..` 与指向目录外的符号链接目录。
                if (canonicalize(from).parent.toString() != sourceRoot) {
                    throw Exception("plugin-source-escaping")
                }
                Directory.create(to, recursive: true)
                copyTreeInto(from, to, sourceRoot, budget)
                continue
            }
            if (!FileInfo(from).isRegular()) {
                // 既不是目录也不是普通文件（设备、套接字、断裂的符号链接）：不猜它是什么。
                throw Exception("plugin-source-not-regular")
            }
            let data = File.readFrom(from)
            budget.bytes += Int64(data.size)
            budget.files += Int64(1)
            if (budget.bytes > pluginPackageBytesLimit) {
                throw Exception("plugin-source-too-large")
            }
            if (budget.files > pluginPackageFileLimit) {
                throw Exception("plugin-source-too-many-files")
            }
            File.writeTo(to, data)
        }
    }

    private func readManifestText(dir: String): String {
        let path = "${dir}/${pluginManifestFileName}"
        if (!exists(path) || !FileInfo(path).isRegular()) {
            throw Exception("plugin-manifest-missing")
        }
        return readTextFile(path)
    }
}

// 包名到目录名。规则写在这里而不是散在调用点：安装、查找、卸载必须算出同一个名字，
// 否则卸载时答不出「哪个目录是这个包的」。
public func slugOf(name: String): String {
    let out = ArrayList<UInt8>()
    let bytes = name.toArray()
    var i: Int64 = 0
    while (i < Int64(bytes.size)) {
        let b = bytes[i]
        // 去掉作用域前缀 @，作用域分隔符 / 映射为 -。
        if (b == 64 && i == 0) {
            i += 1
            continue
        }
        if (b == 47) {
            out.add(UInt8(45))
        } else {
            out.add(b)
        }
        i += 1
    }
    return String.fromUtf8(out.toArray())
}

private func readTextFile(path: String): String {
    return String.fromUtf8(File.readFrom(path))
}

private func eventObject(text: String): JsonObject {
    try {
        return JsonValue.fromStr(text).asObject()
    } catch (e: Exception) {
        // 自家写出去的事件解析不过，等于回放被污染——与中段缺帧同一族，
        // 不能静默跳过，否则清单会悄悄少一个包。
        throw Exception("plugin-replay-rejected")
    }
}

private func textFieldOf(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        if (isJsonNull(v)) {
            return ""
        }
        return v.asString().getValue()
    }
    return ""
}

private func boolFieldOf(obj: JsonObject, key: String): Bool {
    if (let Some(v) <- obj.get(key)) {
        if (isJsonNull(v)) {
            return false
        }
        return v.asBool().getValue()
    }
    return false
}

// 与 provider_registry.cj 同一处判定同一个写法：用 match 而不是 `== JsNull`。
// 枚举值的等值比较在本仓没有先例，不引入第二种类判方式。
private func isJsonNull(v: JsonValue): Bool {
    match (v.kind()) {
        case JsNull => true
        case _ => false
    }
}

private func installEventData(name: String, version: String, directory: String): String {
    let obj = JsonObject()
    obj.put("name", JsonString(name))
    obj.put("version", JsonString(version))
    obj.put("directory", JsonString(directory))
    return obj.toString()
}

private func textEventData(key: String, value: String): String {
    let obj = JsonObject()
    obj.put(key, JsonString(value))
    return obj.toString()
}

private func enabledEventData(name: String, on: Bool): String {
    let obj = JsonObject()
    obj.put("name", JsonString(name))
    obj.put("enabled", JsonBool(on))
    return obj.toString()
}
