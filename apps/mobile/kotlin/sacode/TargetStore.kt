// 目标表与连接代次。
//
// 两条不能混的线：①「多目标」是用户显式选择的列表，故障时**不自动转连另一台**
// （设计里会话不迁移，自动转连会把一条会话写到另一台机器上）；② connectionEpoch 是
// 客户端自己的连接代次，用来丢掉上一条连接迟到的帧——断线重连后旧流的尾巴不能进新视图。
package sacode

class Target(
    val instanceId: String,
    val baseUrl: String,
    val pinSha256Hex: String,
    val label: String
) {
    init {
        validatedBase(baseUrl)
        require(instanceId.isNotBlank()) { "target-instance-required" }
        require(pinSha256Hex.isNotBlank()) { "target-pin-required" }
    }
}

class TargetStore {
    private val targets = LinkedHashMap<String, Target>()
    private val drafts = HashMap<String, String>()
    private var activeId: String? = null

    fun add(target: Target) {
        targets[target.instanceId] = target
        if (activeId == null) activeId = target.instanceId
    }

    fun active(): Target? = activeId?.let { targets[it] }

    fun setActive(instanceId: String): Boolean {
        if (!targets.containsKey(instanceId)) return false
        activeId = instanceId
        return true
    }

    // 这一条是产品裁决，不是实现空缺：允许「用户手动切换」，禁止「失败后自动换目标」。
    fun failoverCandidateFor(instanceId: String): Target? = null

    fun putDraft(instanceId: String, text: String) {
        require(targets.containsKey(instanceId)) { "draft-target-unknown" }
        drafts[instanceId] = text
    }

    fun draftFor(instanceId: String): String = drafts[instanceId] ?: ""

    fun list(): List<Target> = targets.values.toList()
}

class EpochGate(private val instanceId: String) {
    private var current: Long = 0L
    private val seen = HashMap<Long, MutableSet<String>>()

    fun newEpoch(): Long {
        current += 1
        seen[current] = HashSet<String>()
        return current
    }

    fun accepts(epoch: Long, cursor: String): Boolean {
        if (epoch != current) return false
        val set = seen[epoch] ?: return false
        // 同一条游标只交付一次：补读页里给过的，直播再取到要丢——服务端已经按同一规则
        // 做过一遍，客户端这一遍防的是「重连时补读与直播在同一帧上重叠」。
        if (set.contains(cursor)) return false
        set.add(cursor)
        return true
    }

    fun instanceId(): String = instanceId
}
