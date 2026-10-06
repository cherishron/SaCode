// 模型中心·自定义模型页：注册到 'model-center.tab' 槽位。
// 管理自定义模型（路由/权重/预算）与上游绑定；读写穿过宿主适配器。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType} from 'vue';
import type {ClientScope} from './slot-core';

// --- 类型 ---
export type Mode='weighted'|'round-robin';
export type Category='coding'|'general'|'vision'|'embedding'|'other';
export type Requires='tools'|'text-output'|'image-output'|'structured-output'|'stream';
export interface Binding{
  providerId:string;modelId:string;enabled:boolean;order:number;weight:number;
  priceInMicro:number;priceOutMicro:number;priceCacheReadMicro:number;priceCacheWriteMicro:number;
  priceVersion:number;currency:string;
}
export interface CustomModel{
  id:string;name:string;description:string;enabled:boolean;category:Category;requires:Requires[];
  bindings:Binding[];mode:Mode;params:string;modalityBudget:string;
  dailyTokens:number;monthlyTokens:number;dailyAmountMicro:number;monthlyAmountMicro:number;maxOutputTokens:number;
  probeEnabled:boolean;probeMaxPerDay:number;
}
export interface Draft extends CustomModel{}
export interface Adapter{
  describe():Promise<{customs:CustomModel[];providers:{id:string;name:string}[];revision:string;writable:boolean}>;
  upsert(draft:Draft,expectedRevision:string):Promise<void>;
  remove(id:string,expectedRevision:string):Promise<void>;
  bindingUpsert(customId:string,binding:Binding,expectedRevision:string):Promise<void>;
  bindingRemove(customId:string,providerId:string,modelId:string,expectedRevision:string):Promise<void>;
  bindingReorder(customId:string,keys:string[],expectedRevision:string):Promise<void>;
  subscribe?(invalidate:()=>void):()=>void;
}

// --- 校验 ---
const CATEGORIES:Category[]=['coding','general','vision','embedding','other'];
const REQUIRES_LIST:Requires[]=['tools','text-output','image-output','structured-output','stream'];
export function validateCustom(d:Draft,customs:CustomModel[],editing:boolean):string{
  if(!d.id||!/^[a-z][a-z0-9-]*$/.test(d.id))return 'ID 只能以小写字母开头，包含小写字母、数字和短横线';
  if(!editing&&customs.some(c=>c.id===d.id))return '已有自定义模型使用了这个 ID';
  if(!d.name.trim())return '名称不能为空';
  if(!CATEGORIES.includes(d.category))return '分类无效';
  if(!d.requires.length)return '至少选择一项能力要求';
  if(d.mode!=='weighted'&&d.mode!=='round-robin')return '模式无效';
  for(const col of['dailyTokens','monthlyTokens','dailyAmountMicro','monthlyAmountMicro','maxOutputTokens']){
    if(d[col]!==-1&&(!Number.isInteger(d[col])||d[col]<0))return '预算值无效：'+col;
  }
  if(d.probeMaxPerDay<0||d.probeMaxPerDay>100)return '探测上限需在 0–100 之间';
  for(let i=0;i<d.bindings.length;i++){
    const b=d.bindings[i],pfx='绑定 '+(i+1)+'：';
    if(!b.providerId.trim())return pfx+'提供商 ID 不能为空';
    if(!b.modelId.trim())return pfx+'模型 ID 不能为空';
    if(!Number.isInteger(b.weight)||b.weight<1||b.weight>1000)return pfx+'权重需在 1–1000 之间';
    for(const col of['priceInMicro','priceOutMicro','priceCacheReadMicro','priceCacheWriteMicro']){
      if(b[col]!==-1&&(!Number.isInteger(b[col])||b[col]<0))return pfx+'价格无效：'+col;
    }
  }
  const keys=d.bindings.map(b=>b.providerId+'/'+b.modelId);
  if(new Set(keys).size!==keys.length)return '绑定列表存在重复';
  return'';
}

// --- UI ---
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'cm-'+cls,...props},children);
const btn=(text:string,action:()=>void,cls='btn',more:any={})=>el('button',cls,text,{type:'button',disabled:false,onClick:action,...more});
const inp=(label:string,value:string,update:(v:string)=>void,attrs:any={})=>el('label','field',[el('span','lbl',label),el('input','ipt',null,{value,disabled:false,'aria-label':label,onInput:(e:Event)=>update((e.target as HTMLInputElement).value),...attrs})]);
const numInp=(label:string,value:number,update:(v:number)=>void,attrs:any={})=>el('label','field',[el('span','lbl',label),el('input','ipt',null,{type:'number',value:String(value),'aria-label':label,onInput:(e:Event)=>update(parseInt((e.target as HTMLInputElement).value)||0),...attrs})]);

