// 模型中心·迁移页：注册到 'model-center.tab' 槽位。
// 导入：将上游模型绑定为新的自定义模型或追加到已有模型。
// 导出：序列化当前自定义模型为可迁移的 JSON 文本。
// 导出数据只留在内存/剪贴板，不落 localStorage。
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
    const mode=ref<'new'|'into'>('new');
    const importItems=ref('');
    const importTarget=ref('');
    const importing=ref(false);
    const exportText=ref('');
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
      const items=importItems.value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
      const inv=validateItems(items);
      if(inv){error.value=inv;return;}
      importing.value=true;error.value='';
      try{
        if(mode.value==='into'&&importTarget.value){
          await props.adapter.importInto(importTarget.value,items,revision.value);
          message.value='已追加 '+items.length+' 条绑定';
        }else{
          await props.adapter.importNew(items,revision.value);
          message.value='已创建新自定义模型，含 '+items.length+' 条绑定';
        }
        importItems.value='';
        await load();
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
        el('div','header',[el('h2',null,'迁移'),el('p','intro','导入上游模型绑定为自定义模型，或导出自定义模型摘要。')]),
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

        // 导入
        el('fieldset','section',[
          el('legend',null,'导入绑定'),
          el('p','hint','输入 "providerId/modelId" 格式的条目，每行一条或用逗号分隔。每次最多 128 条。'),
          el('label','field',[el('span','lbl','条目列表'),h('textarea',{class:'mig-ipt',rows:6,value:importItems.value,'aria-label':'条目列表',placeholder:'step/gpt-4\nstep/gpt-3.5\nopenai/o1',onInput:(e:Event)=>importItems.value=(e.target as HTMLTextAreaElement).value})]),
          el('fieldset','section',[el('legend',null,'导入模式'),
            el('label','radio',[h('input',{type:'radio',name:'import-mode',checked:mode.value==='new','aria-label':'创建新自定义模型',onChange:()=>mode.value='new'}),'创建新自定义模型（自动分配 ID）']),
            el('label','radio',[h('input',{type:'radio',name:'import-mode',checked:mode.value==='into','aria-label':'追加到已有自定义模型',onChange:()=>mode.value='into'}),'追加到已有自定义模型']),
          ]),
          mode.value==='into'?el('label','field',[el('span','lbl','目标自定义模型'),h('select',{class:'ipt',value:importTarget.value,'aria-label':'目标自定义模型',onChange:(e:Event)=>importTarget.value=(e.target as HTMLSelectElement).value},[
            h('option',{value:''},'选择目标模型'),
            ...customs.value.map(c=>h('option',{value:c.id},c.name||c.id)),
          ])]):null,
          btn(importing.value?'导入中…':'导入',()=>void doImport(),'primary',{disabled:!writable.value||importing.value}),
        ]),

        // 导出
        el('fieldset','section',[
          el('legend',null,'导出摘要'),
          el('p','hint','导出模型名称、模式和绑定数量的摘要；不含完整绑定、凭据，不能用来恢复配置。'),
          btn(loading.value?'生成中…':'生成导出',()=>void doExport(),'primary',{disabled:!writable.value||loading.value}),
          exportText.value?el('div','export',[
            h('textarea',{class:'mig-ipt',rows:12,readonly:true,value:exportText.value,'aria-label':'导出内容',placeholder:'导出结果将显示在此'}),
            btn(copied.value?'已复制':'复制',copyExport,'secondary'),
          ]):null,
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
