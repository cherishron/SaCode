import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),vue=require('vue');
const source=fileURLToPath(new URL('../renderer/pages/composer-stats.ts',import.meta.url));
const bundle=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
const module={exports:{}};
const listeners=new Map(),mounted=[],unmounted=[];
const document={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key)=>listeners.delete(key)};
runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,document,window:{addEventListener(){},removeEventListener(){}},ResizeObserver:class{observe(){}disconnect(){}},require:name=>name==='vue'?{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:require(name)});
const {activityOf,duration,compactTokens,usageOf,ActivityPill,UsagePill,StatPill,ComposerStats}=module.exports;
test('activity 只收有限非负宿主数据，无数据不渲染',()=>{
  for(const data of [undefined,{}, {elapsedMs:-1,ttftMs:NaN,tokensPerSecond:Infinity}])assert.equal(activityOf(data),null);
  assert.equal(ActivityPill.setup({})(),null);
  const node=ActivityPill.setup({activity:{elapsedMs:146000,ttftMs:7300,tokensPerSecond:119}})();
  assert.equal(node.props.label,'2分26秒 · TTFT 7.3s · 119 tok/s');
  assert.equal(duration(500),'0秒');assert.equal(compactTokens(1340000),'1.34M');
});
test('累计四维相加，命中率只用缓存读取和未缓存输入，不重复加 used',()=>{
  const u=usageOf({used:999999},{tokenTotals:{input:100,cacheRead:300,cacheWrite:40,output:60}});
  assert.equal(u.total,500);assert.equal(u.hit,.75);assert.equal(u.cacheWrite,40);
  assert.equal(usageOf(null,{providerTotals:[{usedMicros:100}]}),null);
  assert.equal(usageOf({used:500},{}).input,null);
  assert.equal(usageOf(null,{tokenTotals:{input:0,cacheRead:0,cacheWrite:0,output:0}}).hit,null);
  assert.equal(UsagePill.setup({})(),null);
});
test('非模态 popover 再点、Escape、外点关闭，卸载解除监听',()=>{
  const render=StatPill.setup({label:'1K',title:'用量',resetKey:'s'},{slots:{}});
  mounted.splice(0).forEach(fn=>fn());
  let node=render();assert.equal(node.children[1].props.popover,'manual');assert.equal(node.children[1].props['aria-modal'],undefined);
  node.children[0].props.onClick();assert.equal(render().children[0].props['aria-expanded'],true);
  node.children[0].props.onClick();assert.equal(render().children[0].props['aria-expanded'],false);
  node.children[0].props.onClick();listeners.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
  assert.equal(render().children[0].props['aria-expanded'],false);
  node.children[0].props.onClick();listeners.get('pointerdown')({target:{}});assert.equal(render().children[0].props['aria-expanded'],false);
  unmounted.splice(0).forEach(fn=>fn());assert.equal(listeners.size,0);
});
test('会话切换立即清空且拒绝迟到累计用量',async()=>{
  let resolveOld;const old=new Promise(resolve=>resolveOld=resolve);
  const props=vue.reactive({sessionId:'a',modelKey:'m',settled:false,api:{usageStatus:()=>old,ledgerStats:async()=>null}});
  const render=ComposerStats.setup(props);
  props.api={usageStatus:async()=>({used:12}),ledgerStats:async()=>null};props.sessionId='b';
  await new Promise(resolve=>setImmediate(resolve));assert.equal(render().children[1].props.usage.total,12);
  resolveOld({used:900});await new Promise(resolve=>setImmediate(resolve));assert.equal(render().children[1].props.usage.total,12);
});
test('装配位于输入框上方，ContextMeter 留在尾部且模型变化清空活动',()=>{
  const app=readFileSync(new URL('../renderer/app.js',import.meta.url),'utf8');
  assert.ok(app.indexOf('h(window.SaCodeComposerStats.ComposerStats')<app.indexOf('el("label", "composer-label"'));
  assert.ok(app.indexOf('h(window.SaCodeContextMeter.ContextMeter')>app.indexOf('"composer-trailing"'));
  assert.match(app,/watch\(\(\) => \[turn.value, composerModelKey.value\]/);
  assert.match(app,/epoch===activityGeneration && pollEpoch===pollGeneration/);
});
