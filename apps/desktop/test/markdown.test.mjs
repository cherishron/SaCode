import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import MarkdownIt from 'markdown-it';

const window = { SaCodeMarkdownIt: MarkdownIt, Vue: { h: (tag, props, children) => ({ tag, props, children }) } };
vm.runInNewContext(readFileSync(new URL('../renderer/markdown.js', import.meta.url), 'utf8'), { window });
const render = window.SaCodeMarkdown.render;
const walk = (nodes) => nodes.flatMap(n => typeof n === 'string' ? [] : [n, ...walk(Array.isArray(n.children) ? n.children : [])]);

test('正文包含标题、嵌套列表、引用、代码与表格语义节点', () => {
  const nodes = walk(render('# 标题\n\n1. 首项\n   - 子项\n\n> 引用 **强调**\n\n```js\nconst x = 1;\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 项目 | `内容` |'));
  for (const tag of ['h1','ol','ul','li','blockquote','strong','pre','code','table','th','td']) assert.ok(nodes.some(n => n.tag === tag), tag);
});
test('模型 HTML 与代码作为文本，图片不生成加载节点', () => {
  const nodes = render('<script>alert(1)</script>\n\n![说明](https://example.com/a.png)\n\n```html\n<img onerror="alert(1)">\n```');
  assert.ok(JSON.stringify(nodes).includes('<script>'));
  assert.ok(!walk(nodes).some(n => ['script','img'].includes(n.tag)));
  assert.ok(walk(nodes).some(n => n.tag === 'code' && n.children.includes('<img')));
});
test('危险链接不会形成可导航 href，安全链接保留', () => {
  const nodes = walk(render('[危险](javascript:alert%281%29) [安全](https://example.com) [文件](file:///C:/secret)'));
  assert.equal(nodes.filter(n => n.tag === 'a').length, 1);
  assert.equal(nodes.find(n => n.tag === 'a').props.href, 'https://example.com');
});

test('任意流式截断可以解析，未闭合代码围栏保留正文', () => {
  const text='# 标题\n\n正文 **强调**。\n\n- 第一项\n- 第二项\n\n```js\nconst x = "<标签>";\n```';
  for (let i=0; i<=text.length; i++) assert.doesNotThrow(() => render(text.slice(0,i)));
  const open = walk(render('```js\nconst x = "<标签>";'));
  assert.ok(open.some(n => n.tag === 'pre'));
  assert.ok(open.some(n => n.tag === 'code' && n.children.includes('<标签>')));
});
