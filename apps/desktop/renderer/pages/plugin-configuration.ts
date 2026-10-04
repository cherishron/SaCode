// 插件配置共用暂存表单：字段值、覆盖层与修订号来自共享核心，密钥不进入设置快照。
import { defineComponent, h, ref, computed, onMounted, onBeforeUnmount, useId, type PropType } from 'vue';
import type { Adapter as SubagentAdapter } from './subagent-settings';
export interface Field { key: string; label: string; hint: string; numeric?: boolean }
export interface Definition { namespace: string; title: string; description: string; fields: Field[]; credential?: boolean }
export interface Snapshot {
  revision: string; available: boolean; writable: boolean;
  fields: Record<string, { text: string; overridden: boolean }>;
  credential?: { configured: boolean; writable: boolean };
}
export type Patch = { key: string; op: 'set'; value: string | number } | { key: string; op: 'unset' };
export interface Adapter {
  read(namespace: string): Promise<Snapshot>;
  apply(namespace: string, patches: Patch[], expectedRevision: string): Promise<Snapshot>;
  writeCredential(namespace: string, secret: string): Promise<void>;
  subscribe?(namespace: string, invalidate: () => void): () => void;
}
export const definitions: Definition[] = [
  { namespace:'agent-loop', title:'Agent 循环', description:'控制 Agent 派发工具调用的方式。', fields:[{key:'maxParallelToolCalls',label:'并行工具调用数',hint:'同一步内最多同时运行多少个可并行的调用。',numeric:true}] },
  { namespace:'shell',title:'终端',description:'限制每条命令最多能跑多久、最多输出多少内容。',fields:[{key:'timeoutMs',label:'命令超时（毫秒）',hint:'单条命令允许运行多久，超时即终止。',numeric:true},{key:'maxOutputBytes',label:'单流输出上限（字节）',hint:'超出部分会转存到临时文件，而不是被丢弃。',numeric:true}] },
  { namespace:'web-search',title:'网络搜索',description:'设置搜索提供方的接口和请求预算。',credential:true,fields:[{key:'baseURL',label:'接口地址',hint:'留空则使用提供方默认地址。'},{key:'maxUses',label:'单次请求最多搜索次数',hint:'一次请求在必须作答前最多可以搜索多少次。',numeric:true}] },
  { namespace:'subagent',title:'子智能体',description:'设置子智能体的递归层级、数量和模型。',fields:[] },
];
const el = (tag:string,cls:string,children:any,props:any={}) => h(tag,{class:'plugin-config-'+cls,...props},children);
let formInstance = 0;
export const Form = defineComponent({
  name:'SaCodePluginSettingsForm',props:{definition:{type:Object as PropType<Definition>,required:true},adapter:Object as PropType<Adapter>},
  setup(props) {
    const uid='plugin-config-'+useId()+'-'+(++formInstance), state=ref<Snapshot|null>(null), drafts=ref<Record<string,string>>({});
    const key=ref(''), failure=ref(''), busy=ref(false), loading=ref(false), baseline=ref<string|null>(null);
    let generation=0,disposed=false,off:(()=>void)|undefined;
    const read=async()=>{
      if(!props.adapter)return;const request=++generation;loading.value=true;
      try {const value=await props.adapter.read(props.definition.namespace);if(!disposed&&request===generation)state.value=value;}
      catch {if(!disposed&&request===generation)failure.value='暂时无法读取插件配置，请重试。';}
      finally {if(!disposed&&request===generation)loading.value=false;}
    };
    onMounted(()=>{off=props.adapter?.subscribe?.(props.definition.namespace,()=>{void read();});void read();});
    onBeforeUnmount(()=>{disposed=true;generation++;off?.();drafts.value={};key.value='';baseline.value=null;});
    const edit=(field:string,text:string)=>{if(baseline.value===null)baseline.value=state.value?.revision||'';drafts.value={...drafts.value,[field]:text};failure.value='';};
    const plan=computed(()=>props.definition.fields.flatMap(field=>{
      if(!(field.key in drafts.value))return [];
      const text=drafts.value[field.key].trim(), accepted=state.value?.fields[field.key];
      if(!text)return accepted?.overridden?[{key:field.key,op:'unset'} as Patch]:[];
      const value=field.numeric?Number(text):text;
      if(String(value)===accepted?.text&&accepted.overridden)return [];
      return [{key:field.key,op:'set',value} as Patch];
    }));
    const invalid=computed(()=>props.definition.fields.some(f=>f.numeric&&f.key in drafts.value&&drafts.value[f.key].trim()!==''&&!Number.isFinite(Number(drafts.value[f.key].trim()))));
    const secretDirty=computed(()=>key.value.length>0);
    const canSave=computed(()=>!!state.value?.available&&!busy.value&&!invalid.value&&(!plan.value.length||state.value.writable)&&(!secretDirty.value||state.value.credential?.writable)&&!!(plan.value.length||secretDirty.value));
    const save=async()=>{
      if(!props.adapter||!canSave.value)return;busy.value=true;failure.value='';
      try {
        // 官方顺序：配置修订屏障先落地，随后写独立凭证；成功部分不重复写。
        if(plan.value.length){const value=await props.adapter.apply(props.definition.namespace,plan.value,baseline.value||state.value!.revision);state.value=value;drafts.value={};baseline.value=null;}
        if(secretDirty.value){await props.adapter.writeCredential(props.definition.namespace,key.value);key.value='';await read();}
      } catch(e) {failure.value=(e as {code?:string})?.code==='settings-conflict'?'这些设置已被另一入口修改。请重新读取后在当前值上编辑。':'本部署没有接受这些值，已保留供你修改。';}
      finally {busy.value=false;}
    };
    return ()=>el('div','form',[
      !props.adapter?el('p','notice','配置接口尚未接入，不能读取或保存这些设置。',{role:'status'}):loading.value?el('p','notice','正在读取插件配置…',{role:'status'}):null,
      failure.value?el('div','failed',[el('p','notice',failure.value,{role:'status'}),el('button','reset','重新读取',{type:'button',disabled:busy.value,onClick:()=>{drafts.value={};key.value='';baseline.value=null;failure.value='';void read();}})]):null,
      state.value&&!state.value.available?el('p','notice','该插件当前未加载，暂时无法配置。',{role:'status'}):null,
      state.value?.available?[
        !state.value.writable?el('p','notice','本部署的设置为只读。',{role:'status'}):null,
        props.definition.credential?el('div','field',[el('label','label','API Key',{for:uid+'-key'}),el('p','notice',state.value.credential?.configured?'已配置密钥。':'未配置密钥。'),el('input','input',null,{id:uid+'-key',type:'password',autocomplete:'new-password','aria-label':'搜索 API Key',value:key.value,disabled:busy.value||!state.value.credential?.writable,onInput:(e:Event)=>{key.value=(e.target as HTMLInputElement).value;failure.value='';}}),el('p','hint','不写入设置文件。留空表示保持当前密钥。')]):null,
        ...props.definition.fields.map(field=>{
          const accepted=state.value!.fields[field.key], text=drafts.value[field.key]??accepted?.text??'';
          const overridden=field.key in drafts.value?drafts.value[field.key].trim()!=='':!!accepted?.overridden;
          const bad=field.numeric&&text.trim()!==''&&!Number.isFinite(Number(text));
          return el('div','field',[el('div','head',[el('label','label',field.label,{for:uid+'-'+field.key}),overridden?el('span','badge','已覆盖'):null,el('button','reset','恢复默认',{type:'button',disabled:busy.value||!state.value!.writable,onClick:()=>edit(field.key,'')})]),
            el('input','input',null,{id:uid+'-'+field.key,'aria-label':field.label,'aria-invalid':!!bad,'aria-describedby':uid+'-'+field.key+'-hint',inputmode:field.numeric?'decimal':undefined,value:text,disabled:busy.value||!state.value!.writable,onInput:(e:Event)=>edit(field.key,(e.target as HTMLInputElement).value)}),
            el('p',bad?'invalid':'hint',bad?'请填数字；留空表示使用默认值。':field.hint,{id:uid+'-'+field.key+'-hint'})],{key:field.key});
        }),
        el('div','footer',[el('button','save',busy.value?'保存中…':'保存',{type:'button',disabled:!canSave.value,onClick:save})]),
      ]:null,
    ]);
  },
});
export const Page=defineComponent({
  name:'SaCodePluginConfiguration',props:{adapter:Object as PropType<Adapter>,subagentAdapter:Object as PropType<SubagentAdapter>},
  setup(props){const chosen=ref<string|null>(null);return()=>el('div','page',[
    !props.adapter?el('p','notice','以下为复刻目标的配置页面，仓颉配置接口尚未接入。',{role:'status'}):null,
    ...definitions.map(d=>el('section','card',[el('button','cardHead',[el('strong','title',d.title),el('span','summary',d.description)],{type:'button','aria-expanded':chosen.value===d.namespace,onClick:()=>chosen.value=chosen.value===d.namespace?null:d.namespace}),
      chosen.value===d.namespace?(d.namespace==='subagent'?h((window as any).SaCodeSubagent.Card,{adapter:props.subagentAdapter}):h(Form,{definition:d,adapter:props.adapter})):null],{key:d.namespace,'data-config-namespace':d.namespace})),
  ]);},
});
