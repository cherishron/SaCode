import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import MarkdownIt from 'markdown-it';
import CodeHighlighter from '../renderer/highlight-source.mjs';

const window = { SaCodeMarkdownIt: MarkdownIt, SaCodeCodeHighlighter:CodeHighlighter, Vue: { h: (tag, props, children) => ({ tag, props, children }) } };
vm.runInNewContext(readFileSync(new URL('../renderer/markdown.js', import.meta.url), 'utf8'), { window });
const render = window.SaCodeMarkdown.render;
const walk = (nodes) => nodes.flatMap(n => typeof n === 'string' ? [] : [n, ...walk(Array.isArray(n.children) ? n.children : [])]);
const sourceText=n=>typeof n==='string'?n:Array.isArray(n)?n.map(sourceText).join(''):sourceText(n.children||[]);

test('正文包含标题、嵌套列表、引用、代码与表格语义节点', () => {
  const nodes = walk(render('# 标题\n\n1. 首项\n   - 子项\n\n> 引用 **强调**\n\n```js\nconst x = 1;\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 项目 | `内容` |'));
  for (const tag of ['h1','ol','ul','li','blockquote','strong','pre','code','table','th','td']) assert.ok(nodes.some(n => n.tag === tag), tag);
});
test('模型 HTML 与代码作为文本，图片不生成加载节点', () => {
  const nodes = render('<script>alert(1)</script>\n\n![说明](https://example.com/a.png)\n\n```html\n<img onerror="alert(1)">\n```');
  assert.ok(JSON.stringify(nodes).includes('<script>'));
  assert.ok(!walk(nodes).some(n => ['script','img'].includes(n.tag)));
  assert.ok(walk(nodes).some(n => n.tag === 'code' && sourceText(n).includes('<img')));
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
  assert.ok(open.some(n => n.tag === 'code' && sourceText(n).includes('<标签>')));
});

test('全部已核语言别名保留源文本，未知及原型属性名保持纯文本',()=>{
  const source='const 中文 = "<script>";\n第二行\n';
  for(const hint of CodeHighlighter.supportedHints){
    const lines=CodeHighlighter.highlight(source,hint);
    assert.equal(lines.map(line=>line.map(token=>token.text).join('')).join('\n'),source,hint);
  }
  for(const hint of ['constructor','__proto__','仓颉','not-a-language',''])assert.equal(CodeHighlighter.highlight(source,hint),undefined);
});
test('高亮只产生文本 span 与主题变量，流式围栏保持相同原文',()=>{
  const code='const 中文 = "<img onerror=alert(1)>";\n';
  const nodes=walk(render('```JS\n'+code+'```'));
  assert.equal(sourceText(nodes.find(n=>n.tag==='code')),code);
  assert.ok(nodes.some(n=>n.tag==='span' && n.props.style?.color?.startsWith('var(--shiki-')));
  assert.ok(!nodes.some(n=>['script','img','style'].includes(n.tag) || n.props?.innerHTML));
  const open=walk(render('```js\n'+code));
  assert.equal(sourceText(open.find(n=>n.tag==='code')),code);
});
test('表格保留对齐，宽表独立滚动，引用中的表格填满内容列',()=>{
  const wide=walk(render('|甲|乙|丙|丁|\n|:---|:---:|---:|---|\n|1|2|3|4|'));
  assert.ok(wide.some(n=>n.props.class==='markdown-table-scroll table-wide'));
  assert.deepEqual(Array.from(wide.filter(n=>n.tag==='th'),n=>n.props.style?.textAlign),['left','center','right',undefined]);
  const quote=walk(render('> |甲|乙|丙|丁|\n> |---|---|---|---|\n> |1|2|3|4|'));
  assert.ok(quote.some(n=>n.props.class==='markdown-table-scroll table-fill'));
});
