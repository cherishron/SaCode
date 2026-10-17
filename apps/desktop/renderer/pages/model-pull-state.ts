// 页签外持有操作身份；只接受同一操作的回执，未知不是失败、取消请求不是收束。
export interface PullState {
  operationId:string;providerId:string;status:string;settled:boolean;error:string;
  checking:boolean;cancelling:boolean;cancelRequested:boolean;
  verificationError?:string;
}
const terminal=new Set(['succeeded','failed','cancelled','timed-out']);
const statuses=new Set(['running','committing','succeeded','failed','cancelled','timed-out','outcome-unknown','unknown']);
export const pullBlocks=(s:PullState|null)=>!!s&&(!s.settled||!terminal.has(s.status));

export function createModelPullState(api:any,makeId=()=>globalThis.crypto.randomUUID()) {
  let state:PullState|null=null,sequence=0;
  const listeners=new Set<()=>void>();
  const publish=()=>{for(const listener of listeners)listener();};
  const snapshot=()=>state?{...state}:null;
  const unknown=(id:string,code:string)=>{
    if(state?.operationId!==id||state.settled&&terminal.has(state.status))return;
    // 查询失联不能推翻已确认的取消/到期或提交未知，只保留收束仍待核。
    const status=['cancelled','timed-out','outcome-unknown','committing'].includes(state.status)?state.status:'unknown';
    const known=['cancelled','timed-out','outcome-unknown','committing'].includes(state.status);
    state={...state,status,settled:known?state.settled:false,error:known?state.error:code};publish();
  };
  const accept=(id:string,raw:any)=>{
    if(state?.operationId!==id)return;
    // 未知ID回执没有providerId；其他回执必须同时匹配供应商、身份及状态。
    if(raw?.operationId!==id||(raw.providerId!==state.providerId&&!(raw.providerId===undefined&&raw.status==='unknown'))
      ||!statuses.has(raw?.status)||typeof raw.settled!=='boolean'
      ||raw.status==='succeeded'&&raw.settled!==true
      ||['unknown','running','committing'].includes(raw.status)&&raw.settled!==false){
      state={...state,verificationError:'model-pull-result-mismatch'};
      unknown(id,'model-pull-result-mismatch');return;
    }
    // 查询得到终态后，较早的运行中/取消回执不能倒退状态。
    if(state.settled&&terminal.has(state.status))return;
    if(['cancelled','timed-out'].includes(state.status)&&['running','committing','unknown'].includes(raw.status))return;
    if(state.status==='committing'&&raw.status==='running')return;
    if(state.status==='outcome-unknown'&&['running','committing','unknown'].includes(raw.status))return;
    state={...state,status:raw.status,settled:raw.settled,error:typeof raw.error==='string'?raw.error:'',verificationError:'',
      cancelRequested:state.cancelRequested||raw.cancelRequested===true};publish();
  };
  const inspect=async(cancel:boolean)=>{
    const current=state;if(!current||current.checking||current.cancelling)return;
    if(cancel&&!pullBlocks(current))return;
    const id=current.operationId,seq=++sequence;
    state={...current,checking:!cancel,cancelling:cancel,verificationError:''};publish();
    try{accept(id,await(cancel?api.modelPullCancel(id):api.modelPullDescribe(id)));}
    catch{
      const code=cancel?'model-pull-cancel-unconfirmed':'model-pull-query-unconfirmed';
      if(state?.operationId===id){state={...state,verificationError:code};unknown(id,code);publish();}
    }
    finally{if(state?.operationId===id&&seq===sequence){state={...state,checking:false,cancelling:false};publish();}}
    return snapshot();
  };
  return {
    snapshot,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    async start(providerId:string,revision:number|string){
      if(pullBlocks(state))throw new Error('model-pull-in-flight');
      if(typeof api.modelPullDescribe!=='function'||typeof api.modelPullCancel!=='function')throw new Error('模型拉取查询与取消接口尚未就绪，请更新应用');
      const operationId='pull-'+makeId();
      if(!/^[A-Za-z0-9_-]{1,96}$/.test(operationId))throw new Error('bad-model-pull-operation');
      state={operationId,providerId,status:'running',settled:false,error:'',checking:false,cancelling:false,cancelRequested:false};
      publish();
      try{const result=await api.modelPull(providerId,revision,operationId);accept(operationId,result?.pullOperation);}
      catch(error){
        // 只有明确受理前拒绝可作为已结束失败；失联/超时/未知异常不得放开重试。
        const message=String((error as any)?.message||'');
        if(/(?:bad-model-provider|bad-custom-revision|bad-model-pull-operation|model-pull-result-capacity|turn-in-flight|execution-in-flight-or-unsettled|page-call-in-flight)$/.test(message)){
          accept(operationId,{operationId,providerId,status:'failed',settled:true,error:message});
        }else unknown(operationId,'model-pull-result-unconfirmed');
      }
      return snapshot();
    },
    refresh:()=>inspect(false),cancel:()=>inspect(true),
  };
}

export function pullStateText(state:PullState):string {
  const result:Record<string,string>={running:'正在拉取模型目录',committing:'正在保存模型目录，不能再取消',
    succeeded:'模型目录已拉取成功',failed:'模型拉取失败',cancelled:'模型拉取已取消',
    'timed-out':'模型拉取已达到总时限','outcome-unknown':'模型目录提交结果未知，请核对配置，不要重复拉取',
    unknown:'拉取结果未知，后台可能仍在处理；请查询原操作，不要重复拉取'};
  const reasons:Record<string,string>={'http-status:401':'请检查供应商密钥','http-status:403':'供应商拒绝访问',
    'settings-conflict':'配置已改变，请刷新后核对','model-catalog-request-failed':'连接或证书校验失败',
    'bad-model-catalog':'供应商返回的模型目录无法解析','model-pull-result-capacity':'宿主结果保留已达上限',
    'model-pull-query-unconfirmed':'本次查询未确认，请稍后重查原操作','model-pull-cancel-unconfirmed':'取消是否送达尚未确认',
    'model-pull-operation-unknown':'当前宿主没有该操作记录，不能据此判断是否发生修改'};
  return (result[state.status]||result.unknown)+(reasons[state.error]?'；'+reasons[state.error]:'')+'；'+(state.settled?'后台已收束':'后台尚未确认收束')
    +(state.cancelRequested&&!state.settled?'；已请求取消，正在等待收束':'');
}

// 核对失败是一次控制请求的事实，不覆盖原操作的取消/超时/提交结果或资源收束事实。
export function pullVerificationText(state:PullState):string {
  if(state.checking)return '正在核对原操作；本次查询不会重新拉取模型';
  if(state.cancelling)return '正在请求取消原操作；收到取消回执前不代表取消成功';
  if(state.verificationError==='model-pull-cancel-unconfirmed')return '取消请求是否送达未确认。原操作状态仍保留；请查询原操作，不要重复拉取。';
  if(state.verificationError)return '本次核对未取得有效回执。原操作状态仍保留；请稍后再次查询，不要重复拉取。';
  return '';
}

export function pullActionLabel(state:PullState|null,providerId:string):string {
  if(!state||state.providerId!==providerId||!pullBlocks(state))return '拉取模型';
  if(['unknown','outcome-unknown'].includes(state.status))return '结果待核对';
  if(['cancelled','timed-out'].includes(state.status))return '等待后台收束';
  return '拉取中…';
}
