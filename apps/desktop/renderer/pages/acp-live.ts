export interface AcpLiveView {
  version:1;source:'owned-live-process';
  delegation:{sessionId:string;delegationId:string;taskId:string;requestId:string;peerId:string;phase:string;revision:number;result:string};
  permissions:Array<{approvalId:number;toolCallId:string;argumentsJson:string;allowOnceOption:string;denyOnceOption:string;policyAllowsGrant:boolean;state:string;approvalState:string;reason:string}>;
  updates:string[];workerFinished:boolean;serverAlive:boolean;serverExitObserved:boolean;workerError:string;
}
export function checkedAcpLive(value:any, session:string, delegation?:string,peerId?:string):AcpLiveView {
  const d=value?.delegation;
  if(value?.version!==1||value.source!=='owned-live-process'||!d||d.sessionId!==session||(peerId!==undefined&&d.peerId!==peerId)||
    typeof d.delegationId!=='string'||!d.delegationId||delegation!==undefined&&d.delegationId!==delegation||
    !['taskId','requestId','peerId','phase','result'].every(key=>typeof d[key]==='string')||!Number.isSafeInteger(d.revision)||d.revision<1||
    !['workerFinished','serverAlive','serverExitObserved'].every(key=>typeof value[key]==='boolean')||typeof value.workerError!=='string'||
    !Array.isArray(value.updates)||value.updates.some((v:unknown)=>typeof v!=='string')||!Array.isArray(value.permissions)||
    value.permissions.some((p:any)=>!p||!Number.isSafeInteger(p.approvalId)||p.approvalId<1||typeof p.policyAllowsGrant!=='boolean'||
      !['toolCallId','argumentsJson','allowOnceOption','denyOnceOption','state','approvalState','reason'].every(key=>typeof p[key]==='string')))
    throw Error('ACP 活任务回执身份或格式无效');
  return value;
}

// 仅管理本次页面会话收到的活句柄；历史恢复没有调用 create 的路径。
export class AcpSessionController {
  private generation=0;private session='';private active=false;private peerId='opencode';
  constructor(private api:any,private publish:(view:AcpLiveView)=>void){}
  bind(session:string,active:boolean,peerId='opencode'){if(!['opencode','codebuddy'].includes(peerId))throw Error('ACP 提供方未注册');this.session=session;this.active=active;this.peerId=peerId;this.generation++;}
  private guard(){if(!this.active||!this.session)throw Error('ACP 页面当前未激活');return {session:this.session,generation:this.generation,peerId:this.peerId};}
  private current(binding:{session:string;generation:number}){return this.active&&binding.session===this.session&&binding.generation===this.generation;}
  async create(taskId:string,requestId:string,text:string){
    const binding=this.guard();if(!this.api?.acpDelegationCreate)throw Error('ACP 启动入口未接通');
    const result=await this.api.acpDelegationCreate(binding.session,taskId,requestId,binding.peerId,text);
    if(!this.current(binding))return;
    const view=checkedAcpLive(result,binding.session);
    if(view.delegation.taskId!==taskId||view.delegation.requestId!==requestId||view.delegation.peerId!==binding.peerId)throw Error('ACP 创建回执请求绑定不符');
    this.publish(view);
  }
  async refresh(id:string){
    const binding=this.guard();if(!this.api?.acpDelegationPoll)throw Error('ACP 活任务查询入口未接通');
    const result=await this.api.acpDelegationPoll(binding.session,id);
    if(this.current(binding))this.publish(checkedAcpLive(result,binding.session,id,binding.peerId));
  }
  async control(view:AcpLiveView,action:'cancel'|'close'){
    const binding=this.guard();checkedAcpLive(view,binding.session,undefined,binding.peerId);
    const method=action==='cancel'?'acpDelegationCancel':'acpDelegationClose';
    if(!this.api?.[method])throw Error('ACP 控制入口未接通');
    const result=await this.api[method](binding.session,view.delegation.delegationId,view.delegation.revision);
    if(this.current(binding))this.publish(checkedAcpLive(result,binding.session,view.delegation.delegationId,binding.peerId));
  }
  async answer(view:AcpLiveView,id:number,allow:boolean){
    const binding=this.guard();checkedAcpLive(view,binding.session,undefined,binding.peerId);
    const permission=view.permissions.find(p=>p.approvalId===id);
    if(!permission||permission.state!=='pending'||permission.approvalState!=='pending'||(allow?(!permission.policyAllowsGrant||!permission.allowOnceOption):!permission.denyOnceOption))throw Error('ACP 审批当前不可回复');
    if(!this.api?.acpDelegationAnswer)throw Error('ACP 审批入口未接通');
    const result=await this.api.acpDelegationAnswer(binding.session,view.delegation.delegationId,id,allow?'allowed-once':'denied',allow?permission.allowOnceOption:permission.denyOnceOption);
    if(!this.current(binding))return;
    if(!result||!['sent','not-sent','outcome-unknown'].includes(result.state)||typeof result.reason!=='string')throw Error('ACP 审批回执格式无效');
    if(result.state!=='sent')throw Error('ACP 审批未确认发送：'+result.reason);
    await this.refresh(view.delegation.delegationId);
  }
}
