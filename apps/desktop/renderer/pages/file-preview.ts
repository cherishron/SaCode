// 只管理一次明确读取的展示，不把历史快照或迟到响应写回其他资源。
export function createFilePreview(read:(path:string)=>Promise<{result:string}>,changed:()=>void){
  const state={path:'',text:'',busy:false,error:'',loaded:false};let epoch=0,disposed=false;
  const notify=()=>{if(!disposed)changed();};
  async function open(path:string){
    if(disposed)return;const ticket=++epoch;
    Object.assign(state,{path,text:'',busy:true,error:'',loaded:false});notify();
    try{
      const result=await read(path);
      if(disposed||ticket!==epoch)return;
      if(typeof result.result!=='string')throw Error('文件读取结果格式无效');
      state.text=result.result;state.loaded=true;
    }catch(error){if(!disposed&&ticket===epoch)state.error=String((error as Error).message||error);}
    finally{if(!disposed&&ticket===epoch){state.busy=false;notify();}}
  }
  function close(){++epoch;Object.assign(state,{path:'',text:'',busy:false,error:'',loaded:false});notify();}
  return{state,open,close,dispose(){disposed=true;++epoch;}};
}
