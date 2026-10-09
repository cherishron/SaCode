import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/composer-menu.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
function fixture(listFiles){
  const unmounts=[],emitted=[];
  const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),nextTick:fn=>Promise.resolve().then(fn),onMounted:()=>{},onBeforeUnmount:fn=>unmounts.push(fn)};
  const ctx={module:{exports:{}},require:()=>vue,innerWidth:1384,innerHeight:764,document:{removeEventListener(){}},window:{removeEventListener(){}}};
  vm.runInNewContext(compiled.outputFiles[0].text,ctx);
  const render=ctx.module.exports.AddButton.setup({workspaceConfigured:true,goalAvailable:true,listFiles},{emit:(...args)=>emitted.push(args)});
  return{render,emitted,unmounts};
}
function flatten(tree){if(Array.isArray(tree))return tree.flatMap(flatten);if(!tree||typeof tree!=='object')return[];return[tree,...(Array.isArray(tree.children)?tree.children.flatMap(flatten):[])];}
const find=(f,label)=>flatten(f.render()).find(n=>n.type==='button'&&JSON.stringify(n.children).includes(label));
const open=async f=>{await f.render().children[0].props.onClick();find(f,'工作区文件').props.onClick();};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
test('关闭后迟到目录结果不覆盖重新打开的文件选择',async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const f=fixture(()=>++calls===1?first.promise:second.promise);
  await open(f);
  f.render().props.onKeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  await open(f);second.resolve({files:[{name:'current.cj',isDir:false}]});await tick();
  first.resolve({files:[{name:'late.cj',isDir:false}]});await tick();
  assert.ok(find(f,'current.cj'));assert.equal(find(f,'late.cj'),undefined);
});
test('文件引用只发路径，不上传或自动发送；目录点击只读取对应路径',async()=>{
  const paths=[],f=fixture(async path=>{paths.push(path);return{files:path?[{name:'agent.cj',isDir:false}]:[{name:'core',isDir:true}]};});
  await open(f);await tick();find(f,'core').props.onClick();await tick();
  find(f,'agent.cj').props.onClick();
  assert.deepEqual(paths,['','core']);
  assert.equal(f.emitted.length,1);assert.equal(f.emitted[0][0],'reference');assert.equal(f.emitted[0][1],'core/agent.cj');
  assert.equal(flatten(f.render()).some(n=>n.props?.class==='composer-menu-popover'),false);
});
test('卸载后目录回执不改变清单',async()=>{
  const read=deferred(),f=fixture(()=>read.promise);await open(f);f.unmounts[0]();
  read.resolve({files:[{name:'after-unmount.cj',isDir:false}]});await tick();assert.equal(find(f,'after-unmount.cj'),undefined);
});
