import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function load(name) {
  const context=vm.createContext({setTimeout,clearTimeout});
  vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  return context;
}

function clearFixture(clear = async () => {}) {
  const source=readFileSync(new URL('../../renderer/app.js',import.meta.url),'utf8');
  const start=source.indexOf('    async function clearConversation() {');
  const end=source.indexOf('\n    // 代码审查',start);
  assert.ok(start>=0&&end>start);
  const ref=value=>({value});
  const context=vm.createContext({window:{sacode:{sessionClear:clear}},turn:ref({running:false}),sendBusy:ref(false),
    clearBusy:ref(false),clearNotice:ref(null),error:ref(''),sessionGeneration:1,scrollSession:ref('s1'),catalogBusy:ref(false),
    reviewBusy:ref(true),reviewNotice:ref({text:'旧审查'}),reviewCards:ref([{id:'old'}]),resets:0,refreshes:0,cancelled:0,
    turnState:{reset(){context.resets++;}},refresh:async()=>{context.refreshes++;},
    cancelReview(){context.cancelled++;context.reviewBusy.value=false;}});
  vm.runInContext(source.slice(start,end)+'\nglobalThis.clearConversation=clearConversation;',context);
  return context;
}

test('清空成功后清除审查卡并显示成功，不把本地清理异常误报为宿主失败',async()=>{
  const context=clearFixture();
  await context.clearConversation();
  assert.equal(context.clearNotice.value.text,'对话已清空，会话标题与设置保留');
  assert.equal(context.reviewCards.value.length,0);
  assert.equal(context.reviewNotice.value,null);
  assert.equal(context.reviewBusy.value,false);
  assert.equal(context.resets,1);
  assert.equal(context.refreshes,1);
  assert.equal(context.clearBusy.value,false);
});

test('宿主拒绝清空时保留审查结果与轮次状态',async()=>{
  const context=clearFixture(async()=>{throw Error('clear-rejected');});
  await context.clearConversation();
  assert.match(context.clearNotice.value.text,/清空失败/);
  assert.equal(context.reviewCards.value.length,1);
  assert.equal(context.resets,0);
  assert.equal(context.cancelled,0);
  assert.equal(context.clearBusy.value,false);
});

test('轮次重置移除旧正文、工具增量、待答和队列身份，重新开始不继承旧轮',()=>{
  const context=load('turn-poll-state.js');
  assert.equal(typeof context.SaCodeTurnPoll.createTurnState,'function');
  const turn={value:{text:'旧正文',questionId:'old',toolCallDeltas:['old'],goalInFlight:true,pendingTurnCount:3}};
  const state=context.SaCodeTurnPoll.createTurnState(turn);
  state.reset();
  assert.equal(turn.value.running,false);
  assert.equal(turn.value.text,'');
  assert.equal(turn.value.questionId,undefined);
  assert.equal(turn.value.toolCallDeltas,undefined);
  assert.equal(turn.value.goalInFlight,false);
  assert.equal(turn.value.pendingTurnCount,0);
  state.start();
  state.appendText('新正文');
  state.settle({finishReason:'stop',delivered:2});
  assert.equal(turn.value.text,'新正文');
  assert.equal(turn.value.settled,true);
  assert.equal(turn.value.projectionPending,true);
  state.projectionReady();
  assert.equal(turn.value.projectionPending,false);
});

