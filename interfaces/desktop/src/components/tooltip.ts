/** Tooltip — 悬浮提示 */
import { el } from '../dom.ts';

export function buildTooltip(text: string, children: HTMLElement) {
  const wrapper = el('span', { className: 'tooltip-wrapper' }, [children]);
  const tip = el('span', { className: 'tooltip' }, [text]);
  wrapper.append(tip);
  return wrapper;
}
