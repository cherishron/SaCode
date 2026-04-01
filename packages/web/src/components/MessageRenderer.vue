<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";

const props = defineProps<{
  content: string;
  role: "user" | "assistant";
}>();

// 配置 marked 使用自定义渲染器
const renderer = new marked.Renderer();

// 自定义代码块渲染
renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  let highlighted: string;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } catch {
      highlighted = hljs.highlightAuto(text).value;
    }
  } else {
    highlighted = hljs.highlightAuto(text).value;
  }
  return `<pre class="code-block"><code class="hljs language-${lang || "auto"}">${highlighted}</code></pre>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

const renderedContent = computed(() => {
  // 清理并渲染 Markdown
  const clean = DOMPurify.sanitize(props.content);
  const html = marked.parse(clean) as string;
  return html;
});

function copyCode(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const codeBlock = target.closest(".code-block");
  if (codeBlock) {
    const code = codeBlock.querySelector("code")?.textContent || "";
    navigator.clipboard.writeText(code).then(() => {
      // 显示复制成功提示
      const btn = target.closest("button");
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = "已复制!";
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      }
    });
  }
}
</script>

<template>
  <div
    class="message-renderer"
    :class="role"
    v-html="renderedContent"
    @click="copyCode"
  />
</template>

<style>
.message-renderer {
  line-height: 1.6;
  word-wrap: break-word;
}

.message-renderer p {
  margin: 0 0 12px;
}

.message-renderer p:last-child {
  margin-bottom: 0;
}

.message-renderer code {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.875em;
  font-family: "Fira Code", "JetBrains Mono", monospace;
}

.dark .message-renderer code {
  background: #374151;
}

.message-renderer pre {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  margin: 12px 0;
  position: relative;
}

.message-renderer pre code {
  background: transparent;
  padding: 0;
  font-size: 0.875rem;
  color: #d4d4d4;
}

.message-renderer ul,
.message-renderer ol {
  padding-left: 24px;
  margin: 8px 0;
}

.message-renderer li {
  margin: 4px 0;
}

.message-renderer blockquote {
  border-left: 4px solid #f97316;
  padding-left: 16px;
  margin: 12px 0;
  color: #6b7280;
}

.dark .message-renderer blockquote {
  color: #9ca3af;
}

.message-renderer a {
  color: #f97316;
  text-decoration: underline;
}

.message-renderer a:hover {
  color: #ea580c;
}

.message-renderer table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.message-renderer th,
.message-renderer td {
  border: 1px solid #e5e7eb;
  padding: 8px 12px;
  text-align: left;
}

.dark .message-renderer th,
.dark .message-renderer td {
  border-color: #374151;
}

.message-renderer th {
  background: #f9fafb;
  font-weight: 600;
}

.dark .message-renderer th {
  background: #374151;
}

/* 代码高亮主题 - One Dark */
.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-section,
.hljs-link {
  color: #c678dd;
}

.hljs-function .hljs-title {
  color: #61afef;
}

.hljs-string,
.hljs-title,
.hljs-name,
.hljs-type,
.hljs-attribute,
.hljs-symbol,
.hljs-bullet,
.hljs-addition,
.hljs-variable,
.hljs-template-tag,
.hljs-template-variable {
  color: #98c379;
}

.hljs-comment,
.hljs-quote,
.hljs-deletion,
.hljs-meta {
  color: #5c6370;
}

.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-title,
.hljs-section,
.hljs-doctag,
.hljs-type,
.hljs-name,
.hljs-strong {
  font-weight: bold;
}

.hljs-emphasis {
  font-style: italic;
}
</style>
