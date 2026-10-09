import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),vue=require('vue');
const read=name=>readFileSync(new URL('../renderer/'+name,import.meta.url),'utf8');
const source=read('app.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({members:[],tasks:[],messages:[]});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
// 直接执行 app 的团队装配段；仅替换 IPC、计时器和既有会话导航，不复制生产逻辑。
function entry(api={}){
  const begin=source.indexOf('    const teamSessionId = ref('),end=source.indexOf('    // 通用设置的三个持久化偏好',begin);
  assert.ok(begin>=0&&end>begin,'app 尚未装配团队状态与事件');
  const timers=new Map(),cleanup=[],calls=[];
  const context={ref:vue.ref,window:{Vue:{...vue,onBeforeUnmount:fn=>cleanup.push(fn)},sacode:{teamDescribe:async()=>empty(),...api}},sideOpen:vue.ref(false),sideTab:vue.ref('inspect'),pluginManagerOpen:vue.ref(false),scrollSession:vue.ref('lead'),catalog:vue.ref({entries:[{id:'lead',current:true}]}),selectedScrollId:'lead',selectSession:async id=>{calls.push(['sessionSelect',id]);context.scrollSession.value=id;context.selectedScrollId=id;},setInterval:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)};
  const scope=vue.effectScope();let state;
  scope.run(()=>{state=vm.runInNewContext(source.slice(begin,end)+'\n({teamSessionId,teamSnapshot,teamBusy,teamError,refreshTeam,addTeamMember,sendTeamMessage,createTeamTask,assignTeamTask,stopTeamMember,selectTeamSession})',context);});
  return{...state,context,timers,calls,async open(){context.sideOpen.value=true;context.sideTab.value='agents';await vue.nextTick();await this.flush();},async flush(){for(let i=0;i<8;i++)await Promise.resolve();},dispose(){cleanup.forEach(fn=>fn());scope.stop();}};
}
test('团队资源可选且客户端槽位实际导出 TeamPanel',async()=>{
  const code=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/client-slots.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue'],logLevel:'silent'});
  const module={exports:{}};vm.runInNewContext(code.outputFiles[0].text,{module,exports:module.exports,require});
  assert.equal(module.exports.TeamPanel?.name,'SaCodeTeamPanel');
  const tabs=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/workbench-tabs.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue'],logLevel:'silent'});
  const m={exports:{}};vm.runInNewContext(tabs.outputFiles[0].text,{module:m,exports:m.exports,require});
  const resource=m.exports.resources.find(r=>r.id==='agents');assert.equal(resource.label,'智能体团队');assert.equal(resource.available,true);
});
test('右侧资源页实际 h TeamPanel 并绑定全部事件',()=>{
  const begin=source.indexOf('    const teamPage='),end=source.indexOf('\n',begin);assert.ok(begin>=0,'缺团队资源页');
  const self={sideTab:'agents',teamSnapshot:empty(),teamBusy:true,teamError:'真实错误'};
  for(const name of ['addTeamMember','sendTeamMessage','createTeamTask','assignTeamTask','stopTeamMember','selectTeamSession','refreshTeam'])self[name]=()=>name;
  const context={self,window:{SaCodeSlots:{TeamPanel:{name:'TeamPanel'}}},h:(type,props)=>({type,props}),el:(type,cls,children,props)=>({type,cls,children,props})};
  const page=vm.runInNewContext(source.slice(begin,end)+'\nteamPage',context);const panel=page.children[0];
  assert.equal(page.props.id,'side-page-agents');assert.equal(page.props.hidden,false);assert.equal(panel.type,context.window.SaCodeSlots.TeamPanel);
  assert.equal(panel.props.snapshot,self.teamSnapshot);assert.equal(panel.props.busy,true);assert.equal(panel.props.error,'真实错误');
  for(const [event,method] of Object.entries({AddMember:'addTeamMember',SendMessage:'sendTeamMessage',CreateTask:'createTeamTask',AssignTask:'assignTeamTask',StopMember:'stopTeamMember',SelectSession:'selectTeamSession',Refresh:'refreshTeam'}))assert.equal(panel.props['on'+event],self[method]);
  assert.match(source,/side-primary[^\n]*teamPage/);
});
test('打开后从 teamDescribe 读取权威快照并开启周期刷新',async()=>{
  const calls=[],snapshot={...empty(),members:[{id:'a',sessionId:'member'}]};const f=entry({teamDescribe:async id=>{calls.push(id);return snapshot;}});
  await f.open();assert.equal(f.teamSessionId.value,'lead');assert.equal(vue.toRaw(f.teamSnapshot.value),snapshot);assert.deepEqual(calls,['lead']);assert.equal(f.timers.size,1);
  await [...f.timers.values()][0]();assert.deepEqual(calls,['lead','lead']);f.dispose();
});
test('写请求完成前 busy 且不乐观修改，回执之后再刷新',async()=>{
  const write=deferred(),calls=[],after={...empty(),members:[{id:'new'}]};let snapshot=empty();
  const f=entry({teamDescribe:async id=>{calls.push(['describe',id]);return snapshot;},teamMemberCreate:async(...args)=>{calls.push(['create',...args]);await write.promise;snapshot=after;return{members:['伪回执']};}});await f.open();
  const before=f.teamSnapshot.value,pending=f.addTeamMember({name:'new',role:'开发'});assert.equal(f.teamBusy.value,true);assert.equal(f.teamSnapshot.value,before);assert.equal(calls.length,2);
  await f.addTeamMember({name:'重复',role:'开发'});assert.equal(calls.length,2);write.resolve();await pending;
  assert.deepEqual(calls,[['describe','lead'],['create','lead','new','开发'],['describe','lead']]);assert.equal(vue.toRaw(f.teamSnapshot.value),after);assert.equal(f.teamBusy.value,false);f.dispose();
});
test('消息、任务、分派、停止精确使用团队身份与有限 preload 参数',async()=>{
  const calls=[],api={};for(const name of ['teamMessageSend','teamTaskCreate','teamTaskAssign','teamMemberStop'])api[name]=async(...args)=>calls.push([name,...args]);
  const f=entry(api);await f.open();await f.sendTeamMessage({target:'a',text:' 原文\n'});await f.createTeamTask({title:'任务',dependencies:['t0']});await f.assignTeamTask({taskId:'t1',memberId:'a'});await f.stopTeamMember('a');
  assert.deepEqual(plain(calls),[['teamMessageSend','lead','a',' 原文\n'],['teamTaskCreate','lead','任务',['t0']],['teamTaskAssign','lead','t1','a'],['teamMemberStop','lead','a']]);f.dispose();
});
test('成员会话导航保留团队归属，关闭重开亦不改成成员团队且不停止后台成员',async()=>{
  const calls=[];const f=entry({teamDescribe:async id=>{calls.push(id);return{...empty(),members:[{id:'a',sessionId:'member'}]};},teamMemberStop:async()=>assert.fail('导航或关闭不得停止成员')});
  await f.open();await f.selectTeamSession('member');await vue.nextTick();await f.flush();assert.deepEqual(f.calls,[['sessionSelect','member']]);assert.equal(f.teamSessionId.value,'lead');
  f.context.sideOpen.value=false;await vue.nextTick();assert.equal(f.timers.size,0);await f.open();await f.refreshTeam();assert.ok(calls.every(id=>id==='lead'));f.dispose();assert.equal(f.timers.size,0);
});
test('普通切换到其他会话更换团队归属并隔离旧 describe 迟到结果',async()=>{
  const old=deferred(),fresh={...empty(),members:[{id:'fresh'}]};const f=entry({teamDescribe:id=>id==='lead'?old.promise:Promise.resolve(fresh)});
  f.context.sideOpen.value=true;f.context.sideTab.value='agents';await vue.nextTick();assert.equal(f.teamBusy.value,true);
  f.context.scrollSession.value='other';f.context.selectedScrollId='other';await vue.nextTick();await f.flush();assert.equal(f.teamSessionId.value,'other');assert.equal(vue.toRaw(f.teamSnapshot.value),fresh);
  old.resolve({...empty(),members:[{id:'old'}]});await f.flush();assert.equal(vue.toRaw(f.teamSnapshot.value),fresh);assert.equal(f.teamBusy.value,false);f.dispose();
});
test('未知 Host 方法和畸形快照显示错误，首次失败不渲染空团队',async()=>{
  for(const result of ['unknown-method',null,{members:[]}]){const f=entry({teamDescribe:async()=>{if(typeof result==='string')throw Error(result);return result;}});await f.open();assert.ok(f.teamError.value);assert.equal(f.teamSnapshot.value,null);assert.equal(f.teamBusy.value,false);f.dispose();}
});
test('失败保留上次权威快照，写错误原样显示',async()=>{
  let fail=false;const f=entry({teamDescribe:async()=>{if(fail)throw Error('describe-failed');return empty();},teamTaskAssign:async()=>{throw Error('assign-failed');}});await f.open();const before=f.teamSnapshot.value;fail=true;await f.refreshTeam();assert.equal(f.teamSnapshot.value,before);assert.match(f.teamError.value,/describe-failed/);await f.assignTeamTask({taskId:'t',memberId:'a'});assert.match(f.teamError.value,/assign-failed/);assert.equal(f.teamBusy.value,false);f.dispose();
});
test('关闭或卸载后迟到结果不恢复状态，周期刷新不影响成员',async()=>{
  for(const action of ['close','dispose']){const pending=deferred();const f=entry({teamDescribe:()=>pending.promise});f.context.sideOpen.value=true;f.context.sideTab.value='agents';await vue.nextTick();if(action==='dispose')f.dispose();else{f.context.sideOpen.value=false;await vue.nextTick();}pending.resolve(empty());await f.flush();assert.equal(f.timers.size,0);assert.equal(f.teamSnapshot.value,null);assert.equal(f.teamBusy.value,false);if(action==='close')f.dispose();}
});
test('团队样式仅用现有 tokens 且 index 精确引用一次',()=>{
  const css=read('team.css');assert.doesNotMatch(css,/#(?:[\da-f]{3,8})\b|\brgba?\(|innerHTML/i);assert.match(css,/var\(--/);assert.equal((read('index.html').match(/href="team.css"/g)||[]).length,1);
  const all=read('styles.css')+read('frame.css')+read('product-design.css');for(const token of new Set(css.match(/--[\w-]+/g)))assert.ok(all.includes(token+':'),'未定义令牌 '+token);
});
