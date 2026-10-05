import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const result=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/slot-core.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const context={module:{exports:{}},queueMicrotask,AggregateError};
vm.runInNewContext(result.outputFiles[0].text,context);
const {SlotCore,ClientScope}=context.module.exports;
const spec=kind=>({kind,scope:'session'});
function fixture(kind='list') {
  const core=new SlotCore(),parent=new ClientScope('parent',core);
  const root=parent.register({name:'root',children:{view:spec(kind)}},()=>null);
  return{core,parent,root};
}
const tick=()=>new Promise(queueMicrotask);

test('未声明贡献与同一优先级冲突拒绝，不留半张子槽位表',()=>{
  const {core}=fixture();
  assert.throws(()=>core.register({name:'missing'},()=>null,'bad'),/undeclared/);
  core.register({name:'view',id:'chat',children:{owned:spec('single')}},()=>null,'chat');
  assert.throws(()=>core.register({name:'view',id:'other',children:{orphan:spec('list'),owned:spec('single')}},()=>null,'bad'),/declaration-conflict/);
  assert.equal(core.declaration('orphan').spec,undefined);
  assert.throws(()=>core.register({name:'view',id:'chat'},()=>null,'duplicate'),/occupancy-conflict/);
  assert.equal(core.entries('view').length,1);
});

test('列表按单元优先级遮蔽并按 order 展示，卸载覆盖层恢复原插件',()=>{
  const {core,root}=fixture();
  const original=core.register({name:'view',id:'chat',order:0},'original','chat');
  core.register({name:'view',id:'trajectory',order:10},'trajectory','trajectory');
  const override=core.register({name:'view',id:'chat',priority:-1,order:20},'override','override');
  assert.equal(core.entries('view').length,3);
  assert.deepEqual(Array.from(core.dispatch(root.entry,'view',{}),x=>x.entry.component),['trajectory','override']);
  override.dispose();
  assert.equal(core.dispatch(root.entry,'view',{}, {only:'chat'})[0].entry,original.entry);
});

test('single 与 keyed 按优先级选中，chain 只把首个非 null 匹配交给组件',()=>{
  for(const kind of ['single','keyed']){
    const {core,root}=fixture(kind);
    const options={name:'view',...(kind==='keyed'?{key:'x'}:{})};
    core.register(options,'base','base');
    const override=core.register({...options,priority:-2},'override','override');
    assert.equal(core.dispatch(root.entry,'view',{}, {entryKey:'x'})[0].entry.component,'override');
    override.dispose();
    assert.equal(core.dispatch(root.entry,'view',{}, {entryKey:'x'})[0].entry.component,'base');
  }
  const {core,root}=fixture('chain');let seen=[];
  assert.throws(()=>core.register({name:'view'},'bad','bad'),/needs-select/);
  core.register({name:'view',priority:-1,select:()=>{seen.push('decline');return null;}},'first','first');
  core.register({name:'view',select:owner=>{seen.push('accept');return owner.answer;}},'second','second');
  core.register({name:'view',select:()=>{seen.push('late');return true;}},'third','third');
  const elected=core.dispatch(root.entry,'view',{answer:{status:'accepted'}});
  assert.deepEqual(seen,['decline','accept']);
  assert.equal(elected[0].matched.status,'accepted');
});

test('父注册递归撤销孙辈，旧授权与旧 disposer 不能影响重装',()=>{
  const {core,root}=fixture();
  const child=core.register({name:'view',id:'chat',children:{nested:spec('single')}},'chat','chat');
  const grandchild=core.register({name:'nested'},'nested','nested');
  const firstEpoch=core.declaration('view').epoch;
  root.dispose();
  assert.equal(core.entries('view').length,0);assert.equal(core.entries('nested').length,0);
  assert.throws(()=>core.dispatch(root.entry,'view',{}),/stale/);
  const next=core.register({name:'root',children:{view:spec('list')}},'new-root','new-root');
  core.register({name:'view',id:'chat'},'new-chat','new-chat');
  child.dispose();grandchild.dispose();root.dispose();
  assert.equal(core.dispatch(next.entry,'view',{})[0].entry.component,'new-chat');
  assert.ok(core.declaration('view').epoch>firstEpoch);
});

