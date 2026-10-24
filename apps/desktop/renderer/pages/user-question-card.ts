import {defineComponent,h,ref,onBeforeUnmount,type PropType} from 'vue';
type Option={id:string;label:string;description?:string};
type Question={id:string;question:string;type:'single'|'multi'|'confirm'|'input';options?:Option[];allowCustom?:boolean};
type Answer={id:string;selectedIds:string[];text:string};
export type QuestionCard={id:string;sessionId:string;questions:Question[];status:'pending'|'answered'|'cancelled'|'unknown';answers?:Answer[]};
type Reply=(sessionId:string,id:string,answers:Answer[],cancelled:boolean)=>Promise<{accepted:boolean}>;
export const UserQuestionCard=defineComponent({
  name:'SaCodeUserQuestionCard',
  props:{card:{type:Object as PropType<QuestionCard>,required:true},sessionId:{type:String,required:true},answer:{type:Function as PropType<Reply>,required:true}},
  setup(props){
    const drafts=ref<Record<string,Answer>>({});
    for(const q of props.card.questions||[]){const saved=props.card.answers?.find(a=>a.id===q.id);drafts.value[q.id]={id:q.id,selectedIds:[...(saved?.selectedIds||[])],text:saved?.text||''};}
    const busy=ref(false),submitted=ref(false),error=ref(''),expanded=ref(false);let disposed=false;
    onBeforeUnmount(()=>{disposed=true;});
    const canAct=()=>!disposed&&props.card.status==='pending'&&props.card.sessionId===props.sessionId&&!busy.value&&!submitted.value;
    const complete=()=>(props.card.questions||[]).every(q=>drafts.value[q.id]?.selectedIds.length||drafts.value[q.id]?.text.trim());
    async function send(cancelled=false){
      if(!canAct()||(!cancelled&&!complete()))return;
      const session=props.sessionId,id=props.card.id;
      const answers=(props.card.questions||[]).map(q=>({...drafts.value[q.id],selectedIds:[...drafts.value[q.id].selectedIds]}));
      busy.value=true;error.value='';
      try{
        const result=await props.answer(session,id,cancelled?[]:answers,cancelled);
        if(result?.accepted!==true)throw Error('提问应答回执无效');
        if(!disposed)submitted.value=true;
      }catch(e){if(!disposed)error.value=String((e as Error).message||e);}
      finally{if(!disposed)busy.value=false;}
    }
    return()=>{
      const card=props.card,locked=!canAct();
      const status=card.sessionId!==props.sessionId?'属于其他会话':card.status==='answered'?'已回答':card.status==='cancelled'?'已取消':card.status==='unknown'?'原任务已不在运行，无法继续提交':submitted.value?'已提交，等待任务继续':'等待你的选择';
      // 非待答（已答/已取消/未知/跨会话）或本地已提交：卡片自动收起，只留状态与选择摘要，
      // 「查看详情」可只读展开。表单仍留在 DOM（仅 hidden），历史问答可回读、不会被卸载。
      const isClosed=!disposed&&(submitted.value||card.status!=='pending'||card.sessionId!==props.sessionId);
      const collapsed=isClosed&&!expanded.value;
      const rows=(card.questions||[]).map(q=>{
        const value=drafts.value[q.id]||{selectedIds:[],text:''};
        const options=q.type==='confirm'?[{id:'yes',label:'确认'},{id:'no',label:'不确认'}]:q.options||[];
        const picked=value.selectedIds.map(id=>{const hit=options.find(o=>o.id===id);return hit?hit.label:id;});
        const custom=(value.text||'').trim();
        return {question:q.question,picked:custom?[...picked,custom]:picked};
      }).filter(row=>row.picked.length>0);
      return h('section',{class:'user-question-card','data-question-card':card.id,'aria-label':'AI 需要你的选择'},[
        h('header',{class:'question-card-header'},[h('strong',{},'AI 需要你的选择'),h('span',{role:'status'},status)]),
        collapsed
          ? (rows.length?h('ul',{class:'question-summary'},rows.map((row,index)=>h('li',{key:index},[h('span',{class:'question-summary-label'},row.question+'：'),h('span',{},row.picked.join('、'))]))):h('p',{class:'note'},'本轮提问已结束。'))
          : null,
        h('form',{hidden:collapsed,onSubmit:e=>{e.preventDefault();void send();}},[
          ...(card.questions||[]).map(q=>{
            const options=q.type==='confirm'?[{id:'yes',label:'确认'},{id:'no',label:'不确认'}]:q.options||[];
            const value=drafts.value[q.id];
            return h('fieldset',{disabled:locked,key:q.id},[
              h('legend',{},q.question),
              ...options.map(option=>h('label',{class:'question-option',key:option.id},[
                h('input',{type:q.type==='multi'?'checkbox':'radio',name:card.id+'-'+q.id,value:option.id,checked:value.selectedIds.includes(option.id),onChange:e=>{
                  if(!canAct())return;
                  if(q.type==='multi')value.selectedIds=(e.target as HTMLInputElement).checked?[...value.selectedIds,option.id]:value.selectedIds.filter(id=>id!==option.id);
                  else value.selectedIds=[option.id];
                }}),
                h('span',{},[h('strong',{},option.label),option.description?h('small',{},option.description):null]),
              ])),
              q.type==='input'||q.allowCustom?h('label',{class:'question-custom'},[
                h('span',{},q.type==='input'?'你的回答':'补充或自定义回答'),
                h('textarea',{'aria-label':q.question+' 自定义回答',value:value.text,maxlength:8000,onInput:e=>{if(canAct())value.text=(e.target as HTMLTextAreaElement).value;}}),
              ]):null,
            ]);
          }),
          card.status==='pending'&&card.sessionId===props.sessionId&&!submitted.value?h('div',{class:'question-actions'},[
            h('button',{type:'submit',class:'btn btn-primary',disabled:locked||!complete()},busy.value?'提交中…':'提交并继续任务'),
            h('button',{type:'button',class:'btn',disabled:locked,onClick:()=>void send(true)},'取消本次任务'),
          ]):null,
          isClosed&&expanded.value?h('div',{class:'question-actions'},[h('button',{type:'button',class:'btn question-collapse',onClick:()=>{expanded.value=false;}},'收起详情')]):null,
          error.value?h('p',{role:'alert',class:'error'},error.value):null,
          h('p',{class:'note'},'选择只回答当前问题；文件修改和命令执行仍需各自审批。'),
        ]),
        collapsed?h('button',{type:'button',class:'btn question-reopen',onClick:()=>{expanded.value=true;}},'查看详情'):null,
      ]);
    };
  },
});