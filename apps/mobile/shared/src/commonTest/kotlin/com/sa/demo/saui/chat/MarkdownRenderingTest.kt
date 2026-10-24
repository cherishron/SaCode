package com.sa.demo.saui.chat

import com.sa.demo.chat.ChatUiMessage
import com.sa.demo.feature.chat.ChatPage
import com.sa.demo.history.Conversation
import com.sa.demo.history.ConversationMessage
import com.sa.demo.history.InMemoryHistoryStore
import com.sa.demo.history.LocalHistoryRepository
import com.sa.demo.storage.SecureStore
import com.sa.demo.storage.SecureStores
import com.tencent.kuikly.core.base.DeclarativeBaseView
import com.tencent.kuikly.core.base.ViewContainer
import com.tencent.kuikly.core.base.ViewBuilder
import com.tencent.kuikly.core.pager.Pager
import com.tencent.kuikly.core.manager.BridgeManager
import com.tencent.kuikly.core.manager.PagerManager
import com.tencent.kuikly.core.nvi.serialization.json.JSONObject
import com.tencent.kuikly.core.views.ImageView
import com.tencent.kuikly.core.views.ImageSpan
import com.tencent.kuikly.core.views.RichTextView
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

@Suppress("DEPRECATION")
class MarkdownRenderingTest {
    @BeforeTest
    fun setup() {
        SecureStores.init(object : SecureStore {
            override fun getString(key: String): String? = null
            override fun putString(key: String, value: String) = Unit
            override fun remove(key: String) = Unit
            override fun clear() = Unit
        })
        LocalHistoryRepository.bindStore(InMemoryHistoryStore())
    }

    @AfterTest
    fun cleanup() { BridgeManager.currentPageId = "" }

    private fun page(): ChatPage {
        val page = ChatPage()
        BridgeManager.currentPageId = "markdown-render-test"
        PagerManager.registerPageRouter("MarkdownRenderTest") { page }
        PagerManager.createPager("markdown-render-test", "MarkdownRenderTest", "{\"width\":360,\"height\":640}")
        return page
    }

    private fun descendants(root: DeclarativeBaseView<*, *>): List<DeclarativeBaseView<*, *>> = buildList {
        add(root)
        if (root is ViewContainer<*, *>) {
            repeat(root.childrenSize()) { addAll(descendants(root.getChild(it))) }
        }
    }

    private fun textViews(page: ChatPage, text: String) = descendants(page).filter {
        it.getViewAttr().getProp("text") == text
    }

    @Test
    fun renderer_persists_across_deltas_and_final_flush_rebuilds_once() {
        val page = page()
        var message = ChatUiMessage("assistant", "first\n\nsecond", streaming = true)
        page.messages = listOf(message)
        val renderer = page.messageRenderers.single()
        val state = renderer.markdownState
        val first = renderer.blocks.first()
        val firstView = textViews(page, "first").single()
        message = message.copy(content = "first\n\nsecond delta")
        page.messages = listOf(message)
        assertSame(renderer, page.messageRenderers.single())
        assertSame(state, renderer.markdownState)
        assertSame(first, renderer.blocks.first())
        assertSame(firstView, textViews(page, "first").single())
        assertTrue(textViews(page, "second delta").isNotEmpty())
        val parsed = state.parseResult
        page.messages = listOf(message.copy(streaming = false))
        assertNotSame(parsed, state.parseResult, "完成时即使文本相同也要最终 flush")
        assertNotSame(firstView, textViews(page, "first").single(), "完成时失效重绘一次，delta 期间才保留旧块")
        assertTrue(textViews(page, "▍").isEmpty())
        val finalBlock = renderer.blocks.first()
        page.messages = listOf(message.copy(streaming = true))
        assertNotSame(finalBlock, renderer.blocks.first(), "完成后的同身份重新流式输入必须重置块")
    }

    @Test
    fun shortening_and_replacement_reset_state_without_cross_message_contamination() {
        val page = page()
        val message = ChatUiMessage("assistant", "one\n\ntwo", streaming = true)
        page.messages = listOf(message, ChatUiMessage("assistant", message.content))
        val renderer = page.messageRenderers.first()
        assertNotSame(renderer.markdownState, page.messageRenderers.last().markdownState)
        page.messages = listOf(message.copy(content = "short"))
        assertSame(renderer, page.messageRenderers.single())
        assertEquals("short", renderer.markdownState.parseResult?.content)
        assertEquals(1, renderer.blocks.size)
        assertTrue(textViews(page, "two").isEmpty())
        page.messages = listOf(message.copy(content = ""))
        assertNull(renderer.markdownState.parseResult)
        assertTrue(renderer.blocks.isEmpty())
        page.messages = listOf(ChatUiMessage("assistant", "short"))
        assertNotSame(renderer, page.messageRenderers.single())
    }

