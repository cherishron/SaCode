type Api={read:(path:string)=>Promise<unknown>,ask:(path:string,text:string)=>Promise<unknown>,answer:(id:number,decision:string)=>Promise<unknown>,write:(path:string,text:string,id:number)=>Promise<unknown>};
export const editableText=(text:string)=>text.length<=65536&&!text.includes('\0')&&!text.includes('[read-truncated:');
const replyObject=(reply:unknown):reply is Record<string,unknown>=>!!reply&&typeof reply==='object'&&!Array.isArray(reply);
function readResult(reply:unknown):string{
  if(!replyObject(reply)||typeof reply.result!=='string')throw Error('文件读取回执无效，未确认磁盘内容。');
  return reply.result;
}
function approvalId(reply:unknown):number{
  if(!replyObject(reply)||typeof reply.approvalId!=='number'||!Number.isSafeInteger(reply.approvalId)||reply.approvalId<1)throw Error('审批工单无效，未写入。');
  return reply.approvalId;
}
function checkApproval(reply:unknown):void{
  if(!replyObject(reply)||reply.accepted!==true)throw Error('一次性审批未被接受，未写入。');
}
function checkWrite(reply:unknown):void{
  if(!replyObject(reply)||typeof reply.result!=='string')throw Error('写入回执无效，请核对磁盘文件；草稿已保留。');
  if(!reply.result.startsWith('ok:'))throw Error('写入未确认：'+reply.result);
}
// 仅保存页面草稿；磁盘观察、审批与原子替换仍由现有共享工具管线执行。
export function createFileEditor(api:Api,changed:()=>void){
  const state={path:'',original:'',draft:'',loaded:false,busy:false,review:false,error:'',notice:'',saveRevision:0};
  let epoch=0,disposed=false;
  const notify=()=>{if(!disposed)changed();};
  const dirty=()=>state.loaded&&state.draft!==state.original;
  async function open(path:string){
    if(disposed||state.busy)return;
    if(dirty()){state.error='请先保存或放弃当前文件的修改。';notify();return;}
    const ticket=++epoch;Object.assign(state,{path,original:'',draft:'',loaded:false,busy:true,review:false,error:'',notice:''});notify();
    try{const reply=await api.read(path);if(disposed||ticket!==epoch)return;
      const text=readResult(reply);
      if(!editableText(text))throw Error('文件过大、包含二进制内容或读取被截断，不能整文件编辑。');
      state.original=state.draft=text;state.loaded=true;
    }catch(e){if(!disposed&&ticket===epoch)state.error=String((e as Error).message||e);}
    finally{if(!disposed&&ticket===epoch){state.busy=false;notify();}}
  }
  function edit(text:string){if(!state.loaded||state.busy||state.review||disposed)return;state.draft=text;state.notice='';state.error='';notify();}
  function review(){if(disposed||!dirty()||state.busy)return;if(!editableText(state.draft)){state.error='编辑内容超过 64K 字符或包含不支持的内容。';notify();return;}state.review=true;notify();}
  function cancelReview(){if(disposed||state.busy)return;state.review=false;notify();}
  function discard(){if(disposed||state.busy)return;state.draft=state.original;state.review=false;state.error='';state.notice='已放弃本地修改。';notify();}
  async function save(){
    if(disposed||state.busy||!state.review||!dirty())return;
    const ticket=epoch,path=state.path,wanted=state.draft,baseline=state.original;state.busy=true;state.error='';state.notice='';notify();
    try{
      const current=await api.read(path);
      if(disposed||ticket!==epoch)return;
      if(readResult(current)!==baseline)throw Error('文件已被外部修改，已拒绝覆盖。请保留草稿，放弃本地修改后重新读取。');
      const id=approvalId(await api.ask(path,wanted));
      if(disposed||ticket!==epoch){await api.answer(id,'denied');return;}
      const answer=await api.answer(id,'allowed-once');
      checkApproval(answer);
      if(disposed||ticket!==epoch)return;
      const reply=await api.write(path,wanted,id);
      checkWrite(reply);
      if(disposed||ticket!==epoch)return;
      const back=await api.read(path);
      if(readResult(back)!==wanted)throw Error('写后回读不一致，请核对磁盘文件；草稿已保留。');
      if(!disposed&&ticket===epoch){state.original=wanted;state.review=false;state.notice='已保存并核对磁盘内容。';state.saveRevision++;}
    }catch(e){if(!disposed&&ticket===epoch)state.error=String((e as Error).message||e);}
    finally{if(!disposed&&ticket===epoch){state.busy=false;notify();}}
  }
  function reset(){if(disposed||state.busy||dirty())return false;++epoch;Object.assign(state,{path:'',original:'',draft:'',loaded:false,review:false,error:'',notice:''});notify();return true;}
  return{state,dirty,open,edit,review,cancelReview,discard,save,reset,dispose(){disposed=true;++epoch;}};
}
// 用共同前后缀框定变更区间，避免大文件上的二次复杂度；不是 Git 索引差异。
export function draftDiff(before:string,after:string){
  const a=before.split('\n'),b=after.split('\n');let start=0,endA=a.length,endB=b.length;
  while(start<endA&&start<endB&&a[start]===b[start])start++;
  while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const rows:{kind:string;text:string;old:number|null;next:number|null}[]=[];
  for(let i=Math.max(0,start-3);i<start;i++)rows.push({kind:'context',text:a[i],old:i+1,next:i+1});
  for(let i=start;i<endA&&rows.length<200;i++)rows.push({kind:'remove',text:a[i],old:i+1,next:null});
  for(let i=start;i<endB&&rows.length<200;i++)rows.push({kind:'add',text:b[i],old:null,next:i+1});
  for(let i=0;i<3&&endA+i<a.length&&rows.length<200;i++)rows.push({kind:'context',text:a[endA+i],old:endA+i+1,next:endB+i+1});
  return{rows,removed:endA-start,added:endB-start,limited:endA-start+endB-start>194};
}
