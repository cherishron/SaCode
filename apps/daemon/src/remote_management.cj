package daemon

import core.*
import std.collection.*

// 认证 RPC 管理面：auth/devices 与 auth/revoke（规格 §5「设备列表、确认、撤销只能通过
// 本机受保护管理入口或**具有显式管理权限的认证 RPC**」里的后半个通路）。
//
// 本批只建处理器与它的授权检查，**不建 scope 的来源**：HEAD 里 DeviceRecord 没有 scopes
// 字段，记录级 scope 那条线正被并发会话持有（core/src/remote_identity.cj 工作区未落库，
// 其两条用例当轮为红）。所以这里的授权输入统一是 DeviceAuthzView——scope 从哪儿来由那条
// 线定，本批保证的是「视图里没有 management 就一步都不执行」，而不是自己另造一套授予面
// 与那条线撞车。
//
// 与本机管理入口（--manage list-devices / revoke-device）的关系是**同一套 store 方法**，
// 但有一处真实的语义差别必须写清：
//   - 本机入口操作的是从快照读出来的**一次性副本**，落盘失败时磁盘与内存都没变，
//     所以它可以直接 rc=78 宣告失败。
//   - RPC 操作的是**在跑的 store**：撤销当场生效，落盘失败意味着「重启后这台设备会复活」。
//     这里不能照抄 78 那种「整体失败」，也不能假装成功，所以把落盘结果如实带在应答里
//     （persisted:false）。没配快照路径时**不出这个键**——「没配持久化」既不等于
//     「已持久」也不等于「写失败」，硬塞一个 true 是谎。
//
// 设备面只投影 DeviceSummary 的四项（deviceId/principalId/kind/revoked）：
// 凭据原文与摘要在类型上就取不到，不是靠这里记得过滤。

public const MGMT_ERR_NOT_GRANTED: String = "management-not-granted"
public const MGMT_ERR_TARGET_UNKNOWN: String = "revoke-target-unknown"
public const MGMT_ERR_TARGET_INVALID: String = "revoke-target-invalid"

public class RemoteManagementService {
    let store: RemoteIdentityStore
    let snapshotPath: String

    public init(store: RemoteIdentityStore, snapshotPath!: String = "") {
        this.store = store
        this.snapshotPath = snapshotPath
    }

    // 空串表示允许。返回值直接用授权模块那条稳定原因串，审计与拒因因此不会分裂成两套词表。
    public func requireManagement(view: DeviceAuthzView): String {
        return if (view.scopes.contains(AUTHZ_SCOPE_MANAGEMENT)) { "" } else { AUTHZ_REASON_SCOPE_REQUIRED }
    }

    func deniedBody(): String {
        return "{\"error\":\"${MGMT_ERR_NOT_GRANTED}\"}"
    }

    // 设备清单。撤销过的设备**照旧列出并标 revoked:true**：本机入口那面读的是盘，
    // 远程桌面读的是这里，把已撤设备滤掉等于让用户在唯一能看到它的地方看不见它。
    public func devicesJson(view: DeviceAuthzView): String {
        if (requireManagement(view) != "") { return deniedBody() }
        let listed = store.listDevices()
        var items = "["
        var comma = ""
        for (d in listed) {
            // 先算局部变量再插值：`${if ... }` 这种带引号的形态会把插值解析打断（实测）。
            let revokedFlag = if (d.revoked) { "true" } else { "false" }
            items += "${comma}{\"deviceId\":\"${jsonEscapeText(d.deviceId)}\""
            items += ",\"principalId\":\"${jsonEscapeText(d.principalId)}\""
            items += ",\"kind\":\"${jsonEscapeText(d.kind)}\""
            items += ",\"revoked\":${revokedFlag}}"
            comma = ","
        }
        items += "]"
        return "{\"devices\":${items},\"count\":${listed.size}}"
    }

    // 撤销。三步顺序是钉子，不许调换：
    //   1) 先核管理权（未授权时连「目标存在吗」都不回，免得设备清单变成可枚举的 oracle）；
    //   2) 再挡空目标——空串是最危险的「未知目标」，把它当成「没指定就全撤」一次参数缺失
    //      就能废掉整台实例，这正是批次 K 在撤销那条线上抓过的事故半径形状；
    //   3) 最后才动存储，且只有真撤动了才落盘。
    //
    // 目标设备号**不设长度上限**：它由登记时的 deviceName 拼出，客户端能给多长就多长。
    // 在这里加一个上限会造出一台「RPC 面撤不掉」的设备，那比回显一个长串更糟；
    // 回显走 jsonEscapeText，注入不了结构。
    public func revokeJson(view: DeviceAuthzView, deviceId: String): String {
        if (requireManagement(view) != "") { return deniedBody() }
        if (deviceId.size == 0) { return "{\"error\":\"${MGMT_ERR_TARGET_INVALID}\"}" }
        if (!store.revokeDevice(deviceId)) { return "{\"error\":\"${MGMT_ERR_TARGET_UNKNOWN}\"}" }
        if (snapshotPath.size == 0) {
            return "{\"revoked\":true,\"deviceId\":\"${jsonEscapeText(deviceId)}\"}"
        }
        let persistedFlag = if (store.saveSnapshot(snapshotPath)) { "true" } else { "false" }
        return "{\"revoked\":true,\"deviceId\":\"${jsonEscapeText(deviceId)}\",\"persisted\":${persistedFlag}}"
    }
}
