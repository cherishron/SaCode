export type FileEntry={name:string;isDir:boolean;size?:number};
export type SearchLimits={directories:number;entries:number;matches:number;depth:number};
export const defaultLimits:SearchLimits={directories:128,entries:4096,matches:200,depth:6};
const excluded=new Set(['.git','node_modules','target','dist']);
// 仅查询已有工作区目录 API；不读取文件正文，不执行 Shell。停止后不继续发目录请求。
export function createWorkspaceSearch(list:(path:string)=>Promise<{files:FileEntry[]}>,changed:()=>void,limits:SearchLimits=defaultLimits){
  const state={query:'',results:[] as {path:string;size?:number}[],busy:false,status:'idle',directories:0,entries:0,limited:false,errors:[] as string[]};
  let epoch=0,disposed=false;
  const notify=()=>{if(!disposed)changed();};
  function cancel(){++epoch;if(state.busy){state.busy=false;state.status='cancelled';notify();}}
  function reset(){++epoch;Object.assign(state,{query:'',results:[],busy:false,status:'idle',directories:0,entries:0,limited:false,errors:[]});notify();}
  async function search(query:string){
    if(disposed)return;reset();const ticket=epoch,term=query.trim().toLocaleLowerCase();state.query=query.trim();
    if(!term)return;state.busy=true;state.status='searching';notify();
    const paths=[{path:'',depth:0}];
    while(paths.length&&!disposed&&ticket===epoch){
      if(state.directories>=limits.directories){state.limited=true;break;}
      const current=paths.shift()!;state.directories++;
      try{
        const response=await list(current.path);
        if(disposed||ticket!==epoch)return;
        if(!Array.isArray(response.files))throw Error('目录返回格式无效');
        for(const entry of response.files){
          if(state.entries>=limits.entries||state.results.length>=limits.matches){state.limited=true;break;}
          state.entries++;
          if(!entry||typeof entry.name!=='string'||typeof entry.isDir!=='boolean'||!entry.name||entry.name==='.'||entry.name==='..'||/[\\/]/.test(entry.name))throw Error('目录返回包含无效文件名');
          const path=current.path?current.path+'/'+entry.name:entry.name;
          if(entry.isDir){
            if(excluded.has(entry.name))continue;
            if(current.depth>=limits.depth){state.limited=true;continue;}
            if(paths.length+state.directories>=limits.directories){state.limited=true;continue;}
            paths.push({path,depth:current.depth+1});
          }else if(path.toLocaleLowerCase().includes(term))state.results.push({path,size:entry.size});
        }
      }catch(error){if(disposed||ticket!==epoch)return;state.errors.push((current.path||'工作区根目录')+'：'+String((error as Error).message||error));}
      notify();
      if(state.entries>=limits.entries||state.results.length>=limits.matches){state.limited=true;break;}
    }
    if(disposed||ticket!==epoch)return;
    state.results.sort((a,b)=>a.path.localeCompare(b.path));state.busy=false;
    state.status=state.errors.length?'partial':state.limited?'limited':'done';notify();
  }
  return{state,search,cancel,reset,dispose(){disposed=true;++epoch;}};
}
