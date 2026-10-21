// 子代理角色编辑器（方案 docs/plans/sacode-orchestrator-agent-2026-10-21.md §4.3）：
// 角色列表（4 内置预设 + 用户自定义）、复制内置为自定义、闭环工具集勾选、ACP 能力开关、
// 模型选择（沿用当前选择或引用模型配置，不含密钥）、预算编辑与 CAS 修订屏障。
// IPC 通道未接：数据经 adapter 注入；adapter 缺失时只读展示内置预设，不虚构读写。
import {defineComponent,h,ref,computed,onMounted,onBeforeUnmount,useId,type PropType} from 'vue';

export type ToolKey='read'|'write'|'command'|'browser'|'ssh'|'database'|'mcp'|'skill';
export interface ModelOption{id:string;label:string;available:boolean}
export interface RoleBudget{rounds?:number;tokens?:number;toolCalls?:number;minutes?:number}
export interface RoleDefinition{
  id:string;name:string;description:string;systemPrompt:string;
  tools:ToolKey[];acpEnabled:boolean;model:string;budget:RoleBudget;
  origin:'builtin'|'user'|'project';revision:string;writable:boolean;
}
export interface Adapter{
  read():Promise<{roles:RoleDefinition[];models:ModelOption[]}>;
  saveRole(role:RoleDefinition,expectedRevision:string):Promise<RoleDefinition>;
  deleteRole?(id:string,revision:string):Promise<void>;
  subscribe?(invalidate:()=>void):()=>void;
}
interface Draft{
  id:string;origin:'user'|'project';baselineRevision:string;
  name:string;description:string;systemPrompt:string;
  tools:ToolKey[];acpEnabled:boolean;model:string;
  budgetTexts:{rounds:string;tokens:string;toolCalls:string;minutes:string};
}

// 工具集是闭环集合：勾选项映射到角色能力，不允许手写逃逸工具或越权组合（方案 §4.3）。
const TOOLS:ReadonlyArray<{key:ToolKey;label:string;hint:string}>=[
  {key:'read',label:'读文件',hint:'grep / read / glob 等只读检索'},
  {key:'write',label:'写文件',hint:'工作区内创建与修改文件'},
  {key:'command',label:'跑命令',hint:'构建、测试等命令执行，需审批'},
  {key:'browser',label:'浏览器',hint:'网页读取与自动化操作'},
  {key:'ssh',label:'SSH',hint:'远程主机连接与执行'},
  {key:'database',label:'数据库',hint:'数据库连接与查询'},
  {key:'mcp',label:'MCP',hint:'外部工具服务接入'},
  {key:'skill',label:'Skill',hint:'稳定引用已登记技能'},
];
const TOOL_LABEL:Record<string,string>={};for(const t of TOOLS)TOOL_LABEL[t.key]=t.label;
const ORIGIN_LABEL:Record<string,string>={builtin:'内置',user:'用户',project:'项目'};
const BUDGET_FIELDS:ReadonlyArray<{key:'rounds'|'tokens'|'toolCalls'|'minutes';label:string}>=[
  {key:'rounds',label:'轮次上限'},
  {key:'tokens',label:'Token 上限'},
  {key:'toolCalls',label:'工具调用上限'},
  {key:'minutes',label:'时间上限（分钟）'},
];
const MODEL_INHERIT='inherit';

// adapter 缺失时的内置预设展示（真实定义以核心侧为准；explorer 建议配快模型见方案 §4.2）。
const PRESETS:RoleDefinition[]=[
  {id:'builtin-explorer',name:'explorer',description:'并行搜索与读代码，不污染主上下文；建议为其指定快模型。',systemPrompt:'你是并行检索角色：只读地搜索并阅读代码，汇报事实与出处，不修改任何文件。',tools:['read'],acpEnabled:true,model:MODEL_INHERIT,budget:{},origin:'builtin',revision:'preset',writable:false},
  {id:'builtin-planner',name:'planner',description:'出方案与计划，不改文件。',systemPrompt:'你是规划角色：只读地分析代码，产出可执行的实施计划与风险说明，不修改任何文件。',tools:['read'],acpEnabled:true,model:MODEL_INHERIT,budget:{},origin:'builtin',revision:'preset',writable:false},
  {id:'builtin-implementer',name:'implementer',description:'落地修改、跑测试，需审批。',systemPrompt:'你是实现角色：按计划修改文件并运行命令；所有写入与命令遵守审批，不越权操作。',tools:['read','write','command'],acpEnabled:true,model:MODEL_INHERIT,budget:{},origin:'builtin',revision:'preset',writable:false},
  {id:'builtin-reviewer',name:'reviewer',description:'代码审查与安全扫描。',systemPrompt:'你是审查角色：只读地审查变更并做安全扫描，可申请调用外部 Agent 做对照审查。',tools:['read'],acpEnabled:true,model:MODEL_INHERIT,budget:{},origin:'builtin',revision:'preset',writable:false},
];

