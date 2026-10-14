import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {AcpSessionController,type AcpLiveView} from './acp-live';
interface Delegation {delegationId:string;sessionId:string;taskId:string;requestId:string;peerId:string;protocolSessionId:string;phase:string;revision:number;result:string;source:string}
const labels:Record<string,string>={completed:'已结束',cancelled:'已确认取消',incomplete:'未完整结束','outcome-unknown':'运行结果未知'};
export const AcpHistoryPanel=defineComponent({
  name:'SaCodeAcpHistory',props:{active:Boolean,sessionId:String,api:Object},setup(props){
    const rows=ref<Delegation[]>([]),busy=ref(false),error=ref(''),loaded=ref(false);let serial=0,disposed=false;
    const live=ref<AcpLiveView[]>([]),draft=ref(''),acting=ref(false),actionError=ref('');let epoch=0,requestId='',taskId='';
    const settings=ref<{enabled:boolean;revision:number;source:string}|null>(null),provider=ref<any>(null);
    const providerReady=()=>provider.value?.peerId==='opencode'&&provider.value.environment==='installed-usable'&&provider.value.protocolReady===true&&provider.value.verdict==='measured'&&provider.value.protocolVersion===1;
    function checkedSettings(value:any){if(typeof value?.enabled!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0||!['default','project'].includes(value.source)||value.scope!=='project-session')throw Error('ACP 配置回执无效');return value;}
    async function readSettings(){const ticket=epoch,id=props.sessionId||'';try{const api=props.api as any;if(!api?.acpSettingsDescribe)throw Error('ACP 配置入口未接通');const value=checkedSettings(await api.acpSettingsDescribe(id));if(!disposed&&ticket===epoch)settings.value=value;}catch(e){if(!disposed&&ticket===epoch)actionError.value=String((e as Error).message||e);}}
    async function toggle(){const before=settings.value;if(!before)return;const ticket=epoch,id=props.sessionId||'';await perform(async()=>{const value=checkedSettings(await (props.api as any).acpSettingsSetEnabled(id,!before.enabled,before.revision));if(!disposed&&ticket===epoch)settings.value=value;});}
    async function probe(){if(!settings.value?.enabled){actionError.value='请先启用 OpenCode ACP';return;}const ticket=epoch,id=props.sessionId||'';await perform(async()=>{provider.value=null;const api=props.api as any;if(!api?.acpProviderProbe)throw Error('ACP 提供方探针入口未接通');const value=await api.acpProviderProbe(id);if(!value||value.peerId!=='opencode'||typeof value.environment!=='string'||typeof value.protocolReady!=='boolean'||typeof value.verdict!=='string'||!Number.isSafeInteger(value.protocolVersion)||typeof value.evidence!=='string'||value.modelTaskTested!==false)throw Error('ACP 提供方回执无效');if(!disposed&&ticket===epoch)provider.value=value;});}
    const controller=new AcpSessionController(props.api,view=>{live.value=[...live.value.filter(v=>v.delegation.delegationId!==view.delegation.delegationId),view];});
    async function perform(action:()=>Promise<void>){if(acting.value)return;const ticket=epoch;acting.value=true;actionError.value='';try{await action();}catch(e){if(!disposed&&ticket===epoch)actionError.value=String((e as Error).message||e);}finally{if(!disposed&&ticket===epoch)acting.value=false;}}
    async function start(){if(!draft.value.trim()||!settings.value?.enabled||!providerReady())return;const ticket=epoch,text=draft.value;if(!requestId){requestId=crypto.randomUUID();taskId=crypto.randomUUID();}
      await perform(async()=>{await controller.create(taskId,requestId,text);if(!disposed&&ticket===epoch){draft.value='';requestId='';taskId='';}});}
    async function refreshLive(){await perform(async()=>{for(const view of live.value)await controller.refresh(view.delegation.delegationId);});}
    async function load(){const ticket=++serial,id=props.sessionId||'';if(!props.active||!id)return;busy.value=true;error.value='';
      try{const api=props.api as {acpDelegationList?:(id:string)=>Promise<any>};if(!api?.acpDelegationList)throw Error('ACP 读取入口未接通');
        const reply=await api.acpDelegationList(id);if(disposed||ticket!==serial||id!==props.sessionId||!props.active)return;
        if(reply?.version!==1||reply.sessionId!==id||!Array.isArray(reply.delegations)||reply.delegations.some((row:Delegation)=>!row||row.sessionId!==id||row.source!=='durable-history'||typeof row.delegationId!=='string'||typeof row.phase!=='string'||typeof row.result!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1))throw Error('ACP 委派回执身份或格式无效');
        rows.value=reply.delegations;loaded.value=true;
      }catch(e){if(!disposed&&ticket===serial){rows.value=[];loaded.value=false;error.value=String((e as Error).message||e);}}
      finally{if(!disposed&&ticket===serial)busy.value=false;}
    }
    watch(()=>[props.active,props.sessionId],()=>{++serial;++epoch;controller.bind(props.sessionId||'',!!props.active);live.value=[];settings.value=null;provider.value=null;draft.value='';requestId='';taskId='';acting.value=false;actionError.value='';rows.value=[];busy.value=false;error.value='';loaded.value=false;if(props.active){void load();void readSettings();}},{immediate:true});
    onBeforeUnmount(()=>{disposed=true;++serial;++epoch;controller.bind('',false);});
    return()=>h('section',{class:'side-section acp-history','aria-label':'ACP 委派记录'},[
      h('header',{class:'row spread'},[h('h2',{},'ACP 委派'),h('button',{class:'btn',type:'button',disabled:busy.value,onClick:()=>void load()},'刷新记录')]),
      h('p',{class:'note'},'OpenCode 委派。须先由宿主装配并确认提供方就绪；恢复历史不启动进程、不重发任务。'),
      h('div',{class:'row spread'},[
        h('span',{class:'note'},settings.value?('本项目会话 ACP '+(settings.value.enabled?'已开启':'已关闭')):'正在读取 ACP 配置…'),
        h('button',{class:'btn',type:'button',disabled:acting.value||!settings.value,onClick:()=>void toggle()},settings.value?.enabled?'关闭 ACP':'开启 ACP'),
        h('button',{class:'btn',type:'button',disabled:acting.value,onClick:()=>void perform(readSettings)},'刷新配置'),
      ]),
      h('button',{class:'btn',type:'button',disabled:acting.value||!settings.value?.enabled,onClick:()=>void probe()},'检查 OpenCode 提供方'),
      settings.value?.enabled===false&&live.value.some(v=>!v.workerFinished)?h('section',{class:'tool-card',role:'status'},[
        h('strong',{},'已停止接收新委派；在途任务仍在运行'),
        h('p',{class:'note'},'可以等待收尾，或明确取消。关闭开关不会杀死进程。'),
        h('button',{class:'btn',disabled:acting.value,onClick:()=>void refreshLive()},'等待收尾／刷新状态'),
        h('button',{class:'btn',disabled:acting.value,onClick:()=>void perform(async()=>{for(const view of [...live.value])if(!view.workerFinished)await controller.control(view,'cancel');})},'取消在途委派'),
      ]):null,
      provider.value?h('section',{class:'tool-card'},[
        h('strong',{},providerReady()?'ACP 协议已连接':'提供方尚未就绪'),
        provider.value.evidence.includes('acp-auth-required:no-task')?h('p',{class:'note',role:'status'},'OpenCode 实际返回认证要求。请在 OpenCode 中处理对应提供方；SaCode 不自动登录。'):null,
        provider.value.evidence.includes('log-file-permission-denied')?h('p',{class:'note',role:'status'},'OpenCode 子进程打开本地日志文件被拒绝，协议连接尚未确认。'):null,
        h('p',{class:'note'},'沿用 OpenCode 当前工作目录下生效的模型、Agent 与插件配置；SaCode 不复制凭据、不自动登录或更换模型。'),h('p',{class:'note'},'主模型、免费属性、插件覆盖及端点可达性尚未确认；协议检查不等于模型调用成功。'),h('p',{class:'note'},'真实模型任务尚未验证。'),h('details',{},[h('summary',{},'探针详情'),h('pre',{},provider.value.evidence)]),
      ]):h('p',{class:'note'},'提交前请检查提供方；检查不会发送模型任务。'),
      h('form',{class:'stack',onSubmit:(event:Event)=>{event.preventDefault();void start();}},[
        h('p',{class:'note'},'提交会将任务数据发送给 OpenCode 的有效模型，可能产生费用；当前价格尚未确认。'),h('label',{class:'note'},'委派任务'),h('textarea',{class:'input','aria-label':'OpenCode 委派任务',value:draft.value,disabled:acting.value,placeholder:'描述任务范围、限制与验收条件',onInput:(event:Event)=>{const next=(event.target as HTMLTextAreaElement).value;if(next!==draft.value){draft.value=next;requestId='';taskId='';}}}),
        h('button',{class:'btn',type:'submit',disabled:acting.value||!draft.value.trim()||!settings.value?.enabled||!providerReady()},acting.value?'正在处理…':requestId?'重试同一请求':'提交给 OpenCode'),
      ]),
      actionError.value?h('p',{class:'resource-error',role:'alert'},actionError.value):null,
      live.value.length?h('section',{class:'stack','aria-label':'当前持有的 ACP 活任务'},[
        h('button',{class:'btn',type:'button',disabled:acting.value,onClick:()=>void refreshLive()},'刷新活任务'),
        ...live.value.map(view=>h('article',{class:'tool-card',key:view.delegation.delegationId},[
          h('strong',{},'OpenCode · '+(labels[view.delegation.phase]||view.delegation.phase)),
          h('p',{class:'note'},view.delegation.delegationId+' · 修订 '+view.delegation.revision),
          h('p',{class:'note'},view.serverExitObserved?'进程退出已确认':view.serverAlive?'进程仍存活':'进程退出尚未确认'),
          view.delegation.result?h('p',{class:'note'},view.delegation.result):null,
          view.workerError?h('p',{class:'resource-error'},view.workerError):null,
          ...view.updates.map((text,index)=>h('details',{key:index},[h('summary',{},'提供方消息 '+(index+1)),h('pre',{},text)])),
          ...view.permissions.map(permission=>h('section',{class:'tool-card',key:permission.approvalId},[
            h('strong',{},'工具审批 · '+permission.toolCallId),h('pre',{},permission.argumentsJson),
            h('p',{class:'note'},permission.state+' · '+permission.approvalState),
            h('button',{class:'btn',disabled:acting.value||permission.state!=='pending'||permission.approvalState!=='pending'||!permission.policyAllowsGrant||!permission.allowOnceOption,onClick:()=>void perform(()=>controller.answer(view,permission.approvalId,true))},'仅允许这一次'),
            h('button',{class:'btn',disabled:acting.value||permission.state!=='pending'||permission.approvalState!=='pending'||!permission.denyOnceOption,onClick:()=>void perform(()=>controller.answer(view,permission.approvalId,false))},'拒绝'),
          ])),
          h('div',{class:'row'},[
            h('button',{class:'btn',disabled:acting.value||view.workerFinished,onClick:()=>void perform(()=>controller.control(view,'cancel'))},'请求取消'),
            h('button',{class:'btn',disabled:acting.value||view.serverExitObserved,onClick:()=>void perform(()=>controller.control(view,'close'))},'关闭进程'),
          ]),
        ])),
      ]):null,
      busy.value?h('p',{class:'note',role:'status'},'正在读取委派记录…'):null,
      error.value?h('p',{class:'note',role:'alert'},error.value):null,
      loaded.value&&!rows.value.length?h('p',{class:'note'},'当前会话暂无 ACP 委派记录。'):null,
      ...rows.value.map(row=>h('article',{class:'tool-card',key:row.delegationId,'data-acp-delegation':row.delegationId},[
        h('div',{class:'row spread'},[h('strong',{},row.peerId),h('span',{class:'note'},labels[row.phase]||row.phase)]),
        h('p',{class:'note'},row.delegationId+' · 任务 '+row.taskId+' · 修订 '+row.revision),
        row.result?h('p',{class:'note'},row.result):null,
        h('button',{class:'btn',type:'button',disabled:acting.value,onClick:()=>void perform(()=>controller.refresh(row.delegationId))},'查询本进程持有状态'),
      ])),
    ]);
  },
});
