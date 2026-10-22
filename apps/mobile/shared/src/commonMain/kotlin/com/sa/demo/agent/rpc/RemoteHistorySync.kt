package com.sa.demo.agent.rpc

/** 单会话恢复状态。只接纳服务端持久事件，瞬时正文不能推进持久游标。 */
data class RemoteHistorySnapshot(
    val generation: String = "",
    val nextSeq: String = "",
    val events: List<RemoteDurableEvent> = emptyList(),
    val hasMore: Boolean = false,
    val resetReason: String? = null,
)

object RemoteHistorySync {
    const val MAX_CACHED_EVENTS = 2000

    fun merge(previous: RemoteHistorySnapshot, page: RemoteEventPage): RemoteHistorySnapshot {
        if (page.gap != null) {
            require(page.gap in setOf("generation-mismatch", "cursor-beyond-horizon")) { "未知事件缺口类型" }
            // 清空旧基线；下一次从头请求，不把服务端 horizon 当已交付游标。
            return RemoteHistorySnapshot(resetReason = page.gap)
        }
        require(previous.generation.isEmpty() || previous.generation == page.generation) { "事件代次改变，须重新读取" }
        val sorted = page.events.sortedBy { it.seq.toLong() }
        require(page.events == sorted) { "事件游标乱序" }
        require(page.events.map { it.seq }.distinct().size == page.events.size) { "页内游标重复" }
        require(!page.hasMore || (page.nextSeq.isNotBlank() && page.nextSeq != previous.nextSeq)) { "分页游标未推进" }
        if (page.events.isNotEmpty()) require(page.nextSeq == page.events.last().seq) { "分页游标不对应已交付事件" }
        if (previous.nextSeq.isNotBlank() && page.nextSeq.isNotBlank()) {
            require(page.nextSeq.toLong() >= previous.nextSeq.toLong()) { "分页游标倒退" }
        }
        val known = previous.events.associateBy { it.seq }
        page.events.forEach { event ->
            known[event.seq]?.let { require(it == event) { "相同游标事件内容冲突" } }
        }
        val merged = (previous.events + page.events).distinctBy { it.seq }.sortedBy { it.seq.toLong() }.takeLast(MAX_CACHED_EVENTS)
        return RemoteHistorySnapshot(page.generation, page.nextSeq, merged, page.hasMore)
    }
}

/** 目标或账号变化即换代；旧请求回执不能进入新目标状态。 */
class RemoteConnectionEpoch {
    private val lock = Any()
    private var epoch = 0L
    fun current(): Long = synchronized(lock) { epoch }
    fun advance(): Long = synchronized(lock) { ++epoch }
    fun accepts(value: Long): Boolean = synchronized(lock) { value == epoch }
}
