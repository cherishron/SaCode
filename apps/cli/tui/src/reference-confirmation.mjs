import { Box, Text } from 'ink';
import { h } from './components.mjs';
import { displayText } from './commands.mjs';
import { Viewport } from './viewport.mjs';
import { THEME } from './theme.mjs';

export function ReferenceConfirmation({ view, height = 24 }) {
  const panelHeight = Math.min(16, Math.max(12, height - 4));
  const row = (text, props = {}) => h(Box, { flexShrink: 0 }, h(Text, { wrap: 'truncate-end', ...props }, text));
  const reading = view.status === 'reading';
  return h(Box, { flexDirection: 'column', height: panelHeight, flexShrink: 0, borderStyle: 'round', borderColor: THEME.warning, paddingX: 1 },
    row('确认读取并发送文本引用', { bold: true }),
    row('正文将保存到会话，并发给当前模型', { color: THEME.warning }),
    row('请勿引用密钥；仅文件/64KiB每份/128KiB合计', { dimColor: true }),
    h(Box, { height: panelHeight - 9, flexDirection: 'column', flexShrink: 0 },
      h(Viewport, { resetKey: view.paths, fromTop: true, showIndicator: false },
        h(Text, null, `模型路由：${displayText(view.modelLabel || '宿主默认路由；发送时解析')}`),
        h(Text, null, `工作区：${displayText(view.identity.directory)}`),
        view.paths.map((path) => h(Text, { key: path }, `@${displayText(path)}`)),
        view.error ? h(Text, { color: THEME.danger }, displayText(view.error)) : null,
      )),
    row('PgUp/PgDn 查看全部路径', { dimColor: true }),
    row(`${view.selected === 0 ? '❯' : ' '} 读取并发送本轮`, { bold: view.selected === 0 }),
    row(`${view.selected === 1 ? '❯' : ' '} 取消（默认，保留草稿）`, { bold: view.selected === 1 }),
    row(reading ? view.progress || '准备读取…' : view.error ? 'Esc返回修正；本次不会自动重试' : '↑↓选择 · Enter确认 · Esc返回', { dimColor: true }),
  );
}
