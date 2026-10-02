/**
 * Markdown 渲染 — 知识库正文等处使用（契约：正文渲染，不直接展示源文）。
 * 与 FilesSidePanel 同策略：marked + dompurify，懒加载；未就绪时退回转义纯文本。
 */
import { marked } from 'marked';

let markedParse: ((src: string) => string) | null = null;
let purifySanitize: ((html: string) => string) | null = null;
let renderersPromise: Promise<void> | null = null;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function ensureMarkdownRenderers(): Promise<void> {
  if (renderersPromise) return renderersPromise;
  renderersPromise = (async () => {
    const purifyMod = await import('dompurify');
    markedParse = (src) =>
      String(marked.parse(src, { async: false, gfm: true, breaks: true }));
    const purify = (purifyMod as { default?: { sanitize: (h: string) => string } })
      .default;
    purifySanitize = (html) => (purify ? purify.sanitize(html) : html);
  })();
  return renderersPromise;
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  if (!markedParse || !purifySanitize) return escapeHtml(src);
  return purifySanitize(markedParse(src));
}

export function markdownRenderersReady(): boolean {
  return markedParse !== null && purifySanitize !== null;
}
