// 模型中心·迁移页：注册到 'model-center.tab' 槽位。
// 一键导出当前自定义模型配置（不含凭据），导入走统一差异预览。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType} from 'vue';
import type {ClientScope} from './slot-core';

// --- 类型 ---
export interface CustomSummary{id:string;name:string;description:string;enabled:boolean;category:string;mode:string;bindingsCount:number}
export interface Adapter{
  describe():Promise<{customs:CustomSummary[];revision:string;writable:boolean}>;
  importNew(items:string[],expectedRevision:string):Promise<void>;
  importInto(customId:string,items:string[],expectedRevision:string):Promise<void>;
  subscribe?(invalidate:()=>void):()=>void;
}

// --- 校验（纯函数）---
const KEY_RE=/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/;
export function validateItems(items:string[]):string{
  if(!Array.isArray(items)||items.length===0)return'请至少提供一条 "providerId/modelId"';
  if(items.length>128)return'每次导入不能超过 128 条';
  for(let i=0;i<items.length;i++){
    const s=items[i];
    if(typeof s!=='string'||!KEY_RE.test(s))return'第 '+(i+1)+' 条格式无效：应为 "providerId/modelId"（小写字母/数字/短横线 + 斜杠 + 模型 ID）';
  }
  if(new Set(items).size!==items.length)return'列表中存在重复条目';
  return'';
}

// --- 导出序列化（纯函数）---
export function buildExport(customs:CustomSummary[]):string{
  return JSON.stringify({format:'sacode-custom-migration',version:1,exportedAt:new Date().toISOString(),customs},null,2);
}

// --- UI ---
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'mig-'+cls,...props},children);
const btn=(text:string,action:()=>void,cls='btn',more:any={})=>el('button',cls,text,{type:'button',disabled:false,onClick:action,...more});

// --- 主组件 ---
export const Page=defineComponent({
  name:'SaCodeMigration',
  props:{adapter:Object as PropType<Adapter>},
  setup(props){
    const customs=ref<CustomSummary[]>([]),revision=ref(''),writable=ref(!props.adapter);
    const loading=ref(false),error=ref(''),message=ref('');
    const importing=ref(false);
    const exportText=ref('');
    const importText=ref('');
    const copied=ref(false);
    let off:(()=>void)|undefined,disposed=false;

    const load=async()=>{
      if(!props.adapter)return;
      loading.value=true;error.value='';
      try{const r=await props.adapter.describe();if(!disposed){customs.value=r.customs;revision.value=r.revision;writable.value=r.writable;}}
      catch(e){if(!disposed)error.value=String((e as any)?.message||e);}
      finally{if(!disposed)loading.value=false;}
    };

    const doImport=async()=>{
      if(!props.adapter)return;
      importing.value=true;error.value='';
      const items=importText.value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
      const inv=validateItems(items);
      if(inv){error.value=inv;importing.value=false;return;}
      try{
        await props.adapter.importNew(items,revision.value);
        importText.value='';message.value='已导入 '+items.length+' 条绑定';await load();
      }catch(e){error.value=String((e as any)?.message||e);}
      finally{importing.value=false;}
    };

    const doExport=async()=>{
      if(!props.adapter)return;
      loading.value=true;error.value='';
      try{const r=await props.adapter.describe();if(!disposed)exportText.value=buildExport(r.customs);}
      catch(e){if(!disposed)error.value=String((e as any)?.message||e);}
      finally{if(!disposed)loading.value=false;}
    };

    const copyExport=async()=>{
      if(!exportText.value)return;
      try{await navigator.clipboard.writeText(exportText.value);copied.value=true;setTimeout(()=>copied.value=false,2000);}
      catch{}
    };

    onMounted(()=>{off=props.adapter?.subscribe?.(()=>{void load();});void load();});
    onBeforeUnmount(()=>{disposed=true;off?.();});

    return()=>{
      if(!props.adapter)return el('section','root',[el('h2',null,'迁移'),el('p','notice','迁移后端尚未接入。',{role:'status'})]);

      return el('section','root',[
        el('div','header',[el('h2',null,'迁移'),el('p','intro','一键导出当前自定义模型配置；配置不含 API 密钥，换机后补填即可。')]),
        loading.value?el('p','loading','正在加载…'):null,
        error.value?el('p','error',error.value,{role:'alert'}):null,
        message.value?el('p','saved',message.value,{role:'status','aria-live':'polite'}):null,
        !writable.value?el('p','notice','当前部署的设置文档为只读。',{role:'status'}):null,

        // 当前自定义模型概览
        el('fieldset','section',[
          el('legend',null,'当前自定义模型（'+customs.value.length+' 个）'),
          customs.value.length?h('table',{class:'mig-table',role:'table'},[
            el('thead',null,el('tr',null,[el('th',null,'名称'),el('th',null,'ID'),el('th',null,'模式'),el('th',null,'绑定数'),el('th',null,'状态')])),
            el('tbody',null,customs.value.map(c=>h('tr',{key:c.id},[
              el('td',null,c.name||c.id),el('td',null,c.id),el('td',null,c.mode),el('td',null,String(c.bindingsCount)),el('td',null,c.enabled?'启用':'禁用'),
            ]))),
          ]):el('p','hint','暂无自定义模型。'),
        ]),

        // 一键导出
        el('fieldset','section',[
          el('legend',null,'导出配置'),
          el('p','hint','导出的是自定义模型及其上游绑定（含顺序、权重、费率与预算），不含 API 密钥。'),
          btn(loading.value?'生成中…':'一键导出',()=>void doExport(),'primary',{disabled:!writable.value||loading.value}),
          exportText.value?el('div','export',[
            h('textarea',{class:'mig-ipt',rows:12,readonly:true,value:exportText.value,'aria-label':'导出内容',placeholder:'导出结果将显示在此'}),
            el('div','exportActions',[
              btn(copied.value?'已复制':'复制导出内容',copyExport,'secondary'),
              btn('保存为文件',()=>{const blob=new Blob([exportText.value],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='sacode-migration.json';a.click();URL.revokeObjectURL(url);},'secondary'),
            ]),
          ]):null,
        ]),

        // 导入
        el('fieldset','section',[
          el('legend',null,'导入绑定条目'),
          el('p','hint','每行一条 "providerId/modelId"（可用逗号分隔），每次最多 128 条；按稳定 ID 对齐，重复导入不重复创建。'),
          el('label','field',[el('span','lbl','条目列表'),h('textarea',{class:'mig-ipt',rows:6,value:importText.value,'aria-label':'条目列表',placeholder:'stepfun/step-5-preview\ndstepseek/deepseek-chat',onInput:(e:Event)=>importText.value=(e.target as HTMLTextAreaElement).value})]),
          btn(importing.value?'导入中…':'导入',()=>void doImport(),'primary',{disabled:!writable.value||importing.value}),
        ]),

        // 数据来源
        el('fieldset','section',[
          el('legend',null,'数据来源'),
          el('p','hint','以上展示的是自定义模型的摘要；完整迁移（含供应商与凭据）需后端提供 migrate/* 动词。'),
        ]),
      ]);
    };
  },
});

// --- 槽位注册 ---
export function install(scope:ClientScope):()=>void{
  return scope.inject('model-center.tab',(child)=>{
    child.register({name:'model-center.tab',id:'migration',order:3,label:'迁移'},
      defineComponent({name:'SaCodeMigrationSlot',props:['owner'],setup:(props)=>()=>h(Page,{adapter:(props.owner as any)?.adapter})}));
  });
}