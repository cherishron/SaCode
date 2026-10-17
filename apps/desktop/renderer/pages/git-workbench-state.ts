export type GitReply={sessionId:string;directory:string;output:string;exitCode:number;truncated:boolean;failure:string;diagnostic:string;path?:string;scope?:string};
export function parseGitStatus(output:string,truncated=false){
  const parts=output.split('\0');if(truncated||parts.at(-1)==='')parts.pop();
  const entries:{path:string;oldPath?:string;x:string;y:string}[]=[];let branch='';
  for(let i=0;i<parts.length;i++){
    const record=parts[i];if(record.startsWith('## ')){branch=record.slice(3);continue;}
    if(record.length<4||record[2]!==' ')throw Error('Git 状态格式无效');
    const item={path:record.slice(3),x:record[0],y:record[1],oldPath:undefined as string|undefined};
    if(item.x==='R'||item.x==='C'||item.y==='R'||item.y==='C'){if(++i>=parts.length){if(truncated)break;throw Error('Git 重命名记录不完整');}item.oldPath=parts[i];}
    entries.push(item);
  }
  return{entries,branch};
}
export function createGitWorkbench(api:{status:()=>Promise<GitReply>;diff:(path:string,scope:string)=>Promise<GitReply>},identity:()=>{sessionId:string;directory:string},changed:()=>void){
  const state={entries:[] as ReturnType<typeof parseGitStatus>['entries'],branch:'',busy:false,error:'',limited:false,loaded:false,path:'',scope:'working',patch:'',diffBusy:false,diffError:'',diffLoaded:false,diffLimited:false};let epoch=0,diffEpoch=0,disposed=false;
  const notify=()=>{if(!disposed)changed();};
  const validate=(reply:GitReply)=>{const who=identity();if(reply.sessionId!==who.sessionId||reply.directory!==who.directory)throw Error('Git 查询已不属于当前工作区。');if(reply.failure||reply.exitCode!==0)throw Error(reply.failure+(reply.diagnostic?'：'+reply.diagnostic:''));};
  async function refresh(){if(disposed)return;const ticket=++epoch;++diffEpoch;Object.assign(state,{busy:true,error:'',loaded:false,entries:[],branch:'',patch:'',diffLoaded:false,diffBusy:false,diffError:'',path:'',limited:false});notify();
    try{const reply=await api.status();if(disposed||ticket!==epoch)return;validate(reply);const parsed=parseGitStatus(reply.output,reply.truncated);state.entries=parsed.entries;state.branch=parsed.branch;state.limited=reply.truncated;state.loaded=true;}
    catch(e){if(!disposed&&ticket===epoch)state.error=String((e as Error).message||e);}
    finally{if(!disposed&&ticket===epoch){state.busy=false;notify();}}
  }
  async function select(path:string,scope:string){if(disposed)return;const ticket=++diffEpoch;Object.assign(state,{path,scope,patch:'',diffBusy:true,diffLoaded:false,diffError:'',diffLimited:false});notify();
    try{const reply=await api.diff(path,scope);if(disposed||ticket!==diffEpoch)return;validate(reply);if(reply.path!==path||reply.scope!==scope)throw Error('差异回执身份不匹配。');state.patch=reply.output;state.diffLoaded=true;state.diffLimited=reply.truncated;}
    catch(e){if(!disposed&&ticket===diffEpoch)state.diffError=String((e as Error).message||e);}
    finally{if(!disposed&&ticket===diffEpoch){state.diffBusy=false;notify();}}
  }
  function reset(){++epoch;++diffEpoch;Object.assign(state,{entries:[],branch:'',busy:false,error:'',limited:false,loaded:false,path:'',patch:'',diffBusy:false,diffError:'',diffLoaded:false,diffLimited:false});notify();}
  return{state,refresh,select,reset,dispose(){disposed=true;++epoch;++diffEpoch;}};
}
