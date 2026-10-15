import {defineComponent,h,ref,watch,onBeforeUnmount,type PropType} from 'vue';

type Scope='user'|'project';
type Model={id:string;name:string};
type Fire={id:string;at:number;status:string;detail:string};
type Task={id:string;title?:string;prompt:string;cron:string;workspace:string;modelId?:string;timezone?:string;permission?:string;enabled:boolean;history?:Fire[]};
type View={scope:Scope;workspace:string;revision:number;tasks:Task[];executorAvailable:boolean};

const permissions:[string,string][]=[['plan','Plan'],['build','Build'],['yolo','YOLO'],['auto-review','Auto Review']];
const errorText=(error:unknown)=>{
 const reason=String((error as Error)?.message||error);
 if(reason.includes('automation-revision-conflict'))return '配置已被其他操作更新。草稿仍保留，请刷新清单后核对再保存。';
 if(reason.includes('automation-model-unavailable'))return '所选模型当前不可用，请在模型中心检查后重试。';
 if(reason.includes('automation-project-required'))return '当前会话没有已配置的工作区，无法读取项目自动化。';
 if(reason.includes('automation-timezone-load-failed'))return '无法加载所选时区。请检查时区名称及安装包中的 IANA 时区数据。';
 if(reason.includes('automation-bad-definition')||reason.includes('automation-bad-cron'))return '配置未通过校验。请检查目录、Cron、时区和必填内容。';
 if(reason.includes('host-gone'))return 'SaCode Host 连接已断开；草稿保留，可连接恢复后重试。';
 return '操作失败：'+reason;
};

function checkView(value:any,scope:Scope):View{
 if(!value||value.scope!==scope||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.tasks)||typeof value.executorAvailable!=='boolean')throw Error('自动化服务回执格式错误');
 const tasks=value.tasks.map((task:any)=>{
  if(!task||typeof task.id!=='string'||typeof task.prompt!=='string'||typeof task.cron!=='string'||typeof task.workspace!=='string'||typeof task.enabled!=='boolean')throw Error('自动化任务回执格式错误');
  const history=task.history===undefined?[]:task.history;
  if(!Array.isArray(history)||!history.every((item:any)=>item&&typeof item.id==='string'&&Number.isSafeInteger(item.at)&&typeof item.status==='string'&&typeof item.detail==='string'))throw Error('自动化运行记录格式错误');
  return {...task,history} as Task;
 });
 return {...value,tasks} as View;
}

