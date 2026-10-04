import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import MarkdownIt from 'markdown-it';
import CodeHighlighter from '../renderer/highlight-source.mjs';

const window = { SaCodeMarkdownIt: MarkdownIt, SaCodeCodeHighlighter:CodeHighlighter, Vue: { ref:value=>({value}),onBeforeUnmount:()=>{},h: (tag, props, children) => typeof tag==='object'?tag.setup(props)():({ tag, props, children }) } };
vm.runInNewContext(readFileSync(new URL('../renderer/code-block.js', import.meta.url), 'utf8'), { window });
vm.runInNewContext(readFileSync(new URL('../renderer/markdown.js', import.meta.url), 'utf8'), { window });
const render = window.SaCodeMarkdown.render;
const walk = (nodes) => nodes.flatMap(n => n==null || typeof n === 'string' ? [] : [n, ...walk(Array.isArray(n.children) ? n.children : [])]);
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

test('代码卡默认换行且可切换，复制成功反馈以实际写入结果为准',async()=>{
  let written,finish,timer,dispose;
  const host={SaCodeCodeHighlighter:CodeHighlighter,Vue:{ref:value=>({value}),onBeforeUnmount:fn=>{dispose=fn;},h:(tag,props,children)=>({tag,props,children})},navigator:{clipboard:{writeText:text=>{written=text;return new Promise(resolve=>{finish=resolve;});}}},setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=undefined;}};
  vm.runInNewContext(readFileSync(new URL('../renderer/code-block.js',import.meta.url),'utf8'),{window:host});
  const props={code:'const 中文 = "<标签>";\n',lang:'js'},view=host.SaCodeCodeBlock.Component.setup(props);
  const button=cls=>walk([view()]).find(n=>n.props?.class===cls);
  assert.equal(view().props['data-code-wrap'],'true');
  button('code-action code-wrap').props.onClick();
  assert.equal(view().props['data-code-wrap'],'false');
  props.code+='第二行\n';
  assert.equal(view().props['data-code-wrap'],'false');
  assert.equal(sourceText(walk([view()]).find(n=>n.tag==='pre')),props.code);
  const pending=button('code-action code-copy').props.onClick();
  assert.equal(written,props.code);assert.equal(button('code-action code-copy').props.disabled,true);
  assert.equal(button('code-action code-copy').props['aria-label'],'复制代码');
  finish();await pending;
  assert.equal(button('code-action code-copy').props['aria-label'],'已复制');
  timer();assert.equal(button('code-action code-copy').props['aria-label'],'复制代码');
  host.navigator.clipboard.writeText=async()=>{throw new Error('拒绝');};
  await button('code-action code-copy').props.onClick();
  assert.equal(button('code-action code-copy').props['aria-label'],'复制代码');
  assert.ok(walk([view()]).some(n=>n.props?.role==='alert'&&n.children==='复制失败，请重试'));
  dispose();assert.equal(timer,undefined);
});

test('无 Clipboard API 时复制回退清理临时节点并恢复焦点，拒绝仍返回失败',async()=>{
  let selected,removed=false,focused=false,accept=true;
  const node={select(){selected=this.value;},remove(){removed=true;}};
  const host={Vue:{h:()=>{},ref:()=>{},onBeforeUnmount:()=>{}},navigator:{},document:{activeElement:{focus(){focused=true;}},getSelection:()=>null,createElement:()=>node,body:{append(){}},execCommand(){if(!accept)throw new Error('拒绝');return true;}}};
  vm.runInNewContext(readFileSync(new URL('../renderer/code-block.js',import.meta.url),'utf8'),{window:host});
  assert.equal(await host.SaCodeCodeBlock.writeClipboard('中文\n原文'),true);
  assert.equal(selected,'中文\n原文');assert.equal(removed,true);assert.equal(focused,true);
  accept=false;removed=false;focused=false;
  assert.equal(await host.SaCodeCodeBlock.writeClipboard('下一段'),false);
  assert.equal(removed,true);assert.equal(focused,true);
});
