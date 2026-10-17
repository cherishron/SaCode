import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/inline-editor.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
function fixture(){
  const mounts=[],unmounts=[],watches=[],events=[],observers=[];
  const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),watch:(_,fn)=>watches.push(fn),nextTick:()=>Promise.resolve(),onMounted:fn=>mounts.push(fn),onBeforeUnmount:fn=>unmounts.push(fn)};
  class ResizeObserver{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}}
  const ctx={module:{exports:{}},require:()=>vue,ResizeObserver};
  vm.runInNewContext(compiled.outputFiles[0].text,ctx);
  const props={value:'原文',label:'目标正文',busy:false},render=ctx.module.exports.InlineEditor.setup(props,{emit:(...args)=>events.push(args)});
  return{props,render,mounts,unmounts,watches,events,observers};
}
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
const key=extra=>({key:'Enter',prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});

test('Enter 保存与 Escape 取消，阻止冒泡到会话发送',()=>{
  const f=fixture(),input=f.render();
  for(const event of [key({}),key({key:'Escape'})]){input.props.onKeydown(event);assert.equal(event.prevented,true);assert.equal(event.stopped,true);}
  assert.deepEqual(f.events,[['save'],['cancel']]);
});
test('中文输入法两种标记与 Shift+Enter 保持原生输入，不提交',()=>{
  const f=fixture();for(const extra of [{isComposing:true},{keyCode:229},{shiftKey:true}]){const event=key(extra);f.render().props.onKeydown(event);assert.equal(event.prevented,false);}
  assert.deepEqual(f.events,[]);
});
test('长按 Enter 不重复保存，保存期间不提交、不取消、不改正文',()=>{
  const f=fixture();f.render().props.onKeydown(key({repeat:true}));assert.deepEqual(f.events,[]);
  f.props.busy=true;const input=f.render();assert.equal(input.props.readOnly,true);
  input.props.onKeydown(key({}));input.props.onKeydown(key({key:'Escape'}));input.props.onInput({target:{value:'不能覆盖'}});assert.deepEqual(f.events,[]);
});
test('输入保留多行原文，不自行发送消息',()=>{
  const f=fixture();f.render().props.onInput({target:{value:'需求\n约束'}});assert.deepEqual(f.events,[['change','需求\n约束']]);
});
test('挂载聚焦、文本变化和宽度变化重新测量；高度回调不空转',async()=>{
  const f=fixture(),node={style:{},clientWidth:200,scrollHeight:40,offsetHeight:44,clientHeight:40,focus(){this.focused=true;}};
  f.render().props.ref.value=node;f.mounts[0]();await settle();assert.equal(node.focused,true);assert.equal(node.style.height,'44px');
  node.scrollHeight=80;f.watches[0]();await settle();assert.equal(node.style.height,'84px');
  node.scrollHeight=120;f.observers[0].callback();await settle();assert.equal(node.style.height,'84px','只有高度变化时不重复写入');
  node.clientWidth=100;f.observers[0].callback();await settle();assert.equal(node.style.height,'124px');
});
test('卸载断开观察者，未结算的尺寸更新不再写 DOM',async()=>{
  const f=fixture(),node={style:{},clientWidth:100,scrollHeight:50,offsetHeight:54,clientHeight:50,focus(){}};
  f.render().props.ref.value=node;f.mounts[0]();f.unmounts[0]();await settle();assert.equal(f.observers[0].disconnected,true);assert.equal(node.style.height,undefined);
  node.clientWidth=80;f.observers[0].callback();await settle();assert.equal(node.style.height,undefined);
});
