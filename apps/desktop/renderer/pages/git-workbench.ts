import {defineComponent,h,ref,watch,onScopeDispose,type PropType} from 'vue';
import {createGitWorkbench,type GitReply} from './git-workbench-state';
import {createGitActionPlan,inspectPushUpstream,parseGitPushTarget,safeGitBranchLabel,type GitActionKind} from './git-action-state';
import {ExecutionTask,type ExecutionPreset} from './execution-task';

export const GitWorkbench=defineComponent({props:{sessionId:{type:String,required:true},directory:{type:String,required:true},configured:Boolean,active:Boolean,refreshSignal:Number,status:{type:Function as PropType<()=>Promise<GitReply>>,required:true},diff:{type:Function as PropType<(path:string,scope:string)=>Promise<GitReply>>,required:true},pushTarget:{type:Function as PropType<()=>Promise<GitReply>>},executionApi:Object},emits:['open','browse','choose'],setup(props,{emit}){
  const revision=ref(0),selectedPaths=ref(new Set<string>()),actionPreset=ref<ExecutionPreset|null>(null),actionError=ref(''),actionBusy=ref(false);
  let actionEpoch=0,refreshAfterAction=false;
  const view=createGitWorkbench({status:()=>props.status(),diff:(path,scope)=>props.diff(path,scope)},()=>({sessionId:props.sessionId,directory:props.directory}),()=>revision.value++);
  watch(()=>[props.sessionId,props.directory,props.configured],()=>{actionEpoch++;actionBusy.value=false;refreshAfterAction=false;view.reset();selectedPaths.value=new Set();actionPreset.value=null;actionError.value='';if(props.active&&props.configured)void view.refresh();},{immediate:true});
  watch(()=>props.active,active=>{if(active&&props.configured&&!view.state.busy&&!view.state.loaded)void view.refresh();else if(!active)view.reset();});
  watch(()=>props.refreshSignal,()=>{if(!props.active||!props.configured)return;if(actionBusy.value){refreshAfterAction=true;return;}refresh();});
  onScopeDispose(()=>view.dispose());
  const labels:Record<string,string>={M:'修改',A:'新增',D:'删除',R:'重命名',C:'复制',U:'冲突','?':'未跟踪'};
  function refresh(){selectedPaths.value=new Set();actionError.value='';void view.refresh();}
  function toggle(path:string,checked:boolean){const next=new Set(selectedPaths.value);if(checked)next.add(path);else next.delete(path);selectedPaths.value=next;}
  const commitMessage=ref('');
  async function runAction(kind:GitActionKind){
    if(actionBusy.value||!props.active)return;
    actionBusy.value=true;actionError.value='';const ticket=++actionEpoch;
    const sessionId=props.sessionId,directory=props.directory;
    try{
      await view.refresh();
      if(ticket!==actionEpoch||!props.active||props.sessionId!==sessionId||props.directory!==directory)return;
      const current=view.state;
      if(!current.loaded||current.limited)throw Error(current.error||'Git 状态不完整，不能创建写操作提案。');
      const staged=current.entries.filter(e=>e.x!==' '&&e.x!=='?');
      let pushTarget;
      if(kind==='push'){
        if(!props.pushTarget)throw Error('当前 Host 未提供经过核验的推送目标。');
        const reply=await props.pushTarget();
        if(ticket!==actionEpoch||!props.active||props.sessionId!==sessionId||props.directory!==directory)return;
        if(reply.sessionId!==sessionId||reply.directory!==directory)throw Error('推送目标已不属于当前会话或工作区。');
        if(reply.failure||reply.exitCode!==0)throw Error(reply.failure||reply.diagnostic||'Git 推送目标读取失败。');
        pushTarget=parseGitPushTarget(reply.output);
      }
      const plan=createGitActionPlan(kind,{entries:current.entries,selectedPaths:[...selectedPaths.value],stagedPaths:staged.flatMap(e=>e.oldPath?[e.oldPath,e.path]:[e.path]),conflicts:current.entries.filter(e=>e.x==='U'||e.y==='U').map(e=>e.path),branch:current.branch,commitMessage:commitMessage.value,pushTarget});
      actionPreset.value={...plan,id:globalThis.crypto.randomUUID()};
    }catch(e){if(ticket===actionEpoch)actionError.value=String((e as Error).message||e);}
    finally{if(ticket===actionEpoch){actionBusy.value=false;if(refreshAfterAction){refreshAfterAction=false;refresh();}}}
  }
  return()=>{void revision.value;const s=view.state,staged=s.entries.filter(e=>e.x!==' '&&e.x!=='?'),working=s.entries.filter(e=>e.y!==' '&&e.y!=='?'),untracked=s.entries.filter(e=>e.x==='?');
    const stageable=(e:typeof s.entries[number],scope:string)=>!s.limited&&(scope==='working'||scope==='untracked')&&(e.x===' '&&e.y!==' '&&e.y!=='U'||e.x==='?'&&e.y==='?')&&!e.path.endsWith('/');
    const group=(title:string,rows:typeof s.entries,scope:string)=>h('section',{class:'git-change-group'},[h('h3',{},title+' · '+rows.length),...rows.map(e=>h('div',{class:'git-change-item',key:scope+':'+e.path},[
      stageable(e,scope)?h('label',{class:'git-stage-choice'},[h('input',{type:'checkbox',checked:selectedPaths.value.has(e.path),disabled:s.busy||!props.active,onChange:(event:any)=>toggle(e.path,event.target.checked)}),h('span',{class:'sr-only'},'选择暂存 '+e.path)]):null,
      h('button',{class:'git-change-row',type:'button',title:e.oldPath?e.oldPath+' → '+e.path:e.path,onClick:()=>scope==='untracked'?(e.path.endsWith('/')?emit('browse',e.path):emit('open',e.path)):view.select(e.path,scope)},[h('span',{class:'git-status-letter'},labels[scope==='index'?e.x:e.y]||e.x+e.y),h('span',{class:'git-change-path'},e.path)]),
    ]))]);
    const push=inspectPushUpstream(s.branch),writesBlocked=!props.active||s.busy||!s.loaded||s.limited;
    const actions=props.executionApi?h('section',{class:'git-action-controls','aria-label':'Git 独立授权操作'},[
      h('h3',{},'Git 操作'),
      h('p',{class:'note'},'暂存、提交、推送分别生成独立提案；每项都要单独批准并启动，不会自动进入下一步。'),
      h('p',{class:'note'},'已有索引内容（包括部分暂存）不会被覆盖；请先核对索引差异，再分别提交。'),
      h('div',{class:'row git-action-buttons'},[
        h('button',{class:'btn',type:'button',disabled:writesBlocked||actionBusy.value||!selectedPaths.value.size,onClick:()=>void runAction('stage')},'暂存所选文件'),
        h('label',{class:'git-commit-message'},[h('span',{},'提交说明'),h('textarea',{class:'input',value:commitMessage.value,disabled:writesBlocked,onInput:(event:any)=>commitMessage.value=event.target.value,rows:2,maxLength:4000})]),
        h('button',{class:'btn',type:'button',disabled:writesBlocked||actionBusy.value||!staged.length||s.entries.some(e=>e.x==='U'||e.y==='U'),onClick:()=>void runAction('commit')},'提交已暂存内容'),
        h('button',{class:'btn',type:'button',disabled:writesBlocked||actionBusy.value||!push.available,onClick:()=>void runAction('push')},'推送当前分支'),
      ]),
      h('p',{class:'note'},push.reason),
      s.limited?h('p',{class:'editor-error',role:'alert'},'Git 清单不完整；为避免遗漏索引内容，暂存、提交和推送均已禁用。'):null,
      actionError.value?h('p',{class:'editor-error',role:'alert'},actionError.value):null,
    ]):h('p',{class:'note'},'当前入口提供 Git 只读审查；请从工作台 Git 页面发起独立授权操作。');
    return h('section',{class:'git-workbench','aria-label':'Git 变更与差异'},[
      h('div',{class:'editor-heading'},[h('h2',{},'Git 变更'),h('button',{class:'btn',type:'button',disabled:s.busy||actionBusy.value||!props.configured,onClick:refresh},(actionBusy.value?'校验 Git 状态…':s.busy?'读取中…':'刷新'))]),
      !props.configured?h('div',{class:'empty-card'},[h('strong',{},'先选择 Git 项目目录'),h('button',{class:'btn',onClick:()=>emit('choose')},'选择工作区')]):[
        s.error?h('p',{class:'editor-error',role:'alert'},s.error):null,
        s.loaded?[h('p',{class:'note'},safeGitBranchLabel(s.branch)||'分支信息不可用'),s.limited?h('p',{class:'note',role:'status'},'Git 输出已截断，清单不完整。'):null,
          group('已暂存',staged,'index'),group('工作区修改',working,'working'),group('未跟踪',untracked,'untracked'),
          !s.entries.length?h('p',{class:'note'},s.limited?'限额内未读到完整条目。':'当前没有变更。'):null]:null,
        s.path?h('section',{class:'git-patch'},[h('h3',{},s.scope==='index'?'索引差异':'工作区差异'),h('code',{},s.path),s.diffBusy?h('p',{class:'note'},'正在读取真实差异…'):null,s.diffError?h('p',{class:'editor-error',role:'alert'},s.diffError):null,
          s.diffLoaded?[s.diffLimited?h('p',{class:'note'},'差异已截断，仅展示读取到的部分。'):null,s.patch?h('div',{class:'git-patch-lines',tabindex:0},s.patch.split('\n').map((line,i)=>h('div',{key:i,class:line.startsWith('+')?'editor-diff-add':line.startsWith('-')?'editor-diff-remove':line.startsWith('@@')?'git-hunk':''},h('code',{},line)))):h('p',{class:'note'},'该范围内没有差异。')]:null,
        ]):null,
        actions,
        actionPreset.value?h('section',{class:'git-action-session'},[
          h('div',{class:'row spread'},[h('h3',{},actionPreset.value.title),h('button',{class:'btn',type:'button',onClick:()=>actionPreset.value=null},'关闭操作')]),
          h(ExecutionTask,{key:actionPreset.value.id,active:props.active,sessionId:props.sessionId,api:props.executionApi,preset:actionPreset.value}),
        ]):null,
        !props.executionApi?h('p',{class:'note'},'只读查询。未跟踪项打开文件预览；暂存、提交、推送在当前入口未接入。'):null,
      ],
    ]);
  };
}});