    @Test
    fun user_text_keeps_blank_lines_fences_and_outer_whitespace_without_parser() {
        val page = page()
        val raw = "  before\n\n```kotlin\nval a = 1\n```\n\nafter  \n"
        page.messages = listOf(ChatUiMessage("user", raw))
        assertEquals(1, textViews(page, raw).size)
        val renderer = page.messageRenderers.single()
        assertNull(renderer.markdownState.parseResult)
        assertTrue(renderer.blocks.isEmpty())
        val updated = raw + "\n"
        page.messages = listOf(page.messages.single().copy(content = updated))
        assertEquals(1, textViews(page, updated).size)
    }

    @Test
    fun actual_page_list_updates_after_initial_empty_render_and_history_switch() {
        val page = page()
        assertTrue(page.messages.isEmpty())
        page.messages = listOf(ChatUiMessage("assistant", "live message"))
        assertEquals(1, textViews(page, "live message").size)
        LocalHistoryRepository.upsertConversation("anon", Conversation("history", "anon", "历史",
            messages = listOf(ConversationMessage("assistant", "history message"))))
        page.selectPanel(1)
        page.openConversation("history")
        assertEquals(1, textViews(page, "history message").size)
        assertTrue(textViews(page, "live message").isEmpty())
        page.messages = emptyList()
        assertTrue(textViews(page, "history message").isEmpty())
    }

    @Test
    fun explicit_theme_entry_updates_bubbles_and_code_configuration() {
        val page = page()
        page.messages = listOf(ChatUiMessage("assistant", "theme body"))
        val body = textViews(page, "theme body").single()
        val oldColor = body.getViewAttr().getProp("color")
        val entry = textViews(page, "气泡主题：浅色（点击切换）").single()
        entry.getViewEvent().onFireEvent("click", JSONObject())
        assertEquals(SaMarkdownTheme.DARK, page.messageTheme)
        assertEquals(1, textViews(page, "气泡主题：深色（点击切换）").size)
        assertNotSame(body, textViews(page, "theme body").single())
        assertTrue(oldColor != textViews(page, "theme body").single().getViewAttr().getProp("color"))
        assertTrue(SaMarkdownTheme.DARK.markdownConfig().codeHighlightDarkTheme)
        assertFalse(SaMarkdownTheme.LIGHT.markdownConfig().codeHighlightDarkTheme)
        assertEquals(SaMarkdownTheme.LIGHT.assistantBackground(), SaMarkdownTheme.LIGHT.markdownConfig().colors.tableBackground)
        assertFalse(SaMarkdownTheme.DARK.assistantBackground() == SaMarkdownTheme.LIGHT.assistantBackground())
    }

    @Test
    fun bubble_long_press_reads_latest_unmodified_source_and_plain_sample_is_compatible() {
        val host = object : Pager() { override fun body(): ViewBuilder = {} }
        BridgeManager.currentPageId = "markdown-copy-test"
        PagerManager.registerPageRouter("MarkdownCopyTest") { host }
        PagerManager.createPager("markdown-copy-test", "MarkdownCopyTest", "{\"width\":360,\"height\":640}")
        var message = ChatUiMessage("assistant", "old", streaming = true)
        val renderer = ChatMessageRenderer(message, host)
        var copied = ""
        ChatMessageBubble.build(renderer, onCopy = { copied = renderer.content }).invoke(host)
        message = message.copy(content = "  latest\n\n```text\nsource\n```  ")
        renderer.update(message)
        val longPress = descendants(host).single { it.getViewEvent().handlerWithEventName("longPress") != null }
        longPress.getViewEvent().onFireEvent("longPress", JSONObject())
        assertEquals(message.content, copied)
        ChatMessageBubble.build("sample", ChatMessageBubble.Role.USER).invoke(host)
        assertEquals(1, descendants(host).count { it.getViewAttr().getProp("text") == "sample" })
    }

