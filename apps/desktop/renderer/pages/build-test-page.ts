import {defineComponent,h,ref,watch} from 'vue';
import {ExecutionTask,type ExecutionPreset} from './execution-task';

const templates:Omit<ExecutionPreset,'id'>[]=[
  {kind:'build',title:'构建仓颉项目',summary:'在当前工作区执行仓颉项目构建。只创建持久提案，不会运行命令。',executable:'cjpm',argv:['build'],timeoutMs:300000,outputLimit:65536},
  {kind:'test',title:'运行仓颉测试',summary:'关闭颜色和进度动画；按 cjpm 最终测试摘要、退出事实与完整输出生成报告。',executable:'cjpm',argv:['test','--no-color','--no-progress'],timeoutMs:300000,outputLimit:65536},
  {kind:'test',title:'运行 Node.js 测试',summary:'通过 Node TAP 摘要识别 node --test 结果；普通命令输出的相似文本不会被当成测试通过。',executable:'node',argv:['--test'],timeoutMs:300000,outputLimit:65536},
];

export const BuildTestPage=defineComponent({
  name:'SaCodeBuildTestPage',
  props:{active:Boolean,sessionId:String,api:Object},
  setup(props){
    const mode=ref<'choices'|'preset'|'custom'>('choices');
    const selected=ref<ExecutionPreset|null>(null);
    const armed=ref(false);
    const error=ref('');
    const reset=()=>{mode.value='choices';selected.value=null;armed.value=false;error.value='';};
    // 隐藏标签或切换会话后，不重放持久化提案这一副作用；用户再次选择才创建新请求。
    watch(()=>props.active,active=>{if(!active)reset();});
    watch(()=>props.sessionId,()=>reset());
    function choose(template:Omit<ExecutionPreset,'id'>){
      try{
        selected.value={...template,id:globalThis.crypto.randomUUID()};
        mode.value='preset';armed.value=false;error.value='';
      }catch(e){error.value=String((e as Error).message||e);}
    }
    return()=>h('section',{class:'side-section build-test-page','aria-label':'构建与测试'},[
      h('h2',{},'构建与测试'),
      h('p',{class:'note'},'从当前会话工作区创建构建或测试提案。提案、一次性审批、启动、取消和输出报告共用持久执行链。'),
      !props.active?h('p',{class:'note',role:'status'},'页面已隐藏；重新打开后需由你再次选择任务。'):null,
      error.value?h('p',{class:'resource-error',role:'alert'},error.value):null,
      mode.value==='choices'?h('div',{class:'stack','aria-label':'构建与测试任务类型'},[
        ...templates.map((item,index)=>h('article',{class:'empty-card',key:item.kind+':'+index},[
          h('strong',{},item.title),
          h('p',{class:'note'},item.summary),
          h('code',{},[item.executable,...item.argv].join(' ')),
          h('button',{class:'btn',type:'button',disabled:!props.active,onClick:()=>choose(item)},'选择任务'),
        ])),
        h('article',{class:'empty-card'},[
          h('strong',{},'历史任务与自定义命令'),
          h('p',{class:'note'},'查看当前会话的持久执行记录，或自行填写程序和参数。'),
          h('button',{class:'btn',type:'button',disabled:!props.active,onClick:()=>{mode.value='custom';armed.value=true;}},'打开任务记录'),
        ]),
      ]):null,
      mode.value==='preset'&&selected.value&&!armed.value?h('section',{class:'execution-action-summary'},[
        h('div',{class:'row spread'},[h('h3',{},selected.value.title),h('button',{class:'btn',type:'button',onClick:reset},'返回选择')]),
        h('p',{class:'note'},selected.value.summary),
        h('pre',{tabindex:0},JSON.stringify({executable:selected.value.executable,argv:selected.value.argv,timeoutMs:selected.value.timeoutMs,outputLimit:selected.value.outputLimit},null,2)),
        h('p',{class:'note'},'下一步只会把命令写入持久执行提案。审批与启动仍是两个独立动作；隔离或监督探针未通过时，宿主会拒绝启动。'),
        h('button',{class:'btn btn-primary',type:'button',disabled:!props.active,onClick:()=>{armed.value=true;}},'创建持久执行提案'),
      ]):null,
      (mode.value==='custom'||(mode.value==='preset'&&armed.value))?h('section',{class:'build-test-task'},[
        h('div',{class:'row spread'},[
          h('h3',{},mode.value==='custom'?'任务记录与自定义命令':selected.value?.title||'构建与测试任务'),
          h('button',{class:'btn',type:'button',onClick:reset},'返回任务类型'),
        ]),
        h(ExecutionTask,{key:mode.value==='custom'?'custom':selected.value?.id,active:!!props.active&&armed.value,sessionId:props.sessionId,api:props.api,showTestReport:true,preset:mode.value==='custom'?null:selected.value}),
      ]):null,
    ]);
  },
});
