import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// index.html 用经典 <script src> 直接加载 renderer 根下的手写 JS，Chromium 解析失败即整份脚本不执行，
// 现场表现为「宿主有投影、DOM 里一个气泡都没有」——只有把每个文件真解析一遍才拦得住这一类回归。
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = resolve(HERE, '..', 'renderer');
const compile = (source, filename) => new vm.Script(source, {filename});

function scriptsLoadedByPage() {
  const html = readFileSync(join(RENDERER, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => !src.startsWith('vendor/'))
    .map((src) => src.split('?')[0]);
}

test('页面加载的手写渲染脚本必须能被解析', () => {
  const scripts = scriptsLoadedByPage();
  // 空集合不算通过：正则或路径一旦漂了，这条会静默变成「零个文件要检」。
  assert.ok(scripts.length >= 5, `只取到 ${scripts.length} 个脚本：${scripts.join(',')}`);
  for (const src of scripts) {
    const file = join(RENDERER, src);
    compile(readFileSync(file, 'utf8'), file);
  }
});

test('缺分支的三元会在这道门禁里红', () => {
  // 反证门禁本身：真实回归就是 `cond ? el(...)` 漏了 `: null`，浏览器报 Unexpected token ','。
  assert.throws(() => compile("const a = cond ? el('p') ,", 'fixture.js'), SyntaxError);
  assert.doesNotThrow(() => compile("const a = cond ? el('p') : null;", 'fixture.js'));
});
