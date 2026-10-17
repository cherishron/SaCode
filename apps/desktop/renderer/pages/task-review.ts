import {ReviewWriteback} from './review-writeback';
import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {createExecutionTask,executionReview} from './execution-task-state';
import {decodeReviewPreview} from './task-review-preview';
import {draftDiff} from './file-editor-state';

// 消费共享执行投影；写回通过独立确认组件进入同一核心授权链。
export const TaskReview=defineComponent({
 name:'SaCodeTaskReview',props:{sessionId:String,active:Boolean,describe:Function,readFile:Function,writebackApi:Object},
 setup(props){
  const revision=ref(0),id=ref('');
  const previews=ref<Record<string,any>>({}),previewError=ref(''),pending=ref('');let epoch=0;
  const view=createExecutionTask({executionDescribe:(session:string,execution:string)=>props.describe?.(session,execution)} as any,()=>props.sessionId||'',()=>revision.value++);
  watch(()=>props.sessionId,()=>{++epoch;view.reset();id.value='';previews.value={};pending.value='';previewError.value='';});
  watch(()=>props.active,value=>{if(!value){++epoch;pending.value='';}});
  onBeforeUnmount(()=>{++epoch;view.dispose();});
  async function preview(row:any){
   const task=view.state.task;if(!task||!props.readFile||pending.value)return;
   const ticket=++epoch,session=props.sessionId;pending.value=row.path;previewError.value='';
   try{
    const [a,b]=await Promise.all(['before','after'].map(side=>props.readFile!(task.sessionId,task.executionId,task.revision,row.path,side)));
    if(ticket!==epoch||props.sessionId!==session||!props.active||view.state.task!==task)return;
    const before=decodeReviewPreview(a,task,row,'before'),after=decodeReviewPreview(b,task,row,'after');
    previews.value={...previews.value,[row.path]:{before,after,diff:before.binary||after.binary||before.truncated||after.truncated?null:draftDiff(before.text,after.text)}};
   }catch(e){if(ticket===epoch&&props.sessionId===session)previewError.value=String((e as Error).message||e);}
   finally{if(ticket===epoch)pending.value='';}
  }
  return()=>{void revision.value;const state=view.state,task=state.task,review=task?executionReview(task):null;
   return h('section',{'aria-label':'任务差异清单'},[
    h('h3',{},'任务差异清单'),
    h('p',{class:'note'},'按执行身份读取已结算任务登记的文件差异，不把整个 Git 工作区变化归属给该任务。'),
    h('div',{class:'row'},[
     h('input',{class:'input','aria-label':'审查执行身份',placeholder:'execution-…',value:id.value,onInput:(event:any)=>id.value=event.target.value}),
     h('button',{class:'btn',disabled:!props.active||!props.describe||!!state.busy||!/^execution-[1-9][0-9]*$/.test(id.value),onClick:()=>{++epoch;previews.value={};previewError.value='';pending.value='';return view.describe(id.value);}},state.busy?'正在读取…':'读取任务差异'),
    ]),
    state.error?h('p',{role:'alert'},state.error):null,
    previewError.value?h('p',{role:'alert'},previewError.value):null,
    task&&!review?h('p',{class:'note'},'该任务尚未登记可核验的差异清单。'):null,
    review?h('article',{},[
     h('p',{},task!.executionId+' · '+task!.taskId+' · 修订 '+task!.revision),
     h('p',{class:'note'},'原工作区：'+review.sourceDirectory),
     h('p',{class:'note'},'快照摘要：'+review.manifestDigest),
     ...review.files.map((row:any)=>h('details',{key:row.path},[
      h('summary',{},({added:'新增',modified:'修改',deleted:'删除'} as any)[row.kind]+' · '+row.path),
      h('p',{class:'note'},'修改前：'+(row.beforeDigest||'不存在')),
      h('p',{class:'note'},'修改后：'+(row.afterDigest||'不存在')),
      h('button',{class:'btn',disabled:!props.readFile||!!pending.value,onClick:()=>preview(row)},pending.value===row.path?'正在读取正文…':'预览正文'),
      ...(['before','after'] as const).map(side=>{const p=previews.value[row.path]?.[side];return p?h('section',{},[
       h('h4',{},side==='before'?'修改前':'修改后'),
       h('p',{class:'note'},!p.exists?'此侧文件不存在':p.binary?'二进制内容 · '+p.totalBytes+' 字节':p.truncated?'仅预览前 64 KiB，完整文件 '+p.totalBytes+' 字节':'完整正文 · '+p.totalBytes+' 字节'),
       !p.binary?h('pre',{tabindex:0},p.text):null,
      ]):null;}),
      previews.value[row.path]?.diff?h('div',{class:'editor-diff','aria-label':'任务正文差异'},[
       ...previews.value[row.path].diff.rows.map((r:any,i:number)=>h('div',{class:['editor-diff-line','editor-diff-'+r.kind],key:i},[h('code',{},(r.kind==='add'?'+':r.kind==='remove'?'-':' ')+r.text)])),
       previews.value[row.path].diff.limited?h('p',{class:'note'},'差异超过展示上限，仅显示部分行。'):null,
      ]):null,
     ])),
     !review.files.length?h('p',{},'未发现文件字节变化。'):null,
     props.writebackApi?h(ReviewWriteback,{key:task!.executionId+':'+task!.revision,task,review,api:props.writebackApi,sessionId:props.sessionId,active:props.active}):h('p',{class:'note'},'预览读取任务已登记的前后对象；写回接口尚未提供。'),
    ]):null,
   ]);
  };
 },
});
