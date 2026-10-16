import {createExecutionTask} from './execution-task-state';
import {buildTestReport} from './build-test-report.mjs';

const phases=['awaiting-approval','admitted','starting','running','stopping','exited','unknown','cancelled-before-start'];

// 产物页只读取 Host 已持久化的执行事实；摘要从原提案、输出和退出事实重建。
// 每次读取绑定会话、执行身份和修订，避免迟到页覆盖当前选择。
export function createExecutionArtifacts(api:any,session:()=>string,changed:()=>void){
 const state={rows:[] as any[],cursor:-1,more:false,loaded:false,busy:'',error:'',selectedId:'',detail:null as any,report:null as any,stdout:'',stderr:'',capture:null as any};
 let listEpoch=0,detailEpoch=0,disposed=false;
 const notify=()=>{if(!disposed)changed();};
 function reset(){++listEpoch;++detailEpoch;Object.assign(state,{rows:[],cursor:-1,more:false,loaded:false,busy:'',error:'',selectedId:'',detail:null,report:null,stdout:'',stderr:'',capture:null});notify();}
 async function load(append=false){
  if(disposed||state.busy)return;
  const id=session();if(!id){state.error='没有选中的会话，无法读取执行产物。';notify();return;}
  if(append&&!state.more)return;
  const ticket=++listEpoch,cursor=append?state.cursor:-1;state.busy='list';state.error='';notify();
  try{
   if(typeof api?.executionList!=='function')throw Error('当前宿主未提供持久执行记录列表');
   const page=await api.executionList(id,cursor,16);
   if(disposed||ticket!==listEpoch||session()!==id)return;
   if(page?.version!==1||page.sessionId!==id||page.source!=='durable-history'||!Array.isArray(page.records)||page.records.length>16||
    !Number.isSafeInteger(page.nextCursor)||page.nextCursor!==cursor+page.records.length||typeof page.hasMore!=='boolean'||(page.hasMore&&!page.records.length))throw Error('产物列表身份或分页无效');
   const existing=append?state.rows:[],ids=new Set(existing.map(row=>row.executionId));
   for(const row of page.records){
    if(!row||row.sessionId!==id||typeof row.executionId!=='string'||!/^execution-[1-9][0-9]*$/.test(row.executionId)||ids.has(row.executionId)||
     !Number.isSafeInteger(row.revision)||row.revision<1||!phases.includes(row.phase)||typeof row.taskId!=='string'||!row.taskId||typeof row.requestId!=='string'||!row.requestId)throw Error('产物列表记录无效');
    ids.add(row.executionId);
   }
   state.rows=[...existing,...page.records];state.cursor=page.nextCursor;state.more=page.hasMore;state.loaded=true;
  }catch(error){if(!disposed&&ticket===listEpoch&&session()===id)state.error=String((error as Error).message||error);}
  finally{if(!disposed&&ticket===listEpoch&&session()===id){state.busy='';notify();}}
 }
 async function open(executionId:string){
  if(disposed||state.busy)return;
  const id=session(),row=state.rows.find(value=>value.executionId===executionId);
  if(!id||!row){state.error='执行记录已不在当前会话列表中，请刷新后重试。';notify();return;}
  const ticket=++detailEpoch;state.busy='detail';state.error='';state.selectedId=executionId;state.detail=null;state.report=null;state.stdout='';state.stderr='';state.capture=null;notify();
  let expected:any=null;
  const readerApi={
   executionPropose:(...args:any[])=>api.executionPropose(...args),
   executionAuthorize:(...args:any[])=>api.executionAuthorize(...args),
   executionStart:(...args:any[])=>api.executionStart(...args),
   executionStop:(...args:any[])=>api.executionStop(...args),
   approvalAsk:(...args:any[])=>api.approvalAsk(...args),
   approvalAnswer:(...args:any[])=>api.approvalAnswer(...args),
   workspaceGet:(...args:any[])=>api.workspaceGet(...args),
   executionDescribe:async(sessionId:string,id0:string)=>{const value=await api.executionDescribe(sessionId,id0);expected=value;return value;},
   executionOutput:async(sessionId:string,id0:string,cursor:number,limit:number)=>{
    const page=await api.executionOutput(sessionId,id0,cursor,limit);
    if(!expected||page?.revision!==expected.revision||page?.phase!==expected.phase)throw Error('执行任务在读取输出时发生变化，请重新读取。');
    return page;
   },
  };
  const reader=createExecutionTask(readerApi,()=>id,notify);
  const current=()=>!disposed&&ticket===detailEpoch&&session()===id;
  try{
   await reader.describe(executionId);
   if(reader.state.error)throw Error(reader.state.error);
   const task=reader.state.task;
   if(!task||task.sessionId!==id||task.executionId!==executionId||task.taskId!==row.taskId||task.requestId!==row.requestId||task.revision<row.revision)throw Error('执行产物与列表记录不匹配');
   let pages=0;
   while(pages<64){
    const before=reader.state.cursor;await reader.output();pages++;
    if(reader.state.error)throw Error(reader.state.error);
    if(!reader.state.more)break;
    if(reader.state.cursor<=before)throw Error('执行输出分页没有前进');
   }
   if(reader.state.more)throw Error('输出页数超过安全读取上限；请从任务记录查看分页输出。');
   const after=await api.executionDescribe(id,executionId);
   if(!after||after.sessionId!==id||after.executionId!==task.executionId||after.taskId!==task.taskId||after.requestId!==task.requestId||
    after.revision!==task.revision||after.phase!==task.phase||after.proposal!==task.proposal||after.proposalDigest!==task.proposalDigest||after.result!==task.result)throw Error('读取期间执行任务发生变化，请刷新后重试。');
   if(!current())return;
   state.detail=task;state.stdout=reader.state.stdout;state.stderr=reader.state.stderr;state.capture=reader.state.capture;
   state.report=buildTestReport(task,{stdout:state.stdout,stderr:state.stderr,capture:state.capture,more:reader.state.more});
  }catch(error){if(current())state.error=String((error as Error).message||error);}
  finally{reader.dispose();if(current()){state.busy='';notify();}}
 }
 return{state,load,open,reset,dispose(){disposed=true;++listEpoch;++detailEpoch;}};
}
