/** ThinkingBlock — 可折叠思考过程 */
import { el } from '../dom.ts';

export function buildThinkingBlock(text: string, expanded = false) {
  const content = el('div', {
    className: `thinking-content ${expanded ? 'expanded' : 'collapsed'}`,
  }, [text]);

  const toggle = el('button', {
    className: 'thinking-toggle',
    onclick: () => {
      const isExpanded = content.classList.contains('expanded');
      content.classList.toggle('expanded');
      content.classList.toggle('collapsed');
      toggle.textContent = isExpanded ? '▸ 思考过程' : '▾ 思考过程';
    },
  }, [expanded ? '▾ 思考过程' : '▸ 思考过程']);

  return el('div', { className: 'msg msg-thinking' }, [
    toggle,
    content,
  ]);
}
