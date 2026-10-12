import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/product-management.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
function fixture(readRecent){
 const mounted=[],unmount=[];
 const vue={defineComponent:x=>x,h:(type,props,children)=>({type,props,children}),ref:value=>({value}),computed:spec=>({get value(){return typeof spec==='function'?spec():spec.get();},set value(v){spec.set(v);}}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmount.push(fn)};
 const ctx={module:{exports:{}},require:()=>vue};vm.runInNewContext(bundle.outputFiles[0].text,ctx);
 const render=ctx.module.exports.ProductManagementPage.setup({page:'automation',draft:{},models:[],recent:[{id:'old',directory:'D:/old',available:true}],readRecent},{emit(){}});
 const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.children)]:[];
 nodes(render()).find(n=>n.type==='button'&&n.children==='创建自动化').props.onClick();
 return{render,nodes,mounted,unmount,select:()=>nodes(render()).find(n=>n.props?.['aria-label']==='最近项目')};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('最近项目读取异常清除旧选项并展示读取失败',async()=>{
 const f=fixture(async()=>{throw Error('host-gone');});f.mounted[0]();await settle();
 assert.equal(f.select().children.length,1);assert.ok(f.nodes(f.render()).some(n=>n.children==='无法读取最近项目；可以填写目录路径。'));
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
