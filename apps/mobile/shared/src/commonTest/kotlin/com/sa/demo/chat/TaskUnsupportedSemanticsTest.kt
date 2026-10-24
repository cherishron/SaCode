package com.sa.demo.chat

import com.sa.demo.feature.chat.ChatPage
import com.sa.demo.history.CloudSyncApi
import com.sa.demo.history.CloudTaskRef
import com.sa.demo.history.Conversation
import com.sa.demo.history.InMemoryHistoryStore
import com.sa.demo.history.LocalHistoryRepository
import com.sa.demo.storage.SecureStore
import com.sa.demo.storage.SecureStores
import com.tencent.kuikly.core.base.DeclarativeBaseView
import com.tencent.kuikly.core.base.ViewContainer
import com.tencent.kuikly.core.manager.BridgeManager
import com.tencent.kuikly.core.manager.PagerManager
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TaskUnsupportedSemanticsTest {
    @BeforeTest
    fun setup() {
        SecureStores.init(object : SecureStore {
            override fun getString(key: String): String? = null
            override fun putString(key: String, value: String) = Unit
            override fun remove(key: String) = Unit
            override fun clear() = Unit
        })
        LocalHistoryRepository.bindStore(InMemoryHistoryStore())
        LocalHistoryRepository.upsertConversation("anon", Conversation("a", "anon", "A"))
    }

    @AfterTest
    fun cleanup() { BridgeManager.currentPageId = "" }

    @Suppress("DEPRECATION")
    private fun renderedPage(): ChatPage {
        val page = ChatPage()
        BridgeManager.currentPageId = "task-semantics-test"
        PagerManager.registerPageRouter("TaskSemanticsTest") { page }
        PagerManager.createPager("task-semantics-test", "TaskSemanticsTest", "{\"width\":360,\"height\":640}")
        page.selectPanel(2)
        return page
    }

    private fun texts(root: DeclarativeBaseView<*, *>): List<String> = buildList {
        (root.getViewAttr().getProp("text") as? String)?.let { add(it) }
        if (root is ViewContainer<*, *>) {
            repeat(root.childrenSize()) { addAll(texts(root.getChild(it))) }
        }
    }

    @Test
    fun open_task_panel_updates_from_empty_to_running_to_unsupported() {
        val page = renderedPage()
        assertTrue("当前会话暂无任务" in texts(page))
        assertTrue(ChatPage.TASK_PANEL_HINT in texts(page))

        page.tasks = listOf(CloudTaskRef("task-live", "run", "running", "探测中"))
        assertFalse("当前会话暂无任务" in texts(page))
        assertTrue("running · run" in texts(page))

        page.tasks = page.tasks.map { it.copy(status = "unsupported", detail = "云端任务接口未就绪") }
        assertFalse("running · run" in texts(page))
        assertTrue("unsupported · run" in texts(page))
        assertTrue("task-live | 云端任务接口未就绪" in texts(page))

        page.tasks = emptyList()
        assertTrue("当前会话暂无任务" in texts(page))
        assertFalse(texts(page).any { it.contains("task-live") })
        assertTrue(texts(page).any { it.contains("去发起任务") }, "重建任务列表不能移除列表外的操作按钮")
    }

    private fun token(page: ChatPage): com.sa.demo.core.platform.CancelToken {
        val token = com.sa.demo.core.platform.CancelToken()
        ChatPage::class.java.getDeclaredField("streamToken").apply { isAccessible = true }.set(page, token)
        ChatPage::class.java.getDeclaredField("streamMessageKey").apply { isAccessible = true }
            .set(page, page.messages.lastOrNull()?.renderKey)
        return token
    }

    private fun beginStream(page: ChatPage, token: com.sa.demo.core.platform.CancelToken) {
        ChatPage::class.java.getDeclaredMethod(
            "beginStream", com.sa.demo.core.platform.CancelToken::class.java, String::class.java,
        ).apply { isAccessible = true }.invoke(page, token, "a")
    }

    @Test
    fun unsupported_task_does_not_fall_back_to_chat_or_mark_done() {
        val page = ChatPage().apply {
            openConversation("a")
            busy = true
            messages = listOf(ChatUiMessage("user", "do task"), ChatUiMessage("assistant", "", streaming = true))
        }
        val token = token(page)
        beginStream(page, token)

        val taskId = "task-unsupported-1"
        page.tasks = listOf(CloudTaskRef(taskId, "do task", "running", "探测云端任务接口并执行…"))

        val finish = ChatPage::class.java.getDeclaredMethod(
            "finishRequest",
            com.sa.demo.core.platform.CancelToken::class.java,
            String::class.java,
            String::class.java,
            String::class.java,
            Any::class.java,
        ).apply { isAccessible = true }

        finish.invoke(page, token, "a", "task", taskId, Triple(
            CloudSyncApi.TaskSubmitResult(false, null, "无 api_key"),
            "",
            false,
        ))

        val task = page.tasks.first { it.taskId == taskId }
        assertEquals("unsupported", task.status, "任务接口不可用时不应标 done，应标 unsupported")
        assertEquals("无 api_key", task.detail, "不应回退 chat 并宣称'已用网关 chat 同步完成'")
        assertFalse(task.detail.contains("已用网关 chat 同步完成"), "不得宣称 chat 同步完成")
        assertEquals("任务不受支持", page.status, "状态栏不得用「任务已处理」掩盖 unsupported")
        assertTrue(page.messages.last().content.isBlank() || page.messages.last().content == "",
            "任务不支持时不应回退 chat 生成回复")
        assertFalse(ChatPage.TASK_PANEL_HINT.contains("同步执行"))
        assertFalse(ChatPage.TASK_EMPTY_HINT.contains("同步执行"))
    }

    @Test
    fun unsupported_task_with_404_marks_unsupported_not_done() {
        val page = ChatPage().apply {
            openConversation("a")
            busy = true
            messages = listOf(ChatUiMessage("user", "run"), ChatUiMessage("assistant", "", streaming = true))
        }
        val token = token(page)
        beginStream(page, token)

        val taskId = "task-404-1"
        page.tasks = listOf(CloudTaskRef(taskId, "run", "running", "探测中…"))

        val finish = ChatPage::class.java.getDeclaredMethod(
            "finishRequest",
            com.sa.demo.core.platform.CancelToken::class.java,
            String::class.java,
            String::class.java,
            String::class.java,
            Any::class.java,
        ).apply { isAccessible = true }

        finish.invoke(page, token, "a", "task", taskId, Triple(
            CloudSyncApi.TaskSubmitResult(false, null, "云端任务接口未就绪"),
            "",
            false,
        ))

        val task = page.tasks.first { it.taskId == taskId }
        assertEquals("unsupported", task.status)
        assertEquals("云端任务接口未就绪", task.detail)
        assertFalse(page.busy)
    }
}
