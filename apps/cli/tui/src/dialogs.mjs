import { Box, Text } from "ink";
import { h } from "./components.mjs";
import { displayText } from "./commands.mjs";
import { THEME } from "./theme.mjs";

export function SelectionDialog({ title, items, selected = 0, loading, error, compact = false, emptyText = "没有可选条目", footer, filter, showArchived, searchable = false }) {
  const count = compact ? 3 : 6;
  const start = Math.max(0, selected - count + 1);
  return h(Box, { flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: THEME.accent, paddingX: 1 },
    h(Text, { bold: true, wrap: searchable ? 'truncate-end' : 'wrap' }, title),
    searchable ? h(Text, { dimColor: true, wrap: 'truncate-end' }, `搜索：${displayText(filter || '')}▌ · ${showArchived ? '已归档' : '未归档'} · ${items.length}项`) : null,
    loading ? h(Text, { dimColor: true }, "正在读取宿主数据…") : null,
    error ? h(Text, { color: THEME.danger, wrap: "truncate-end" }, displayText(error)) : null,
    !loading && !error && items.length === 0 ? h(Text, { dimColor: true, wrap: searchable ? 'truncate-end' : 'wrap' }, emptyText) : null,
    items.slice(start, start + count).map((item, index) => h(Text, {
      key: item.id, bold: start + index === selected,
      color: start + index === selected ? THEME.accent : undefined, wrap: "truncate-end",
    }, `${start + index === selected ? "❯" : " "} ${displayText(item.label)}`)),
    items[selected]?.description ? h(Text, { dimColor: true, wrap: searchable ? 'truncate-middle' : 'wrap' }, displayText(items[selected].description)) : null,
    h(Text, { dimColor: true, wrap: "truncate-end" }, footer || (searchable ? '输入搜索 · Ctrl+A 切换归档 · Ctrl+U 清空' : `↑↓ 选择 · Enter 确认 · Esc 返回${items.length > count ? ` · ${selected + 1}/${items.length}` : ""}`)),
    searchable ? h(Text, { dimColor: true }, '↑↓ 选择 · Enter 打开 · Esc 返回') : null,
  );
}

export function CommandSuggestions({ matches, selected, compact = false }) {
  const count = compact ? 3 : 5;
  const start = Math.max(0, selected - count + 1);
  return h(Box, { flexDirection: "column", flexShrink: 0, paddingX: 1 },
    matches.slice(start, start + count).map((command, index) => h(Text, {
      key: command.name, color: start + index === selected ? THEME.accent : undefined,
      bold: start + index === selected, wrap: "truncate-end",
    }, `${start + index === selected ? "❯" : " "} ${command.name}  ${command.description}`)),
    h(Text, { dimColor: true }, "↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 收起"),
  );
}
