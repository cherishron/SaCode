// 模型中心·供应商管理页：注册到 'model-center.tab' 槽位。
// 所有读写穿过宿主适配器，界面不留第二份提供商状态。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType} from 'vue';
import type {ClientScope} from './slot-core';
import {Page as ProviderEditor} from './models-page';

// --- 类型 ---
export type Protocol='openai-completions'|'openai-responses'|'anthropic-messages';
export type Transport='direct'|'relay';
export interface Provider{id:string;name:string;baseUrl:string;protocol:Protocol;keyConfigured:boolean;declared:boolean;sortOrder:number;enabled:boolean;transport:Transport;credentialWritable?:boolean}
export interface Draft extends Provider{key:string}
export interface Adapter{
  describe():Promise<{providers:Provider[];catalog:Provider[];revision:string;writable:boolean}>;
  save(draft:Draft,expectedRevision:string):Promise<void>;
  remove(id:string,expectedRevision:string):Promise<void>;
  reorder(keys:string[],expectedRevision:string):Promise<void>;
  pullModels(providerId:string,expectedRevision:string):Promise<void>;
  subscribe?(invalidate:()=>void):()=>void;
}

// --- 校验（纯函数，前端比核心更严）---
export function validateProvider(draft:Draft,providers:Provider[],editing:boolean):string{
  if(!draft.id||!/^[a-z][a-z0-9-]*$/.test(draft.id))return 'ID 只能以小写字母开头，包含小写字母、数字和短横线';
  if(!editing&&providers.some(p=>p.id===draft.id))return '已有供应商使用了这个 ID';
  if(!draft.name.trim())return '显示名称不能为空';
  if(!draft.baseUrl.trim())return '请输入 API 地址';
  try{const u=new URL(draft.baseUrl);const ok=u.protocol==='https:'||(u.protocol==='http:'&&(u.hostname==='127.0.0.1'||u.hostname==='localhost'));if(!ok||u.username||u.password||u.search||u.hash)return '请输入有效的 HTTP 或 HTTPS 地址';}catch{return '请输入有效的 HTTP 或 HTTPS 地址';}
  if(!editing&&!draft.key.trim())return '新增供应商需填写 API 密钥';
  if(draft.key&&/[\x00-\x20\x7f]/.test(draft.key))return '密钥格式错误';
  if(!Number.isInteger(draft.sortOrder)||draft.sortOrder<0)return '排序需为非负整数';
  return'';
}

// --- UI 辅助 ---
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'ps-'+cls,...props},children);
const btn=(text:string,action:()=>void,cls='btn',more:any={})=>el('button',cls,text,{type:'button',disabled:false,onClick:action,...more});
const inp=(label:string,value:string,update:(v:string)=>void,attrs:any={})=>el('label','field',[el('span','lbl',label),el('input','ipt',null,{value,disabled:false,'aria-label':label,onInput:(e:Event)=>update((e.target as HTMLInputElement).value),...attrs})]);

// --- 空草稿 ---
const blank=():Draft=>({id:'',name:'',baseUrl:'',protocol:'openai-completions',keyConfigured:false,declared:true,sortOrder:0,enabled:true,transport:'direct',key:''});

