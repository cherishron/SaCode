// 供应商新增/编辑必须渲染进共享弹窗：列表只留行，长模型目录不再把表单推到列表末尾。
// 真实 Vue 运行时 + 自建渲染器，只替换宿主节点；共享弹窗用能转出默认插槽的桩。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const Vue=createRequire(import.meta.url)('vue');
const pages=join(dirname(fileURLToPath(import.meta.url)),'../renderer/pages');
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
const byLabel=(root,label)=>walk(root).find(n=>n.props['aria-label']===label);
const fieldsetOutside=(root,dialog)=>{
  const inside=new Set(walk(dialog));
  return walk(root).filter(n=>!inside.has(n)&&n.type==='fieldset');
};
const mount=async(providers)=>{
  const result=await build({entryPoints:[join(pages,'provider-settings.ts')],bundle:true,write:false,format:'cjs',external:['vue']});
  const ctx={module:{exports:{}},exports:{},require:()=>Vue,URL,crypto:{randomUUID:()=>'fixture'}};
  // 页面在渲染期读 globalThis.SaCodeDialog；桩必须放进 vm 沙箱，不能挂到宿主进程的全局。
  ctx.SaCodeDialog=Vue.defineComponent({
    props:{open:Boolean,title:{type:String,default:''},onClose:Function},
    setup(props,{slots}){return()=>Vue.h('div',{role:'dialog','data-title':props.title},[Vue.h('button',{type:'button','aria-label':'关闭弹窗',onClick:()=>props.onClose?.()},'×'),...(slots.default?.()||[])]);},
  });
  vm.runInNewContext(result.outputFiles[0].text,ctx);
  const root=node('root'),adapter={describe:async()=>({providers,catalog:[],revision:1,writable:true}),save:async()=>{}};
  const app=renderer.createApp({render:()=>Vue.h(ctx.module.exports.Page,{adapter})});
  app.mount(root);await settle();
  return{root,unmount:()=>app.unmount()};
};

test('新增表单位于共享弹窗，列表区不再内联',async()=>{
  const ui=await mount([]);
  try{
    byLabel(ui.root,'添加供应商').props.onClick();await settle();
    const dialog=walk(ui.root).find(n=>n.props.role==='dialog');
    assert.ok(dialog,'新增表单必须走共享弹窗');
    assert.equal(dialog.props['data-title'],'添加供应商');
    assert.match(String(dialog.props.class||''),/ps-editor-dialog/,'弹窗走宽表单变体');
    for(const label of ['Provider ID','显示名称','API 地址','API 密钥'])assert.ok(walk(dialog).some(n=>n.props['aria-label']===label),'字段应在弹窗内：'+label);
    assert.deepEqual(fieldsetOutside(ui.root,dialog).map(n=>n.props.class),[],'列表区不应再内联 fieldset');
    byLabel(dialog,'关闭弹窗').props.onClick();await settle();
    assert.equal(walk(ui.root).some(n=>n.props.role==='dialog'),false,'关闭后弹窗必须卸载');
  }finally{ui.unmount();}
});

test('编辑表单位于共享弹窗并携带供应商名称',async()=>{
  const provider={id:'p',name:'供应商甲',baseUrl:'https://example.com/v1',protocol:'openai-completions',transport:'direct',sortOrder:1,enabled:true,declared:false,keyConfigured:true,models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]};
  const ui=await mount([provider]);
  try{
    byLabel(ui.root,'编辑 供应商甲').props.onClick();await settle();
    const dialog=walk(ui.root).find(n=>n.props.role==='dialog');
    assert.ok(dialog,'编辑表单必须走共享弹窗');
    assert.equal(dialog.props['data-title'],'编辑 供应商甲');
    assert.ok(walk(dialog).some(n=>n.props['aria-label']==='显示名称'),'编辑字段应在弹窗内');
    assert.deepEqual(fieldsetOutside(ui.root,dialog).map(n=>n.props.class),[],'列表区不应再内联编辑区');
  }finally{ui.unmount();}
});
