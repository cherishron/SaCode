package daemon

import core.*
import std.collection.*
import std.env.*
import std.fs.*
import std.unittest.*

// 认证 RPC 管理面（任务 6 剩余半）：契约里 auth/devices 与 auth/revoke 的
// implementationAnchor 至今是「拟新增」，而规格 §5 那句「设备列表、确认、撤销只能通过
// 本机受保护管理入口或**具有显式管理权限的认证 RPC**」里，后半个通路一直没建。
//
// 本批只建**处理器与它的授权检查**，不建「设备怎么拿到 management scope」：
// HEAD 里 RemoteIdentityStore 的 DeviceRecord 根本没有 scopes 字段，那条记录级 scope
// 线正被并发会话持有（core/src/remote_identity.cj 工作区 +62/−5 未落库，且它的两条
// 用例当轮为红）。在这里另造一套授予面会和那条线撞同一个语义，所以处理器的授权
// 输入统一是 DeviceAuthzView——scope 从哪儿来由那条线定，本批只保证
// 「视图里没有 management 就一步都不执行」。
//
// 规格 §2 补偿基线明写「业务授权在核心执行前再次检查」，所以处理器自己核一次
// scope，不依赖调用层已经核过；这也是这几条用例能脱离 HTTP 栈直接驱动的原因。
//
// 设备面的取值只用 HEAD 里 DeviceSummary 的四项（deviceId/principalId/kind/revoked）：
// 凭据摘要与登记秘密在类型上就取不到，这里再用断言钉一次「序列化产物里没有」。

func mgmtTmp(name: String): String {
    "${getTempDirectory().toString()}/sa-mgmt-${name}"
}

func mgmtDrop(name: String): Unit {
    let p = Path(mgmtTmp(name))
    if (exists(p)) { try { remove(p, recursive: false) } catch (_: Exception) {} }
}

class MgmtDevices {
    let f: AccessFixture
    let devA: String
    let tokA: String
    let credA: String
    let devB: String
    let tokB: String
    let credB: String

    init(name: String) {
        f = AccessFixture(name)
        let sa = f.secret("p-a")
        let ea = f.api.enroll(f.enrollBody(sa), "127.0.0.1")
        devA = RemoteAccessEndpoints.field(ea.body, "deviceId")
        credA = RemoteAccessEndpoints.field(ea.body, "credential")
        let ta = f.api.token(f.tokenBody(devA, credA), "127.0.0.1")
        tokA = RemoteAccessEndpoints.field(ta.body, "accessToken")
        let sb = f.secret("p-b")
        let eb = f.api.enroll(f.enrollBody(sb), "127.0.0.1")
        devB = RemoteAccessEndpoints.field(eb.body, "deviceId")
        credB = RemoteAccessEndpoints.field(eb.body, "credential")
        let tb = f.api.token(f.tokenBody(devB, credB), "127.0.0.1")
        tokB = RemoteAccessEndpoints.field(tb.body, "accessToken")
    }

    // 普通设备视图：与 daemon 里 gate 构造的形态一致（零 scope）。
    // 认证不过就当无身份——这样连视图都拿不到 scope。
    func plainView(token: String): DeviceAuthzView {
        if (let Some(c) <- f.store.authenticate(token)) { return DeviceAuthzView(c) }
        return DeviceAuthzView(AuthenticationContext("unauthenticated", "unauthenticated", Int64(0)))
    }

    // 被授予管理权的视图。用 HEAD 已有的 withScope 构造，不新造授予机制。
    func managementView(token: String): DeviceAuthzView {
        return plainView(token).withScope(AUTHZ_SCOPE_MANAGEMENT)
    }
}

@Test
func devicesJsonRequiresManagementAndNeverLeaksDigestOrCredential() {
    let m = MgmtDevices("d1")
    let svc = RemoteManagementService(m.f.store)
    // 先证「无授权就拒」：这一半不依赖 JSON 形状，只依赖 scope。
    let denied = svc.devicesJson(m.plainView(m.tokB))
    @Expect((denied.indexOf("management-not-granted") ?? Int64(-1)) >= Int64(0), true)
    @Expect((denied.indexOf(m.devA) ?? Int64(-1)) == Int64(-1), true)

    let ok = svc.devicesJson(m.managementView(m.tokA))
    @Expect((ok.indexOf("\"devices\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf(m.devA) ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf(m.devB) ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf("\"revoked\":false") ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf("\"count\":2") ?? Int64(-1)) >= Int64(0), true)
    // 秘密侧：凭据原文、凭据摘要与登记秘密都不许出现在设备面里。
    @Expect((ok.indexOf("credential") ?? Int64(-1)) == Int64(-1), true)
    @Expect((ok.indexOf("digest") ?? Int64(-1)) == Int64(-1), true)
    @Expect((ok.indexOf("secret") ?? Int64(-1)) == Int64(-1), true)
}

