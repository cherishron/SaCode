import {defineComponent,h,ref,watch,onBeforeUnmount,type PropType} from 'vue';
import {createGitWorkbench,type GitReply} from './git-workbench-state';
export const GitWorkbench=defineComponent({props:{sessionId:{type:String,required:true},directory:{type:String,required:true},configured:Boolean,active:Boolean,status:{type:Function as PropType<()=>Promise<GitReply>>,required:true},diff:{type:Function as PropType<(path:string,scope:string)=>Promise<GitReply>>,required:true}},emits:['open','browse','choose'],setup(props,{emit}){
  const revision=ref(0);const view=createGitWorkbench({status:()=>props.status(),diff:(path,scope)=>props.diff(path,scope)},()=>({sessionId:props.sessionId,directory:props.directory}),()=>revision.value++);
  watch(()=>[props.active,props.sessionId,props.directory,props.configured],()=>{view.reset();if(props.active&&props.configured)void view.refresh();},{immediate:true});onBeforeUnmount(()=>view.dispose());
  const labels:Record<string,string>={M:'修改',A:'新增',D:'删除',R:'重命名',C:'复制',U:'冲突','?':'未跟踪'};
  return()=>{void revision.value;const s=view.state;const staged=s.entries.filter(e=>e.x!==' '&&e.x!=='?'),working=s.entries.filter(e=>e.y!==' '&&e.y!=='?'),untracked=s.entries.filter(e=>e.x==='?');
    const group=(title:string,rows:typeof s.entries,scope:string)=>h('section',{class:'git-change-group'},[h('h3',{},`${title} · ${rows.length}`),...rows.map(e=>h('button',{class:'git-change-row',type:'button',title:e.oldPath?`${e.oldPath} → ${e.path}`:e.path,onClick:()=>scope==='untracked'?(e.path.endsWith('/')?emit('browse',e.path):emit('open',e.path)):view.select(e.path,scope)},[h('span',{class:'git-status-letter'},labels[scope==='index'?e.x:e.y]||e.x+e.y),h('span',{class:'git-change-path'},e.path)]))]);
    return h('section',{class:'git-workbench','aria-label':'Git 变更与差异'},[
      h('div',{class:'editor-heading'},[h('h2',{},'Git 变更'),h('button',{class:'btn',type:'button',disabled:s.busy||!props.configured,onClick:view.refresh},s.busy?'读取中…':'刷新')]),
      !props.configured?h('div',{class:'empty-card'},[h('strong',{},'先选择 Git 项目目录'),h('button',{class:'btn',onClick:()=>emit('choose')},'选择工作区')]):[
        s.error?h('p',{class:'editor-error',role:'alert'},s.error):null,
        s.loaded?[h('p',{class:'note'},s.branch||'分支信息不可用'),s.limited?h('p',{class:'note',role:'status'},'Git 输出已截断，清单不完整。'):null,
          group('已暂存',staged,'index'),group('工作区修改',working,'working'),group('未跟踪',untracked,'untracked'),
          !s.entries.length?h('p',{class:'note'},s.limited?'限额内未读到完整条目。':'当前没有变更。'):null]:null,
        s.path?h('section',{class:'git-patch'},[h('h3',{},s.scope==='index'?'索引差异':'工作区差异'),h('code',{},s.path),s.diffBusy?h('p',{class:'note'},'正在读取真实差异…'):null,s.diffError?h('p',{class:'editor-error',role:'alert'},s.diffError):null,
          s.diffLoaded?[s.diffLimited?h('p',{class:'note'},'差异已截断，仅展示读取到的部分。'):null,s.patch?h('div',{class:'git-patch-lines',tabindex:0},s.patch.split('\n').map((line,i)=>h('div',{key:i,class:line.startsWith('+')?'editor-diff-add':line.startsWith('-')?'editor-diff-remove':line.startsWith('@@')?'git-hunk':''},h('code',{},line)))):h('p',{class:'note'},'该范围内没有差异。')]:null,
        ]):null,
        h('p',{class:'note'},'只读查询。未跟踪项打开文件预览；暂存、提交、推送尚未开放。'),
      ],
    ]);
  };
}});
