// 会话详情可翻页；确认/默认取消始终留在固定操作区，不被长标题挤出短屏。
import { Box, Text } from 'ink';
import { h } from './components.mjs';
import { displayText } from './commands.mjs';
import { THEME } from './theme.mjs';
import { Viewport } from './viewport.mjs';

export function SessionConfirmation({ confirmation, busy = false, height = 24 }) {
  const { entry, action, title, selected, error, blocked } = confirmation;
  const panelHeight = Math.min(16, Math.max(10, height - 4));
  const row = (text, props = {}) => h(Box, { flexShrink: 0 }, h(Text, { wrap: 'truncate-end', ...props }, text));
  return h(Box, { flexDirection: 'column', flexShrink: 0, height: panelHeight,
    borderStyle: 'round', borderColor: THEME.warning, paddingX: 1 },
  row(action === 'rename' ? '确认重命名' : action === 'archive' ? '确认归档（不删除）' : '确认恢复归档', { bold: true }),
  row(`确认修订：${entry.durable}`, { dimColor: true }),
  h(Box, { height: panelHeight - 8, flexDirection: 'column', flexShrink: 0 },
  h(Viewport, { resetKey: entry, fromTop: true, showIndicator: false },
    h(Text, null, `会话ID：${displayText(entry.id)}`),
    h(Text, null, `原标题：${displayText(entry.title)}`),
    entry.workspaceDirectory ? h(Text, null, `工作区：${displayText(entry.workspaceDirectory)}`) : null,
    title ? h(Text, null, `新标题：${displayText(title)}`) : null,
    error ? h(Text, { color: THEME.danger }, displayText(error)) : null,
  )),
  row('PgUp/PgDn 翻阅完整会话详情', { dimColor: true }),
  row(`${selected === 0 ? '❯' : ' '} 确认修改`, { bold: selected === 0 }),
  row(`${selected === 1 ? '❯' : ' '} 取消（默认）`, { bold: selected === 1 }),
  row(busy ? '等待宿主保存并回读…'
    : blocked ? '确认已失效；Esc返回后重新读目录' : '↑↓选择 · Enter确认 · Esc放弃', { dimColor: true }),
  );
}
