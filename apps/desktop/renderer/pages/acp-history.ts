import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
interface Delegation {delegationId:string;sessionId:string;taskId:string;requestId:string;peerId:string;protocolSessionId:string;phase:string;revision:number;result:string;source:string}
const labels:Record<string,string>={completed:'已结束',cancelled:'已确认取消',incomplete:'未完整结束','outcome-unknown':'运行结果未知'};
export const AcpHistoryPanel=defineComponent({
  name:'SaCodeAcpHistory',props:{active:Boolean,sessionId:String,api:Object},setup(props){
    const rows=ref<Delegation[]>([]),busy=ref(false),error=ref(''),loaded=ref(false);let serial=0,disposed=false;
    async function load(){const ticket=++serial,id=props.sessionId||'';if(!props.active||!id)return;busy.value=true;error.value='';
      try{const api=props.api as {acpDelegationList?:(id:string)=>Promise<any>};if(!api?.acpDelegationList)throw Error('ACP 读取入口未接通');
        const reply=await api.acpDelegationList(id);if(disposed||ticket!==serial||id!==props.sessionId||!props.active)return;
        if(reply?.version!==1||reply.sessionId!==id||!Array.isArray(reply.delegations)||reply.delegations.some((row:Delegation)=>!row||row.sessionId!==id||row.source!=='durable-history'||typeof row.delegationId!=='string'||typeof row.phase!=='string'||typeof row.result!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1))throw Error('ACP 委派回执身份或格式无效');
        rows.value=reply.delegations;loaded.value=true;
      }catch(e){if(!disposed&&ticket===serial){rows.value=[];loaded.value=false;error.value=String((e as Error).message||e);}}
      finally{if(!disposed&&ticket===serial)busy.value=false;}
    }
    watch(()=>[props.active,props.sessionId],()=>{++serial;rows.value=[];busy.value=false;error.value='';loaded.value=false;if(props.active)void load();},{immediate:true});
    onBeforeUnmount(()=>{disposed=true;++serial;});
    return()=>h('section',{class:'side-section acp-history','aria-label':'ACP 委派记录'},[
      h('header',{class:'row spread'},[h('h2',{},'ACP 委派'),h('button',{class:'btn',type:'button',disabled:busy.value,onClick:()=>void load()},'刷新记录')]),
      h('p',{class:'note'},'读取当前会话的持久事实。恢复不启动进程，也不重发任务。启动、审批与取消入口尚未开放。'),
      busy.value?h('p',{class:'note',role:'status'},'正在读取委派记录…'):null,
      error.value?h('p',{class:'note',role:'alert'},error.value):null,
      loaded.value&&!rows.value.length?h('p',{class:'note'},'当前会话暂无 ACP 委派记录。'):null,
      ...rows.value.map(row=>h('article',{class:'tool-card',key:row.delegationId,'data-acp-delegation':row.delegationId},[
        h('div',{class:'row spread'},[h('strong',{},row.peerId),h('span',{class:'note'},labels[row.phase]||row.phase)]),
        h('p',{class:'note'},row.delegationId+' · 任务 '+row.taskId+' · 修订 '+row.revision),
        row.result?h('p',{class:'note'},row.result):null,
      ])),
    ]);
  },
});
