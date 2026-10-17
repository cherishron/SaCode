import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/workbench-tabs.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
function fixture(){
  const events=[],unmounts=[],focus=[],scroll=[],watchers=[];
  const props={active:'files'};
  const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),watch:(source,callback)=>watchers.push(callback),nextTick:fn=>Promise.resolve().then(fn),onMounted:()=>{},onBeforeUnmount:fn=>unmounts.push(fn)};
  const ctx={module:{exports:{}},require:()=>vue,document:{removeEventListener(){}}};
  vm.runInNewContext(bundle.outputFiles[0].text,ctx);
  const render=ctx.module.exports.WorkbenchTabs.setup(props,{emit:(...event)=>events.push(event)});
  const buttons=[0,1,2].map(i=>({tagName:'BUTTON',focus:()=>focus.push(i)}));
  render().props.ref.value={querySelector:selector=>({focus:()=>focus.push(selector),closest:()=>({scrollIntoView:()=>scroll.push(selector)})}),querySelectorAll:()=>buttons};
  return{render,props,events,focus,scroll,watchers,buttons,unmounts};
}
test('资源选择方向键循环，Home/End 不抢搜索输入光标',()=>{
  const f=fixture();f.render().children[0].children[1].children[0].props.onClick();
  const picker=f.render().children[2];let prevented=0;
  const key=(key,target)=>picker.props.onKeydown({key,target,preventDefault:()=>prevented++});
  key('ArrowDown',{tagName:'INPUT'});assert.equal(f.focus.at(-1),0);
  key('ArrowUp',f.buttons[0]);assert.equal(f.focus.at(-1),2);
  key('Home',{tagName:'INPUT'});assert.equal(prevented,2);
  key('Home',f.buttons[2]);assert.equal(f.focus.at(-1),0);
});
test('关闭最后一个标签回到添加按钮，卸载后不执行迟到聚焦',async()=>{
  const f=fixture();
  f.render().children[1].children[1].children[1].props.onClick();
  await Promise.resolve();f.focus.length=0;
  f.render().children[1].children[0].children[1].props.onClick();
  await Promise.resolve();assert.equal(f.focus.at(-1),'#add-resource');
  assert.deepEqual(f.events.at(-1),['select','']);
  const g=fixture();g.render().children[1].children[0].children[1].props.onClick();
  g.unmounts[0]();await Promise.resolve();assert.equal(g.focus.length,0);
});

test('外部打开资源使活动标签可见但不抢焦点，卸载后不滚动',async()=>{
  const f=fixture();f.watchers[0]('agents');await Promise.resolve();
  assert.equal(f.scroll.at(-1),'#side-tab-agents');assert.equal(f.focus.length,0);
  f.scroll.length=0;f.watchers[0]('trace');f.unmounts[0]();await Promise.resolve();assert.equal(f.scroll.length,0);
});


test('资源菜单关闭或卸载后不执行迟到搜索聚焦',async()=>{
  const f=fixture();const add=f.render().children[0].children[1].children[0];
  add.props.onClick();add.props.onClick();await Promise.resolve();assert.equal(f.focus.length,0);
  const g=fixture();g.render().children[0].children[1].children[0].props.onClick();g.unmounts[0]();await Promise.resolve();assert.equal(g.focus.length,0);
});
test('Escape 关闭资源菜单后组件卸载不夺取焦点',async()=>{
  const f=fixture();f.render().children[0].children[1].children[0].props.onClick();await Promise.resolve();f.focus.length=0;
  f.render().props.onKeydown({key:'Escape',stopPropagation(){}});f.unmounts[0]();await Promise.resolve();assert.equal(f.focus.length,0);
});
