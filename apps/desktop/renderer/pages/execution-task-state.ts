export type ExecutionState={executionId:string;sessionId:string;taskId:string;requestId:string;proposal:string;proposalDigest:string;revision:number;phase:string;result:string;providerAvailable:boolean;providerReason:string;approvalArguments?:string;workspaceSnapshot?:string;review?:string};
export function executionWorkspaceSnapshot(task:ExecutionState){
 if(task.workspaceSnapshot===undefined||task.workspaceSnapshot==='')return null;
 if(typeof task.workspaceSnapshot!=='string'||task.workspaceSnapshot.length>1048576)throw Error('工作区快照格式无效');
 const value=JSON.parse(task.workspaceSnapshot),proposal=JSON.parse(task.proposal);
 const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 if(value.version!==1||value.executionId!==task.executionId||value.sessionId!==task.sessionId||value.taskId!==task.taskId||value.requestId!==task.requestId||value.proposalDigest!==task.proposalDigest||value.workspaceRevision!==proposal.workspaceRevision||typeof value.sourceDirectory!=='string'||!value.sourceDirectory||typeof value.executionDirectory!=='string'||(value.executionDirectory.toLowerCase()!==proposal.cwd.toLowerCase()&&(value.sourceDirectory.toLowerCase()!==proposal.cwd.toLowerCase()||typeof value.sourceIdentity!=='string'||!/^[a-f0-9]{48}$/.test(value.sourceIdentity)))||!digest(value.manifestDigest)||!Number.isSafeInteger(value.entryCount)||value.entryCount<0||value.entryCount>8192||!Number.isSafeInteger(value.byteCount)||value.byteCount<0||value.byteCount>67108864||!Array.isArray(value.excluded)||value.excluded.length>8192||value.excluded.some((p:any)=>typeof p!=='string'||!p||p.startsWith('/')||p.split('/').some((part:string)=>part==='..'||part==='')))throw Error('工作区快照身份或范围无效');
 if(value.toolBinding!==undefined){
  if(typeof value.toolBinding!=='string'||value.toolBinding.length>65536)throw Error('执行程序绑定无效');
  const tool=JSON.parse(value.toolBinding);
  if(!tool||Object.keys(tool).length!==4||tool.version!==1||tool.requested!==proposal.executable||typeof tool.executable!=='string'||!(/^[A-Za-z]:[\\/]/.test(tool.executable)||tool.executable.startsWith('\\\\'))||tool.executable.includes('\u0000')||!digest(tool.sha256))throw Error('执行程序绑定无效');
 }
 return value;
}
export function executionReview(task:ExecutionState){
 if(task.review===undefined||task.review==='')return null;
 if(typeof task.review!=='string'||task.review.length>16777216)throw Error('任务差异清单格式无效');
 const value=JSON.parse(task.review),snapshot=executionWorkspaceSnapshot(task);
 if(!snapshot||task.phase!=='exited'||value.version!==1||value.executionId!==task.executionId||value.sessionId!==task.sessionId||value.taskId!==task.taskId||value.requestId!==task.requestId||value.executionRevision!==task.revision||value.proposalDigest!==task.proposalDigest||value.manifestDigest!==snapshot.manifestDigest||value.sourceDirectory!==snapshot.sourceDirectory||(snapshot.sourceIdentity!==undefined&&value.sourceIdentity!==snapshot.sourceIdentity)||!Array.isArray(value.files)||value.files.length>8192)throw Error('任务差异清单身份无效');
 const paths=new Set();
 for(const row of value.files){
  if(!row||typeof row.path!=='string'||!row.path||row.path.includes('\\')||row.path.startsWith('/')||row.path.split('/').some((p:string)=>!p||p==='..'||p==='.')||paths.has(row.path)||!['added','modified','deleted'].includes(row.kind))throw Error('任务差异路径无效');
  paths.add(row.path);
  for(const side of ['before','after']){
   const missing=(side==='before'&&row.kind==='added')||(side==='after'&&row.kind==='deleted');
   if(missing?(row[side+'Digest']!==''||row[side+'Object']!==''):(!/^[a-f0-9]{64}$/.test(row[side+'Digest'])||row[side+'Object']!=='sha256:'+row[side+'Digest']))throw Error('任务差异对象无效');
  }
 }
 return value;
}
type Api={workspaceGet:()=>Promise<any>;executionPropose:Function;executionDescribe:Function;executionAuthorize:Function;executionStart:Function;executionStop:Function;executionOutput:Function;approvalAsk:Function;approvalAnswer:Function};
const phases=new Set(['awaiting-approval','admitted','starting','running','stopping','exited','unknown','cancelled-before-start']);
const providerReasons=new Set(['','platform-sandbox-unavailable','bubblewrap-required','unsafe-workspace','workspace-unavailable','sandbox-probe-failed']);
export function executionProviderNotice(reason:string):string{
 switch(reason){
  case'platform-sandbox-unavailable':return'当前平台尚未接入可验证的执行隔离后端；命令仍是提案，启动未开放。';
  case'bubblewrap-required':return'缺少 bubblewrap 隔离后端；命令仍是提案，启动未开放。';
  case'unsafe-workspace':return'当前工作区不符合隔离策略；命令仍是提案，启动未开放。';
  case'workspace-unavailable':return'当前工作区目录不可用；命令仍是提案，启动未开放。';
  default:return'隔离与监督探针尚未通过；命令仍是提案，启动未开放。';
 }
}
// 只持有投影和消费游标。标签销毁或会话切换不停止服务端任务。
export function createExecutionTask(api:Api,session:()=>string,changed:()=>void){
 const state={task:null as ExecutionState|null,workspace:null as any,busy:'',error:'',cursor:-1,more:false,stdout:'',stderr:'',capture:{stdout:{end:false,eof:false,truncated:false},stderr:{end:false,eof:false,truncated:false}}};
 let epoch=0,disposed=false;let sequence={stdout:0,stderr:0},bytes={stdout:0,stderr:0};let retained={stdout:new Uint8Array(),stderr:new Uint8Array()};
 function outputReset(){Object.assign(state,{cursor:-1,more:false,stdout:'',stderr:'',capture:{stdout:{end:false,eof:false,truncated:false},stderr:{end:false,eof:false,truncated:false}}});sequence={stdout:0,stderr:0};bytes={stdout:0,stderr:0};retained={stdout:new Uint8Array(),stderr:new Uint8Array()};}
 function reset(){++epoch;state.task=null;state.workspace=null;state.busy='';state.error='';outputReset();if(!disposed)changed();}
 function check(value:any,id:string,executionId?:string):ExecutionState{
  if(!value||value.sessionId!==id||(executionId&&value.executionId!==executionId)||!/^execution-\d+$/.test(value.executionId)||!Number.isSafeInteger(value.revision)||value.revision<1||!phases.has(value.phase)||typeof value.providerAvailable!=='boolean'||typeof value.proposal!=='string'||!/^[a-f0-9]{64}$/.test(value.proposalDigest)||typeof value.result!=='string')throw Error('任务响应身份或状态无效');
  const providerReason=value.providerReason===undefined?(value.providerAvailable?'':'sandbox-probe-failed'):value.providerReason;
  if(typeof providerReason!=='string'||!providerReasons.has(providerReason)||(value.providerAvailable!==(providerReason==='')))throw Error('任务响应隔离状态无效');
  if(state.task?.executionId===value.executionId&&(value.revision<state.task.revision||value.proposal!==state.task.proposal||value.proposalDigest!==state.task.proposalDigest))throw Error('任务修订倒退或提案改变');
  executionWorkspaceSnapshot(value);
  executionReview(value);
  if(state.task?.executionId===value.executionId&&state.task.workspaceSnapshot&&value.workspaceSnapshot!==state.task.workspaceSnapshot)throw Error('工作区快照绑定改变');
  if(state.task?.executionId===value.executionId&&state.task.review&&value.review!==state.task.review)throw Error('任务差异清单改变');
  return {...value,providerReason};
 }
 async function action(name:string,work:(id:string,current:()=>boolean)=>Promise<any>,apply:(value:any,id:string)=>void){
  if(disposed||state.busy)return;const ticket=++epoch,id=session();state.busy=name;state.error='';changed();const current=()=>!disposed&&ticket===epoch&&session()===id;
  try{const value=await work(id,current);if(current())apply(value,id);}catch(e){if(current())state.error=String((e as Error).message||e);}finally{if(current()){state.busy='';changed();}}
 }
 function workspace(){return action('workspace',()=>api.workspaceGet(),(value,id)=>{if(value.sessionId!==id||!value.available||!value.configured||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.directory!=='string')throw Error('尚未配置当前会话工作区');state.workspace=value;});}
 function propose(taskId:string,requestId:string,proposal:string){return action('propose',id=>api.executionPropose(id,taskId,requestId,proposal),(value,id)=>{state.task=check(value,id);outputReset();});}
 function describe(executionId:string){return action('describe',id=>api.executionDescribe(id,executionId),(value,id)=>{const next=check(value,id,executionId);if(state.task?.executionId!==executionId)outputReset();state.task=next;});}
 function approve(){const task=state.task;if(!task||!task.approvalArguments)return Promise.resolve();return action('authorize',async(id,current)=>{
  const ticket=await api.approvalAsk('execution/start',task.approvalArguments);if(!current())return;
  if(!Number.isSafeInteger(ticket.approvalId)||ticket.approvalId<1)throw Error('审批票身份无效');
  const answer=await api.approvalAnswer(ticket.approvalId,'allowed-once');if(!current())return;if(answer.accepted!==true)throw Error('审批票已失效');
  return api.executionAuthorize(id,task.executionId,task.revision,task.proposalDigest,ticket.approvalId);
 },(value,id)=>{state.task=check(value,id,task.executionId);});}
 function control(name:'start'|'stop'){const task=state.task;if(!task)return Promise.resolve();if(name==='start'&&!task.providerAvailable){state.error=executionProviderNotice(task.providerReason);changed();return Promise.resolve();}return action(name,id=>name==='start'?api.executionStart(id,task.executionId,task.revision):api.executionStop(id,task.executionId,task.revision),(value,id)=>{state.task=check(value,id,task.executionId);});}
 function output(){const task=state.task;if(!task)return Promise.resolve();const cursor=state.cursor;return action('output',id=>api.executionOutput(id,task.executionId,cursor,16),(page,id)=>{
  if(page.sessionId!==id||page.executionId!==task.executionId||!Array.isArray(page.records)||page.records.length>16||!Number.isSafeInteger(page.nextCursor)||page.nextCursor<cursor||typeof page.hasMore!=='boolean'||(page.hasMore&&page.nextCursor<=cursor))throw Error('输出身份或游标无效');
  let previous=cursor;const stagedSequence={...sequence},stagedBytes={...bytes},stagedRetained={...retained},stagedCapture={stdout:{...state.capture.stdout},stderr:{...state.capture.stderr}};
  const cap=JSON.parse(task.proposal).outputLimit;if(!Number.isSafeInteger(cap)||cap<1||cap>65536)throw Error('提案输出限额无效');
  for(const row of page.records){const ch=row.channel as 'stdout'|'stderr';if((ch!=='stdout'&&ch!=='stderr')||row.executionId!==task.executionId||row.sessionId!==id||row.version!==1||!Number.isSafeInteger(row.cursor)||row.cursor<=previous||row.cursor>page.nextCursor||row.streamSequence!==stagedSequence[ch]+1||stagedCapture[ch].end||!Number.isSafeInteger(row.byteCount)||row.byteCount<0||row.byteCount>512||typeof row.endOfCapture!=='boolean'||typeof row.eof!=='boolean'||typeof row.truncated!=='boolean')throw Error('输出记录不连续或格式无效');
   const raw=Uint8Array.from(atob(row.data),c=>c.charCodeAt(0));if(raw.length!==row.byteCount||stagedBytes[ch]+raw.length>cap||(row.endOfCapture&&raw.length!==0)||(!row.endOfCapture&&(raw.length===0||row.eof||row.truncated)))throw Error('输出字节计数或结束标记无效');
   const combined=new Uint8Array(stagedRetained[ch].length+raw.length);combined.set(stagedRetained[ch]);combined.set(raw,stagedRetained[ch].length);stagedRetained[ch]=combined;stagedSequence[ch]=row.streamSequence;stagedBytes[ch]+=raw.length;previous=row.cursor;
   if(row.endOfCapture)stagedCapture[ch]={end:true,eof:row.eof,truncated:row.truncated};
  }
  sequence=stagedSequence;bytes=stagedBytes;retained=stagedRetained;state.capture=stagedCapture;
  for(const ch of ['stdout','stderr'] as const)state[ch]=new TextDecoder().decode(retained[ch],{stream:!state.capture[ch].end});
  state.cursor=page.nextCursor;state.more=page.hasMore;
 });}
 return{state,workspace,propose,describe,approve,start:()=>control('start'),stop:()=>control('stop'),output,reset,dispose(){disposed=true;++epoch;}};
}