const budgetText=(v:number|undefined)=>v==null?'':String(v);
const shortRev=(r:string)=>!r?'—':r.length>12?r.slice(0,12)+'…':r;
const draftFromRole=(role:RoleDefinition,fresh:boolean):Draft=>({
  id:fresh?'':role.id,
  origin:role.origin==='project'?'project':'user',
  baselineRevision:fresh?'':role.revision,
  name:fresh?role.name+'（副本）':role.name,
  description:role.description,systemPrompt:role.systemPrompt,
  tools:role.tools.slice(),acpEnabled:role.acpEnabled,model:role.model,
  budgetTexts:{rounds:budgetText(role.budget.rounds),tokens:budgetText(role.budget.tokens),toolCalls:budgetText(role.budget.toolCalls),minutes:budgetText(role.budget.minutes)},
});
const blankDraft=():Draft=>({id:'',origin:'user',baselineRevision:'',name:'',description:'',systemPrompt:'',tools:['read'],acpEnabled:false,model:MODEL_INHERIT,budgetTexts:{rounds:'',tokens:'',toolCalls:'',minutes:''}});
const draftSignature=(d:Draft)=>JSON.stringify([d.name.trim(),d.description.trim(),d.systemPrompt,d.tools.slice().sort(),d.acpEnabled,d.model,BUDGET_FIELDS.map(f=>d.budgetTexts[f.key].trim())]);
const roleSignature=(r:RoleDefinition)=>JSON.stringify([r.name.trim(),r.description.trim(),r.systemPrompt,r.tools.slice().sort(),r.acpEnabled,r.model,BUDGET_FIELDS.map(f=>budgetText(r.budget[f.key]))]);
const buildRole=(d:Draft):RoleDefinition=>{
  const budget:RoleBudget={};
  for(const f of BUDGET_FIELDS){const text=d.budgetTexts[f.key].trim();if(text!=='')budget[f.key]=Number(text);}
  return{id:d.id,name:d.name.trim(),description:d.description.trim(),systemPrompt:d.systemPrompt,tools:TOOLS.map(t=>t.key).filter(k=>d.tools.includes(k)),acpEnabled:d.acpEnabled,model:d.model,budget,origin:d.origin,revision:d.baselineRevision,writable:true};
};
const budgetFieldInvalid=(draft:Draft|null,key:string)=>{
  if(!draft)return false;const text=draft.budgetTexts[key as 'rounds'|'tokens'|'toolCalls'|'minutes'];
  if(!text.trim())return false;const n=Number(text);
  return !Number.isSafeInteger(n)||n<1||Object.is(n,-0);
};
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'subagent-role-'+cls,...props},children);

