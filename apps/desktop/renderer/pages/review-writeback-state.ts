// 写回投影只绑定一个会话、执行修订和不可变选集；迟到回执不得触发下一步副作用。
export function createReviewWriteback(api:any, session:()=>string, changed:()=>void){
 const state={plan:null as any,status:null as any,busy:'',error:''};let epoch=0;
 const notify=()=>changed();
 function receipt(value:any,id:string,paths:string[]){
  const phases=['awaiting-approval','applying','completed','cancelled','partial-cancelled','conflict','partial-conflict','unknown'];
  if(!value||value.version!==1||value.sessionId!==session()||value.applyId!==id||!phases.includes(value.phase)||!Array.isArray(value.files)||value.files.length!==paths.length||value.files.some((r:any,i:number)=>r.path!==paths[i]||!['not-attempted','writing','applied','conflict','unknown','cancelled'].includes(r.phase)))throw Error('写回回执身份或文件状态无效');
  return value;
 }
 function reset(){++epoch;state.plan=null;state.status=null;state.error='';state.busy='';notify();}
 function suspend(){++epoch;state.busy='';notify();}
 async function operation(name:string,run:(valid:()=>boolean)=>Promise<void>){
  if(state.busy)return;const ticket=++epoch,s=session();state.busy=name;state.error='';notify();
  const valid=()=>ticket===epoch&&s===session();
  try{await run(valid);}catch(e){if(valid())state.error=String((e as Error).message||e);}finally{if(valid()){state.busy='';notify();}}
 }
 async function prepare(task:any,review:any,paths:string[]){
  if(state.busy||!paths.length)return;
  const selection=[...paths];
  await operation('prepare',async valid=>{
   state.plan=null;state.status=null;
   const value=await api.executionReviewPrepare(task.sessionId,task.executionId,task.revision,globalThis.crypto.randomUUID(),selection);
   if(!valid())return;
   if(!value||typeof value.applyId!=='string'||!/^review-apply-[a-f0-9]{64}$/.test(value.applyId)||typeof value.approvalArguments!=='string')throw Error('写回提案格式无效');
   const exact=JSON.parse(value.approvalArguments);
   if(exact.version!==1||exact.sessionId!==task.sessionId||exact.executionId!==task.executionId||exact.executionRevision!==task.revision||exact.applyId!==value.applyId||exact.sourceDirectory!==review.sourceDirectory||exact.sourceIdentity!==review.sourceIdentity||!Array.isArray(exact.files)||exact.files.length!==selection.length||exact.files.some((r:any,i:number)=>{
    const source=review.files.find((f:any)=>f.path===selection[i]);return !source||r.path!==source.path||['beforeObject','afterObject','beforeDigest','afterDigest'].some(k=>r[k]!==source[k]);
   }))throw Error('写回提案与所选任务差异不一致');
   state.status=receipt(value,value.applyId,selection);state.plan={...value,paths:selection};
  });
 }
 async function approve(){
  const plan=state.plan;if(!plan||state.status?.phase!=='awaiting-approval')return;
  await operation('apply',async valid=>{
   const ticket=await api.approvalAsk('execution/review-apply',plan.approvalArguments);if(!valid())return;
   if(!Number.isSafeInteger(ticket?.approvalId)||ticket.approvalId<1)throw Error('写回审批工单无效');
   const answer=await api.approvalAnswer(ticket.approvalId,'allowed-once');if(!valid())return;
   if(answer?.accepted!==true)throw Error('写回审批未被接受');
   state.status=null; // 请求失败也不能继续显示为待审批；先核对服务端事实。
   const value=await api.executionReviewApply(session(),plan.applyId,ticket.approvalId);if(!valid())return;
   state.status=receipt(value,plan.applyId,plan.paths);
  });
 }
 async function refresh(stop=false){
  const plan=state.plan;if(!plan)return;
  await operation(stop?'stop':'refresh',async valid=>{
   const value=await (stop?api.executionReviewApplyStop(session(),plan.applyId):api.executionReviewApplyDescribe(session(),plan.applyId));
   if(valid())state.status=receipt(value,plan.applyId,plan.paths);
  });
 }
 return {state,prepare,approve,refresh,reset,suspend};
}
