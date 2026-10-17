type Row={seq:number;jobId:string;text:string;truncated:boolean};
type Reply={sessionId:string;page:{rows:Row[];nextCursor:number;more:boolean;malformed:number}};
// 只消费宿主的已落盘快照；重复 jobId 不能合并成一个任务。
export function createTerminalOutput(read:(cursor:number)=>Promise<Reply>,session:()=>string,changed:()=>void){
  const state={rows:[] as Row[],cursor:0,more:false,malformed:0,omitted:0,busy:false,loaded:false,error:''};let epoch=0,disposed=false;
  const notify=()=>{if(!disposed)changed();};
  function reset(){++epoch;Object.assign(state,{rows:[],cursor:0,more:false,malformed:0,omitted:0,busy:false,loaded:false,error:''});notify();}
  async function load(restart=false){
    if(disposed||state.busy)return;
    if(restart)reset();
    const ticket=++epoch,id=session(),cursor=state.cursor;state.busy=true;state.error='';notify();
    try{
      const reply=await read(cursor);if(disposed||ticket!==epoch)return;
      const p=reply.page;
      if(reply.sessionId!==id||id!==session()||!p||!Array.isArray(p.rows)||p.rows.length>16||!Number.isSafeInteger(p.nextCursor)||p.nextCursor<cursor||typeof p.more!=='boolean'||!Number.isSafeInteger(p.malformed)||p.malformed<0)throw Error('终端输出身份或分页格式无效');
      let previous=cursor-1;
      for(const row of p.rows){if(!Number.isSafeInteger(row.seq)||row.seq<=previous||row.seq>=p.nextCursor||typeof row.jobId!=='string'||!row.jobId||typeof row.text!=='string'||typeof row.truncated!=='boolean')throw Error('终端输出记录格式无效');previous=row.seq;}
      if(p.more&&p.nextCursor<=cursor)throw Error('终端分页没有前进');
      const combined=[...state.rows,...p.rows];state.omitted+=Math.max(0,combined.length-128);state.rows=combined.slice(-128);state.cursor=p.nextCursor;state.more=p.more;state.malformed+=p.malformed;state.loaded=true;
    }catch(error){if(ticket===epoch&&!disposed){state.error=String((error as Error).message||error);state.rows=[];state.loaded=false;state.more=false;state.cursor=0;}}
    finally{if(ticket===epoch&&!disposed){state.busy=false;notify();}}
  }
  return{state,load,reset,dispose(){disposed=true;++epoch;}};
}
