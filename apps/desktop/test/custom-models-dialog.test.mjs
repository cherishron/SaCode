// 自定义模型新增/编辑必须渲染进共享弹窗：列表只留行，长绑定列表不再把表单推到列表末尾。
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
const mount=async(customs,providers,overrides={})=>{
  const result=await build({entryPoints:[join(pages,'custom-models.ts')],bundle:true,write:false,format:'cjs',external:['vue']});
  const ctx={module:{exports:{}},exports:{},require:()=>Vue,URL,crypto:{randomUUID:()=>'fixture'}};
  ctx.SaCodeDialog=Vue.defineComponent({
    props:{open:Boolean,title:{type:String,default:''},onClose:Function},
    setup(props,{slots}){return()=>Vue.h('div',{role:'dialog','data-title':props.title},[Vue.h('button',{type:'button','aria-label':'关闭弹窗',onClick:()=>props.onClose?.()},'×'),...(slots.default?.()||[])]);},
  });
  vm.runInNewContext(result.outputFiles[0].text,ctx);
  const root=node('root'),adapter={describe:async()=>({customs,providers,revision:'rev-1',writable:true}),upsert:async()=>{},...overrides};
  const app=renderer.createApp({render:()=>Vue.h(ctx.module.exports.Page,{adapter})});
  app.mount(root);await settle();
  return{root,unmount:()=>app.unmount()};
};

const button=(root,text)=>walk(root).find(n=>n.type==='button'&&n.text===text);
const dialogOf=root=>walk(root).find(n=>n.props.role==='dialog');
const input=async(root,label,value)=>{byLabel(root,label).props.onInput({target:{value}});await settle();};

test('校验错误显示在弹窗内而非被模态背景遮挡',async()=>{
  const ui=await mount([],[]);
  try{
    byLabel(ui.root,'添加模型').props.onClick();await settle();
    button(dialogOf(ui.root),'保存').props.onClick();await settle();
    const dialog=dialogOf(ui.root),alerts=walk(ui.root).filter(n=>n.props.role==='alert');
    assert.ok(dialog,'校验失败不关闭弹窗');
    assert.equal(alerts.length,1);
    assert.ok(walk(dialog).includes(alerts[0]),'错误必须位于可交互的弹窗内');
    assert.match(alerts[0].text,/ID/);
  }finally{ui.unmount();}
});

test('保存期间拒绝关闭，失败后保留草稿并在弹窗显示错误',async()=>{
  let rejectSave;
  const ui=await mount([],[],{upsert:()=>new Promise((_resolve,reject)=>{rejectSave=reject;})});
  try{
    byLabel(ui.root,'添加模型').props.onClick();await settle();
    await input(ui.root,'ID','my-model');await input(ui.root,'名称','草稿名称');
    button(dialogOf(ui.root),'保存').props.onClick();await settle();
    let dialog=dialogOf(ui.root);
    assert.equal(walk(dialog).find(n=>n.props.class==='cm-editor').props.disabled,true);
    byLabel(dialog,'关闭弹窗').props.onClick();await settle();
    assert.ok(dialogOf(ui.root),'保存期间关闭请求不能丢弃草稿');
    rejectSave(new Error('保存失败'));await settle();
    dialog=dialogOf(ui.root);
    assert.equal(byLabel(dialog,'名称').props.value,'草稿名称');
    assert.equal(walk(dialog).find(n=>n.props.class==='cm-editor').props.disabled,false);
    assert.ok(walk(dialog).some(n=>n.props.role==='alert'&&n.text==='保存失败'));
  }finally{ui.unmount();}
});

test('保存成功保留原修订与草稿参数并关闭弹窗',async()=>{
  const calls=[];
  const ui=await mount([],[],{upsert:async(...args)=>{calls.push(args);}});
  try{
    byLabel(ui.root,'添加模型').props.onClick();await settle();
    await input(ui.root,'ID','my-model');await input(ui.root,'名称','模型乙');
    button(dialogOf(ui.root),'保存').props.onClick();await settle();
    assert.equal(dialogOf(ui.root),undefined);
    assert.equal(calls.length,1);
    assert.equal(calls[0][0].id,'my-model');assert.equal(calls[0][0].name,'模型乙');
    assert.equal(calls[0][0].dailyTokens,-1);assert.equal(calls[0][0].bindings.length,0);
    assert.equal(calls[0][1],'rev-1');
    assert.ok(walk(ui.root).some(n=>n.props.role==='status'&&n.text==='已保存'));
  }finally{ui.unmount();}
});

test('新增表单位于共享弹窗，列表区不再内联编辑块',async()=>{
  const ui=await mount([],[]);
  try{
    byLabel(ui.root,'添加模型').props.onClick();await settle();
    const dialog=walk(ui.root).find(n=>n.props.role==='dialog');
    assert.ok(dialog,'新增表单必须走共享弹窗');
    assert.equal(dialog.props['data-title'],'添加模型');
    assert.match(String(dialog.props.class||''),/cm-editor-dialog/,'弹窗走宽表单变体');
    for(const label of ['ID','名称','分类'])assert.ok(walk(dialog).some(n=>n.props['aria-label']===label),'字段应在弹窗内：'+label);
    // 列表区只可能有只读 fieldset（此页列表 ul 无 fieldset），编辑 fieldset 必须在弹窗内
    const outside=fieldsetOutside(ui.root,dialog);
    assert.equal(outside.some(n=>String(n.props.class||'').includes('cm-section')),false,'列表区不应再内联编辑分节 fieldset');
    byLabel(dialog,'关闭弹窗').props.onClick();await settle();
    assert.equal(walk(ui.root).some(n=>n.props.role==='dialog'),false,'关闭后弹窗必须卸载');
  }finally{ui.unmount();}
});

test('编辑表单位于共享弹窗并携带模型名称',async()=>{
  const model={id:'m',name:'模型甲',description:'',enabled:true,category:'coding',requires:['text-output'],bindings:[],mode:'weighted',params:'',modalityBudget:'',dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeEnabled:true,probeMaxPerDay:3};
  const ui=await mount([model],[]);
  try{
    byLabel(ui.root,'编辑 模型甲').props.onClick();await settle();
    const dialog=walk(ui.root).find(n=>n.props.role==='dialog');
    assert.ok(dialog,'编辑表单必须走共享弹窗');
    assert.equal(dialog.props['data-title'],'编辑 模型甲');
    assert.ok(walk(dialog).some(n=>n.props['aria-label']==='名称'),'编辑字段应在弹窗内');
    assert.equal(fieldsetOutside(ui.root,dialog).some(n=>String(n.props.class||'').includes('cm-section')),false,'列表区不应再内联编辑区');
  }finally{ui.unmount();}
});
