import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../renderer/conversation-scroll.js',import.meta.url),'utf8');
function fixture(anchors=[],bindingExtra={}){
 const callbacks=new Map(),events=new Map(),announced=[];let id=0;
 const node={scrollTop:0,scrollHeight:1000,clientHeight:200,dataset:{},children:[],parentElement:{style:{setProperty(){}}},querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({top:0}),addEventListener:(type,cb)=>events.set(type,cb),removeEventListener:type=>events.delete(type)};
 // 锚点的矩形随 scrollTop 变化，和真实视口一致：否则「跳到某条」会被读成一个与滚动无关的固定位置。
 const els=anchors.map(a=>({dataset:{msgId:a.id},getBoundingClientRect:()=>({top:a.top-node.scrollTop,bottom:a.top-node.scrollTop+(a.height||20)})}));
 node.querySelectorAll=sel=>sel==='[data-msg-id]'?els:[];
 const observed=new Set();let resizeCallback,mutationCallback,resizeDisconnected=false,mutationDisconnected=false;
 const root={};vm.runInNewContext(source,{window:root,requestAnimationFrame:cb=>{callbacks.set(++id,cb);return id},cancelAnimationFrame:n=>callbacks.delete(n),ResizeObserver:class{
   constructor(cb){resizeCallback=cb;}observe(child){observed.add(child);}unobserve(child){observed.delete(child);}disconnect(){resizeDisconnected=true;observed.clear();}
 },MutationObserver:class{
   constructor(cb){mutationCallback=cb;}observe(){}disconnect(){mutationDisconnected=true;}
 }});
 const owner=root.SaCodeConversationScroll.attach(node,{session:'test',lastUser:'u1',onAnchor:id=>announced.push(id),...bindingExtra});
 const flush=()=>{for(const [key,cb] of [...callbacks]){callbacks.delete(key);cb();}};
 flush();return {node,api:root.SaCodeConversationScroll,owner,events,flush,announced,observed,resize:()=>resizeCallback?.(),mutate:()=>mutationCallback?.(),pending:()=>callbacks.size,disconnected:()=>resizeDisconnected && mutationDisconnected};
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

// ── 历史对话侧栏需要的两个能力：按锚点跳转 + 播报当前锚点 ──
// 定位仍由这一个宿主管：侧栏不许自己改 scrollTop，否则阅读位置会出现第二个所有者。
test('按锚点跳转把该条钉到视口顶部、释放尾部跟随并播报锚点',()=>{
 const f=fixture([{id:'m1',top:0},{id:'m2',top:400},{id:'m3',top:800}]);
 const before=f.announced.length;
 assert.equal(f.api.jumpTo(f.node,'m2'),true);
 assert.equal(f.node.scrollTop,400);
 assert.equal(f.node.dataset.followingTail,'false');
 assert.equal(f.announced.slice(before).at(-1),'m2');
 f.owner.dispose();
});

test('跳转只认投影里真实存在的锚点，未知 id 不动位置也不解除跟随',()=>{
 const f=fixture([{id:'m1',top:0}]);
 assert.equal(f.node.dataset.followingTail,'true');
 assert.equal(f.api.jumpTo(f.node,'m-不存在'),false);
 assert.equal(f.node.scrollTop,800);
 assert.equal(f.node.dataset.followingTail,'true');
 f.owner.dispose();
});

test('回到最新消息把活动锚点交还成空值，侧栏据此回落到最后一轮',()=>{
 const f=fixture([{id:'m1',top:0},{id:'m2',top:400}]);
 f.api.jumpTo(f.node,'m1');
 const before=f.announced.length;
 f.owner.toBottom();
 assert.equal(f.node.dataset.followingTail,'true');
 assert.equal(f.announced.slice(before).at(-1),null);
 f.owner.dispose();
});

test('同一阅读位置重复调度不重复播报锚点',()=>{
 const f=fixture([{id:'m1',top:0},{id:'m2',top:400}]);
 f.api.jumpTo(f.node,'m2');
 const before=f.announced.length;
 f.flush();f.resize();f.flush();f.owner.update({session:'test',lastUser:'u1'});f.flush();
 assert.equal(f.announced.length,before);
 f.owner.dispose();
});