export const Page=defineComponent({name:'SaCodeSubagentRoleEditor',props:{adapter:Object as PropType<Adapter>},setup(props){
  const uid='subagent-role-'+useId();
  const snapshot=ref<{roles:RoleDefinition[];models:ModelOption[]}|null>(null);
  const selectedId=ref<string|null>(null);
  const draft=ref<Draft|null>(null);
  const busy=ref(false),failure=ref(''),conflict=ref(false),loading=ref(false),confirmingDelete=ref(false);
  let readGeneration=0,disposed=false,off:(()=>void)|undefined;

  const list=computed<RoleDefinition[]>(()=>snapshot.value?snapshot.value.roles:props.adapter?[]:PRESETS);
  const models=computed<ModelOption[]>(()=>snapshot.value?.models??[]);
  const selected=computed(()=>draft.value?null:list.value.find(r=>r.id===selectedId.value)??null);
  const baseline=computed(()=>{const d=draft.value;return d?list.value.find(r=>r.id===d.id)??null:null;});
  const nameInvalid=computed(()=>!!draft.value&&draft.value.name.trim()==='');
  const descInvalid=computed(()=>!!draft.value&&draft.value.description.trim()==='');
  const invalid=computed(()=>nameInvalid.value||descInvalid.value||BUDGET_FIELDS.some(f=>budgetFieldInvalid(draft.value,f.key)));
  const dirty=computed(()=>{const d=draft.value;if(!d)return false;if(!d.id)return true;const b=list.value.find(r=>r.id===d.id);return !b||draftSignature(d)!==roleSignature(b);});
  const canSave=computed(()=>!!props.adapter&&!!draft.value&&!busy.value&&!conflict.value&&!invalid.value&&dirty.value);

  const read=async()=>{
    if(!props.adapter)return;
    const token=++readGeneration;loading.value=true;
    try{
      const value=await props.adapter.read();
      if(disposed||token!==readGeneration)return;
      if(draft.value){
        const next=value.roles.find(r=>r.id===draft.value!.id);
        if(next&&next.revision!==draft.value.baselineRevision){
          if(draftSignature(draft.value)===roleSignature(next)){draft.value=null;conflict.value=false;}
          else conflict.value=true;
        }
      }
      snapshot.value=value;
    }catch{
      if(!disposed&&token===readGeneration)failure.value='暂时无法读取角色定义，请重试。';
    }finally{
      if(!disposed&&token===readGeneration)loading.value=false;
    }
  };

  const patch=(p:Partial<Draft>)=>{if(!draft.value)return;draft.value={...draft.value,...p};failure.value='';};
  const toggleTool=(key:ToolKey)=>{
    if(!draft.value)return;
    const has=draft.value.tools.includes(key);
    patch({tools:has?draft.value.tools.filter(t=>t!==key):TOOLS.map(t=>t.key).filter(k=>k===key||draft.value!.tools.includes(k))});
  };
  const setBudget=(key:string,text:string)=>{if(!draft.value)return;patch({budgetTexts:{...draft.value.budgetTexts,[key]:text}});};

  const openRole=(id:string)=>{
    if(busy.value)return;
    if(draft.value&&draft.value.id===id)return; // 正在编辑该角色时不因重复点击丢弃草稿。
    const role=list.value.find(r=>r.id===id);if(!role)return;
    selectedId.value=id;draft.value=null; // 打开先看只读详情，编辑须经显式「编辑」进入。
    conflict.value=false;failure.value='';confirmingDelete.value=false;
  };
  const copyRole=(role:RoleDefinition)=>{
    if(busy.value||!props.adapter)return;
    selectedId.value=role.id;draft.value=draftFromRole(role,true);
    conflict.value=false;failure.value='';confirmingDelete.value=false;
  };
  const newRole=()=>{
    if(busy.value||!props.adapter)return;
    selectedId.value=null;draft.value=blankDraft();
    conflict.value=false;failure.value='';confirmingDelete.value=false;
  };
  const startEdit=()=>{
    const role=selected.value;if(busy.value||!role||!role.writable)return;
    draft.value=draftFromRole(role,false);conflict.value=false;failure.value='';
  };
  const discardDraft=()=>{
    if(busy.value||!draft.value)return;
    const b=list.value.find(r=>r.id===draft.value!.id);
    draft.value=b&&b.writable?draftFromRole(b,false):null;
    conflict.value=false;failure.value='';confirmingDelete.value=false;
  };
  const reset=()=>{
    if(busy.value)return;
    draft.value=null;conflict.value=false;failure.value='';confirmingDelete.value=false;
    void read();
  };

  const saveRole=async()=>{
    if(!props.adapter||!draft.value||!canSave.value)return;
    busy.value=true;failure.value='';
    try{
      const saved=await props.adapter.saveRole(buildRole(draft.value),draft.value.baselineRevision);
      const roles=snapshot.value?.roles??[];
      const next=roles.some(r=>r.id===saved.id)?roles.map(r=>r.id===saved.id?saved:r):[...roles,saved];
      snapshot.value={roles:next,models:snapshot.value?.models??[]};
      selectedId.value=saved.id;draft.value=null;conflict.value=false;confirmingDelete.value=false;
    }catch(e){
      if((e as{code?:string})?.code==='role-conflict')conflict.value=true;
      else failure.value='保存失败，请重试。';
    }finally{busy.value=false;}
  };

  const removeRole=async(role:RoleDefinition)=>{
    if(!props.adapter?.deleteRole||busy.value)return;
    if(!(confirmingDelete.value&&selectedId.value===role.id)){selectedId.value=role.id;confirmingDelete.value=true;return;}
    busy.value=true;failure.value='';
    try{
      await props.adapter.deleteRole(role.id,role.revision);
      if(snapshot.value)snapshot.value={...snapshot.value,roles:snapshot.value.roles.filter(r=>r.id!==role.id)};
      if(selectedId.value===role.id)selectedId.value=null;
      if(draft.value&&draft.value.id===role.id)draft.value=null;
      confirmingDelete.value=false;
    }catch(e){
      confirmingDelete.value=false;
      if((e as{code?:string})?.code==='role-conflict')conflict.value=true;
      else failure.value='删除失败，请重试。';
    }finally{busy.value=false;}
  };

  onMounted(()=>{
    void read();
    if(props.adapter?.subscribe)off=props.adapter.subscribe(()=>{void read();});
  });
  onBeforeUnmount(()=>{disposed=true;off?.();});

  return()=>{
    const editing=!!draft.value;
    const src:RoleDefinition|Draft|undefined=draft.value??selected.value??undefined;
    const modelOptions=[{id:MODEL_INHERIT,label:'跟随当前选择',available:true},...models.value];
    if(src&&src.model!==MODEL_INHERIT&&!modelOptions.some(o=>o.id===src.model))modelOptions.push({id:src.model,label:src.model+'（当前不可用）',available:false});
    return el('form','form',[
      !props.adapter?el('p','notice','角色接口尚未接入，当前仅展示内置预设。',{role:'status'}):loading.value?el('p','notice','正在读取角色定义…',{role:'status'}):null,
      failure.value?el('p','invalid',failure.value,{role:'status'}):null,
      el('section','section',[
        el('h3','heading','角色列表'),
        el('ul','list',[
          list.value.length===0?el('li','item',el('span','itemMeta','暂无自定义角色，可从内置预设复制或新建。'),{key:'empty'}):null,
          ...list.value.map(r=>el('li','item',[
          el('button','open',[
            el('span','itemName',r.name),
            el('span','itemMeta',[ORIGIN_LABEL[r.origin]??r.origin,(r.tools.length?r.tools.map(k=>TOOL_LABEL[k]??k).join('/'):'无本地工具'),'修订 '+shortRev(r.revision)].join(' · ')),
          ],{type:'button','aria-label':'打开角色 '+r.name,'aria-current':selectedId.value===r.id?'true':undefined,disabled:busy.value,onClick:()=>openRole(r.id)}),
          r.acpEnabled?el('span','badge','ACP'):null,
          r.origin==='builtin'?el('button','action','复制为自定义',{type:'button',disabled:!props.adapter||busy.value,'aria-label':'复制 '+r.name+' 为自定义',onClick:()=>copyRole(r)}):null,
          r.writable&&props.adapter?.deleteRole?el('button','danger',confirmingDelete.value&&selectedId.value===r.id?'确认删除':'删除',{type:'button',disabled:busy.value,'aria-label':'删除 '+r.name,onClick:()=>void removeRole(r)}):null,
        ],{key:r.id,'data-role-id':r.id,'data-role-origin':r.origin}))]),
        props.adapter?el('button','action','新建自定义角色',{type:'button',disabled:busy.value,onClick:newRole}):null,
      ]),
      src?el('section','section',[
        el('h3','heading',editing?'编辑角色':'角色详情'),
        el('div','field',[
          el('label','label','名称',{for:uid+'-name'}),
          el('input','input',null,{id:uid+'-name','aria-label':'角色名称','aria-invalid':nameInvalid.value||undefined,value:src.name,disabled:!editing||busy.value,onInput:(e:Event)=>patch({name:(e.target as HTMLInputElement).value})}),
        ]),
        editing&&nameInvalid.value?el('p','invalid','名称不能为空。'):null,
        el('div','field',[
          el('label','label','描述',{for:uid+'-description'}),
          el('input','input',null,{id:uid+'-description','aria-label':'角色描述','aria-invalid':descInvalid.value||undefined,value:src.description,disabled:!editing||busy.value,onInput:(e:Event)=>patch({description:(e.target as HTMLInputElement).value})}),
        ]),
        editing&&descInvalid.value?el('p','invalid','描述不能为空，主 Agent 依据它决定何时委派。'):null,
        el('div','field',[
          el('label','label','System Prompt',{for:uid+'-prompt'}),
          el('textarea','prompt',null,{id:uid+'-prompt','aria-label':'System Prompt',rows:6,value:src.systemPrompt,disabled:!editing||busy.value,onInput:(e:Event)=>patch({systemPrompt:(e.target as HTMLTextAreaElement).value})}),
        ]),
        el('fieldset','tools',[h('legend',null,'本地工具集（闭环勾选，不允许手写逃逸工具）'),...TOOLS.map(t=>el('label','tool',[
          el('input','checkbox',null,{type:'checkbox','aria-label':'工具：'+t.label,checked:src.tools.includes(t.key),disabled:!editing||busy.value,onChange:()=>toggleTool(t.key)}),
          el('span','toolText',[el('span','toolName',t.label),el('span','toolHint',t.hint)]),
        ],{key:t.key}))]),
        el('label','toggle',[
          el('span','label','ACP 能力（可申请调用外部 Agent）'),
          el('input','switch',null,{type:'checkbox',role:'switch','aria-label':'ACP 能力',checked:src.acpEnabled,disabled:!editing||busy.value,onChange:()=>{if(draft.value)patch({acpEnabled:!draft.value.acpEnabled});}}),
        ]),
        el('p','notice','能力只代表可以申请调用，不是自动同意：每次外部调用仍需审批，外部 Agent 继承本角色权限边界。'),
        el('div','field',[
          el('label','label','模型',{for:uid+'-model'}),
          h('select',{id:uid+'-model',class:'subagent-role-input','aria-label':'模型',value:src.model,disabled:!editing||busy.value,onChange:(e:Event)=>patch({model:(e.target as HTMLSelectElement).value})},modelOptions.map(o=>h('option',{value:o.id,key:o.id},o.label))),
        ]),
        el('p','notice','沿用当前选择或引用模型配置，不含密钥。'),
        el('div','budget',BUDGET_FIELDS.map(f=>{
          const text=draft.value?draft.value.budgetTexts[f.key]:budgetText((src as RoleDefinition).budget[f.key]);
          const fieldInvalid=budgetFieldInvalid(draft.value,f.key);
          return el('div','field',[
            el('label','label',f.label,{for:uid+'-'+f.key}),
            el('input','input',null,{id:uid+'-'+f.key,'aria-label':f.label,'aria-invalid':fieldInvalid||undefined,value:text,inputmode:'numeric',disabled:!editing||busy.value,onInput:(e:Event)=>setBudget(f.key,(e.target as HTMLInputElement).value)}),
            fieldInvalid?el('p','invalid','请输入不小于 1 的整数，留空表示不单独限制。'):null,
          ],{key:f.key});
        })),
        el('p','notice','预算不允许扩大用户授权上限；留空表示不单独限制。'),
        !editing?el('div','footer',[
          el('span','revision','当前修订 '+shortRev(selected.value?.revision??'')),
          selected.value?.writable&&props.adapter?el('button','action','编辑',{type:'button',disabled:busy.value,onClick:startEdit}):null,
        ]):null,
        conflict.value?el('p','invalid',baseline.value?'该角色已在其他位置更新（最新修订 '+shortRev(baseline.value.revision)+'）。请放弃修改后重试。':'该角色已在其他位置更新，请放弃修改后重试。',{role:'status'}):null,
        editing?el('div','footer',[
          el('span','revision',draft.value!.id?'基于修订 '+shortRev(draft.value!.baselineRevision):'新角色（无修订基线）'),
          dirty.value&&!conflict.value?el('button','action','撤销修改',{type:'button',disabled:busy.value,onClick:discardDraft}):null,
          conflict.value||failure.value?el('button','reset','放弃修改并重新读取',{type:'button',disabled:busy.value,onClick:reset}):null,
          el('button','save',busy.value?'保存中…':'保存',{type:'submit',disabled:!canSave.value}),
        ]):null,
      ]):null,
    ],{onSubmit:(e:Event)=>{e.preventDefault();void saveRole();}});
  };
}});
