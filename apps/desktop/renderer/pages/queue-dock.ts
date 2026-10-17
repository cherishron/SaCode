// 对照冻结上游 QueueDock；MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
// 队列事实与操作结果由仓颉适配器提供，本视图不自行生成已送达消息。
import {defineComponent,h,ref,computed,watch,onBeforeUnmount,type PropType} from 'vue';
import {projectUserText} from './user-text';
import {PersistedImage} from './persisted-image';
import {InlineEditor} from './inline-editor';
export {projectUserText} from './user-text';
export type AttachmentRef={attachmentId:string;name:string;bytes:number};
export type QueueProjectionRow={id:string;text:string;rpcId:string;attachments?:ReadonlyArray<AttachmentRef&{kind:'image'|'file'}>};
export type Block={type:string;text?:string;attachment?:AttachmentRef};
export type QueueRow={id:string;content:Block[];source?:{kind:string;rpcId?:string}};
export type Pending={requestId:string;placement:'queued'|'transcript';text:string;attachments:({type:'image';previewUrl:string}|{type:'file';attachment:AttachmentRef})[]};
// Host 引用保留顺序和元数据，正文与附件不能在适配时被静默丢掉。
export function projectQueueRow(row:QueueProjectionRow):QueueRow {
  return {id:row.id,content:[...(row.attachments||[]).map(attachment=>({type:attachment.kind,attachment:{...attachment,name:attachment.name||(attachment.kind==='image'?'图片附件':'文件附件')}})),{type:'text',text:row.text}],source:{kind:'user',rpcId:row.rpcId}};
}
export type QueueAction={kind:'remove'|'steer'}|{kind:'edit';content:Block[]};
export const previewOf=(content:Block[])=>{const flat=content.filter(b=>b.type!=='image'&&b.type!=='file').map(b=>b.type==='text'?b.text||'':`[${b.type}]`).join(' ').replace(/\s+/g,' ').trim();const chars=Array.from(flat);return chars.length>200?chars.slice(0,200).join('')+'…':flat;};
const textOf=(content:Block[])=>content.every(b=>b.type==='text')?content.map(b=>b.text||'').join(''):null;
const sizeText=(n:number)=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'queue-'+cls,...props},children);
const icon=(path:string)=>h('svg',{viewBox:'0 0 24 24',width:14,height:14,fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':true},[h('path',{d:path})]);
const glyphs={edit:'M4 16l12-12 4 4L8 20H4z',remove:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15',steer:'M3 11l18-8-8 18-2-8zM11 13l10-10',save:'M4 12l5 5L20 6',cancel:'M6 6l12 12M18 6L6 18'};
let nextDock=0;
const Thumb=defineComponent({props:{attachment:{type:Object as PropType<AttachmentRef>,required:true},loadImage:Function as PropType<(a:AttachmentRef)=>Promise<string>>},setup(props){const url=ref<string|null>(null);let serial=0;
  watch(()=>[props.attachment,props.loadImage],async()=>{const ticket=++serial;url.value=null;if(!props.loadImage)return;try{const loaded=await props.loadImage(props.attachment);if(ticket===serial)url.value=loaded;}catch{}},{immediate:true});
  onBeforeUnmount(()=>{serial++;});return()=>url.value?h('img',{class:'queue-thumb',src:url.value,alt:'排队图片'}):el('span','thumb',icon('M3 3h18v18H3zM3 16l6-6 4 4 3-3 5 5'),{role:'img','aria-label':'排队图片 '+props.attachment.name,title:props.attachment.name});
}});
const Editor=defineComponent({props:{text:{type:String,required:true},busy:Boolean},emits:['change','save','cancel'],setup(props,{emit}){
  return()=>h(InlineEditor,{value:props.text,label:'编辑排队消息',className:'queue-editor',busy:props.busy,onChange:(text:string)=>emit('change',text),onSave:()=>emit('save'),onCancel:()=>emit('cancel')});
}});
export const QueueDock=defineComponent({name:'SaCodeQueueDock',props:{rows:{type:Array as PropType<QueueRow[]>,default:()=>[]},pending:{type:Array as PropType<Pending[]>,default:()=>[]},running:Boolean,mutable:{type:Boolean,default:true},sessionId:String,updateQueue:Function as PropType<(id:string,action:QueueAction)=>Promise<void>>,loadImage:Function as PropType<(a:AttachmentRef)=>Promise<string>>},emits:['notice'],setup(props,{emit}){
  const listId='sacode-queue-'+(++nextDock),editing=ref<{id:string;text:string}|null>(null),busy=ref<string|null>(null),collapsed=ref(false);let disposed=false;
  const rows=computed(()=>{const transcript=new Set(props.pending.filter(p=>p.placement==='transcript').map(p=>p.requestId));return props.rows.filter(r=>r.source?.kind!=='user'||!r.source.rpcId||!transcript.has(r.source.rpcId));});
  const pending=computed(()=>{const admitted=new Set(rows.value.filter(r=>r.source?.kind==='user').map(r=>r.source?.rpcId));return props.pending.filter(p=>p.placement==='queued'&&!admitted.has(p.requestId));});
  const count=computed(()=>rows.value.length+pending.value.length);
  watch([count,rows,()=>props.mutable],()=>{if(!count.value)collapsed.value=true;if(editing.value&&(!props.mutable||!rows.value.some(r=>r.id===editing.value?.id)))editing.value=null;});
  onBeforeUnmount(()=>{disposed=true;});
  const apply=async(id:string,action:QueueAction)=>{if(busy.value||!props.mutable||!props.updateQueue)return false;busy.value=id;try{await props.updateQueue(id,action);return !disposed;}catch{if(!disposed)emit('notice','error',({edit:'编辑排队消息失败，请重试。',remove:'删除排队消息失败，请重试。',steer:'引导失败，请重试。'} as const)[action.kind]);return false;}finally{if(!disposed&&busy.value===id)busy.value=null;}};
  const save=async()=>{const draft=editing.value;if(!draft?.text.trim())return;if(await apply(draft.id,{kind:'edit',content:[{type:'text',text:draft.text}]}))if(editing.value===draft)editing.value=null;};
  const button=(name:keyof typeof glyphs,label:string,fn:()=>void,disabled=false,title?:string)=>{const n=el('button','action',icon(glyphs[name]),{type:'button','aria-label':label,disabled,title,onClick:fn});return !disabled&&(window as any).SaCodeTooltip?(window as any).SaCodeTooltip.wrap(n,{label,side:'bottom',delayMs:500}):n;};
  const file=(a:AttachmentRef)=>el('span','file',[icon('M6 3h8l4 4v14H6zM14 3v5h4'),el('span','fileName',a.name),el('span','fileSize',sizeText(a.bytes))],{'aria-label':'排队文件 '+a.name,title:a.name});
  return()=>{if(!count.value)return null;const active=props.mutable&&!!(editing.value||busy.value),expanded=!collapsed.value||active,visible=expanded,locked=busy.value!==null||!props.updateQueue;
    return el('div','dock',[el('div','panel',[
      count.value>0?el('button','header',[icon('M3 6h18M3 12h18M3 18h12'),el('span','count',`${count.value} 条排队消息`),!visible&&pending.value.length?el('span','status','发送中…',{role:'status'}):null,icon(expanded?'M6 9l6 6 6-6':'M6 15l6-6 6 6')],{type:'button','aria-controls':listId,'aria-expanded':expanded,disabled:active,onClick:()=>collapsed.value=!collapsed.value}):null,
      el('ul','list',visible?[
        ...rows.value.map(row=>{const edit=editing.value?.id===row.id,text=textOf(row.content),attachments=row.content.filter(b=>(b.type==='image'||b.type==='file')&&b.attachment);return el('li','row',[
          count.value===1?icon('M3 6h18M3 12h18M3 18h12'):null,
          edit?h(Editor,{text:editing.value!.text,busy:locked,onChange:(text:string)=>editing.value={id:row.id,text},onSave:()=>void save(),onCancel:()=>editing.value=null}):[
            attachments.length?el('span','attachments',attachments.map((b,index)=>b.type==='image'?props.sessionId?h(PersistedImage,{key:b.attachment!.attachmentId+':'+index,attachment:b.attachment!,sessionId:props.sessionId,mode:'queue',label:'排队图片'}):h(Thumb,{key:b.attachment!.attachmentId+':'+index,attachment:b.attachment!,loadImage:props.loadImage}):file(b.attachment!))):null,
            el('span','preview',projectUserText(row.content.filter(b=>b.type==='text').map(b=>b.text||'').join('\n')||previewOf(row.content))),
          ],
          props.mutable?el('div','actions',edit?[
            button('save','保存排队消息',()=>void save(),locked||!editing.value!.text.trim()),button('cancel','取消编辑',()=>editing.value=null,locked),
          ]:[button('edit','编辑排队消息',()=>{if(text!==null)editing.value={id:row.id,text};},locked||text===null,text===null?'包含非文本内容的消息暂不支持编辑':undefined),button('remove','删除排队消息',()=>void apply(row.id,{kind:'remove'}),locked),button('steer','引导',()=>void apply(row.id,{kind:'steer'}),locked||!props.running,!props.running?'当前没有运行中的任务':undefined)]):null,
        ],{key:row.id,'data-queue-id':row.id});}),
        ...pending.value.map(p=>el('li','row pending',[p.attachments.length?el('span','attachments',p.attachments.map(a=>a.type==='image'?h('img',{class:'queue-thumb',src:a.previewUrl,alt:'排队图片'}):file(a.attachment))):null,el('span','preview',p.text),el('span','status','发送中…',{role:'status'}),props.mutable?el('div','actions',[button('edit','编辑排队消息',()=>{},true,'发送中…'),button('remove','删除排队消息',()=>{},true,'发送中…'),button('steer','引导',()=>{},true,'发送中…')]):null],{key:p.requestId,'data-submission-echo':p.requestId})),
      ]:[],{id:listId,hidden:!visible}),
    ])],{'data-queue-dock':''});
  };
}});
