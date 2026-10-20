// 计划审阅面板（方案 B：独立审阅通道）。
// 正文来自 core 投影的 plan/submitted；批准/继续规划/关闭走 plan/review-answer。
// 采用 Vue runtime + h()（CSP script-src 'self'），不引模板编译器与模块加载器。
import {defineComponent,h,ref,computed,onBeforeUnmount,type PropType} from 'vue';
export type PlanCard={id:string;callId?:string;title?:string;plan:string;status:'pending'|'approved'|'kept-planning'|'dismissed'|'unknown';decision?:string;feedback?:string};
type Reply=(sessionId:string,planId:string,decision:string,feedback:string,cancelled:boolean)=>Promise<{accepted:boolean}>;
const STATUS:Record<string,string>={pending:'等待你的批准',approved:'已批准，按计划执行',"kept-planning":'你选择继续规划',dismissed:'已关闭',unknown:'原任务已不在运行，无法继续审阅'};
export const PlanReviewPanel=defineComponent({
  name:'SaCodePlanReviewPanel',
  props:{
    planActive:{type:Boolean,default:false},
    cards:{type:Array as PropType<readonly PlanCard[]>,default:()=>[]},
    sessionId:{type:String,required:true},
    answer:{type:Function as PropType<Reply>,required:true},
    exitMode:{type:Function as PropType<()=>Promise<unknown>>,required:true},
  },
  setup(props){
    const expanded=ref(false),feedback=ref(''),busy=ref(false),error=ref('');
    let disposed=false;
    onBeforeUnmount(()=>{disposed=true;});
    const latest=computed<PlanCard|null>(()=>props.cards.length?props.cards[props.cards.length-1]:null);
    async function reply(decision:string,cancelled=false){
      const card=latest.value;if(!card||busy.value)return;
      busy.value=true;error.value='';
      try{
        const result=await props.answer(props.sessionId,card.id,decision,feedback.value,cancelled);
        if(result?.accepted!==true)throw Error('计划审阅回执无效');
        if(!disposed)feedback.value='';
      }catch(e){if(!disposed)error.value=String((e as Error).message||e);}
      finally{if(!disposed)busy.value=false;}
    }
    async function exit(){
      if(busy.value)return;busy.value=true;error.value='';
      try{await props.exitMode();}catch(e){if(!disposed)error.value=String((e as Error).message||e);}
      finally{if(!disposed)busy.value=false;}
    }
    return()=>{
      const card=latest.value;
      if(!props.planActive&&!card)return null;
      // pending 只对当前会话待审的卡片成立（宿主只为当前会话标 pending），故无需再比 sessionId。
      const pending=!!card&&card.status==='pending';
      const locked=!pending||busy.value;
      return h('section',{class:'plan-review','data-plan-review':card?card.id:'','aria-label':'计划'},[
        h('header',{class:'plan-review-header'},[
          h('strong',{},'计划'),
          card&&card.title?h('span',{class:'plan-review-title'},card.title):null,
          h('span',{class:'plan-review-status',role:'status'},props.planActive?'计划模式已开启':STATUS[card?card.status:'unknown']||''),
        ]),
        props.planActive?h('p',{class:'plan-review-note'},'计划模式下只读探索；批准计划后才进入实施。'):null,
        card?h('div',{class:'plan-review-body'},[
          h('button',{type:'button',class:'plan-review-toggle','aria-expanded':expanded.value,onClick:()=>expanded.value=!expanded.value},expanded.value?'收起计划全文':'查看计划全文'),
          expanded.value?h('pre',{class:'plan-review-text'},card.plan):null,
          pending?h('div',{class:'plan-review-actions'},[
            h('label',{class:'plan-review-feedback'},[
              h('span',{},'反馈（选「继续规划」时随工具结果返回模型）'),
              h('textarea',{'aria-label':'继续规划时的反馈',value:feedback.value,maxlength:8000,disabled:locked,onInput:(e:Event)=>{if(!locked)feedback.value=(e.target as HTMLTextAreaElement).value;}}),
            ]),
            h('div',{class:'plan-review-buttons'},[
              h('button',{type:'button',class:'plan-btn plan-btn-primary',disabled:locked,onClick:()=>void reply('approve')},busy.value?'提交中…':'批准并退出计划模式'),
              h('button',{type:'button',class:'plan-btn',disabled:locked,onClick:()=>void reply('keep-planning')},'继续规划'),
              h('button',{type:'button',class:'plan-btn',disabled:locked,onClick:()=>void reply('dismiss',true)},'关闭'),
            ]),
          ]):h('p',{class:'plan-review-note'},STATUS[card.status]||''),
          card.feedback?h('p',{class:'plan-review-note'},'反馈：'+card.feedback):null,
        ]):null,
        props.planActive?h('div',{class:'plan-review-actions'},[h('button',{type:'button',class:'plan-btn',disabled:busy.value,onClick:()=>void exit()},'退出计划模式')]):null,
        error.value?h('p',{role:'alert',class:'plan-review-error'},error.value):null,
        h('p',{class:'plan-review-note'},'批准计划不等于授权文件修改或命令执行；实施阶段的写入与命令仍需各自审批。'),
      ]);
    };
  },
});
