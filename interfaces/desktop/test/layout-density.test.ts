import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', 'src', 'ui', 'styles', 'layout-contract.css');
const css = readFileSync(cssPath, 'utf8');

/** 取出 [data-density='X'] { … } 块内的声明 */
function tokenBlock(density: 'compact' | 'comfortable'): string {
  const re = new RegExp(`\\[data-density='${density}'\\]\\s*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  assert.ok(m, `layout-contract.css 缺少 [data-density='${density}'] 覆盖块`);
  return m![1];
}

function tokenValue(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  assert.ok(m, `密度块缺少 --${name}`);
  return m![1].trim();
}

test('紧凑密度覆盖列表间距/行高令牌（layout-contract 唯一来源）', () => {
  const compact = tokenBlock('compact');
  const comfortable = tokenBlock('comfortable');

  const compactGap = tokenValue(compact, 'list-gap');
  const comfortableGap = tokenValue(comfortable, 'list-gap');
  assert.equal(compactGap, '2px');
  assert.equal(comfortableGap, '4px');
  assert.notEqual(compactGap, comfortableGap, '紧凑与舒适必须不同，否则切换无视觉变化');

  const compactRow = tokenValue(compact, 'list-row-min');
  const comfortableRow = tokenValue(comfortable, 'list-row-min');
  assert.equal(compactRow, '22px');
  assert.equal(comfortableRow, '28px');
  assert.notEqual(compactRow, comfortableRow);

  const compactLine = tokenValue(compact, 'list-line');
  const comfortableLine = tokenValue(comfortable, 'list-line');
  assert.equal(compactLine, '1.3');
  assert.equal(comfortableLine, '1.45');
  assert.notEqual(compactLine, comfortableLine);
});

test('紧凑密度同步收紧壳行高（chrome-row / pane-head-h / header-h）', () => {
  const compact = tokenBlock('compact');
  const comfortable = tokenBlock('comfortable');
  for (const key of ['chrome-row', 'pane-head-h', 'header-h'] as const) {
    const c = tokenValue(compact, key);
    const r = tokenValue(comfortable, key);
    assert.notEqual(c, r, `--${key} 在两档下应不同`);
    assert.ok(Number.parseFloat(c) < Number.parseFloat(r), `紧凑 --${key} 应更小`);
  }
});
