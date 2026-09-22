/** DiffView — 简易行级 Diff 展示 */
import { el } from '../dom.ts';

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export function buildDiffView(lines: DiffLine[]) {
  return el('div', { className: 'diff-view' }, [
    el('table', { className: 'diff-table' }, [
      el('tbody', {},
        lines.map((line) =>
          el('tr', { className: `diff-line diff-line-${line.type}` }, [
            el('td', { className: 'diff-line-no' }, [
              line.type === 'del' ? String(line.oldNo ?? '') :
              line.type === 'context' ? String(line.oldNo ?? '') :
              '',
            ]),
            el('td', { className: 'diff-line-no' }, [
              line.type === 'add' ? String(line.newNo ?? '') :
              line.type === 'context' ? String(line.newNo ?? '') :
              '',
            ]),
            el('td', { className: 'diff-line-content mono' }, [
              (line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text,
            ]),
          ]),
        ),
      ),
    ]),
  ]);
}

/** 从 unified diff 文本解析为 DiffLine 数组 */
export function parseDiff(text: string): DiffLine[] {
  const lines = text.split('\n');
  const result: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/-(\d+),?\d* \+(\d+),?\d*/);
      if (m) {
        oldNo = parseInt(m[1]!, 10) - 1;
        newNo = parseInt(m[2]!, 10) - 1;
      }
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      newNo++;
      result.push({ type: 'add', text: line.slice(1), newNo });
    } else if (line.startsWith('-')) {
      oldNo++;
      result.push({ type: 'del', text: line.slice(1), oldNo });
    } else {
      oldNo++;
      newNo++;
      result.push({ type: 'context', text: line.slice(1), oldNo, newNo });
    }
  }
  return result;
}
