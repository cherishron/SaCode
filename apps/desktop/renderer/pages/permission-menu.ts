import {defineComponent,h,ref,nextTick,onMounted,onBeforeUnmount} from 'vue';

type ApprovalMode='plan'|'build'|'auto'|'yolo';
type ModeApi={approvalGetMode:()=>Promise<unknown>;approvalSetMode:(mode:ApprovalMode)=>Promise<unknown>};
const modes:ReadonlyArray<readonly [ApprovalMode,string]>=[['plan','规划与只读分析'],['build','在工作区内实施'],['auto','自动审查授权请求'],['yolo','自动执行模式']];
const isMode=(value:unknown):value is ApprovalMode=>modes.some(([name])=>name===value);
function readMode(result:unknown):ApprovalMode{
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('权限模式读取回执无效');
  const value=result as {ok?:unknown;mode?:unknown};
  if(value.ok!==true||!isMode(value.mode))throw Error('权限模式读取回执无效');
  return value.mode;
}
function checkSetResult(result:unknown):void{
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('权限模式设置回执无效');
  const value=result as {ok?:unknown;result?:unknown};
  if(value.ok!==true||(value.result!=='committed'&&value.result!=='noop'))throw Error('权限模式设置回执无效');
}
const errorText=(error:unknown)=>{
  const raw=error&&typeof error==='object'&&'message' in error?String(error.message):'权限模式请求失败';
  // turn 在途时 Host 回 -32001 turn-in-flight；计划模式期间回 plan-mode-active。
  // IPC 包装后用户只看到原始码；与 send-queue-state / session-catalog 同一套友好说法。
  if(raw.includes('turn-in-flight'))return '执行中不能切换权限模式，请等待当前任务完成。';
  if(raw.includes('plan-mode-active'))return '计划模式期间不能切换权限，请先退出计划模式。';
  return raw;
};

export const PermissionMenu=defineComponent({setup(){
  const open=ref(false),root=ref<HTMLElement|null>(null),current=ref<ApprovalMode|null>(null),busy=ref(''),error=ref('');
  const api=()=>(window as unknown as {sacode:ModeApi}).sacode;
  let disposed=false,serial=0;
  const active=(ticket:number)=>!disposed&&ticket===serial;
  async function load(){
    if(disposed||busy.value)return;
    const ticket=++serial;busy.value='read';error.value='';
    try{const mode=readMode(await api().approvalGetMode());if(active(ticket))current.value=mode;}
    catch(e){if(active(ticket)){current.value=null;error.value=errorText(e);}}
    finally{if(active(ticket))busy.value='';}
  }
  async function select(mode:ApprovalMode){
    // 只看 busy：模式读取失败（current 为 null）时也要允许用户手动选择——
    // 选项点击本身就是一次新的写入请求，不必以读成功为前提。
    if(disposed||busy.value||!isMode(mode))return;
    const ticket=++serial;busy.value='set';error.value='';let accepted=false;
    try{
      const result=await api().approvalSetMode(mode);if(!active(ticket))return;
      checkSetResult(result);accepted=true;
      // 写回执不能代替真实状态；不乐观换模式，也不宣称后端已经持久化或落实授权策略。
      const actual=readMode(await api().approvalGetMode());if(!active(ticket))return;
      current.value=actual;
      if(actual!==mode){error.value='设置后回读的权限模式不一致，请重新读取。';return;}
      open.value=false;nextTick(()=>{if(!disposed)root.value?.querySelector<HTMLButtonElement>('.permission-trigger')?.focus();});
    }catch(e){if(active(ticket)){if(accepted)current.value=null;error.value=errorText(e);}}
    finally{if(active(ticket))busy.value='';}
  }
  const cycle=()=>{if(busy.value||current.value===null)return;const i=modes.findIndex(([name])=>name===current.value);void select(modes[(i+1)%modes.length][0]);};
  const outside=(e:PointerEvent)=>{if(!root.value?.contains(e.target as Node))open.value=false;};
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Tab'&&e.shiftKey&&open.value&&!busy.value&&current.value!==null&&root.value?.contains(e.target as Node)){e.preventDefault();cycle();}};
  onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keydown);void load();});
  onBeforeUnmount(()=>{disposed=true;++serial;document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keydown);});
  return()=>h('div',{ref:root,class:'permission-menu-root',onKeydown:(e:KeyboardEvent)=>{if(e.key==='Escape'&&open.value){e.stopPropagation();open.value=false;nextTick(()=>root.value?.querySelector<HTMLButtonElement>('.permission-trigger')?.focus());}}},[
    h('button',{class:'permission-trigger',type:'button','aria-label':'权限模式，当前'+(current.value||'未确认'),'aria-expanded':open.value,'aria-controls':'permission-options',onClick:()=>{open.value=!open.value;if(open.value){if(current.value===null&&!busy.value)void load();nextTick(()=>root.value?.querySelector<HTMLElement>('.permission-popover')?.focus());}}},[
      h('span',{},'工具审批'),h('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},h('path',{d:'m6 9 6 6 6-6'})),
    ]),
    open.value?h('section',{id:'permission-options',class:'permission-popover',tabindex:-1,'aria-label':'权限模式'},[
      h('strong',{},'权限模式'),h('p',{class:'note'},'当前：'+(current.value||'未确认')),
      h('p',{class:'note'},'模式回读不代表持久化或权限策略已生效；工具仍以核心实际审批为准。'),
      busy.value?h('p',{class:'note',role:'status'},busy.value==='read'?'正在读取…':'正在设置并核实…'):null,
      error.value?h('p',{class:'note',role:'alert'},error.value):null,
      ...modes.map(([name,detail])=>h('button',{type:'button',class:['mode-'+name,current.value===name?'active':''].filter(Boolean).join(' '),disabled:!!busy.value,onClick:()=>select(name)},[h('span',{},[h('strong',{},name),h('small',{},detail)])])),
      h('button',{type:'button',disabled:!!busy.value,onClick:load},'重新读取'),
    ]):null,
  ]);
}});
