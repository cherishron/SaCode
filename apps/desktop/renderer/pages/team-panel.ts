import {defineComponent,h,ref,reactive,type PropType} from 'vue';

export interface TeamMember {id:string;role:string;sessionId:string;status:string}
export interface TeamTask {id:string;title:string;owner:string;status:string;dependencies:string[];result:string}
export interface TeamMessage {id:string;sender:string;target:string;text:string;status:string}
export interface TeamSnapshot {members:TeamMember[];tasks:TeamTask[];messages:TeamMessage[]}
const phases=['pending','running','completed','failed','cancelled'];
const phaseLabels:Record<string,string>={pending:'待处理',running:'运行中',completed:'已完成',failed:'失败',cancelled:'已取消'};
const memberTerminal=['completed','failed','cancelled','stopped','exited'];

// 页面只持有输入草稿。操作回执与团队事实由父层更新快照，不在这里推断成功。
export const TeamPanel=defineComponent({
  name:'SaCodeTeamPanel',
  props:{
    snapshot:{type:Object as PropType<TeamSnapshot>,default:()=>({members:[],tasks:[],messages:[]})},
    busy:{type:Boolean,default:false},error:{type:String,default:''},
  },
  emits:['addMember','sendMessage','createTask','assignTask','stopMember','selectSession','refresh'],
  setup(props,{emit}){
    const name=ref(''),role=ref(''),target=ref(''),message=ref(''),title=ref(''),dependencies=ref('[]'),formError=ref('');
    const assignees=reactive<Record<string,string>>({});
    const members=()=>props.snapshot?.members||[],tasks=()=>props.snapshot?.tasks||[],messages=()=>props.snapshot?.messages||[];
    const hasMember=(id:string)=>members().some(m=>m.id===id);
    const canAssign=(id:string)=>{
      const task=tasks().find(t=>t.id===id);
      return !props.busy&&!!task&&['pending','running'].includes(task.status)&&hasMember(assignees[id]||'');
    };
    const canStop=(id:string)=>{
      const member=members().find(m=>m.id===id);
      return !props.busy&&!!member&&!memberTerminal.includes(member.status)&&member.status!=='stopping';
    };
    function addMember(){
      if(props.busy)return;
      if(!name.value.trim()||!role.value.trim()){formError.value='成员名称和角色不能为空';return;}
      formError.value='';emit('addMember',{name:name.value.trim(),role:role.value.trim()});
    }
    function sendMessage(){
      if(props.busy)return;
      if(!hasMember(target.value)||!message.value.trim()){formError.value='请选择当前成员并填写非空消息';return;}
      formError.value='';emit('sendMessage',{target:target.value,text:message.value});
    }
    function createTask(){
      if(props.busy)return;
      try{
        if(!title.value.trim())throw Error('任务标题不能为空');
        const parsed=JSON.parse(dependencies.value);
        if(!Array.isArray(parsed)||parsed.some(d=>typeof d!=='string'||!d.trim()))throw Error('依赖任务应为非空身份的 JSON 字符串数组');
        if(parsed.some(d=>!tasks().some(t=>t.id===d)))throw Error('依赖任务必须存在于当前快照');
        formError.value='';emit('createTask',{title:title.value.trim(),dependencies:[...new Set<string>(parsed)]});
      }catch(e){formError.value=(e as Error).message;}
    }
    const button=(label:string,action:()=>void,disabled=false,caption=label)=>h('button',{class:'btn',type:'button','aria-label':label,disabled,onClick:action},caption);
    const field=(label:string,value:string,update:(value:string)=>void,multiline=false)=>h('label',{class:'team-field'},[
      h('span',{},label),h(multiline?'textarea':'input',{class:'input','aria-label':label,value,disabled:props.busy,onInput:(e:any)=>update(e.target.value)}),
    ]);
    const memberSelect=(label:string,value:string,update:(value:string)=>void)=>h('label',{class:'team-field'},[
      h('span',{},label),h('select',{class:'input','aria-label':label,value,disabled:props.busy,onChange:(e:any)=>update(e.target.value)},[
        h('option',{value:''},'请选择成员'),...members().map(m=>h('option',{key:m.id,value:m.id},m.id+' · '+m.role)),
      ]),
    ]);
    const form=(label:string,action:()=>void,fields:any[],disabled:boolean)=>h('form',{class:'team-form','aria-label':label,onSubmit:(e:any)=>{e.preventDefault();action();}},[
      ...fields,h('button',{class:'btn',type:'submit',disabled:props.busy||disabled},label),
    ]);
    const taskCard=(task:TeamTask)=>h('article',{class:'team-task',key:task.id,'data-task-id':task.id},[
      h('h4',{},task.title),h('p',{class:'note'},task.id+' · '+task.status),
      h('p',{},'负责人：'+(task.owner||'未分派')),
      h('p',{},'依赖：'+(task.dependencies.length?task.dependencies.join('、'):'无')),
      task.result?h('pre',{tabindex:0},task.result):null,
      memberSelect('任务 '+task.id+' 的受派成员',assignees[task.id]||'',v=>assignees[task.id]=v),
      button('分派任务 '+task.id,()=>{if(canAssign(task.id))emit('assignTask',{taskId:task.id,memberId:assignees[task.id]});},!canAssign(task.id),'分派任务'),
    ]);
    return()=>h('section',{class:'team-panel','aria-label':'团队面板','aria-busy':props.busy},[
      h('header',{class:'row spread'},[h('h2',{},'团队'),button('刷新',()=>{if(!props.busy)emit('refresh');},props.busy)]),
      h('p',{class:'note'},'操作仅发出请求，成员、消息与任务状态以传入快照为准。'),
      props.busy?h('p',{class:'note',role:'status','aria-live':'polite'},'正在处理…'):null,
      props.error?h('p',{class:'note',role:'alert'},props.error):null,
      formError.value?h('p',{class:'note',role:'alert'},formError.value):null,
      h('section',{class:'team-members','aria-label':'成员列表'},[
        h('h3',{},'成员状态'),members().length?h('ul',{},members().map(m=>h('li',{key:m.id,'data-member-id':m.id},[
          h('p',{},m.id+' · '+m.role+' · '+m.status),h('p',{class:'note'},'会话：'+(m.sessionId||'未关联')),
          button('打开成员 '+m.id+' 的会话',()=>{const current=members().find(member=>member.id===m.id);if(current?.sessionId)emit('selectSession',current.sessionId);},!m.sessionId,'打开会话'),
          button('停止成员 '+m.id,()=>{if(canStop(m.id))emit('stopMember',m.id);},!canStop(m.id),'停止成员'),
        ]))):h('p',{class:'note'},'暂无成员'),
        form('创建成员',addMember,[field('成员名称',name.value,v=>name.value=v),field('成员角色',role.value,v=>role.value=v)],!name.value.trim()||!role.value.trim()),
      ]),
      h('section',{class:'team-board','aria-label':'共享任务看板'},[
        h('h3',{},'共享任务看板'),!tasks().length?h('p',{class:'note'},'暂无任务'):null,
        ...phases.map(status=>h('section',{class:'team-column',key:status,'data-task-status':status,'aria-label':phaseLabels[status]},[
          h('h4',{},phaseLabels[status]+' · '+status),...tasks().filter(t=>t.status===status).map(taskCard),
        ])),
        tasks().some(t=>!phases.includes(t.status))?h('section',{class:'team-column','aria-label':'未知任务状态'},[
          h('h4',{},'未知任务状态'),...tasks().filter(t=>!phases.includes(t.status)).map(taskCard),
        ]):null,
        form('创建任务',createTask,[field('任务标题',title.value,v=>title.value=v),field('依赖任务（JSON 数组）',dependencies.value,v=>dependencies.value=v,true)],!title.value.trim()),
      ]),
      h('section',{class:'team-messages','aria-label':'团队消息'},[
        h('h3',{},'团队消息'),messages().length?h('ul',{},messages().map(m=>h('li',{key:m.id,'data-message-id':m.id},[
          h('p',{class:'note'},m.id+' · '+m.sender+' → '+m.target+' · '+m.status),h('pre',{tabindex:0},m.text),
        ]))):h('p',{class:'note'},'暂无消息'),
        form('发送消息',sendMessage,[memberSelect('消息目标',target.value,v=>target.value=v),field('消息正文',message.value,v=>message.value=v,true)],!hasMember(target.value)||!message.value.trim()),
      ]),
    ]);
  },
});
