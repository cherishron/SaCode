package com.sa.demo.chat

import com.sa.demo.feature.chat.ChatPage
import com.sa.demo.history.Conversation
import com.sa.demo.history.InMemoryHistoryStore
import com.sa.demo.history.LocalHistoryRepository
import com.sa.demo.history.ProjectBrief
import com.sa.demo.storage.SecureStore
import com.sa.demo.storage.SecureStores
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import com.sa.demo.saui.chat.StreamingInputBar
import com.tencent.kuikly.core.pager.Pager
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.base.ViewContainer
import com.tencent.kuikly.core.nvi.serialization.json.JSONObject
import kotlin.test.assertTrue

class ChatPageRegressionTest {
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
        LocalHistoryRepository.upsertConversation("anon", Conversation("b", "anon", "B"))
        LocalHistoryRepository.upsertProject("anon", ProjectBrief("p", "anon", "P", conversationIds = listOf("b")))
    }

    private fun generatingPage(): ChatPage = ChatPage().apply {
        openConversation("a")
        busy = true
        messages = listOf(ChatUiMessage("user", "question"), ChatUiMessage("assistant", "partial", streaming = true))
    }

    @Test
    fun new_conversation_cannot_replace_inflight_messages() {
        val page = generatingPage()
        page.newConversation("task")
        assertEquals("a", page.activeConvId)
        assertEquals("partial", page.messages.last().content)
        assertEquals(2, LocalHistoryRepository.listConversations("anon").size)
    }

    @Test
    fun history_open_cannot_replace_inflight_messages() {
        val page = generatingPage()
        page.openConversation("b")
        assertEquals("a", page.activeConvId)
        assertEquals("partial", page.messages.last().content)
    }

    @Test
    fun project_open_cannot_replace_inflight_messages() {
        val page = generatingPage()
        page.openProject("p")
        assertEquals("a", page.activeConvId)
        assertEquals("partial", page.messages.last().content)
    }

    @Test
    fun delete_active_conversation_is_blocked_during_generation() {
        val page = generatingPage()
        page.deleteConversation("a")
        assertNotNull(LocalHistoryRepository.getConversation("anon", "a"))
        assertEquals("a", page.activeConvId)
    }

    @Test
    fun kind_shortcuts_cannot_replace_inflight_conversation() {
        val page = generatingPage()
        page.setKindChat()
        page.setKindTask()
        assertEquals("a", page.activeConvId)
        assertEquals("partial", page.messages.last().content)
    }

    @Test
    fun retry_removes_old_user_bubble_before_resend() {
        val page = ChatPage()
        page.messages = listOf(
            ChatUiMessage("user", "old"), ChatUiMessage("assistant", "done"),
            ChatUiMessage("user", "retry"), ChatUiMessage("assistant", "failed", retryable = true),
        )
        // No model: validation prevents network work; inspect the real rewind before resend.
        page.retryLast()
        assertEquals(listOf("old", "done"), page.messages.map { it.content })
        assertEquals("retry", page.draft)
    }

    @Test
    fun stopped_retry_removes_only_last_pair_from_ui_and_history() {
        val page = ChatPage()
        val field = ChatPage::class.java.getDeclaredField("history").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val history = field.get(page) as MutableList<ChatTurn>
        history.addAll(listOf(
            ChatTurn("user", "old"), ChatTurn("assistant", "done"),
            ChatTurn("user", "retry"), ChatTurn("assistant", "partial"),
        ))
        page.messages = history.map { ChatUiMessage(it.role, it.content) }
        page.retryLast()
        assertEquals(listOf("old", "done"), page.messages.map { it.content })
        assertEquals(listOf("old", "done"), history.map { it.content })
        assertEquals("retry", page.draft)
    }

    @Test
    fun select_model_closes_picker_in_page() {
        val page = ChatPage()
        page.models = listOf("m1", "m2")
        page.modelPickerOpen = true
        page.selectModel("m2")
        assertEquals("m2", page.selectedModel)
        assertFalse(page.modelPickerOpen)
    }

    @Test
    fun active_request_locks_switch_even_if_busy_flag_is_cleared() {
        val page = generatingPage()
        val field = ChatPage::class.java.getDeclaredField("streamToken")
        field.isAccessible = true
        field.set(page, com.sa.demo.core.platform.CancelToken())
        page.busy = false
        page.openConversation("b")
        assertEquals("a", page.activeConvId)
    }

    @Test
    fun late_delta_cannot_overwrite_completed_or_next_request_reply() {
        val page = generatingPage()
        val old = com.sa.demo.core.platform.CancelToken()
        val next = com.sa.demo.core.platform.CancelToken()
        val field = ChatPage::class.java.getDeclaredField("streamToken").apply { isAccessible = true }
        val apply = ChatPage::class.java.getDeclaredMethod(
            "applyStreamDelta", com.sa.demo.core.platform.CancelToken::class.java,
            String::class.java, String::class.java,
        ).apply { isAccessible = true }
        field.set(page, old)
        ChatPage::class.java.getDeclaredField("streamMessageKey").apply { isAccessible = true }
            .set(page, page.messages.last().renderKey)
        apply.invoke(page, old, "a", "current")
        assertEquals("current", page.messages.last().content)
        field.set(page, null)
        apply.invoke(page, old, "a", "late-after-finish")
        assertEquals("current", page.messages.last().content)
        field.set(page, next)
        apply.invoke(page, old, "a", "late-old-request")
        assertEquals("current", page.messages.last().content)
        apply.invoke(page, next, "b", "wrong-conversation")
        assertEquals("current", page.messages.last().content)
    }

    @Test
    fun delta_targets_original_message_not_new_tail_or_replacement() {
        val page = generatingPage()
        val token = token(page)
        val original = page.messages.last()
        val apply = ChatPage::class.java.getDeclaredMethod(
            "applyStreamDelta", com.sa.demo.core.platform.CancelToken::class.java,
            String::class.java, String::class.java,
        ).apply { isAccessible = true }
        page.messages = page.messages + ChatUiMessage("assistant", "unrelated")
        apply.invoke(page, token, "a", "original delta")
        assertEquals("original delta", page.messages.first { it.renderKey === original.renderKey }.content)
        assertEquals("unrelated", page.messages.last().content)
        page.messages = listOf(ChatUiMessage("assistant", "replacement", streaming = true))
        apply.invoke(page, token, "a", "must not leak")
        assertEquals("replacement", page.messages.single().content)
    }

    @Test
    fun failed_retry_preserves_completed_history_pair() {
        val page = ChatPage()
        val field = ChatPage::class.java.getDeclaredField("history")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val history = field.get(page) as MutableList<ChatTurn>
        history.addAll(listOf(ChatTurn("user", "old"), ChatTurn("assistant", "done")))
        page.messages = listOf(
            ChatUiMessage("user", "old"), ChatUiMessage("assistant", "done"),
            ChatUiMessage("user", "retry"), ChatUiMessage("assistant", "failed", retryable = true),
        )
        page.retryLast()
        assertEquals(listOf("old", "done"), history.map { it.content })
    }

    @Suppress("DEPRECATION")
    @kotlin.test.AfterTest
    fun clearFrameworkContext() {
        com.tencent.kuikly.core.manager.BridgeManager.currentPageId = ""
    }

    @Suppress("DEPRECATION")
    private fun inputBar(page: ChatPage): ViewContainer<*, *> {
        val host = object : Pager() {
            override fun body(): ViewBuilder = {}
        }
        com.tencent.kuikly.core.manager.BridgeManager.currentPageId = "chat-regression"
        com.tencent.kuikly.core.manager.PagerManager.registerPageRouter("ChatRegressionHost") { host }
        com.tencent.kuikly.core.manager.PagerManager.createPager("chat-regression", "ChatRegressionHost", "{\"width\":360,\"height\":640}")
        StreamingInputBar.build(
            draft = "", busy = false, useStream = true,
            selectedModel = "m1", models = listOf("m1", "m2"),
            onDraftChange = {}, onSend = {}, onModelSelect = page::selectModel,
            modelPickerOpen = true, onToggleModelPicker = page::toggleModelPicker,
        ).invoke(host)
        return host.getChild(0) as ViewContainer<*, *>
    }

    @Test
    fun model_option_click_does_not_reopen_picker() {
        val page = ChatPage()
        page.models = listOf("m1", "m2")
        page.modelPickerOpen = true
        val options = inputBar(page).getChild(1) as ViewContainer<*, *>
        options.getChild(1).getViewEvent().onFireEvent("click", JSONObject())
        assertEquals("m2", page.selectedModel)
        assertFalse(page.modelPickerOpen)
    }

    @Test
    fun input_bar_and_model_options_have_no_one_unit_width_constraint() {
        val bar = inputBar(ChatPage())
        assertTrue(bar.flexNode.styleWidth.isNaN(), "Root must stretch instead of having fixed width")
        val options = bar.getChild(1) as ViewContainer<*, *>
        assertTrue(options.getChild(0).flexNode.styleWidth.isNaN(), "Model option must stretch")
    }

    private fun renderPageInput(page: ChatPage): ViewContainer<*, *> {
        val bar = inputBar(page)
        val host = bar.parent as ViewContainer<*, *>
        val builder = ChatPage::class.java.getDeclaredMethod("inputBarBuilder").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        (builder.invoke(page) as ViewBuilder).invoke(host)
        return host.getChild(host.childrenSize() - 1) as ViewContainer<*, *>
    }

    private fun action(bar: ViewContainer<*, *>): ViewContainer<*, *> {
        val row = bar.getChild(0) as ViewContainer<*, *>
        return row.getChild(row.childrenSize() - 1) as ViewContainer<*, *>
    }

    private fun label(view: ViewContainer<*, *>): String =
        view.getChild(0).getViewAttr().getProp("text").toString()

    private fun token(page: ChatPage): com.sa.demo.core.platform.CancelToken {
        val token = com.sa.demo.core.platform.CancelToken()
        ChatPage::class.java.getDeclaredField("streamToken").apply { isAccessible = true }.set(page, token)
        ChatPage::class.java.getDeclaredField("streamMessageKey").apply { isAccessible = true }
            .set(page, page.messages.lastOrNull()?.renderKey)
        return token
    }

    private fun beginStream(page: ChatPage, token: com.sa.demo.core.platform.CancelToken) {
        ChatPage::class.java.getDeclaredMethod("beginStream", com.sa.demo.core.platform.CancelToken::class.java, String::class.java)
            .apply { isAccessible = true }.invoke(page, token, "a")
    }

    @Test
    fun busy_input_without_stop_callback_renders_inert_processing_action() {
        val bar = inputBar(ChatPage())
        val host = bar.parent as ViewContainer<*, *>
        StreamingInputBar.build(
            draft = "question", busy = true, useStream = true,
            selectedModel = "m1", models = emptyList(), onDraftChange = {},
            onSend = { throw AssertionError("Busy component must not send") },
        ).invoke(host)
        val button = action(host.getChild(host.childrenSize() - 1) as ViewContainer<*, *>)
        assertEquals("处理中", label(button))
        assertFalse(button.getViewEvent().handlerWithEventName("click") != null)
    }

    @Test
    fun model_loading_has_processing_label_and_no_action_gesture() {
        val page = ChatPage().apply { busy = true; draft = "question"; status = "加载模型…" }
        val button = action(renderPageInput(page))
        assertEquals("处理中", label(button))
        assertFalse(button.getViewEvent().handlerWithEventName("click") != null)
        button.getViewEvent().onFireEvent("click", JSONObject())
        assertEquals("加载模型…", page.status)
        assertTrue(page.busy)
    }

    @Test
    fun nonstream_request_cannot_cancel_even_after_output_toggle() {
        val page = generatingPage().apply { useStream = false }
        val token = token(page)
        page.toggleStream(true)
        val button = action(renderPageInput(page))
        assertEquals("处理中", label(button))
        assertFalse(button.getViewEvent().handlerWithEventName("click") != null)
        page.stopStreaming()
        assertFalse(token.isCancelled)
        assertTrue(page.busy)
    }

    @Test
    fun task_submission_only_becomes_stoppable_when_stream_starts() {
        val page = generatingPage().apply { activeKind = "task" }
        val token = token(page)
        assertEquals("处理中", label(action(renderPageInput(page))))
        page.stopStreaming()
        assertFalse(token.isCancelled)
        beginStream(page, token)
        assertEquals("⏹", label(action(renderPageInput(page))))
    }

    @Test
    fun real_stop_click_cancels_stream_and_disables_action_until_settlement() {
        val page = generatingPage()
        val token = token(page)
        beginStream(page, token)
        page.toggleStream(false)
        val button = action(renderPageInput(page))
        assertEquals("⏹", label(button))
        assertTrue(button.getViewEvent().handlerWithEventName("click") != null)
        button.getViewEvent().onFireEvent("click", JSONObject())
        assertTrue(token.isCancelled)
        assertEquals("正在停止…", page.status)
        assertTrue(page.busy)
        assertFalse(action(renderPageInput(page)).getViewEvent().handlerWithEventName("click") != null)
        assertEquals("partial", page.messages.last().content)
    }

    @Test
    fun cancelled_settlement_preserves_partial_reply_and_retry_contract() {
        val page = generatingPage()
        val token = token(page)
        val renderer = page.messageRenderers.last()
        val markdownState = renderer.markdownState
        beginStream(page, token)
        page.stopStreaming()
        val historyField = ChatPage::class.java.getDeclaredField("history").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val history = historyField.get(page) as MutableList<ChatTurn>
        history.add(ChatTurn("user", "question"))
        val finish = ChatPage::class.java.getDeclaredMethod(
            "finishRequest", com.sa.demo.core.platform.CancelToken::class.java, String::class.java,
            String::class.java, String::class.java, Any::class.java,
        ).apply { isAccessible = true }
        finish.invoke(page, token, "a", "chat", null, Triple(
            com.sa.demo.history.CloudSyncApi.TaskSubmitResult(true, null, ""), "partial", true,
        ))
        assertFalse(page.busy)
        assertEquals("已停止", page.status)
        assertEquals("partial", page.messages.last().content)
        kotlin.test.assertSame(renderer, page.messageRenderers.last())
        kotlin.test.assertSame(markdownState, page.messageRenderers.last().markdownState)
        assertEquals("partial", markdownState.parseResult?.content)
        assertTrue(page.messages.last().retryable)
        assertFalse(page.messages.last().streaming)
        assertEquals(listOf("question", "partial"), LocalHistoryRepository.getConversation("anon", "a")!!.messages.map { it.content })
        assertFalse(action(renderPageInput(page)).getViewEvent().handlerWithEventName("click") != null)
        page.retryLast()
        assertTrue(history.isEmpty())
        assertTrue(page.messages.isEmpty())
        assertEquals("question", page.draft)
    }

    @Test
    fun blank_draft_has_no_send_gesture_and_return_does_not_send() {
        val page = ChatPage().apply { draft = "  \n" }
        val bar = renderPageInput(page)
        val button = action(bar)
        assertFalse(button.getViewEvent().handlerWithEventName("click") != null)
        button.getViewEvent().onFireEvent("click", JSONObject())
        val row = bar.getChild(0) as ViewContainer<*, *>
        row.getChild(0).getViewEvent().onFireEvent("inputReturn", JSONObject())
        assertTrue(page.messages.isEmpty())
        assertEquals("", page.status)
    }

    @Test
    fun busy_blocks_button_return_and_repeated_direct_send() {
        val page = generatingPage().apply { draft = "next"; selectedModel = "m1" }
        val original = page.messages
        val bar = renderPageInput(page)
        action(bar).getViewEvent().onFireEvent("click", JSONObject())
        (bar.getChild(0) as ViewContainer<*, *>).getChild(0).getViewEvent().onFireEvent("inputReturn", JSONObject())
        page.send()
        page.send()
        assertEquals(original, page.messages)
        assertEquals("next", page.draft)
        assertTrue(page.busy)
    }

    @Test
    fun request_identity_blocks_duplicate_send_even_if_busy_is_cleared() {
        val page = generatingPage().apply { draft = "next"; selectedModel = "m1"; busy = false }
        token(page)
        val original = page.messages
        page.send()
        assertEquals(original, page.messages)
        assertEquals("next", page.draft)
    }

    @Test
    fun stale_stream_start_cannot_enable_stop_for_next_request() {
        val page = generatingPage()
        val old = token(page)
        val next = token(page)
        beginStream(page, old)
        assertEquals("处理中", label(action(renderPageInput(page))))
        page.stopStreaming()
        assertFalse(old.isCancelled)
        assertFalse(next.isCancelled)
    }

    @Test
    fun switching_is_allowed_after_generation() {
        val page = generatingPage()
        page.busy = false
        page.openConversation("b")
        assertEquals("b", page.activeConvId)
        page.newConversation("task")
        assertEquals("task", page.activeKind)
    }
}
