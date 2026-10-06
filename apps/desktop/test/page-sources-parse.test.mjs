import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

// 页面 .ts 只在 `npm run vendor`（pack-pages 折叠）时才会被解析，而 node --test 不跑 vendor，
// 所以源码级语法破口能一路绿到打包态才炸。这里在单测面先把每个页面源过一遍解析器。
const pagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'pages');
const sources = readdirSync(pagesDir).filter((n) => n.endsWith('.ts')).sort();

test('页面 .ts 源全部可被解析', () => {
  assert.ok(sources.length > 0, `页面源目录取到 0 个 .ts：${pagesDir}`);
  const broken = [];
  for (const name of sources) {
    try {
      transformSync(readFileSync(join(pagesDir, name), 'utf8'), { loader: 'ts', sourcefile: name });
    } catch (error) {
      const first = error && error.errors && error.errors[0];
      broken.push(`${name}:${first && first.location ? first.location.line : '?'} ${first ? first.text : error.message}`);
    }
  }
  assert.deepEqual(broken, []);
});
