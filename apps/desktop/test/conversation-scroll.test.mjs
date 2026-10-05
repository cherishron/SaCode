import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../renderer/conversation-scroll.js',import.meta.url),'utf8');
function fixture(){
 const callbacks=new Map(),events=new Map();let id=0;
 const node={scrollTop:0,scrollHeight:1000,clientHeight:200,dataset:{},children:[],parentElement:{style:{setProperty(){}}},querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({top:0}),addEventListener:(type,cb)=>events.set(type,cb),removeEventListener:type=>events.delete(type)};
 const observed=new Set();let resizeCallback,mutationCallback,resizeDisconnected=false,mutationDisconnected=false;
 const root={};vm.runInNewContext(source,{window:root,requestAnimationFrame:cb=>{callbacks.set(++id,cb);return id},cancelAnimationFrame:n=>callbacks.delete(n),ResizeObserver:class{
   constructor(cb){resizeCallback=cb;}observe(child){observed.add(child);}unobserve(child){observed.delete(child);}disconnect(){resizeDisconnected=true;observed.clear();}
 },MutationObserver:class{
   constructor(cb){mutationCallback=cb;}observe(){}disconnect(){mutationDisconnected=true;}
 }});
 const owner=root.SaCodeConversationScroll.attach(node,{session:'test',lastUser:'u1'});
 const flush=()=>{for(const [key,cb] of [...callbacks]){callbacks.delete(key);cb();}};
 flush();return {node,owner,events,flush,observed,resize:()=>resizeCallback?.(),mutate:()=>mutationCallback?.(),pending:()=>callbacks.size,disconnected:()=>resizeDisconnected && mutationDisconnected};
}
test('布局定位待执行时，延迟自动滚动不应解除尾部跟随',()=>{
 const {node,owner,events,flush}=fixture();assert.equal(node.scrollTop,800);
 owner.update({session:'test',lastUser:'u2'});
 // 草稿收缩导致浏览器先夹紧位置，正文展开随后扩大底部；scroll 事件晚于布局变化到达。
 node.scrollTop=600;node.scrollHeight=1800;events.get('scroll')();
 flush();assert.equal(node.dataset.followingTail,'true');assert.equal(node.scrollTop,1600);
 owner.dispose();
});
test('用户滚轮撤销待执行定位，仍能上翻并保持阅读位置',()=>{
 const {node,owner,events,flush}=fixture();owner.update({session:'test',lastUser:'u1'});
 events.get('wheel')();node.scrollTop=100;events.get('scroll')();flush();
 assert.equal(node.dataset.followingTail,'false');assert.equal(node.scrollTop,100);owner.dispose();
});

test('插件延迟挂载消息容器后，容器增高仍跟随真实尾部',()=>{
 const f=fixture(),messages={};f.node.children=[messages];f.mutate();f.flush();
 assert.ok(f.observed.has(messages),'延迟挂载容器必须纳入尺寸观察');
 f.node.scrollHeight=1800;f.resize();f.flush();
 assert.equal(f.node.scrollTop,1600);assert.equal(f.node.dataset.followingTail,'true');f.owner.dispose();
});

test('插件容器替换清除旧观察，卸载后不再调度或保留资源',()=>{
 const f=fixture(),oldView={},newView={};f.node.children=[oldView];f.mutate();f.flush();
 assert.ok(f.observed.has(oldView));f.node.children=[newView];f.mutate();f.flush();
 assert.equal(f.observed.has(oldView),false);assert.ok(f.observed.has(newView));
 f.resize();assert.equal(f.pending(),1);f.owner.dispose();
 assert.equal(f.pending(),0);assert.ok(f.disconnected());
 f.mutate();f.resize();assert.equal(f.pending(),0);assert.equal(f.observed.size,0);
});
