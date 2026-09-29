/** Badge — 状态标签 */
import { el } from '../dom.ts';

export type BadgeVariant = 'default' | 'ok' | 'warn' | 'bad' | 'accent';

export function buildBadge(text: string, variant: BadgeVariant = 'default') {
  return el('span', { className: `badge ${variant !== 'default' ? variant : ''}` }, [text]);
}