const blank=():Draft=>({
  id:'',name:'',description:'',enabled:true,category:'coding',requires:['text-output'],
  bindings:[],mode:'weighted',params:'',modalityBudget:'',
  dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,
  probeEnabled:true,probeMaxPerDay:3,
});
const blankBinding=():Binding=>({providerId:'',modelId:'',enabled:true,order:0,weight:1,priceInMicro:-1,priceOutMicro:-1,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:0,currency:''});

// --- 主组件 ---
export const Page=defineComponent({
  name:'SaCodeCustomModels',
  props:{adapter:Object as PropType<Adapter>},
  setup(props){
    const customs=ref<CustomModel[]>([]),providers=ref<{id:string;name:string}[]>([]);
    const revision=ref(''),writable=ref(!props.adapter);
    const loading=ref(false),error=ref(''),message=ref('');
    const editing=ref<string|null>(null),adding=ref(false),draft=ref<Draft>(blank());
    const deleting=ref<CustomModel|null>(null),bindingCustom=ref<string|null>(null);
    let off:(()=>void)|undefined,generation=0,disposed=false;

    const reload=async()=>{
      if(!props.adapter)return;
      const gen=++generation;loading.value=true;error.value='';
      try{const r=await props.adapter.describe();if(gen!==generation||disposed)return;customs.value=r.customs;providers.value=r.providers;revision.value=r.revision;writable.value=r.writable;}
      catch(e){if(gen===generation&&!disposed)error.value=errText(e);}
      finally{if(gen===generation&&!disposed)loading.value=false;}
    };
    const errText=(e:unknown)=>{const t=String((e as any)?.message||e);if(/conflict/.test(t))return '数据已被修改，请刷新后重试';return t||'操作失败';};
    const closeEdit=()=>{editing.value=null;adding.value=false;draft.value=blank();bindingCustom.value=null;error.value='';message.value='';};
    const startAdd=()=>{adding.value=true;editing.value=null;draft.value=blank();error.value='';};
    const startEdit=(c:CustomModel)=>{editing.value=c.id;adding.value=false;draft.value={...c,bindings:[...c.bindings]};error.value='';message.value='';};
    const save=async()=>{
      if(!props.adapter)return;
      const d=draft.value,inv=validateCustom(d,customs.value,editing.value!==null);
      if(inv){error.value=inv;return;}
      try{await props.adapter.upsert(d,revision.value);message.value='已保存';closeEdit();await reload();}
      catch(e){error.value=errText(e);}
    };
    const remove=async()=>{
      if(!props.adapter||!deleting.value)return;
      try{await props.adapter.remove(deleting.value.id,revision.value);deleting.value=null;message.value='已删除';await reload();}
      catch(e){error.value=errText(e);}
    };
    const addBinding=()=>{if(draft.value)draft.value.bindings=[...draft.value.bindings,blankBinding()];};
    const removeBinding=(i:number)=>{if(draft.value)draft.value.bindings=[...draft.value.bindings.filter((_,j)=>j!==i)];};
    const moveBinding=(i:number,dir:'up'|'down')=>{
      if(!draft.value)return;const list=[...draft.value.bindings],t=dir==='up'?i-1:i+1;
      if(t<0||t>=list.length)return;[list[i],list[t]]=[list[t],list[i]];draft.value.bindings=list;
    };
    const toggleBinding=(b:Binding)=>{b.enabled=!b.enabled;};

    onMounted(()=>{off=props.adapter?.subscribe?.(()=>{void reload();});void reload();});
    onBeforeUnmount(()=>{disposed=true;generation++;off?.();});

    const catLabels:Record<Category,string>={coding:'编程',general:'通用',vision:'视觉',embedding:'向量',other:'其他'};
    const reqLabels:Record<Requires,string>={'tools':'工具调用','text-output':'文本输出','image-output':'图像输出','structured-output':'结构化输出','stream':'流式'};

    return()=>{
      if(!props.adapter)return el('section','root',[el('h2',null,'自定义模型'),el('p','notice','自定义模型后端尚未接入。',{role:'status'})]);
      const isEditing=editing.value!==null||adding.value;
      const d=draft.value;
      return el('section','root',[
        el('div','header',[
          el('h2',null,'自定义模型'),
          el('p','intro','创建自定义模型，配置路由模式、上游绑定、权重与预算。'),
          btn('+ 添加自定义模型',startAdd,'primary',{disabled:!writable.value||loading.value||isEditing}),
        ]),
        loading.value?el('p','loading','正在加载…'):null,
        error.value?el('p','error',error.value,{role:'alert'}):null,
        message.value?el('p','saved',message.value,{role:'status','aria-live':'polite'}):null,
        !writable.value?el('p','notice','当前部署的设置文档为只读。',{role:'status'}):null,

        el('ul','list',customs.value.map(c=>el('li','row',[
          el('div','info',[
            el('strong','name',c.name||c.id),
            el('code','id',c.id),
            el('span','tag',catLabels[c.category]||c.category),
            el('span','tag',c.mode==='weighted'?'加权路由':'轮询路由'),
            el('span','tag '+(c.enabled?'on':'off'),c.enabled?'已启用':'已禁用'),
            el('span','tag',c.bindings.length+' 个绑定'),
            c.requires.map(r=>el('span','tag',reqLabels[r]||r)),
          ]),
          el('div','actions',[
            btn('编辑',()=>startEdit(c),'btn',{'aria-label':'编辑 '+(c.name||c.id),disabled:!writable.value||loading.value||isEditing}),
            btn('删除',()=>{deleting.value=c;error.value='';},'danger',{'aria-label':'删除 '+(c.name||c.id),disabled:!writable.value||loading.value}),
          ]),
        ],{key:c.id}))),
        !customs.value.length&&!loading.value?el('p','empty','暂无自定义模型，点击"添加自定义模型"开始配置。'):null,

        isEditing?el('div','editor',[
          el('h3',null,adding.value?'添加自定义模型':'编辑 '+(d.name||d.id)),

          // 基本信息
          el('fieldset','section',[el('legend',null,'基本信息'),
            adding.value?el('label','field',[el('span','lbl','ID'),el('input','ipt',null,{value:d.id,'aria-label':'ID',placeholder:'my-model',onInput:(e:Event)=>d.id=(e.target as HTMLInputElement).value})]):null,
            el('label','field',[el('span','lbl','名称'),el('input','ipt',null,{value:d.name,'aria-label':'名称',placeholder:'模型名称',onInput:(e:Event)=>d.name=(e.target as HTMLInputElement).value})]),
            el('label','field',[el('span','lbl','描述'),el('input','ipt',null,{value:d.description,'aria-label':'描述',placeholder:'可选描述',onInput:(e:Event)=>d.description=(e.target as HTMLInputElement).value})]),
            el('label','field',[el('span','lbl','分类'),h('select',{class:'ipt',value:d.category,'aria-label':'分类',onChange:(e:Event)=>d.category=(e.target as HTMLSelectElement).value as Category},Object.entries(catLabels).map(([v,l])=>h('option',{value:v},l)))]),
            el('label','check',[h('input',{type:'checkbox',checked:d.enabled,'aria-label':'启用',onChange:(e:Event)=>d.enabled=(e.target as HTMLInputElement).checked}),'启用此模型']),
          ]),

          // 能力要求
          el('fieldset','section',[el('legend',null,'能力要求'),
            el('p','hint','至少选择一项。'),
            REQUIRES_LIST.map(r=>el('label','check',[h('input',{type:'checkbox',checked:d.requires.includes(r),'aria-label':reqLabels[r],onChange:(e:Event)=>{const v=(e.target as HTMLInputElement).checked;if(v&&!d.requires.includes(r))d.requires=[...d.requires,r];else if(!v)d.requires=d.requires.filter(x=>x!==r);}}),reqLabels[r]])),
          ]),

          // 路由模式
          el('fieldset','section',[el('legend',null,'路由模式'),
            el('label','radio',[h('input',{type:'radio',name:'mode',checked:d.mode==='weighted','aria-label':'加权路由',onChange:()=>d.mode='weighted'}),'加权路由（按权重分配）']),
            el('label','radio',[h('input',{type:'radio',name:'mode',checked:d.mode==='round-robin','aria-label':'轮询路由',onChange:()=>d.mode='round-robin'}),'轮询路由（按顺序轮询）']),
          ]),

          // 预算
          el('fieldset','section',[el('legend',null,'预算（-1 = 未设置）'),
            numInp('每日 Token 上限',d.dailyTokens,v=>d.dailyTokens=v,{min:'-1'}),
            numInp('每月 Token 上限',d.monthlyTokens,v=>d.monthlyTokens=v,{min:'-1'}),
            numInp('每日金额（微单位）',d.dailyAmountMicro,v=>d.dailyAmountMicro=v,{min:'-1'}),
            numInp('每月金额（微单位）',d.monthlyAmountMicro,v=>d.monthlyAmountMicro=v,{min:'-1'}),
            numInp('最大输出 Token',d.maxOutputTokens,v=>d.maxOutputTokens=v,{min:'-1'}),
          ]),

          // 探测
          el('fieldset','section',[el('legend',null,'探测'),
            el('label','check',[h('input',{type:'checkbox',checked:d.probeEnabled,'aria-label':'启用探测',onChange:(e:Event)=>d.probeEnabled=(e.target as HTMLInputElement).checked}),'启用探测']),
            numInp('每日探测上限',d.probeMaxPerDay,v=>d.probeMaxPerDay=v,{min:'0',max:'100'}),
          ]),

          // 上游绑定
          el('fieldset','section',[el('legend',null,'上游绑定（' + d.bindings.length + ' 个）'),
            d.mode==='weighted'?el('p','hint','加权模式：weight 为 1–1000 的整数。轮询模式：权重被忽略。'):null,
            d.bindings.map((b,i)=>el('div','binding',[
              el('div','brow',[
                el('span','order','第 ' + (i+1) + ' 位'),
                el('input','ipt',null,{value:b.providerId,'aria-label':'提供商 ID',placeholder:'提供商 ID',onInput:(e:Event)=>b.providerId=(e.target as HTMLInputElement).value}),
                el('input','ipt',null,{value:b.modelId,'aria-label':'模型 ID',placeholder:'模型 ID',onInput:(e:Event)=>b.modelId=(e.target as HTMLInputElement).value}),
                el('label','check',[h('input',{type:'checkbox',checked:b.enabled,'aria-label':'启用绑定',onChange:()=>toggleBinding(b)}),'启用']),
                d.mode==='weighted'?el('input','ipt',null,{type:'number',min:'1',max:'1000',value:String(b.weight),'aria-label':'权重',onInput:(e:Event)=>b.weight=parseInt((e.target as HTMLInputElement).value)||1}):null,
                btn('↑',()=>moveBinding(i,'up'),'icon',{'aria-label':'上移',disabled:i===0}),
                btn('↓',()=>moveBinding(i,'down'),'icon',{'aria-label':'下移',disabled:i===d.bindings.length-1}),
                btn('×',()=>removeBinding(i),'icon danger',{'aria-label':'删除绑定'}),
              ]),
              el('div','pricings',[
                numInp('输入价格（微）',b.priceInMicro,v=>b.priceInMicro=v,{min:'-1'}),
                numInp('输出价格（微）',b.priceOutMicro,v=>b.priceOutMicro=v,{min:'-1'}),
                numInp('缓存读（微）',b.priceCacheReadMicro,v=>b.priceCacheReadMicro=v,{min:'-1'}),
                numInp('缓存写（微）',b.priceCacheWriteMicro,v=>b.priceCacheWriteMicro=v,{min:'-1'}),
                el('input','ipt',null,{value:b.currency,'aria-label':'货币',placeholder:'货币（如 CNY）',onInput:(e:Event)=>b.currency=(e.target as HTMLInputElement).value}),
              ]),
            ],{key:i})),
            !d.bindings.length?el('p','hint','尚未添加绑定。'):null,
            btn('+ 添加绑定',addBinding,'secondary',{disabled:!writable.value}),
          ]),

          // 操作
          el('div','actions',[btn('取消',closeEdit),btn('保存',()=>void save(),'primary',{disabled:loading.value})]),
        ]):null,

        // 删除确认
        deleting.value?h('div',{class:'cm-dialog',role:'alertdialog','aria-label':'确认删除'},[
          el('p',null,'确认删除 '+(deleting.value.name||deleting.value.id)+'？'),
          el('p','hint','此操作会移除自定义模型及其所有绑定。'),
          el('div','actions',[btn('取消',()=>{deleting.value=null;}),btn('确认删除',()=>void remove(),'danger',{disabled:loading.value})]),
        ]):null,
      ]);
    };
  },
});

// --- 槽位注册 ---
export function install(scope:ClientScope):()=>void{
  return scope.inject('model-center.tab',(child)=>{
    child.register({name:'model-center.tab',id:'custom-models',order:1,label:'自定义模型'},
      defineComponent({name:'SaCodeCustomModelsSlot',props:['owner'],setup:(props)=>()=>h(Page,{adapter:(props.owner as any)?.adapter})}));
  });
}
