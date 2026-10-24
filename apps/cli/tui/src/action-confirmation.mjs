// 通用写操作确认页：compact/clear/权限切换/计划模式切换共用。
// 与 SessionConfirmation 同口径：默认选中取消，详情可翻页，操作区固定。
import { Box, Text } from 'ink';
import { h } from './components.mjs';
import { displayText } from './commands.mjs';
import { Viewport } from './viewport.mjs';
import { THEME } from './theme.mjs';

export function ActionConfirmation({ view, height = 24 }) {
  const panelHeight = Math.min(16, Math.max(10, height - 4));
  const row = (text, props = {}) => h(Box, { flexShrink: 0 }, h(Text, { wrap: 'truncate-end', ...props }, text));
  const busy = view.status === 'executing';
  return h(Box, { flexDirection: 'column', height: panelHeight, flexShrink: 0, borderStyle: 'round', borderColor: THEME.warning, paddingX: 1 },
    row(view.title, { bold: true }),
    view.warning ? row(view.warning, { color: THEME.warning }) : null,
    h(Box, { height: panelHeight - 8, flexDirection: 'column', flexShrink: 0 },
      h(Viewport, { resetKey: view.detail, fromTop: true, showIndicator: false },
        view.detail.map((line, i) => h(Text, { key: i, wrap: 'wrap' }, displayText(line))),
        view.error ? h(Text, { color: THEME.danger, wrap: 'wrap' }, displayText(view.error)) : null,
      )),
    row(`${view.selected === 0 ? '❯' : ' '} ${view.confirmLabel || '确认执行'}`, { bold: view.selected === 0 }),
    row('❯ 取消（默认，保留现状）', { bold: view.selected === 1 }),
    row(busy ? view.progress || '正在执行…' : view.error ? 'Esc返回；本次不会自动重试' : '↑↓选择 · Enter确认 · Esc返回', { dimColor: true }),
  );
}
