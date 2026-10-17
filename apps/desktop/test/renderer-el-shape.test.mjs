import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 渲染层的 el(tag, cls, children, extra) 把 extra 并进 props：Object.assign({class:cls}, extra||{})。
// 所以「数组落到第 4 位」会被展开成数字键，JS 又让整数键先枚举，Vue patch 里就变成
// setAttribute('0', …) → InvalidCharacterError，**整次根渲染 flush 中止且不留明显报错**：
// 症状是下游几十条 DOM 断言集体消失。这一类错位已经踩过三次，语法门禁（renderer-syntax）拦不住，
// 因为参数序写反的脚本完全合法。这里按实参形状机械对账。
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = resolve(HERE, '..', 'renderer');

function sourcesUnderScan() {
  const html = readFileSync(join(RENDERER, 'index.html'), 'utf8');
  const pageScripts = [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => !src.startsWith('vendor/'))
    .map((src) => join(RENDERER, src.split('?')[0]));
  const pages = readdirSync(join(RENDERER, 'pages'))
    .filter((n) => n.endsWith('.ts'))
    .sort()
    .map((n) => join(RENDERER, 'pages', n));
  return [...pageScripts, ...pages];
}

// 引号/模板串/注释内的括号与逗号不计；只切出顶层实参。
function splitArgs(src, openIdx) {
  const args = [];
  let depth = 0, start = openIdx + 1, q = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) i = src.length; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(src.slice(start, i)); return args; }
      continue;
    }
    if (c === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
  }
  return null;
}

const shapeOf = (a) => {
  const t = (a || '').trim();
  if (!t) return 'none';
  if (t[0] === '{') return 'obj';
  if (t[0] === '[') return 'arr';
  return 'other';
};

// 错位判据：第 3 位（children）是对象字面量，或第 3 位恰为 null 而第 4 位（props）不是对象字面量。
// 后者是 `el(tag,cls,null,Array.from(…))` 这一形——源码里第 3 位既不是 [ 也不是 {，纯字面量形状匹配抓不到。
function findInverted(source, file) {
  const hits = [];
  const re = /(^|[^\w$.])el\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const openIdx = m.index + m[0].length - 1;
    const args = splitArgs(source, openIdx);
    if (!args || args.length < 4) continue;
    const a3 = shapeOf(args[2]), a4 = shapeOf(args[3]);
    const inverted = a3 === 'obj' || (args[2].trim() === 'null' && a4 !== 'obj');
    if (inverted) {
      const a3label = args[2].trim() === 'null' ? 'null' : a3;
      hits.push(`${file}:${source.slice(0, openIdx).split(/\r?\n/).length} arg3=${a3label} arg4=${a4}`);
    }
  }
  return hits;
}

test('渲染层 el() 调用点的实参形状不得把 props 与 children 写反', () => {
  const files = sourcesUnderScan();
  // 空集合不算通过：分母的来历（正则、pages 目录）一旦漂了，这条会静默变成「零个文件要检」。
  assert.ok(files.length >= 20, `只取到 ${files.length} 个渲染源`);
  const found = [];
  let calls = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    calls += (source.match(/(^|[^\w$.])el\s*\(/g) || []).length;
    found.push(...findInverted(source, file));
  }
  assert.ok(calls >= 200, `四参对账只扫到 ${calls} 处 el( 调用，门禁可能在空转`);
  assert.deepEqual(found, []);
});

test('这道门禁对本批修掉的三种形状确实是红的', () => {
  // 反证门禁本身：三条都是历史上真实存在过的写法（工作区分组 section/button、轨迹时间线）。
  const bad = [
    "el('section','workspace-group',{'data-workspace-group':d},[el('button','x',[])])",
    "el('div','trace-timeline',null,Array.from({length:n},(_,i)=>el('div','ev',[a,b])))",
  ];
  for (const src of bad) {
    assert.equal(findInverted(src, 'f.js').length, 1, `该被抓却没抓：${src}`);
  }
  // 合法形状一律不抓，否则门禁会绿在「什么都不放过」上。
  const legal = [
    "el('div','c',[a,b],{'aria-label':x})",
    "el('div','c',null,{title:t})",
    "el('div','c',text)",
    "el('span','label',items.map(renderItem),{id:'z'})",
  ];
  for (const src of legal) {
    assert.deepEqual(findInverted(src, 'f.js'), [], `不该被抓却抓了：${src}`);
  }
});
