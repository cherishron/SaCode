// 终端设计 token：正文与背景继承终端主题，避免硬编码深色破坏浅色终端。
// 交互基线为 Gemini CLI；Warp/Ollama 仅辅助留白与中性色，不替代功能入口。
export const THEME = Object.freeze({
  accent: "cyan",
  warning: "yellow",
  danger: "red",
  success: "green",
  border: "single",
  compactColumns: 64,
  compactRows: 22,
  gutter: 1,
});

export function terminalLayout(columns = 80, rows = 24) {
  const width = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  const height = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
  return { width, height, compact: width < THEME.compactColumns || height < THEME.compactRows };
}
