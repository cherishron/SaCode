package core

import std.unittest.*
import std.fs.*
import std.io.*

// 判活与崩溃接管的测试。Windows 下 std 取不到自身 pid，
// 所以这两件事都建立在 CFFI 上；测试只承认「实测的 pid 行为」，不承认文档推断。

func pwPath(tag: String): String {
    return "core-pw-${tag}.lease"
}

func pwClean(tag: String) {
    removeIfExists(pwPath(tag), recursive: false)
}

@Test
func ownProcessIdIsPlausible() {
    let pid = ownProcessId()
    @Expect(pid > Int64(0), true)
    @Expect(pid < Int64(4294967296), true)
}

@Test
func livenessProbeAcceptsSelfAndRejectsBogus() {
    @Expect(isProcessAlive(ownProcessId()), true)
    @Expect(isProcessAlive(Int64(4294967000)), false)
    @Expect(isProcessAlive(Int64(0)), false)
    @Expect(isProcessAlive(Int64(-7)), false)
}

// 租约里必须能认出写者是谁的进程，否则接管无从判断
@Test
func leaseStampedWithHolderPid() {
    pwClean("stamp")
    let lease = WriteLease("core-pw-${"stamp"}")
    @Expect(lease.acquire(), true)
    @Expect(lease.holderPid(), ownProcessId())
    lease.release()
}

// 持有者确认已死：接管；持有者还活着：明确拒绝，什么都不动。
// 判活出错时宁可留着残留租约让人手工清，也不悄悄抢走别人的写权。
@Test
func deadHoldersLeaseIsTakenOverButLiveOneIsRespected() {
    pwClean("takeover")
    let p = "core-pw-takeover"
    // 手工造一个「死者」留下的租约：pid 是确认打不开句柄的假值
    try {
        File.writeTo("${p}.lease", "writer=4294967000-stale".toArray())
    } catch (e: IOException) {
        @Expect(false, true)
    }
    let lease = WriteLease(p)
    @Expect(lease.holderPid(), Int64(4294967000))
    @Expect(lease.takeoverIfStale(), true)
    @Expect(lease.holderPid(), ownProcessId())
    // 现在持有者是本进程，第二次接管必须失败且不能清掉这份凭据
    let other = WriteLease(p)
    @Expect(other.takeoverIfStale(), false)
    // 拒绝接管 = 盘上那份凭据一个字都不动
    @Expect(other.currentOwner().contains("writer="), true)
    @Expect(other.currentOwner() == lease.ownerToken(), true)
    @Expect(lease.release(), true)
}

// 认不出格式的凭据（可能是旧版本留下的）一律按「还活着」处理，不动它
@Test
func unparseableLeaseTokenIsNeverTakenOver() {
    let p = "core-pw-legacy"
    removeIfExists("${p}.lease", recursive: false)
    try {
        File.writeTo("${p}.lease", "held".toArray())
    } catch (e: IOException) {
        @Expect(false, true)
    }
    let lease = WriteLease(p)
    @Expect(lease.holderPid(), Int64(0))
    @Expect(lease.takeoverIfStale(), false)
    @Expect(lease.held(), true)
    @Expect(lease.acquire(), false)
    removeIfExists("${p}.lease", recursive: false)
}
