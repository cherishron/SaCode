const phases=['awaiting-approval','admitted','starting','running','stopping','exited','unknown','cancelled-before-start'];
export function createExecutionHistory(api:any,session:()=>string,changed:()=>void){
 const state={rows:[] as any[],cursor:-1,more:false,loaded:false,busy:false,error:''};let epoch=0,disposed=false;
 function reset(){++epoch;Object.assign(state,{rows:[],cursor:-1,more:false,loaded:false,busy:false,error:''});changed();}
 async function load(append=false){
  if(disposed||state.busy||!session()||(append&&!state.more))return;
  const id=session(),ticket=++epoch,cursor=append?state.cursor:-1;state.busy=true;state.error='';changed();
  try{
   if(typeof api?.executionList!=='function')throw Error('当前宿主未提供持久任务列表');
   const page=await api.executionList(id,cursor,16);
   if(disposed||ticket!==epoch||session()!==id)return;
   if(page?.version!==1||page.sessionId!==id||page.source!=='durable-history'||!Array.isArray(page.records)||page.records.length>16||
    !Number.isSafeInteger(page.nextCursor)||page.nextCursor!==cursor+page.records.length||typeof page.hasMore!=='boolean'||(page.hasMore&&!page.records.length))throw Error('任务列表身份或分页无效');
   const ids=new Set(append?state.rows.map(row=>row.executionId):[]);
   for(const row of page.records){
    if(!row||row.sessionId!==id||typeof row.executionId!=='string'||!/^execution-[1-9][0-9]*$/.test(row.executionId)||ids.has(row.executionId)||
      !Number.isSafeInteger(row.revision)||row.revision<1||!phases.includes(row.phase)||typeof row.taskId!=='string'||!row.taskId||typeof row.requestId!=='string'||!row.requestId)throw Error('任务列表记录无效');
    ids.add(row.executionId);
   }
   state.rows=[...(append?state.rows:[]),...page.records];state.cursor=page.nextCursor;state.more=page.hasMore;state.loaded=true;
  }catch(error){if(!disposed&&ticket===epoch&&session()===id)state.error=String((error as Error).message||error);}
  finally{if(!disposed&&ticket===epoch&&session()===id){state.busy=false;changed();}}
 }
 return {state,load,reset,dispose(){disposed=true;++epoch;}};
}
