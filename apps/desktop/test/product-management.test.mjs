import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/product-management.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
function fixture(readRecent, page='automation'){
 const mounted=[],unmount=[];
 const vue={defineComponent:x=>x,h:(type,props,children)=>({type,props,children}),ref:value=>({value}),computed:spec=>({get value(){return typeof spec==='function'?spec():spec.get();},set value(v){spec.set(v);}}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmount.push(fn)};
 const ctx={module:{exports:{}},require:()=>vue};vm.runInNewContext(bundle.outputFiles[0].text,ctx);
 const render=ctx.module.exports.ProductManagementPage.setup({page,draft:{},models:[],recent:[{id:'old',directory:'D:/old',available:true}],readRecent},{emit(){}});
 const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.children)]:[];
 nodes(render()).find(n=>n.type==='button'&&n.children===({automation:'创建自动化',knowledge:'添加文档',connections:'添加连接'}[page])).props.onClick();
 return{render,nodes,mounted,unmount,select:()=>nodes(render()).find(n=>n.props?.['aria-label']==='最近项目')};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('最近项目读取异常清除旧选项并展示读取失败',async()=>{
 const f=fixture(async()=>{throw Error('host-gone');});f.mounted[0]();await settle();
 assert.equal(f.select().children.length,1);assert.ok(f.nodes(f.render()).some(n=>n.children==='无法读取最近项目；可以填写目录路径。'));
});

test('未接管理服务时三页明确受阻，不把已有清单冒充为空或开放保存',()=>{
 for(const page of ['knowledge','automation','connections']){
  const f=fixture(undefined,page),nodes=f.nodes(f.render());
  assert.ok(nodes.some(n=>n.children==='当前版本未提供管理接口，无法读取已有内容。这里不表示清单为空。'));
  assert.equal(nodes.find(n=>n.type==='button'&&n.children==='保存').props.disabled,true);
  assert.equal(nodes.find(n=>n.type==='input'&&n.props.type==='search').props.disabled,true);
  if(page==='connections') assert.equal(nodes.find(n=>n.type==='button'&&n.children==='测试连接').props.disabled,true);
 }
});
test('非法最近项目回执不被当作可选目录',async()=>{
 const f=fixture(async()=>({entries:[{id:'x',directory:42,available:true}]}));f.mounted[0]();await settle();assert.equal(f.select().children.length,1);
});
test('不可用目录保留说明且禁止选择',async()=>{
 const f=fixture(async()=>({entries:[{id:'x',directory:'D:/missing',available:false}]}));f.mounted[0]();await settle();
 assert.equal(f.select().children[1].props.disabled,true);assert.equal(f.select().children[1].children,'D:/missing（目录不可用）');
});
test('管理页卸载后迟到目录响应不更新原页面',async()=>{
 let reply;const f=fixture(()=>new Promise(resolve=>reply=resolve));f.mounted[0]();f.unmount[0]();reply({entries:[{id:'late',directory:'D:/late',available:true}]});await settle();
 assert.equal(f.select().children[1].props.value,'D:/old');
});
