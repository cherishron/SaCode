import { test } from 'node:test';
import assert from 'node:assert/strict';
import {loadPageModule} from './support/load-page-module.mjs';
function fixture(adapter) {
  const mounts = [];
  // index.html 里 dialog.js 先于页面加载，弹窗以宿主全局出现；这里用同名标记的最小替身
  // 承载插槽内容，让编辑表单里的按钮仍可从渲染树里取到。
  const Dialog = {__saCodeDialog: true};
  const vue = { defineComponent: v => v, ref: value => ({value}), onMounted: fn => mounts.push(fn), onBeforeUnmount() {},
    h: (tag, props, children) => ({tag: tag === Dialog ? 'dialog' : tag, props: props || {}, children: typeof children === 'function' ? children() : children}) };
  const page=loadPageModule(new URL('../renderer/pages/provider-settings.ts',import.meta.url),{vue,globals:{SaCodeDialog:Dialog}});
  const render = page.Page.setup({adapter});
  mounts.forEach(fn => fn());
  const nodes = () => { const all=[]; const visit=v=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'){all.push(v);visit(v.children);}};visit(render());return all;};
  return { nodes, click: label => { const n=nodes().find(n=>n.tag==='button'&&n.children===label);assert.ok(n,label);return n.props.onClick(); }, input: (label,value)=>{const n=nodes().find(n=>n.tag==='input'&&n.props['aria-label']===label);assert.ok(n,label);n.props.onInput({target:{value}});} };
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
for (const edit of [false, true]) test(`部分保存后独立重试${edit?'拒绝修改后的草稿':'仅写凭据'}`, async()=>{
  const provider={id:'p',name:'供应商',baseUrl:'https://example.com/v1',protocol:'openai-completions',transport:'direct',sortOrder:1,enabled:true,declared:false,credentialWritable:true,models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]};
  let writes=0,retries=[];
  const ui=fixture({describe:async()=>({providers:[provider],catalog:[],revision:1,writable:true}),save:async()=>{writes++;const e=Error('密钥失败');e.configurationRevision=2;throw e;},saveCredential:async(...args)=>retries.push(args)});
  await settle();ui.click('编辑');ui.input('API 密钥','fixture-key');ui.click('保存');await settle();
  if(edit)ui.input('显示名称','后来修改');
  ui.click('仅重试密钥');await settle();
  assert.equal(writes,1);
  assert.equal(retries.length,edit?0:1);
  if(!edit)assert.deepEqual(Array.from(retries[0]),['p','fixture-key',2]);
});