    @Test
    fun completed_retry_click_rewinds_real_page_without_network() {
        val page = page()
        val user = ChatUiMessage("user", "retry prompt")
        val assistant = ChatUiMessage("assistant", "partial", streaming = true)
        page.messages = listOf(user, assistant)
        assertTrue(textViews(page, ChatMessageBubble.RETRY_LABEL).isEmpty())
        page.messages = listOf(user, assistant.copy(streaming = false, retryable = true))
        val retry = textViews(page, ChatMessageBubble.RETRY_LABEL).single()
        assertTrue(retry.getViewEvent().handlerWithEventName("click") != null)
        retry.getViewEvent().onFireEvent("click", JSONObject())
        assertTrue(page.messages.isEmpty())
        assertEquals("retry prompt", page.draft)
        assertTrue(textViews(page, "partial").isEmpty())
        assertTrue(textViews(page, ChatMessageBubble.RETRY_LABEL).isEmpty())
    }

    @Test
    fun nested_reference_changes_invalidate_previously_rendered_blocks() {
        val page = page()
        val message = ChatUiMessage("assistant", "[target][ref]", streaming = true)
        page.messages = listOf(message)
        val renderer = page.messageRenderers.single()
        val firstBlock = renderer.blocks.first()
        page.messages = listOf(message.copy(content = message.content + "\n\n> [ref]: https://example.invalid/first"))
        assertNotSame(firstBlock, renderer.blocks.first())
        assertTrue(renderer.blocks.first().references.contains("https://example.invalid/first"))
        val signature = renderer.blocks.first().references
        page.messages = listOf(message.copy(content = message.content + "\n\n- [ref](https://example.invalid/inline)"))
        assertTrue(signature != renderer.blocks.first().references)
        assertTrue(renderer.blocks.first().references.contains("https://example.invalid/inline"))
    }

    @Test
    fun colliding_library_block_hashes_do_not_keep_wrong_content() {
        val page = page()
        val message = ChatUiMessage("assistant", "FB", streaming = true)
        page.messages = listOf(message)
        val renderer = page.messageRenderers.single()
        val original = renderer.blocks.single()
        assertEquals("FB".hashCode(), "Ea".hashCode())
        page.messages = listOf(message.copy(content = "Ea"))
        assertEquals(original.block.id, renderer.blocks.single().block.id)
        assertNotSame(original, renderer.blocks.single())
        assertTrue(textViews(page, "FB").isEmpty())
        assertEquals(1, textViews(page, "Ea").size)
    }

    @Test
    fun late_reference_images_and_tables_never_create_image_spans() {
        val page = page()
        val message = ChatUiMessage("assistant", "![remote][picture]", streaming = true)
        page.messages = listOf(message)
        val renderer = page.messageRenderers.single()
        page.messages = listOf(message.copy(content = message.content + "\n\n> [picture]: https://example.invalid/pixel.png"))
        assertTrue(renderer.blocks.any { it.plainTextOnly })
        val table = "| title | value |\n| --- | --- |\n| icon | ![pixel](https://example.invalid/pixel.png) |"
        page.messages = listOf(ChatUiMessage("assistant", table),
            ChatUiMessage("assistant", "[![linked](file:///private/image)](javascript:alert(1))"))
        assertTrue(descendants(page).none { it is ImageView })
        assertTrue(descendants(page).filterIsInstance<RichTextView>().all { rich ->
            rich.getViewAttr().getSpans().none { it is ImageSpan || it.hasClickEvent() }
        })
        assertTrue(page.messageRenderers.all { item -> item.blocks.any { it.plainTextOnly } })
    }

    @Test
    fun image_blocks_never_create_image_views_and_links_have_no_click_handlers() {
        val page = page()
        val content = "![outside](https://example.invalid/image.png)\n\n" +
            "> quote ![nested](file:///private/image)\n\n" +
            "- list ![inline](data:image/svg+xml,test)\n\n" +
            "[unsafe](javascript:alert(1)) and [web](https://example.invalid/)"
        page.messages = listOf(ChatUiMessage("assistant", content))
        val renderer = page.messageRenderers.single()
        assertTrue(renderer.blocks.count { it.plainTextOnly } >= 3)
        assertTrue(descendants(page).none { it is ImageView })
        val config = SaMarkdownTheme.LIGHT.markdownConfig()
        assertNull(config.onLinkClick)
        assertNull(config.onLinkLongPress)
        val richTexts = descendants(page).filterIsInstance<RichTextView>()
        assertTrue(richTexts.isNotEmpty(), "链接应实际进入富文本渲染路径")
        assertTrue(richTexts.all { rich ->
            rich.getViewAttr().getSpans().none { it is ImageSpan || it.hasClickEvent() }
        })
        assertTrue(richTexts.none { it.getViewEvent().handlerWithEventName("click") != null })
    }
}