// --- 主组件 ---
export const Page=defineComponent({
  name:'SaCodeProviderSettings',
  props:{adapter:Object as PropType<Adapter>},
  setup(props){
    const providers=ref<Provider[]>([]),catalog=ref<Provider[]>([]),revision=ref(''),writable=ref(!props.adapter);
    const loading=ref(false),error=ref(''),message=ref('');
    const editing=ref<string|null>(null),adding=ref(false),draft=ref<Draft>(blank());
    const deleting=ref<Provider|null>(null),pulling=ref<string|null>(null);
    let off:(()=>void)|undefined,generation=0,disposed=false;

    const reload=async()=>{
      if(!props.adapter)return;
      const gen=++generation;loading.value=true;error.value='';
      try{const r=await props.adapter.describe();if(gen!==generation||disposed)return;providers.value=r.providers;catalog.value=r.catalog;revision.value=r.revision;writable.value=r.writable;}
      catch(e){if(gen===generation&&!disposed){error.value=errText(e);}}
      finally{if(gen===generation&&!disposed)loading.value=false;}
    };
    const errText=(e:unknown)=>{const t=String((e as any)?.message||e);if(/conflict|conflict/.test(t))return '数据已被其他入口修改，请刷新后重试';return t||'操作失败';};
    const closeEdit=()=>{editing.value=null;adding.value=false;draft.value=blank();error.value='';message.value='';};
    const startAdd=()=>{closeEdit();adding.value=true;draft.value.sortOrder=providers.value.length;};
    const startEdit=(p:Provider)=>{editing.value=p.id;adding.value=false;draft.value={...p,key:''};error.value='';message.value='';};
    const save=async()=>{
      if(!props.adapter)return;
      const d=draft.value,inv=validateProvider(d,providers.value,editing.value!==null);
      if(inv){error.value=inv;return;}
      try{await props.adapter.save(d,revision.value);message.value='已保存';closeEdit();await reload();}
      catch(e){error.value=errText(e);}
    };
    const remove=async()=>{
      if(!props.adapter||!deleting.value)return;
      try{await props.adapter.remove(deleting.value.id,revision.value);deleting.value=null;message.value='已删除';await reload();}
      catch(e){error.value=errText(e);}
    };
    const move=async(index:number,dir:'up'|'down')=>{
      if(!props.adapter)return;
      const list=[...providers.value],target=dir==='up'?index-1:index+1;
      if(target<0||target>=list.length)return;
      [list[index],list[target]]=[list[target],list[index]];
      try{await props.adapter.reorder(list.map(p=>p.id),revision.value);await reload();}
      catch(e){error.value=errText(e);}
    };
    const toggle=async(p:Provider)=>{
      if(!props.adapter)return;
      try{await props.adapter.save({...p,enabled:!p.enabled,key:''},revision.value);await reload();}
      catch(e){error.value=errText(e);}
    };
    const pull=async(p:Provider)=>{
      if(!props.adapter)return;pulling.value=p.id;
      try{await props.adapter.pullModels(p.id,revision.value);message.value='已拉取模型目录';await reload();}
      catch(e){error.value=errText(e);}
      finally{pulling.value=null;}
    };

    onMounted(()=>{off=props.adapter?.subscribe?.(()=>{void reload();});void reload();});
    onBeforeUnmount(()=>{disposed=true;generation++;off?.();});

    const protoLabels:Record<Protocol,string>={'openai-completions':'OpenAI Completions','openai-responses':'OpenAI Responses','anthropic-messages':'Anthropic Messages'};

    return()=>{
      if(!props.adapter)return el('section','root',[el('h2',null,'供应商管理'),el('p','notice','供应商管理后端尚未接入。',{role:'status'})]);
      const unavailable='供应商管理后端不可用';
      const isEditing=editing.value!==null||adding.value;
      const d=draft.value;
      return el('section','root',[
        el('div','header',[
          el('h2',null,'供应商管理'),
          el('p','intro','管理模型提供商及其 API 密钥。'),
          btn('+ 添加供应商',startAdd,'primary',{'aria-label':'添加供应商',disabled:!writable.value||loading.value||isEditing}),
        ]),
        loading.value?el('p','loading','正在加载…'):null,
        error.value?el('p','error',error.value,{role:'alert'}):null,
        message.value?el('p','saved',message.value,{role:'status','aria-live':'polite'}):null,
        writable.value===false?el('p','notice','当前部署的设置文档为只读。',{role:'status'}):null,

        // 供应商列表
        el('ul','list',providers.value.map((p,i)=>el('li','row',[
          el('div','info',[
            el('strong','name',p.name||p.id),
            el('code','id',p.id),
            el('span','tag',p.declared?'自定义':'内置'),
            el('span','tag',protoLabels[p.protocol]||p.protocol),
            el('span','tag',p.transport==='direct'?'直连':'中继'),
            el('span','tag '+(p.enabled?'on':'off'),p.enabled?'已启用':'已禁用'),
            el('span','tag '+(p.keyConfigured?'on':'off'),p.keyConfigured?'密钥已配置':'密钥缺失'),
          ]),
          el('div','actions',[
            btn('编辑',()=>startEdit(p),'btn',{'aria-label':'编辑 '+(p.name||p.id),disabled:!writable.value||loading.value||isEditing}),
            btn(p.enabled?'禁用':'启用',()=>void toggle(p),'btn',{'aria-label':(p.enabled?'禁用':'启用')+' '+(p.name||p.id),disabled:!writable.value||loading.value}),
            btn(pulling.value===p.id?'拉取中…':'拉取模型',()=>void pull(p),'btn',{'aria-label':'拉取 '+(p.name||p.id)+' 模型目录',disabled:!writable.value||loading.value}),
            btn('↑',()=>void move(i,'up'),'icon',{'aria-label':'上移 '+(p.name||p.id),disabled:!writable.value||loading.value||i===0}),
            btn('↓',()=>void move(i,'down'),'icon',{'aria-label':'下移 '+(p.name||p.id),disabled:!writable.value||loading.value||i===providers.value.length-1}),
            btn('删除',()=>{deleting.value=p;error.value='';},'danger',{'aria-label':'删除 '+(p.name||p.id),disabled:!writable.value||loading.value}),
          ]),
        ],{key:p.id}))),
        !providers.value.length&&!loading.value?el('p','empty','暂无供应商，点击"添加供应商"开始配置。'):null,

        // 编辑表单
        isEditing?el('div','editor',[
          el('h3',null,adding.value?'添加供应商':'编辑 '+(d.name||d.id)),
          adding.value?el('label','field',[el('span','lbl','Provider ID'),el('input','ipt',null,{value:d.id,'aria-label':'Provider ID',placeholder:'my-provider',onInput:(e:Event)=>d.id=(e.target as HTMLInputElement).value})]):null,
          el('label','field',[el('span','lbl','显示名称'),el('input','ipt',null,{value:d.name,'aria-label':'显示名称',placeholder:'显示名称',onInput:(e:Event)=>d.name=(e.target as HTMLInputElement).value})]),
          el('label','field',[el('span','lbl','API 地址'),el('input','ipt',null,{value:d.baseUrl,'aria-label':'API 地址',type:'url',placeholder:'https://gateway.example/v1',onInput:(e:Event)=>d.baseUrl=(e.target as HTMLInputElement).value})]),
          el('label','field',[el('span','lbl','API 协议'),h('select',{class:'ipt',value:d.protocol,'aria-label':'API 协议',onChange:(e:Event)=>d.protocol=(e.target as HTMLSelectElement).value as Protocol},Object.entries(protoLabels).map(([v,label])=>h('option',{value:v},label)))]),
          el('label','field',[el('span','lbl','传输方式'),h('select',{class:'ipt',value:d.transport,'aria-label':'传输方式',onChange:(e:Event)=>d.transport=(e.target as HTMLSelectElement).value as Transport},[h('option',{value:'direct'},'直连'),h('option',{value:'relay'},'中继')])]),
          el('label','field',[el('span','lbl','排序'),el('input','ipt',null,{type:'number',min:'0',value:String(d.sortOrder),'aria-label':'排序',onInput:(e:Event)=>d.sortOrder=parseInt((e.target as HTMLInputElement).value)||0})]),
          !editing.value?el('label','field',[el('span','lbl','API 密钥'),el('input','ipt',null,{type:'password',value:d.key,'aria-label':'API 密钥',placeholder:adding.value?'输入 API 密钥':'',autocomplete:'off',spellcheck:false,onInput:(e:Event)=>d.key=(e.target as HTMLInputElement).value})]):null,
          editing.value&&d.credentialWritable===false?el('p','hint','此供应商密钥由启动环境提供（只读）。'):null,
          el('label','check',[h('input',{type:'checkbox',checked:d.enabled,'aria-label':'启用',onChange:(e:Event)=>d.enabled=(e.target as HTMLInputElement).checked}),'启用此供应商']),
          el('div','actions',[btn('取消',closeEdit),btn('保存',()=>void save(),'primary',{disabled:loading.value})]),
        ]):null,

        // 删除确认弹窗
        deleting.value?h('div',{class:'ps-dialog',role:'alertdialog','aria-label':'确认删除'},[
          el('p',null,'确认删除 '+(deleting.value.name||deleting.value.id)+'？'),
          el('p','hint','此操作会移除供应商配置和存储的 API 密钥。'),
          el('div','actions',[btn('取消',()=>{deleting.value=null;}),btn('确认删除',()=>void remove(),'danger',{disabled:loading.value})]),
        ]):null,
      ]);
    };
  },
});

// --- 槽位注册 ---
export function install(scope:ClientScope):()=>void{
  return scope.inject('model-center.tab',(child)=>{
    child.register({name:'model-center.tab',id:'provider-settings',order:0,label:'供应商'},
      defineComponent({name:'SaCodeProviderSettingsSlot',props:['owner'],setup:(props)=>()=>h(ProviderEditor,{adapter:(props.owner as any)?.adapter})}));
  });
}
