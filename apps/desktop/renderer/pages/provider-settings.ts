// 模型中心·供应商管理页：注册到 'model-center.tab' 槽位。
// 所有读写穿过宿主适配器，界面不留第二份提供商状态。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType} from 'vue';
import type {ClientScope} from './slot-core';
import {cloneModel,renderModelCapabilities,type ModelCapabilities} from './model-capabilities';

// --- 类型 ---
export type Protocol='openai-completions'|'openai-responses'|'anthropic-messages';
export type Transport='direct'|'relay';
export interface Provider{id:string;name:string;baseUrl:string;protocol:Protocol;keyConfigured:boolean;declared:boolean;sortOrder:number;enabled:boolean;transport:Transport;credentialWritable?:boolean;models?:({id:string;name:string;contextWindow:string;maxTokens:string;image:boolean}&ModelCapabilities)[]}
export interface Draft extends Provider{key:string}
export interface Adapter{
  describe():Promise<{providers:Provider[];catalog:Provider[];revision:string;writable:boolean}>;
  save(draft:Draft,expectedRevision:string):Promise<void>;
  saveCredential?(id:string,key:string,expectedRevision:string):Promise<void>;
  remove(id:string,expectedRevision:string):Promise<void>;
  reorder(keys:string[],expectedRevision:string):Promise<void>;
  pullModels(providerId:string,expectedRevision:string):Promise<void>;
  subscribe?(invalidate:()=>void):()=>void;
}

