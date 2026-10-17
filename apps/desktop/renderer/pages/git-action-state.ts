export type GitEntry={path:string;oldPath?:string;x:string;y:string};
export type GitActionKind='stage'|'commit'|'push';
export type GitActionPlan={kind:GitActionKind;title:string;summary:string;executable:'git';argv:string[];timeoutMs:number;outputLimit:number};
export type GitPushTarget={remote:string;ref:string;commit:string};
type GitActionInput={entries?:GitEntry[];selectedPaths?:string[];stagedPaths?:string[];conflicts?:string[];branch?:string;commitMessage?:string;pushTarget?:GitPushTarget};

function checkedPath(path:string):string{
  if(typeof path!=='string'||!path||path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.includes('\\')||/[\u0000-\u001f\u007f]/.test(path))throw Error('Git 路径无效；只能选择当前工作区中的普通文件。');
  const parts=path.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))throw Error('Git 路径包含空段或越界段。');
  return path;
}
function stageable(entry:GitEntry):boolean{
  // 索引里已有内容时拒绝再次 git add，避免用整个工作区文件覆盖部分暂存。
  const unstagedOnly=entry.x===' '&&entry.y!==' '&&entry.y!=='U';
  const untracked=entry.x==='?'&&entry.y==='?';
  return (unstagedOnly||untracked)&&!entry.path.endsWith('/');
}
export function inspectPushUpstream(branch:string):{available:boolean;upstream:string;reason:string}{
  const value=String(branch||'').replace(/^##\s*/,'').trim();
  if(!value||/no branch/i.test(value))return{available:false,upstream:'',reason:'当前处于 detached HEAD，无法确认要推送的分支。'};
  if(/\[gone\]/i.test(value))return{available:false,upstream:'',reason:'当前分支配置的上游已不存在；请先核对 Git 配置。'};
  const match=value.match(/^([^\s]+)\.\.\.([^\s]+)(?:\s|$)/);
  if(!match)return{available:false,upstream:'',reason:'当前分支没有已配置的上游；不会自动设置 upstream。'};
  const upstream=match[2];
  if(/:\/\/|@/.test(upstream)||!/^(?!-)[A-Za-z0-9._/-]+$/.test(upstream))return{available:false,upstream:'',reason:'上游标识包含无法安全展示的 URL 或字符；请先检查远端配置。'};
  return{available:true,upstream,reason:'推送只使用已配置上游 '+upstream+'；不会强推或自动设置 upstream。'};
}
export function safeGitBranchLabel(branch:string):string{
  return String(branch||'').replace(/(https?:\/\/)([^/@\s]+(?::[^/@\s]*)?@)/gi,'$1•••@');
}
export function parseGitPushTarget(output:string):GitPushTarget{
  const fields=String(output||'').split('\n');
  if(fields.length!==3)throw Error('宿主返回的 Git 推送目标格式无效。');
  const [remote,ref,commit]=fields;
  if(!remote||remote==='.'||remote.startsWith('-')||/[\u0000-\u0020\u007f:@\\]/.test(remote)
    ||!ref.startsWith('refs/heads/')||ref.length<12||/[\u0000-\u0020\u007f:~^?*\[\\]/.test(ref)
    ||!(/^[0-9a-f]{40}$/.test(commit)||/^[0-9a-f]{64}$/.test(commit)))throw Error('宿主返回的 Git 推送目标无效。');
  return{remote,ref,commit};
}
export function createGitActionPlan(kind:GitActionKind,input:GitActionInput={}):GitActionPlan{
  if(kind==='stage'){
    const entries=input.entries||[], selected=[...new Set(input.selectedPaths||[])];
    if(!selected.length)throw Error('先选择至少一个文件再创建暂存提案。');
    const byPath=new Map(entries.filter(stageable).map(entry=>[entry.path,entry]));
    const paths:string[]=[];
    for(const path of selected){
      const entry=byPath.get(path);
      if(!entry)throw Error('所选路径已不在可暂存的当前变更中；刷新 Git 状态后重试。');
      paths.push(checkedPath(entry.path));
      if(entry.oldPath)paths.push(checkedPath(entry.oldPath));
    }
    const unique=[...new Set(paths)];
    if(unique.length>256||unique.reduce((sum,path)=>sum+path.length,0)>16000)throw Error('所选路径过多，请分批创建暂存提案。');
    const pathspecs=unique.map(path=>':(literal)'+path);
    return{kind,title:'暂存所选文件',summary:'仅暂存列出的精确路径；已有索引内容（包括部分暂存）不会被覆盖。Git hooks 若配置可能运行。暂存后请重新检查索引差异，再单独创建提交提案。',executable:'git',argv:['add','--all','--',...pathspecs],timeoutMs:120000,outputLimit:16384};
  }
  if(kind==='commit'){
    const staged=[...new Set(input.stagedPaths||[])].map(checkedPath);
    if(!staged.length)throw Error('当前没有可提交的已暂存内容。');
    if((input.conflicts||[]).length)throw Error('存在未解决冲突，不能创建提交提案。');
    const message=String(input.commitMessage||'').trim();
    if(!message||message.length>4000||message.includes('\0'))throw Error('提交说明不能为空、不能包含 NUL，且最多 4000 个字符。');
    const shown=staged.slice(0,12).join('\n'),remaining=staged.length>12?'\n另有 '+(staged.length-12)+' 个路径，需在已暂存列表中核对。':'';
    return{kind,title:'提交已暂存内容',summary:'Git commit 只会提交当前索引。提案创建时检测到 '+staged.length+' 个已暂存路径：\n'+shown+remaining+'\n请先逐项核对“已暂存”差异。Git hooks 若配置可能运行。',executable:'git',argv:['commit','-m',message],timeoutMs:120000,outputLimit:16384};
  }
  if(kind==='push'){
    const upstream=inspectPushUpstream(input.branch||'');
    if(!upstream.available)throw Error(upstream.reason);
    const target=input.pushTarget;
    if(!target)throw Error('尚未从宿主核实实际推送远端、目标分支和 HEAD。');
    const checked=parseGitPushTarget(`${target.remote}\n${target.ref}\n${target.commit}`);
    return{kind,title:'推送已核验提交',summary:'只推送 '+checked.commit+' 到 '+checked.remote+' · '+checked.ref+'。目标由 Git 当前 push 配置解析；多 push URL、push-option 或 mirror 配置会被拒绝。此操作会访问网络；Git hooks 和凭据助手仍可能运行，并包含在本次独立授权中。',executable:'git',argv:['push','--porcelain','--no-follow-tags','--recurse-submodules=no','--',checked.remote,`${checked.commit}:${checked.ref}`],timeoutMs:300000,outputLimit:16384};
  }
  throw Error('未知的 Git 操作。');
}
