package com.sa.demo.saui.chat

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MdParserTest {

    private fun texts(blocks: List<MdBlock>): List<String> =
        blocks.filterIsInstance<MdBlock.Text>().map { it.text }

    private fun codes(blocks: List<MdBlock>): List<String> =
        blocks.filterIsInstance<MdBlock.Code>().map { it.code }

    @Test
    fun plain_text_lines_become_text_blocks() {
        val blocks = MdParser.parse("第一行\n第二行")
        assertEquals(listOf("第一行", "第二行"), texts(blocks))
        assertTrue(codes(blocks).isEmpty())
    }

    @Test
    fun blank_lines_are_dropped() {
        val blocks = MdParser.parse("A\n\n   \n\nB\n")
        assertEquals(listOf("A", "B"), texts(blocks))
    }

    @Test
    fun fenced_block_is_extracted_without_markers() {
        val blocks = MdParser.parse("前文\n```kotlin\nval x = 1\n```\n后文")
        assertEquals(listOf("前文", "后文"), texts(blocks))
        assertEquals(listOf("val x = 1"), codes(blocks))
    }

    @Test
    fun code_preserves_indentation_and_blank_lines() {
        val blocks = MdParser.parse("```kotlin\nfun f() {\n\n    return 1\n}\n```")
        assertEquals(listOf("fun f() {\n\n    return 1\n}"), codes(blocks))
    }

    @Test
    fun fence_may_be_indented() {
        val blocks = MdParser.parse("  ```\ncode\n  ```")
        assertEquals(listOf("code"), codes(blocks))
        assertTrue(texts(blocks).isEmpty())
    }

    @Test
    fun unclosed_fence_still_emits_code_for_streaming() {
        // 流式输出时末尾 ``` 可能还没到，已缓存的代码仍应渲染
        val blocks = MdParser.parse("前文\n```kotlin\nval x = 1")
        assertEquals(listOf("前文"), texts(blocks))
        assertEquals(listOf("val x = 1"), codes(blocks))
    }

    @Test
    fun empty_code_block_is_skipped() {
        val blocks = MdParser.parse("```\n```")
        assertTrue(blocks.isEmpty())
    }

    @Test
    fun multiple_code_blocks_keep_order() {
        val blocks = MdParser.parse("a\n```\n1\n```\nb\n```\n2\n```\nc")
        assertEquals(listOf(MdBlock.Text("a"), MdBlock.Code("1"), MdBlock.Text("b"), MdBlock.Code("2"), MdBlock.Text("c")), blocks)
    }

    @Test
    fun text_inside_code_is_not_split_as_text() {
        val blocks = MdParser.parse("```\n**not bold**\n```")
        assertTrue(texts(blocks).isEmpty())
        assertEquals(listOf("**not bold**"), codes(blocks))
    }

    @Test
    fun empty_content_yields_no_blocks() {
        assertTrue(MdParser.parse("").isEmpty())
    }

    @Test
    fun windows_crlf_line_endings_are_tolerated() {
        val blocks = MdParser.parse("A\r\n\r\n```\r\ncode\r\n```")
        assertEquals(listOf("A"), texts(blocks))
        assertEquals(listOf("code"), codes(blocks))
    }
}