export const AutomationPage=defineComponent({
 name:'SaCodeAutomationPage',
 props:{api:{type:Object as PropType<Record<string,any>>,required:true},sessionId:{type:String,required:true},directory:String,models:{type:Array as PropType<Model[]>,default:()=>[]},recent:{type:Array as PropType<{id:string;directory:string;available:boolean}[]>,default:()=>[]},readRecent:Function},
 emits:['back','models'],
 setup(props,{emit}){
  const scope=ref<Scope>('user'),tasks=ref<Task[]>([]),revision=ref(0),executorAvailable=ref(false),busy=ref(false),error=ref(''),notice=ref(''),query=ref(''),editing=ref(false),dirty=ref(false),editId=ref(''),editRevision=ref(0);
  const title=ref(''),prompt=ref(''),cron=ref('0 9 * * 1-5'),workspace=ref(''),modelId=ref(''),timezone=ref('Asia/Shanghai'),permission=ref('plan'),enabled=ref(true);
  const recent=ref(props.recent),recentBusy=ref(false),recentError=ref('');
  let epoch=0,disposed=false;
  const load=async()=>{
   const ticket=++epoch,requestedScope=scope.value,requestedSession=props.sessionId;
   busy.value=true;error.value='';notice.value='';
   try{const result=checkView(await props.api.automationList(requestedSession,requestedScope),requestedScope);if(!disposed&&ticket===epoch&&requestedSession===props.sessionId){tasks.value=result.tasks;revision.value=result.revision;executorAvailable.value=result.executorAvailable;}}
   catch(e){if(!disposed&&ticket===epoch)error.value=errorText(e);}
   finally{if(!disposed&&ticket===epoch)busy.value=false;}
  };
  const loadRecent=async()=>{
   if(!props.readRecent||recentBusy.value)return;
   recentBusy.value=true;recentError.value='';
   try{const result=await props.readRecent();if(!disposed){if(!Array.isArray(result?.entries)||!result.entries.every((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.directory==='string'&&entry.directory.trim().length>0&&typeof entry.available==='boolean'))throw Error('最近项目回执格式错误');recent.value=result.entries;}}
   catch{if(!disposed){recent.value=[];recentError.value='无法读取最近项目；可以填写工作目录。';}}
   finally{if(!disposed)recentBusy.value=false;}
  };
  const resetForm=()=>{editing.value=false;dirty.value=false;editId.value='';title.value='';prompt.value='';cron.value='0 9 * * 1-5';workspace.value=scope.value==='project'?(props.directory||''):(props.directory||'');modelId.value=props.models.find(m=>m.id)?.id||'';timezone.value='Asia/Shanghai';permission.value='plan';enabled.value=true;};
  const begin=(task?:Task)=>{
   editRevision.value=revision.value;editId.value=task?.id||globalThis.crypto.randomUUID();title.value=task?.title||'';prompt.value=task?.prompt||'';cron.value=task?.cron||'0 9 * * 1-5';workspace.value=task?.workspace||props.directory||'';modelId.value=task?.modelId||props.models.find(m=>m.id)?.id||'';timezone.value=task?.timezone||'Asia/Shanghai';permission.value=task?.permission||'plan';enabled.value=task?.enabled??true;dirty.value=false;editing.value=true;error.value='';notice.value='';
  };
  const accept=(raw:any)=>{const result=checkView(raw,scope.value);tasks.value=result.tasks;revision.value=result.revision;executorAvailable.value=result.executorAvailable;};
  const save=async()=>{
   if(busy.value||!editing.value)return;
   const definition={id:editId.value,title:title.value.trim(),prompt:prompt.value,cron:cron.value.trim(),workspace:scope.value==='project'?(props.directory||''):workspace.value.trim(),modelId:modelId.value,timezone:timezone.value.trim(),permission:permission.value,enabled:enabled.value};
   if(!definition.title||!definition.prompt.trim()||!definition.workspace||!definition.modelId){error.value='请填写名称、任务提示词、工作目录并选择模型。';return;}
   const ticket=++epoch;busy.value=true;error.value='';notice.value='';
   try{const result=await props.api.automationSave(props.sessionId,scope.value,definition,editRevision.value);if(!disposed&&ticket===epoch){accept(result);editing.value=false;dirty.value=false;notice.value='自动化配置已保存。当前没有调度执行器，保存不会启动任务。';}}
   catch(e){if(!disposed&&ticket===epoch)error.value=errorText(e);}
   finally{if(!disposed&&ticket===epoch)busy.value=false;}
  };
  const control=async(task:Task,action:'pause'|'resume'|'remove')=>{
   if(busy.value)return;
   if(action==='remove'&&!globalThis.confirm('删除自动化配置？已有运行记录会按存储规则保留。'))return;
   const ticket=++epoch;busy.value=true;error.value='';notice.value='';
   try{const result=await props.api.automationControl(props.sessionId,scope.value,task.id,action,revision.value);if(!disposed&&ticket===epoch){accept(result);notice.value=action==='remove'?'自动化配置已删除。':action==='pause'?'自动化配置已暂停。':'自动化配置已启用；调度执行器尚未接通。';}}
   catch(e){if(!disposed&&ticket===epoch)error.value=errorText(e);}
   finally{if(!disposed&&ticket===epoch)busy.value=false;}
  };
  watch(()=>[props.sessionId,props.directory,scope.value],()=>{epoch++;tasks.value=[];revision.value=0;query.value='';error.value='';if(editing.value&&!dirty.value)resetForm();void load();},{immediate:true});
  onBeforeUnmount(()=>{disposed=true;epoch++;});
  const button=(label:string,click:()=>void,disabled=false,primary=false)=>h('button',{type:'button',class:'management-button'+(primary?' automation-primary':''),disabled,onClick:click},label);
  const field=(label:string,node:unknown,hint?:string)=>h('label',{class:'management-field'},[h('span',{},label),node,hint?h('small',{},hint):null]);
  const input=(label:string,value:{value:string},placeholder='',attrs:any={})=>h('input',{'aria-label':label,value:value.value,placeholder,disabled:busy.value,onInput:(event:Event)=>{value.value=(event.target as HTMLInputElement).value;dirty.value=true;},...attrs});
  const select=(label:string,value:{value:string},items:[string,string][],attrs:any={})=>h('select',{'aria-label':label,value:value.value,disabled:busy.value,onChange:(event:Event)=>{value.value=(event.target as HTMLSelectElement).value;dirty.value=true;},...attrs},items.map(([id,text])=>h('option',{value:id},text)));
  const filtered=()=>tasks.value.filter(task=>((task.title||'')+' '+task.prompt+' '+task.workspace+' '+task.modelId+' '+task.cron).toLowerCase().includes(query.value.trim().toLowerCase()));
  return()=>h('main',{class:'management-page automation-page',id:'management-automation'},[
   h('header',{class:'management-header'},[h('h1',{},'自动化'),button('返回对话',()=>emit('back'))]),
   h('div',{class:'management-body'},[
    h('div',{class:'management-intro'},[h('div',{},[h('h2',{},'让重复任务按计划运行'),h('p',{},'按用户或项目保存任务定义，选择工作目录、模型与 Cron 规则。')]),button(editing.value?'收起编辑':'创建自动化',()=>editing.value?resetForm():begin(),busy.value,false)]),
    h('section',{class:'automation-executor-notice',role:'status'},[h('span',{class:'automation-status-dot'}),h('div',{},[h('strong',{},executorAvailable.value?'调度执行器已报告可用':'调度执行器尚未接通'),h('p',{},executorAvailable.value?'可保存和管理任务；实际触发状态仍以运行记录为准。':'任务配置会真实保存并可管理，但当前不会按 Cron 自动启动，也不能手动触发。')])]),
    h('nav',{class:'management-scope automation-scope','aria-label':'自动化作用域'},[
     button('个人自动化',()=>{scope.value='user';resetForm();},busy.value||scope.value==='user'),
     button('当前项目',()=>{scope.value='project';resetForm();},busy.value||scope.value==='project'||!props.directory),
    ]),
    scope.value==='project'?h('p',{class:'management-project'},props.directory?'项目范围绑定当前会话工作区：'+props.directory:'请先为当前会话选择工作区。'):null,
    h('form',{class:'management-search',onSubmit:(event:Event)=>{event.preventDefault();void load();}},[h('input',{type:'search','aria-label':'搜索自动化',placeholder:'搜索名称、目录、模型或 Cron',value:query.value,onInput:(event:Event)=>query.value=(event.target as HTMLInputElement).value}),button('刷新清单',()=>void load(),busy.value)]),
    error.value?h('p',{class:'automation-error',role:'alert'},error.value):null,
    notice.value?h('p',{class:'automation-notice',role:'status'},notice.value):null,
    busy.value?h('p',{class:'automation-loading',role:'status'},'正在读取或保存自动化配置…'):null,
    !busy.value&&!error.value&&!filtered().length?h('section',{class:'empty-card automation-empty'},[h('h3',{},query.value?'没有匹配的自动化':'还没有自动化任务'),h('p',{},query.value?'试试其他关键词。':'创建配置后会保存在当前作用域；执行器接通前不会自动运行。'),!query.value?button('创建第一个自动化',()=>begin(),busy.value,true):null]):null,
    h('section',{class:'automation-list','aria-label':'自动化任务列表'},filtered().map(task=>h('article',{class:'automation-card',key:task.id},[
     h('div',{class:'automation-card-main'},[h('div',{class:'automation-card-title'},[h('h3',{},task.title||task.id),h('span',{class:'automation-state '+(task.enabled?'is-enabled':'is-paused')},task.enabled?(executorAvailable.value?'已启用':'已启用 · 待执行器'):'已暂停')]),h('p',{class:'automation-prompt'},task.prompt),h('div',{class:'automation-meta'},[h('span',{},'Cron '+task.cron),h('span',{},task.modelId||'模型未记录'),h('span',{},task.workspace),h('span',{},(task.timezone||'时区未记录')+' · '+({plan:'Plan',build:'Build',yolo:'YOLO','auto-review':'Auto Review'}[task.permission||'']||'权限未记录'))]),task.history?.length?h('details',{class:'automation-history'},[h('summary',{},'运行记录 · '+task.history.length),h('ul',{},task.history.slice().reverse().slice(0,5).map(fire=>h('li',{key:fire.id},[h('span',{},fire.status),fire.detail?h('small',{},fire.detail):null]))) ]):h('p',{class:'automation-no-history'},'暂无运行记录')]),
     h('div',{class:'automation-card-actions'},[button('编辑',()=>begin(task),busy.value),button(task.enabled?'暂停':'启用',()=>void control(task,task.enabled?'pause':'resume'),busy.value),button('删除',()=>void control(task,'remove'),busy.value)]),
    ]))),
    editing.value?h('section',{class:'management-editor automation-editor','aria-label':'自动化任务编辑'},[
     h('div',{class:'management-editor-heading'},[h('h3',{},editId.value&&tasks.value.some(task=>task.id===editId.value)?'编辑自动化':'创建自动化'),h('span',{class:'management-draft'},dirty.value?'草稿有未保存修改':'变更按当前清单修订保存')]),
     h('div',{class:'management-form'},[
      field('任务名称',input('自动化名称',title,'例如：工作日检查依赖更新',{maxlength:600})),
      field('任务提示词',h('textarea',{'aria-label':'自动化提示词',rows:5,value:prompt.value,disabled:busy.value,placeholder:'描述要完成的工作和验收条件',onInput:(event:Event)=>{prompt.value=(event.target as HTMLTextAreaElement).value;dirty.value=true;}})),
      field('作用域',h('input',{'aria-label':'自动化作用域',value:scope.value==='user'?'个人':'当前项目',readonly:true})),
      field('工作目录',h('div',{class:'management-directory'},[input('自动化工作目录',workspace,scope.value==='project'?'使用当前项目工作区':'绝对目录路径',{readonly:scope.value==='project'}),button('当前项目',()=>{workspace.value=props.directory||'';dirty.value=true;},!props.directory||scope.value==='project'),button('刷新最近项目',()=>void loadRecent(),recentBusy.value)]),scope.value==='project'?'项目范围必须使用当前会话工作区。':'个人自动化可绑定任意有效目录；保存时由 Host 校验。'),
      scope.value==='user'?field('最近项目',h('select',{'aria-label':'自动化最近项目',value:workspace.value,disabled:busy.value||recentBusy.value,onChange:(event:Event)=>{workspace.value=(event.target as HTMLSelectElement).value;dirty.value=true;}},[h('option',{value:''},recentBusy.value?'读取中…':'选择最近项目',),...recent.value.map(item=>h('option',{value:item.directory,disabled:!item.available},item.directory+(item.available?'':'（目录不可用）')))]),recentError.value||'目录选择仅保存到自动化定义，不改变当前会话工作区。'):null,
      field('执行模型',h('div',{class:'management-directory'},[select('自动化模型',modelId,[['','请选择模型'],...props.models.map(model=>[model.id,model.name||model.id] as [string,string])]),button('打开模型中心',()=>emit('models'),busy.value)]),props.models.length?'选择当前模型中心中已启用的模型。':'没有已启用模型，请先配置模型中心。'),
      field('Cron',input('自动化 Cron',cron,'0 9 * * 1-5',{placeholder:'分 时 日 月 周'}),'五段式 Cron；由 Host 校验。当前服务只保存规则，不执行调度。'),
      field('时区',input('自动化时区',timezone,'Asia/Shanghai')),
      field('权限模式',select('自动化权限模式',permission,permissions),'配置权限不授予额外执行许可；任务实际执行仍需共享执行链支持。'),
      field('配置状态',h('label',{class:'automation-enabled-toggle'},[h('input',{type:'checkbox','aria-label':'启用此自动化配置',checked:enabled.value,disabled:busy.value,onChange:(event:Event)=>{enabled.value=(event.target as HTMLInputElement).checked;dirty.value=true;}}),h('span',{},enabled.value?'启用配置':'暂停配置')]),'当前启用状态只记录为配置状态，不代表已有调度器在后台运行。'),
     ]),
     h('footer',{class:'management-form-actions'},[h('p',{},'保存会写入 SaCode Host 的用户／项目自动化日志；不会启动模型任务。'),button('取消',()=>resetForm(),busy.value),button('保存自动化',()=>void save(),busy.value||!title.value.trim()||!prompt.value.trim()||!workspace.value.trim()||!modelId.value,true)]),
    ]):null,
   ]),
  ]);
 }
});