test('切换会话通过执行状态所有者清理轮次与队列，选择失败不清理草稿',async()=>{
  const context=load('turn-poll-state.js');
  for(const name of ['send-queue-state.js','session-state.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const ref=value=>({value});
  const turn=ref({running:false,text:'旧半截',questionId:'old',goalInFlight:true}),approval=ref(null),queuePending=ref([{requestId:'old'}]);
  let stopped=0,selectionFails=true;
  const execution=context.SaCodeSendQueue.createSendQueueAssembly({turn,approval,queuePending,stopPolling:()=>stopped++,modelApprovalsSuppressed:ref(true),modelTurnRequestId:ref('old')});
  const draft=ref('旧草稿'),selectedScrollId=ref('s1');
  const deps={api:{sessionSelect:async()=>{if(selectionFails)throw Error('selection-rejected');},sessionCatalog:async()=>({entries:[]})},
    catalog:ref({entries:[]}),turn,approval,draft,selectedScrollId,scrollSession:ref('s1'),sessionDrafts:new Map(),
    sendBusy:ref(false),budgetBusy:ref(false),appearanceBusy:ref(false),workspaceBusy:ref(false),
    fileEditor:{state:{},dirty:()=>false,reset(){}},incrementSessionGeneration(){},clearEnhance(){},clearAttachments(){},
    resetExecution:execution.resetSession,resetModelSelection(){},foldOpen:{ids:new Set()},error:ref(''),previewFloating:ref(true),detailName:ref('tool'),
    budgetDraft:ref(''),budgetNote:ref(''),appearanceNote:ref(''),catalogNote:ref(''),catalogOpen:ref(true),workspaceNote:ref(''),
    refresh:async()=>{},refreshTools:async()=>{},refreshUsage:async()=>{},refreshWorkspace:async()=>{},refreshWorkspaceFiles:async()=>{},refreshQueue:async()=>{},
    resetWorktreePanel(){},worktreeController:{restore:async()=>{}},refreshGlobalAppearance:async()=>{},focusComposer(){},
  };
  const sessions=context.SaCodeSessionState.createSessionAssembly(deps);
  await assert.rejects(sessions.applySelection('s2'),/selection-rejected/);
  assert.equal(stopped,0);assert.equal(draft.value,'旧草稿');
  selectionFails=false;await sessions.applySelection('s2');
  assert.equal(stopped,1);assert.equal(turn.value.text,'');assert.equal(turn.value.questionId,undefined);
  assert.equal(queuePending.value.length,0);assert.equal(deps.sessionDrafts.get('s1'),'旧草稿');assert.equal(selectedScrollId.value,'s2');
});

test('模型协调保持适配器不变，写入失败仍通知目录失效，默认选择清除自定义选择',async()=>{
  const context=load('model-directory-state.js');
  assert.equal(typeof context.SaCodeModelDirectory.createModelSelection,'function');
  const ref=value=>({value});
  let loads=0;
  const directory={load:async()=>{loads++;},select:async()=>{},getSnapshot:()=>({}),subscribe:()=>()=>{}};
  const customModels=ref([]),selectedCustomModel=ref('custom');
  const provider={save:async()=>{throw Error('partial-save');},describe:async()=>({})};
  const adapters={'provider-settings':provider,'custom-models':{upsert:async()=>{}}};
  const original=provider.save;
  const selection=context.SaCodeModelDirectory.createModelSelection({api:{customsDescribe:async()=>({models:[{id:'custom',enabled:true}]})},directory,customModels,selectedCustomModel});
  const bound=selection.bindAdapters(adapters);
  assert.equal(provider.save,original);
  assert.notEqual(bound['provider-settings'],provider);
  await assert.rejects(bound['provider-settings'].save(),/partial-save/);
  assert.equal(loads,1);
  await selection.composerDirectory.select({provider:'p',model:'m'});
  assert.equal(selectedCustomModel.value,'');
  selectedCustomModel.value='custom';
  selection.resetSession();
  assert.equal(selectedCustomModel.value,'');
});

test('并发自定义模型读取只接纳最新目录，重置会话后不接纳旧回执',async()=>{
  const context=load('model-directory-state.js');
  assert.equal(typeof context.SaCodeModelDirectory.createModelSelection,'function');
  const pending=[];
  const customModels={value:[]},selectedCustomModel={value:'new'};
  const selection=context.SaCodeModelDirectory.createModelSelection({api:{customsDescribe:()=>new Promise(resolve=>pending.push(resolve))},directory:{},customModels,selectedCustomModel});
  const first=selection.loadCustomModels(),second=selection.loadCustomModels();
  pending[1]({models:[{id:'new',enabled:true}]});await second;
  pending[0]({models:[{id:'old',enabled:true}]});await first;
  assert.equal(customModels.value[0].id,'new');
  assert.equal(selectedCustomModel.value,'new');
  const late=selection.loadCustomModels();selection.resetSession();
  pending[2]({models:[{id:'old',enabled:true}]});await late;
  assert.equal(customModels.value[0].id,'new');
  assert.equal(selectedCustomModel.value,'');
});
