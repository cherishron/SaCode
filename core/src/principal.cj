package core

import std.fs.*
import std.collection.*
import stdx.crypto.crypto.*
import stdx.encoding.hex.*

// 本地身份只是「归属标签」，不是登录态：它回答「这条记录属于本机哪个安装」，
// 不回答「谁能读写」。未来接入账号体系时，绑定账号是一次显式的 owner 重映射，
// 绝不按名称合并，也不因登录把本地数据自动上云。
public class Principal {
    public let kind: String               // 本批恒为 "local"
    public let installationId: String

    public init(kind: String, installationId: String) {
        this.kind = kind
        this.installationId = installationId
    }

    // 安装 ID 落设置目录里一个独立小文件，不进任何文档日志：它是归属依据，
    // 不该跟着 custom-models.log 一起被导出/导入（§8.4 同一条纪律）。
    public static func forUser(): Principal {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        let file = "${dir}/installation-id"
        if (exists(file)) {
            let log = SessionLog(file)
            if (log.load()) {
                let events = log.snapshotEvents()
                if (Int64(events.size) > 0) {
                    return Principal("local", events[Int64(0)].data)
                }
            }
        }
        let generated = randomInstallationId()
        let fresh = SessionLog(file)
        fresh.append("principal/install", generated)
        if (!fresh.flush()) { throw Exception("principal-write-failed") }
        return Principal("local", generated)
    }
}

// 16 字节随机 → 32 位十六进制。SecureRandom 与 toHexString 的形态都经
// B0 探针实测（docs/evidence/model-center-b0-2026-10-05.md）。
func randomInstallationId(): String {
    let r = SecureRandom()
    let bytes = Array<Byte>(16, repeat: 0)
    r.nextBytes(bytes)
    return toHexString(bytes)
}
