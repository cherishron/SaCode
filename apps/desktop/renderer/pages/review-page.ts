import {defineComponent,h,type PropType} from 'vue';
import {FileEditor,createFileEditor} from './file-editor';
import {GitWorkbench} from './git-workbench';
import type {GitReply} from './git-workbench-state';

// 汇总可核验的两类差异，但明确不把工作区变化冒充为某个 Agent 任务的产物。
export const ReviewPage=defineComponent({
  name:'SaCodeReviewPage',
  props:{
    editor:{type:Object as PropType<ReturnType<typeof createFileEditor>>,required:true},
    revision:Number,
    sessionId:{type:String,required:true},
    directory:String,
    configured:Boolean,
    active:Boolean,
    status:{type:Function as PropType<()=>Promise<GitReply>>,required:true},
    diff:{type:Function as PropType<(path:string,scope:string)=>Promise<GitReply>>,required:true},
  },
  emits:['open','browse','choose'],
  setup(props,{emit}){
    return()=>h('section',{class:'side-section file-editor review-page','aria-label':'差异审查'},[
      h('h2',{},'差异审查'),
      h('p',{class:'note'},'分别查看未保存的编辑器草稿，以及当前会话工作区的 Git 索引和工作区差异。Git 查询只读；当前尚未将文件变化归属到具体 Agent 任务。'),
      h(FileEditor,{editor:props.editor,revision:props.revision,diffOnly:true}),
      h(GitWorkbench,{
        key:'review-git:'+props.sessionId+':'+(props.directory||''),
        sessionId:props.sessionId,
        directory:props.directory||'',
        configured:props.configured,
        active:props.active,
        status:props.status,
        diff:props.diff,
        onOpen:(path:string)=>emit('open',path),
        onBrowse:(path:string)=>emit('browse',path),
        onChoose:()=>emit('choose'),
      }),
    ]);
  },
});