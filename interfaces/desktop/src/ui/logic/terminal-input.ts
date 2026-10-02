/** Translate a focused terminal's key event into bytes for the native PTY. */
export function terminalKeyData(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>): string | null {
  if (event.isComposing || event.metaKey) return null;
  if (event.ctrlKey && event.key.toLowerCase() === 'v') return null;
  const special: Record<string, string> = {
    Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b',
    ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
    Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', Insert: '\x1b[2~',
    PageUp: '\x1b[5~', PageDown: '\x1b[6~',
  };
  if (event.ctrlKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
    return String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64);
  }
  const data = special[event.key] ?? (!event.ctrlKey && event.key.length === 1 ? event.key : null);
  return data && event.altKey ? `\x1b${data}` : data;
}

// Bounds mirror terminal.rs `validated_size` (1..500 rows, 1..1000 cols),
// kept slightly stricter on the low end so a collapsed panel never hits 0.
const MIN_COLS = 2;
const MIN_ROWS = 2;
const MAX_COLS = 1000;
const MAX_ROWS = 500;

/** Estimate PTY cols/rows from a pixel box and font metrics (CSS pixels). */
export function terminalDimensions(width: number, height: number, charWidth: number, lineHeight: number) {
  return {
    cols: Math.min(MAX_COLS, Math.max(MIN_COLS, Math.floor(width / charWidth))),
    rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(height / lineHeight))),
  };
}