test('仅父声明者可渲染子槽，外部贡献不能凭名字取得权限',()=>{
  const {core,root}=fixture();
  const stranger=core.register({name:'view',id:'stranger'},'stranger','stranger');
  assert.throws(()=>core.dispatch(stranger.entry,'view',{}),/ownership/);
  assert.throws(()=>core.dispatch(null,'view',{}),/ownership/);
  assert.equal(core.dispatch(root.entry,'view',{})[0].entry,stranger.entry);
});

test('entries 和声明快照稳定，逐次 mutation 同步而订阅按微任务合并',async()=>{
  const {core}=fixture();await tick();let observed=0,mutations=0;
  const decl=core.declaration('view'),before=core.entries('view');
  const stop=core.subscribe('view',()=>observed++),stopMutation=core.subscribeMutations(()=>mutations++);
  core.register({name:'view',id:'a'},'a','a');core.register({name:'view',id:'b'},'b','b');
  assert.equal(observed,0);assert.equal(mutations,2);
  assert.notEqual(core.entries('view'),before);assert.equal(core.entries('view'),core.entries('view'));
  assert.equal(core.declaration('view'),decl);
  await tick();assert.equal(observed,1);stop();stopMutation();
  core.register({name:'view',id:'c'},'c','c');await tick();assert.equal(observed,1);
});

test('插件失败回滚注册和订阅，清理抛错不阻止其他资源回收',async()=>{
  const {core}=fixture();const scope=new ClientScope('broken',core);let seen=0,cleaned=0;
  assert.throws(()=>scope.apply(ctx=>{
    ctx.slots.register({name:'view',id:'broken'},'broken');
    ctx.slots.subscribe('view',()=>seen++);
    ctx.effect(()=>()=>{cleaned++;throw Error('cleanup');});
    throw Error('setup');
  }),/cleanup-failed/);
  assert.equal(cleaned,1);assert.equal(core.entries('view').length,0);
  core.register({name:'view',id:'ok'},'ok','ok');await tick();assert.equal(seen,0);
  assert.throws(()=>scope.register({name:'view',id:'late'},'late'),/disposed/);
});

test('槽声明卸载与重装自动撤销并重新激活注入贡献',()=>{
  const core=new SlotCore(),plugin=new ClientScope('chat',core);let setups=0,cleanups=0;
  plugin.slots.inject('view',child=>{
    setups++;child.slots.register({name:'view',id:'chat'},'chat');child.effect(()=>()=>cleanups++);
  });
  assert.equal(setups,0);
  const first=core.register({name:'root',children:{view:spec('list')}},'owner','owner');
  assert.equal(setups,1);assert.equal(core.entries('view').length,1);
  first.dispose();assert.equal(cleanups,1);assert.equal(core.entries('view').length,0);
  core.register({name:'root',children:{view:spec('list')}},'owner-again','owner');
  assert.equal(setups,2);assert.equal(core.entries('view').length,1);
  plugin.dispose();assert.equal(cleanups,2);assert.equal(core.entries('view').length,0);
});

test('注入初始化失败连同父声明回滚，不遗留无法取得 disposer 的注册',()=>{
  const core=new SlotCore(),plugin=new ClientScope('broken',core);
  plugin.inject('view',child=>{child.register({name:'view',id:'broken'},'broken');throw Error('injected-setup');});
  assert.throws(()=>core.register({name:'root',children:{view:spec('list')}},'owner','owner'),/injected-setup/);
  assert.equal(core.entries('root').length,0);assert.equal(core.declaration('view').spec,undefined);
  assert.equal(core.entries('view').length,0);plugin.dispose();
});

test('同步装配显式拒绝异步初始化，迟到注册不能在已回滚作用域复活',async()=>{
  const {core}=fixture(),scope=new ClientScope('async',core);let late;
  assert.throws(()=>scope.apply(async ctx=>{
    ctx.slots.register({name:'view',id:'before'},'before');
    await Promise.resolve();
    try { ctx.slots.register({name:'view',id:'after'},'after'); } catch(error) { late=error.message; }
  }),/async-unsupported/);
  await tick();assert.match(late,/disposed/);assert.equal(core.entries('view').length,0);
  assert.throws(()=>core.entries('root').push({}),/extensible|read only|frozen|Cannot/);
});
