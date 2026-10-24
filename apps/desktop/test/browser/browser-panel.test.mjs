import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadPageModule } from '../support/load-page-module.mjs';
const Vue = createRequire(import.meta.url)('vue');
const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null, getBoundingClientRect: () => ({ x: 500, y: 200, width: 400, height: 300 }), getClientRects: () => [1], contains: () => true });
const renderer = Vue.createRenderer({
  createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
  parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
  patchProp: (n, key, _old, value) => { n.props[key] = value; },
  insert(n, parent, anchor = null) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = parent; const i = anchor ? parent.children.indexOf(anchor) : -1; if (i < 0) parent.children.push(n); else parent.children.splice(i, 0, n); },
  remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
});
const walk = n => [n, ...n.children.flatMap(walk)];
const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); await Vue.nextTick(); } };
function mount(api, active = true, clip = null) {
  const { BrowserPanel } = loadPageModule(new URL('../../renderer/pages/browser-panel.ts', import.meta.url), { vue: Vue, globals: {
    document: { visibilityState: 'visible', querySelectorAll: () => [], elementFromPoint: () => null, addEventListener() {}, removeEventListener() {}, documentElement: {} },
    window: { innerWidth: 1200, innerHeight: 800, getComputedStyle:()=>({overflow:'auto',overflowX:'auto',overflowY:'auto'}), addEventListener() {}, removeEventListener() {} },
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  } });
  const props = Vue.reactive({ api, active, sessionId: 's1', projectId: 'p1' }), root = node('root');
  const app = renderer.createApp({ render: () => Vue.h(BrowserPanel, props) }); app.mount(root);
  if (clip) {
    const viewport=walk(root).find(n=>n.props['aria-label']==='网页视图');
    viewport.parentElement={parentElement:null,getBoundingClientRect:()=>clip};
  }
  return { props, root, unmount: () => app.unmount() };
}
function apiFixture() {
  const calls = [];
  const page = { url: 'https://one.test/', title: '页面真实标题', canGoBack: true, canGoForward: false };
  const api = Object.fromEntries(['Open', 'Describe', 'Back', 'Forward', 'Reload', 'Navigate', 'Layout', 'Close'].map(action => ['browserView' + action, async request => { calls.push([action, request]); return { ok: true, page }; }]));
  return { api, calls };
}
test('人工浏览正式面板打开后使用独立通道导航并呈现回执', async () => {
  const f = apiFixture(), ui = mount(f.api); await settle();
  try {
    assert.equal(f.calls.filter(([a]) => a === 'Open').length, 1);
    const input = walk(ui.root).find(n => n.type === 'input');
    input.props.onInput({ target: { value: 'https://one.test/new' } }); await settle();
    await walk(ui.root).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
    assert.equal(f.calls.filter(([a]) => a === 'Navigate').length, 1);
    assert.equal(f.calls.find(([a]) => a === 'Navigate')[1].url, 'https://one.test/new');
    assert.ok(walk(ui.root).some(n => n.text.includes('页面真实标题')));
    assert.ok(walk(ui.root).some(n => n.props['aria-label'] === '网页视图'));
  } finally { ui.unmount(); }
  assert.equal(f.calls.filter(([a]) => a === 'Close').length, 1);
});
test('网页原生视图不得越过滚动父容器边界',async()=>{
  const f=apiFixture(),ui=mount(f.api,true,{left:500,top:150,right:900,bottom:350});await settle();
  try {const request=f.calls.find(([a,p])=>a==='Layout'&&p.visible)?.[1];assert.ok(request);assert.deepEqual(JSON.parse(JSON.stringify(request.bounds)),{x:500,y:200,width:400,height:150});}
  finally {ui.unmount();}
});

test('非活动面板不创建视图，切走隐藏但不伪造后台 Agent 停止', async () => {
  const f = apiFixture(), ui = mount(f.api, false); await settle();
  try {
    assert.equal(f.calls.length, 0);
    ui.props.active = true; await settle(); assert.equal(f.calls.filter(([a]) => a === 'Open').length, 1);
    ui.props.active = false; await settle();
    assert.equal(f.calls.filter(([a]) => a === 'Close').length, 0);
    assert.equal(f.calls.filter(([a]) => a === 'Layout').at(-1)[1].visible, false);
    assert.equal(f.calls.some(([a]) => a === 'StopControl'), false);
  } finally { ui.unmount(); }
});
test('建立视图尚未回执时切项目仍关闭旧目标并建立新视图', async () => {
  const f = apiFixture(); let release;
  f.api.browserViewOpen = request => { f.calls.push(['Open',request]); return request.projectId === 'p1' ? new Promise(resolve => { release=resolve; }) : Promise.resolve({ok:true}); };
  const ui=mount(f.api);await settle();
  try {
    ui.props.projectId='p2';await settle();
    release({ok:true});await settle();
    assert.ok(f.calls.some(([a,p])=>a==='Close'&&p.projectId==='p1'));
    assert.ok(f.calls.some(([a,p])=>a==='Open'&&p.projectId==='p2'));
  } finally {ui.unmount();}
});

test('切项目后旧导航回执不得覆盖新目标', async () => {
  const f = apiFixture(); let resolve;
  f.api.browserViewNavigate = () => new Promise(done => { resolve = done; });
  const ui = mount(f.api); await settle();
  try {
    walk(ui.root).find(n => n.type === 'input').props.onInput({ target: { value: 'https://old.test/' } }); await settle();
    const pending = walk(ui.root).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    ui.props.projectId = 'p2'; await settle();
    resolve({ ok: true, page: { url: 'https://old.test/', title: '旧页面不得显示', canGoBack: false, canGoForward: false } }); await pending; await settle();
    assert.equal(walk(ui.root).some(n => n.text.includes('旧页面不得显示')), false);
    assert.ok(f.calls.some(([a, p]) => a === 'Close' && p.projectId === 'p1'));
    assert.ok(f.calls.some(([a, p]) => a === 'Open' && p.projectId === 'p2'));
  } finally { ui.unmount(); }
});
