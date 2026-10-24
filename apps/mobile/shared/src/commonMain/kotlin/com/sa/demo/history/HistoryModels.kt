package com.sa.demo.history

import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.currentTimeMillis
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/**
 * 用户维度的本地对话 / 项目历史（M2.5 本地优先）。
 * 云端同步接口 saai 产品线尚未落地，字段已按未来 sync 预留。
 */
@Serializable
data class ConversationMessage(
    val role: String,
    val content: String,
    val ts: Long = currentTimeMillis(),
)

@Serializable
data class CloudTaskRef(
    val taskId: String,
    val title: String,
    val status: String = "queued", // queued | running | done | failed | unsupported | canceled
    val detail: String = "",
    val createdAt: Long = currentTimeMillis(),
    val updatedAt: Long = currentTimeMillis(),
)

@Serializable
data class Conversation(
    val id: String,
    val userId: String,
    val title: String,
    val kind: String = "chat", // chat | task | project
    val projectId: String? = null,
    val model: String? = null,
    val messages: List<ConversationMessage> = emptyList(),
    val tasks: List<CloudTaskRef> = emptyList(),
    val createdAt: Long = currentTimeMillis(),
    val updatedAt: Long = currentTimeMillis(),
    /** 云端版本号，sync 时用于冲突检测；本地新建为 0 */
    val cloudRev: Long = 0,
    val dirty: Boolean = true,
)

@Serializable
data class ProjectBrief(
    val id: String,
    val userId: String,
    val name: String,
    val summary: String = "",
    val conversationIds: List<String> = emptyList(),
    val updatedAt: Long = currentTimeMillis(),
    val cloudRev: Long = 0,
    val dirty: Boolean = true,
)

@Serializable
data class HistoryRoot(
    val userId: String,
    val conversations: List<Conversation> = emptyList(),
    val projects: List<ProjectBrief> = emptyList(),
)

/**
 * 历史仓：按 IdP user（username/sub）隔离。
 * 存储：普通 KV（非密钥），api_key/token 仍只在 SecureStore。
 */
interface HistoryStore {
    fun load(userId: String): HistoryRoot
    fun save(root: HistoryRoot)
}

object LocalHistoryRepository {

    private const val KEY_PREFIX = "sa.history."

    private var store: HistoryStore = InMemoryHistoryStore()

    fun bindStore(s: HistoryStore) {
        store = s
    }

    fun userKey(userId: String): String = userId.ifBlank { "anon" }

    fun loadRoot(userId: String): HistoryRoot {
        val id = userKey(userId)
        val root = store.load(id)
        return if (root.userId == id) root else HistoryRoot(userId = id)
    }

    fun listConversations(userId: String): List<Conversation> =
        loadRoot(userId).conversations.sortedByDescending { it.updatedAt }

    fun listProjects(userId: String): List<ProjectBrief> =
        loadRoot(userId).projects.sortedByDescending { it.updatedAt }

    fun getConversation(userId: String, id: String): Conversation? =
        loadRoot(userId).conversations.firstOrNull { it.id == id }

    fun upsertConversation(userId: String, conversation: Conversation): Conversation {
        val id = userKey(userId)
        val root = loadRoot(id)
        val updated = conversation.copy(
            userId = id,
            updatedAt = currentTimeMillis(),
            dirty = true,
        )
        val list = root.conversations.filterNot { it.id == updated.id } + updated
        store.save(root.copy(userId = id, conversations = list))
        return updated
    }

    fun deleteConversation(userId: String, id: String) {
        val uid = userKey(userId)
        val root = loadRoot(uid)
        store.save(root.copy(conversations = root.conversations.filterNot { it.id == id }))
    }

    fun upsertProject(userId: String, project: ProjectBrief): ProjectBrief {
        val uid = userKey(userId)
        val root = loadRoot(uid)
        val updated = project.copy(userId = uid, updatedAt = currentTimeMillis(), dirty = true)
        val list = root.projects.filterNot { it.id == updated.id } + updated
        store.save(root.copy(userId = uid, projects = list))
        return updated
    }

    fun newConversationId(): String = "c-${currentTimeMillis()}-${(0..9999).random()}"

    fun newProjectId(): String = "p-${currentTimeMillis()}-${(0..9999).random()}"

    fun newTaskId(): String = "t-${currentTimeMillis()}-${(0..9999).random()}"

    /** 导出 JSON（为将来云端 sync / 备份预留）。 */
    fun exportJson(userId: String): String =
        saaiJson.encodeToString(HistoryRoot.serializer(), loadRoot(userId))

    fun importJson(userId: String, json: String) {
        val root = saaiJson.decodeFromString(HistoryRoot.serializer(), json)
        store.save(root.copy(userId = userKey(userId)))
    }

    fun storageKey(userId: String): String = KEY_PREFIX + userKey(userId)
}

/** 默认内存实现；Android 可绑 SharedPreferences。 */
class InMemoryHistoryStore : HistoryStore {
    private val map = mutableMapOf<String, String>()

    override fun load(userId: String): HistoryRoot {
        val raw = map[LocalHistoryRepository.storageKey(userId)] ?: return HistoryRoot(userId)
        return try {
            saaiJson.decodeFromString(HistoryRoot.serializer(), raw)
        } catch (_: Exception) {
            HistoryRoot(userId)
        }
    }

    override fun save(root: HistoryRoot) {
        map[LocalHistoryRepository.storageKey(root.userId)] =
            saaiJson.encodeToString(HistoryRoot.serializer(), root)
    }
}

/** Android：非敏感历史落 SharedPreferences。 */
class PrefsHistoryStore(private val getString: (String) -> String?, private val putString: (String, String) -> Unit) :
    HistoryStore {
    override fun load(userId: String): HistoryRoot {
        val raw = getString(LocalHistoryRepository.storageKey(userId)) ?: return HistoryRoot(userId)
        return try {
            saaiJson.decodeFromString(HistoryRoot.serializer(), raw)
        } catch (_: Exception) {
            HistoryRoot(userId)
        }
    }

    override fun save(root: HistoryRoot) {
        putString(
            LocalHistoryRepository.storageKey(root.userId),
            saaiJson.encodeToString(HistoryRoot.serializer(), root),
        )
    }
}