@Test
func devicesJsonReflectsRevokedFlagWithoutDroppingTheDevice() {
    // 撤销过的设备要**仍然出现在清单里**并标 revoked:true——桌面得能看见「这台已撤」，
    // 清单把它滤掉就等于让用户失去撤销记录的唯一读面。
    let m = MgmtDevices("d2")
    let svc = RemoteManagementService(m.f.store)
    @Expect(m.f.store.revokeDevice(m.devB), true)
    let ok = svc.devicesJson(m.managementView(m.tokA))
    @Expect((ok.indexOf(m.devB) ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf("\"revoked\":true") ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf("\"revoked\":false") ?? Int64(-1)) >= Int64(0), true)
    @Expect((ok.indexOf("\"count\":2") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func revokeUnknownDeviceFailsClosedAndWritesNoSnapshot() {
    let snap = mgmtTmp("r-unknown")
    mgmtDrop("r-unknown")
    let m = MgmtDevices("r1")
    let svc = RemoteManagementService(m.f.store, snapshotPath: snap)
    let resp = svc.revokeJson(m.managementView(m.tokA), "no-such-device")
    @Expect((resp.indexOf("revoke-target-unknown") ?? Int64(-1)) >= Int64(0), true)
    // 失败不留半成品：既没建快照，也没把任何设备标成已撤销。
    @Expect(exists(Path(snap)), false)
    var revokedCount = Int64(0)
    for (d in m.f.store.listDevices()) { if (d.revoked) { revokedCount += 1 } }
    @Expect(revokedCount, Int64(0))
    @Expect(m.f.store.authenticate(m.tokB).isSome(), true)
    mgmtDrop("r-unknown")
}

@Test
func revokeEmptyTargetIsRejectedWithoutTouchingStore() {
    // 空串是最危险的一种「未知目标」：如果它被当成「没指定就全撤」，
    // 一次参数缺失就能废掉整台实例。这条专门钉那个方向。
    let m = MgmtDevices("r2")
    let svc = RemoteManagementService(m.f.store)
    let resp = svc.revokeJson(m.managementView(m.tokA), "")
    @Expect((resp.indexOf("revoke-target-invalid") ?? Int64(-1)) >= Int64(0), true)
    @Expect((resp.indexOf("revoke-target-unknown") ?? Int64(-1)) == Int64(-1), true)
    var revokedCount = Int64(0)
    for (d in m.f.store.listDevices()) { if (d.revoked) { revokedCount += 1 } }
    @Expect(revokedCount, Int64(0))
}

@Test
func revokeMarksOnlyTargetAndPersistsSnapshot() {
    let snap = mgmtTmp("r-only")
    mgmtDrop("r-only")
    let m = MgmtDevices("r3")
    let svc = RemoteManagementService(m.f.store, snapshotPath: snap)
    let resp = svc.revokeJson(m.managementView(m.tokA), m.devB)
    @Expect((resp.indexOf("\"revoked\":true") ?? Int64(-1)) >= Int64(0), true)
    @Expect((resp.indexOf(m.devB) ?? Int64(-1)) >= Int64(0), true)
    @Expect((resp.indexOf("\"persisted\":true") ?? Int64(-1)) >= Int64(0), true)
    var revokedOfA = true
    var revokedOfB = false
    for (d in m.f.store.listDevices()) {
        if (d.deviceId == m.devA) { revokedOfA = d.revoked }
        if (d.deviceId == m.devB) { revokedOfB = d.revoked }
    }
    // 记录层的隔离：只动目标那一台。**令牌层的隔离不能在这里断言**——
    // revokeDevice 抬的是全局 revocationVersion（批次 K 记的在飞缺陷，
    // core/src/remote_identity.cj 由并发会话持有），撤一台会连带作废另一台的在途令牌。
    @Expect(revokedOfA, false)
    @Expect(revokedOfB, true)
    // 落盘的是设备清单与其凭据**摘要**，不是凭据原文。
    // 这里别再断言「文本里不含 credential」：快照的键名就叫 credentialDigest，
    // 那是一条按键名误判取值的老错（本批上一版就这么红过）。要钉的是原文与登记秘密。
    @Expect(exists(Path(snap)), true)
    let text = try { String.fromUtf8(File.readFrom(Path(snap))) } catch (_: Exception) { "" }
    @Expect((text.indexOf(m.devB) ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("credentialDigest") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf(m.credA) ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf(m.credB) ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf(m.devA) ?? Int64(-1)) >= Int64(0), true)
    mgmtDrop("r-only")
}

@Test
func revokeReportsPersistedFalseWhenSnapshotWriteFails() {
    // 撤成功了但落盘失败，必须如实回 persisted:false——把「内存里撤了」说成
    // 「已持久」就是给用户一个重启后会复活的设备。
    let m = MgmtDevices("r5")
    // 把快照路径指到一个不存在的目录里：saveSnapshot 的 File.createTemp(parent) 必然抛，
    // 而撤销本身不受影响。选这个形态而不是去建目录——不依赖任何建目录 API 的版本差异。
    let bad = "${getTempDirectory().toString()}/sa-mgmt-no-such-dir/snapshot.json"
    let svc = RemoteManagementService(m.f.store, snapshotPath: bad)
    let resp = svc.revokeJson(m.managementView(m.tokA), m.devB)
    @Expect((resp.indexOf("\"revoked\":true") ?? Int64(-1)) >= Int64(0), true)
    @Expect((resp.indexOf("\"persisted\":false") ?? Int64(-1)) >= Int64(0), true)
    var revokedOfB = false
    for (d in m.f.store.listDevices()) { if (d.deviceId == m.devB) { revokedOfB = d.revoked } }
    @Expect(revokedOfB, true)
}

@Test
func revokedDeviceCannotReachManagementAgain() {
    // 自撤是合法动作（桌面「关掉这台」），但撤完之后它自己不该还有管理权。
    let m = MgmtDevices("r4")
    let svc = RemoteManagementService(m.f.store)
    let resp = svc.revokeJson(m.managementView(m.tokA), m.devA)
    @Expect((resp.indexOf("\"revoked\":true") ?? Int64(-1)) >= Int64(0), true)
    // 认证面已经认不出它（被撤 → authenticate 回 None），走的是「无身份」那一支。
    let after = m.plainView(m.tokA)
    @Expect(after.context.deviceId == "unauthenticated", true)
    @Expect(after.scopes.contains(AUTHZ_SCOPE_MANAGEMENT), false)
}

@Test
func managementHandlersDenyBeforeReadingTargetSoUnauthzCannotProbeDeviceList() {
    // 顺序钉子：未授权时处理器**先拒再取数据**，否则「拒但把目标是否存在回出去」
    // 会把设备清单变成一个可枚举的 oracle。
    let m = MgmtDevices("o1")
    let svc = RemoteManagementService(m.f.store)
    let view = m.plainView(m.tokB)
    @Expect(svc.requireManagement(view) == AUTHZ_REASON_SCOPE_REQUIRED, true)
    let resp = svc.revokeJson(view, m.devA)
    @Expect((resp.indexOf("management-not-granted") ?? Int64(-1)) >= Int64(0), true)
    // 拒因里不许带目标设备号：那等于替调用方确认了这台设备存在。
    @Expect((resp.indexOf(m.devA) ?? Int64(-1)) == Int64(-1), true)
    var revokedCount = Int64(0)
    for (d in m.f.store.listDevices()) { if (d.revoked) { revokedCount += 1 } }
    @Expect(revokedCount, Int64(0))
}

@Test
func gateDeniesManagementRpcBecauseDeviceViewsCarryNoScopesYet() {
    // 今天这条 RPC 在真实门禁上的可达性：**只能被拒**。
    // 钉住它是为了在「记录级 scope」那条线落地时，这条会当场变红并要求同步更新，
    // 而不是让管理面在没人注意的情况下从 fail-closed 翻成放行。
    let m = MgmtDevices("g1")
    let authorizer = RemoteAccessAuthorizer()
    authorizer.register(CapabilitySpec(
        method: "auth/devices", permission: AUTHZ_PERM_MANAGEMENT,
        needsWorkspace: false, needsSession: false, durable: false))
    let gate = RemoteRequestGate(m.f.store, authorizer, m.f.audit, "inst-mgmt")
    let out = gate.check("Bearer ${m.tokA}", "auth/devices", "", "", "op-1")
    @Expect(out.allowed, false)
    @Expect(out.denyReason == AUTHZ_REASON_SCOPE_REQUIRED, true)
    // 拒绝同样要落审计（不许只留成功侧）。
    @Expect(m.f.sink.size() >= Int64(1), true)
    var sawDenied = false
    for (i in 0..m.f.sink.size()) {
        let line = m.f.sink.at(i)
        if ((line.indexOf("\"outcome\":\"denied\"") ?? Int64(-1)) >= Int64(0)
            && (line.indexOf("\"method\":\"auth/devices\"") ?? Int64(-1)) >= Int64(0)) { sawDenied = true }
    }
    @Expect(sawDenied, true)
}