// --- 校验（纯函数，前端比核心更严）---
export function validateProvider(draft:Draft,providers:Provider[],editing:boolean):string{
  if(!draft.id||!/^[a-z][a-z0-9-]*$/.test(draft.id))return 'ID 只能以小写字母开头，包含小写字母、数字和短横线';
  if(draft.id.length>64)return 'ID 最多 64 个字符';
  if(draft.name.length>100)return '显示名称最多 100 个字符';
  if(draft.baseUrl.length>512)return 'API 地址最多 512 个字符';
  if(!['openai-completions','openai-responses','anthropic-messages'].includes(draft.protocol))return 'API 协议无效';
  if(draft.transport!=='direct'&&draft.transport!=='relay')return '传输方式无效';
  if(!editing&&providers.some(p=>p.id===draft.id))return '已有供应商使用了这个 ID';
  if(!draft.name.trim())return '显示名称不能为空';
  if(!draft.baseUrl.trim())return '请输入 API 地址';
  try{const u=new URL(draft.baseUrl);const ok=u.protocol==='https:'||(u.protocol==='http:'&&(u.hostname==='127.0.0.1'||u.hostname==='localhost'));if(!ok||u.username||u.password||u.search||u.hash)return '请输入有效的 HTTP 或 HTTPS 地址';}catch{return '请输入有效的 HTTP 或 HTTPS 地址';}
  if(!editing&&!draft.key.trim())return '新增供应商需填写 API 密钥';
  if(draft.key.length>4096)return 'API 密钥最多 4096 个字符';
  if(draft.key&&/[\x00-\x20\x7f]/.test(draft.key))return '密钥格式错误';
  if(!Number.isInteger(draft.sortOrder)||draft.sortOrder<0||draft.sortOrder>1e9)return '排序需为 0–1000000000 的整数（0 表示未指定）';
  // 内置供应商只允许启停，模型目录不进入整条 update。
  if(!draft.declared){
    if(!Array.isArray(draft.models)||draft.models.length<1||draft.models.length>128)return '请配置 1–128 个模型';
    for(let i=0;i<draft.models.length;i++){
      const m=draft.models[i],prefix='模型 '+(i+1)+'：';
      if(!m||typeof m.id!=='string'||!m.id.trim()||m.id.length>200)return prefix+'ID 需为 1–200 个字符';
      if(typeof m.name!=='string'||m.name.length>100)return prefix+'名称最多 100 个字符';
      if(typeof m.contextWindow!=='string'||typeof m.maxTokens!=='string'||typeof m.image!=='boolean')return prefix+'上下文、输出上限或图片能力格式无效';
      const arrays=[['inputModalities',['text','image','audio','video','embedding']],['outputModalities',['text','image','audio','video','embedding']],['supports',['tools','stream','structured-output','image-output']]] as const;
      for(const [field,allowed] of arrays){const values=m[field];if(values!==undefined&&(!Array.isArray(values)||values.some(v=>!(allowed as readonly string[]).includes(v))||new Set(values).size!==values.length))return prefix+'能力声明无效：'+field;}
      for(const [field,allowed] of [['meterUnit',['token','image','second','request','unknown']],['provenance',['provider-listed','user-entered','human-confirmed','unknown']],['availability',['available','unsupported','unknown']]] as const){if(m[field]!==undefined&&!(allowed as readonly string[]).includes(m[field]!))return prefix+'能力声明无效：'+field;}
      if(['apiKey','api_key','key','token','secret','value'].some(field=>(m as any)[field]!==undefined&&(m as any)[field]!==null))return prefix+'不能包含密钥字段';
    }
  }
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
    const loading=ref(false),saving=ref(false),error=ref(''),message=ref('');
    const editing=ref<string|null>(null),adding=ref(false),draft=ref<Draft>(blank());
    const deleting=ref<Provider|null>(null),pulling=ref<string|null>(null);
    const credentialRetry=ref<{revision:string;snapshot:string}|null>(null);
    let off:(()=>void)|undefined,generation=0,disposed=false,draftRevision='',deleteRevision='';

    const readReady=ref(false);
    const reload=async()=>{
      if(!props.adapter||disposed)return;
      const gen=++generation;readReady.value=false;loading.value=true;error.value='';message.value='';
      try{const r=await props.adapter.describe();if(gen!==generation||disposed)return;providers.value=r.providers;catalog.value=r.catalog;revision.value=r.revision;writable.value=r.writable;readReady.value=true;return true;}
      catch(e){if(gen===generation&&!disposed){error.value=errText(e);}}
      finally{if(gen===generation&&!disposed)loading.value=false;}
    };
    const errText=(e:unknown)=>{const t=String((e as any)?.message||e);if(/conflict|conflict/.test(t))return '数据已被其他入口修改。草稿已保留；请刷新查看最新配置，取消后重新编辑再保存';return t||'操作失败';};
    const closeEdit=()=>{credentialRetry.value=null;editing.value=null;adding.value=false;draft.value=blank();error.value='';message.value='';};
    const startAdd=()=>{closeEdit();draftRevision=revision.value;adding.value=true;draft.value.sortOrder=providers.value.length;};
    const startEdit=(p:Provider)=>{credentialRetry.value=null;draftRevision=revision.value;editing.value=p.id;adding.value=false;draft.value={...p,models:(p.models||[]).map(cloneModel),key:''};error.value='';message.value='';};
    const canMutate=()=>!!props.adapter&&!disposed&&!saving.value&&!loading.value&&writable.value&&readReady.value;
    const mutate=async(action:()=>Promise<void>,done:()=>void=()=>{},success='')=>{
      saving.value=true;error.value='';message.value='';
      try{await action();if(disposed)return;done();const refreshed=await reload();if(!disposed)message.value=refreshed?success:'操作已成功，但目录刷新失败或被更新请求替代；请刷新核对最新配置';}
      catch(e){if(!disposed){error.value=errText(e);if((e as any)?.configurationRevision!==undefined)credentialRetry.value={revision:(e as any).configurationRevision,snapshot:JSON.stringify(draft.value)};}}
      finally{if(!disposed){saving.value=false;pulling.value=null;}}
    };
    const save=async()=>{
      if(!canMutate())return;
      const d={...draft.value,models:(draft.value.models||[]).map(cloneModel)};
      const inv=validateProvider(d,providers.value,editing.value!==null);
      if(inv){error.value=inv;return;}
      const expected=draftRevision;
      await mutate(()=>props.adapter!.save(d,expected),closeEdit,'已保存（能力按用户声明记录，未自动验证）');
    };
    const retryCredential=async()=>{
      const pending=credentialRetry.value;
      if(!canMutate()||!pending||!props.adapter?.saveCredential)return;
      if(pending.snapshot!==JSON.stringify(draft.value)){credentialRetry.value=null;error.value='草稿已修改，请刷新并重新编辑；旧密钥重试已失效';return;}
      const id=draft.value.id,key=draft.value.key;
      await mutate(()=>props.adapter!.saveCredential!(id,key,pending.revision),closeEdit,'密钥已保存');
    };
    const remove=async()=>{
      if(!canMutate()||!deleting.value)return;
      const id=deleting.value.id,expected=deleteRevision;
      await mutate(()=>props.adapter!.remove(id,expected),()=>{deleting.value=null;},'已删除');
    };
    const move=async(index:number,dir:'up'|'down')=>{
      if(!canMutate())return;
      const list=[...providers.value],target=dir==='up'?index-1:index+1;
      if(target<0||target>=list.length)return;
      [list[index],list[target]]=[list[target],list[index]];
      const ids=list.map(p=>p.id),expected=revision.value;
      await mutate(()=>props.adapter!.reorder(ids,expected));
    };
    const toggle=async(p:Provider)=>{
      if(!canMutate())return;
      const d={...p,models:(p.models||[]).map(cloneModel),enabled:!p.enabled,key:''},expected=revision.value;
      await mutate(()=>props.adapter!.save(d,expected));
    };
    const pull=async(p:Provider)=>{
      if(!canMutate())return;
      const id=p.id,expected=revision.value;pulling.value=id;
      await mutate(()=>props.adapter!.pullModels(id,expected),()=>{},'已拉取模型目录');
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
          btn('刷新',()=>void reload(),'btn',{'aria-label':'刷新供应商目录',disabled:loading.value||saving.value}),
          btn('+ 添加供应商',startAdd,'primary',{'aria-label':'添加供应商',disabled:!readReady.value||!writable.value||loading.value||saving.value||isEditing}),
        ]),
        !readReady.value&&!loading.value?el('p','notice','当前目录尚未核实，修改操作已暂停。请刷新后继续。',{role:'status'}):null,
        loading.value?el('p','loading','正在加载…'):null,
        error.value?el('p','error',error.value,{role:'alert'}):null,
        message.value?el('p','saved',message.value,{role:'status','aria-live':'polite'}):null,
        writable.value===false?el('p','notice','当前部署的设置文档为只读。',{role:'status'}):null,

        // 供应商列表
        el('ul','list',providers.value.map((p,i)=>el('li','row',[
          el('div','info',[
            el('strong','name',p.name||p.id),
            el('code','id',p.id),
            el('span','tag',p.declared?'内置':'自定义'),
            el('span','tag',protoLabels[p.protocol]||p.protocol),
            el('span','tag',p.transport==='direct'?'直连':'中继'),
            el('span','tag '+(p.enabled?'on':'off'),p.enabled?'已启用':'已禁用'),
            el('span','tag '+(p.keyConfigured?'on':'off'),p.keyConfigured?'密钥已配置':'密钥缺失'),
          ]),
          el('div','actions',[
            btn('编辑',()=>startEdit(p),'btn',{'aria-label':'编辑 '+(p.name||p.id),disabled:!readReady.value||!writable.value||loading.value||saving.value||isEditing}),
            btn(p.enabled?'禁用':'启用',()=>void toggle(p),'btn',{'aria-label':(p.enabled?'禁用':'启用')+' '+(p.name||p.id),disabled:!readReady.value||!writable.value||loading.value||saving.value}),
            btn(pulling.value===p.id?'拉取中…':'拉取模型',()=>void pull(p),'btn',{'aria-label':'拉取 '+(p.name||p.id)+' 模型目录',disabled:!readReady.value||!writable.value||loading.value||saving.value}),
            btn('↑',()=>void move(i,'up'),'icon',{'aria-label':'上移 '+(p.name||p.id),disabled:!readReady.value||!writable.value||loading.value||saving.value||i===0}),
            btn('↓',()=>void move(i,'down'),'icon',{'aria-label':'下移 '+(p.name||p.id),disabled:!readReady.value||!writable.value||loading.value||saving.value||i===providers.value.length-1}),
            btn('删除',()=>{deleteRevision=revision.value;deleting.value=p;error.value='';},'danger',{'aria-label':'删除 '+(p.name||p.id),disabled:!readReady.value||!writable.value||loading.value||saving.value}),
          ]),
        ],{key:p.id}))),
        !providers.value.length&&!loading.value?el('p','empty','暂无供应商，点击"添加供应商"开始配置。'):null,

        // 编辑表单
        isEditing?el('fieldset','editor',[
          el('h3',null,adding.value?'添加供应商':'编辑 '+(d.name||d.id)),
          d.declared?el('p','hint','内置供应商的名称、接口和协议由目录定义；此处可保存启停和密钥，排序请使用列表中的上移或下移。'):null,
          adding.value?el('label','field',[el('span','lbl','Provider ID'),el('input','ipt',null,{value:d.id,'aria-label':'Provider ID',placeholder:'my-provider',onInput:(e:Event)=>d.id=(e.target as HTMLInputElement).value})]):null,
          el('label','field',[el('span','lbl','显示名称'),el('input','ipt',null,{value:d.name,disabled:d.declared,'aria-label':'显示名称',placeholder:'显示名称',onInput:(e:Event)=>d.name=(e.target as HTMLInputElement).value})]),
          el('label','field',[el('span','lbl','API 地址'),el('input','ipt',null,{value:d.baseUrl,disabled:d.declared,'aria-label':'API 地址',type:'url',placeholder:'https://gateway.example/v1',onInput:(e:Event)=>d.baseUrl=(e.target as HTMLInputElement).value})]),
          el('label','field',[el('span','lbl','API 协议'),h('select',{class:'ipt',value:d.protocol,disabled:d.declared,'aria-label':'API 协议',onChange:(e:Event)=>d.protocol=(e.target as HTMLSelectElement).value as Protocol},Object.entries(protoLabels).map(([v,label])=>h('option',{value:v},label)))]),
          el('label','field',[el('span','lbl','传输方式'),h('select',{class:'ipt',value:d.transport,disabled:d.declared,'aria-label':'传输方式',onChange:(e:Event)=>d.transport=(e.target as HTMLSelectElement).value as Transport},[h('option',{value:'direct'},'直连'),h('option',{value:'relay'},'中继')])]),
          el('label','field',[el('span','lbl','排序'),el('input','ipt',null,{type:'number',min:'0',value:String(d.sortOrder),disabled:d.declared,'aria-label':'排序',onInput:(e:Event)=>d.sortOrder=parseInt((e.target as HTMLInputElement).value)||0})]),
          d.credentialWritable!==false?el('label','field',[el('span','lbl','API 密钥'),el('input','ipt',null,{type:'password',value:d.key,'aria-label':'API 密钥',placeholder:adding.value?'输入 API 密钥':'',autocomplete:'off',spellcheck:false,onInput:(e:Event)=>d.key=(e.target as HTMLInputElement).value})]):null,
          editing.value&&d.credentialWritable===false?el('p','hint','此供应商密钥由启动环境提供（只读）。'):null,
          !d.declared?el('section','model-catalog',(d.models||[]).map((m,i)=>renderModelCapabilities(m,i,saving.value||!writable.value,()=>{}))):null,
          el('label','check',[h('input',{type:'checkbox',checked:d.enabled,'aria-label':'启用',onChange:(e:Event)=>d.enabled=(e.target as HTMLInputElement).checked}),'启用此供应商']),
          credentialRetry.value?btn('仅重试密钥',()=>void retryCredential(),'primary',{disabled:saving.value||loading.value||!writable.value||!props.adapter?.saveCredential}):null,
          el('div','actions',[btn('取消',closeEdit,'btn',{disabled:saving.value}),btn(saving.value?'保存中…':'保存',()=>void save(),'primary',{disabled:!readReady.value||loading.value||saving.value||!writable.value})]),
        ],{disabled:saving.value,'aria-busy':saving.value}):null,

        // 删除确认弹窗
        deleting.value?h('div',{class:'ps-dialog',role:'alertdialog','aria-label':'确认删除'},[
          el('p',null,'确认删除 '+(deleting.value.name||deleting.value.id)+'？'),
          el('p','hint','此操作会移除供应商配置和存储的 API 密钥。'),
          el('div','actions',[btn('取消',()=>{deleting.value=null;},'btn',{disabled:saving.value}),btn(saving.value?'删除中…':'确认删除',()=>void remove(),'danger',{disabled:!readReady.value||loading.value||saving.value||!writable.value})]),
        ]):null,
      ]);
    };
  },
});

// --- 槽位注册 ---
export function install(scope:ClientScope):()=>void{
  return scope.inject('model-center.tab',(child)=>{
    // 供应商页吃 describe/save/remove/reorder/pullModels 适配器；缺适配器时
    // 页面自己显示「后端尚未接入」，不用 models-page 的编辑器冒充。
    child.register({name:'model-center.tab',id:'provider-settings',order:1,label:'供应商'},
      defineComponent({name:'SaCodeProviderSettingsSlot',props:['owner'],setup:(props)=>()=>h(Page,{adapter:(props.owner as any)?.adapter})}));
  });
}
