// F09 交互终端页的离线结构回归：xterm 折叠产物接入后，页面从占位分支转到真实挂载分支。
// 机制与 provider-editor-dialog.test.mjs 同：真实 Vue 运行时 + 自建渲染器，只替换宿主节点；
// 不启动 Electron、也不加载真实 @xterm 包，只桩 globalThis.Xterm 验证结构分歧。
// 另附折叠产物 CSP 反证（vendor 就位时），对齐 pack-xterm.mjs 的自检口径。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync} from 'node:fs';

const Vue=createRequire(import.meta.url)('vue');
const here=dirname(fileURLToPath(import.meta.url));
const pages=join(here,'../renderer/pages');
const node=(type,text='')=>({type,text,props:{},children:[],parent:null});
const renderer=Vue.createRenderer({
  createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
  setText:(n,text)=>{n.text=text;},setElementText:(n,text)=>{n.text=text;n.children=[];},
  parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null,
  patchProp:(n,key,_old,value)=>{n.props[key]=value;},
  insert(n,parent,anchor=null){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;if(i<0)parent.children.push(n);else parent.children.splice(i,0,n);},
  remove(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
});
const walk=n=>[n,...n.children.flatMap(walk)];
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await Vue.nextTick();}};
const classesOf=n=>String(n.props.class||'').split(/\s+/).filter(Boolean);
const hasClass=(root,name)=>walk(root).some(n=>classesOf(n).includes(name));
const texts=root=>walk(root).map(n=>String(n.text||''));

// 桩 globalThis.Xterm：只实现组件挂载路径会触达的方法，不做真实终端。
async function mount(withXterm, channels=null){
  const result=await build({entryPoints:[join(pages,'terminal-interactive.ts')],bundle:true,write:false,format:'cjs',external:['vue']});
  class FakeTerminal{constructor(opts={}){this.cols=opts.cols||80;this.rows=opts.rows||24;}open(){}loadAddon(){}write(){}reset(){}dispose(){}onData(){}}
  class FakeFitAddon{fit(){}dispose(){}}
  const ctx={module:{exports:{}},exports:{},require:()=>Vue,crypto:{randomUUID:()=>'fixture'},
    ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{}};
  if(withXterm)ctx.Xterm={Terminal:FakeTerminal,FitAddon:FakeFitAddon};
  vm.runInNewContext(result.outputFiles[0].text,ctx);
  const root=node('root');
  const app=renderer.createApp({render:()=>Vue.h(ctx.module.exports.TerminalInteractive,{active:true,sessionId:'s1',directory:'C:/ws',configured:true,workspaceRevision:'r1',channels})});
  app.mount(root);await settle();
  return{root,unmount:()=>app.unmount()};
}

test('接入 xterm 全局后终端页渲染真实挂载容器而非占位',async()=>{
  const ui=await mount(true);
  try{
    assert.ok(hasClass(ui.root,'term-xterm-container'),'应渲染 xterm 挂载容器');
    assert.equal(hasClass(ui.root,'term-xterm-placeholder'),false,'不应再落到占位分支');
    assert.equal(texts(ui.root).some(t=>t.includes('xterm.js 尚未加载')),false,'不应出现未加载占位提示');
  }finally{ui.unmount();}
});

test('缺 xterm 全局时明确占位而非假装终端',async()=>{
  const ui=await mount(false);
  try{
    assert.ok(hasClass(ui.root,'term-xterm-placeholder'),'缺产物时应显示占位');
    assert.equal(hasClass(ui.root,'term-xterm-container'),false,'缺产物时不应假装有终端容器');
    assert.ok(texts(ui.root).some(t=>t.includes('xterm.js 尚未加载')),'占位提示应说明原因');
  }finally{ui.unmount();}
});

test('折叠产物过 CSP 反证：无运行时求值、无运行时模块加载、接上 globalThis.Xterm',t=>{
  const artifact=join(here,'../renderer/vendor/xterm.iife.js');
  if(!existsSync(artifact)){t.skip('renderer/vendor/xterm.iife.js 未生成，跳过（需先 npm run vendor）');return;}
  const code=readFileSync(artifact,'utf8');
  assert.doesNotMatch(code,/\bnew Function\b|\beval\s*\(/,'折叠产物不得含运行时求值');
  assert.doesNotMatch(code,/\bimport\s*\(/,'折叠产物不得含运行时模块加载');
  assert.ok(code.includes('globalThis.Xterm'),'折叠产物必须接上 globalThis.Xterm');
});

test('接线通道后“启动终端”进入运行相位而非占位',async()=>{
  const created=[];
  const channels={
    create:async opts=>{created.push(opts);return {sessionId:'pty-1',cwd:opts.cwd,phase:'running'};},
    input:async()=>({}),resize:async()=>({}),interrupt:async()=>({}),
    describe:async()=>({}),output:async()=>({chunks:[],nextCursor:0,more:false}),close:async()=>({}),kill:async()=>({}),
  };
  const ui=await mount(true, channels);
  try{
    const start=walk(ui.root).find(n=>n.type==='button'&&String(n.text).includes('启动终端'));
    assert.ok(start,'应渲染启动终端按钮');
    start.props.onClick();
    await settle();
    assert.equal(created.length,1,'create 应被调用一次');
    assert.equal(created[0].cwd,'C:/ws','create 应绑定工作区目录');
    assert.ok(hasClass(ui.root,'term-phase-running'),'应进入运行相位');
    assert.ok(texts(ui.root).some(t=>t.includes('运行中')),'相位徽标应显示运行中');
    assert.equal(hasClass(ui.root,'term-xterm-placeholder'),false,'接线后不应再占位');
  }finally{ui.unmount();}
});