// 附件由会话草稿所有者持有；本视图展示上传投影、发出动作并管理局部预览。
import {defineComponent,h,ref,watch,nextTick,onMounted,onBeforeUnmount,Teleport,type PropType} from 'vue';
import {ImageLightbox} from './image-lightbox';
export {installComposerKeymap,keymapDirective,resolveSubmitMode} from './composer-keymap';
export type Attachment={id:string;kind:'image'|'file';file:File;previewUrl?:string};
export type Upload={status:'uploading';loaded?:number;total?:number}|{status:'ready'}|{status:'error';message?:string};
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'attachments-'+cls,...props},children);
const sizeText=(n:number)=>n<1024?n+' B':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB';
export const AddButton=defineComponent({name:'SaCodeAddAttachment',props:{disabled:Boolean},emits:['add'],setup(props,{emit}){const input=ref<HTMLInputElement|null>(null);return()=>el('div','picker',[
  el('button','add','＋',{type:'button','aria-label':'添加附件',disabled:props.disabled,title:props.disabled?'当前暂不能添加附件':undefined,onClick:()=>input.value?.click()}),h('input',{ref:input,type:'file',multiple:true,hidden:true,disabled:props.disabled,'aria-label':'选择附件',onChange:(e:Event)=>{const node=e.target as HTMLInputElement;if(!props.disabled&&node.files?.length)emit('add',Array.from(node.files),new Set<File>());node.value='';}}),
]);}});
export const Composer=defineComponent({name:'SaCodeComposerAttachments',props:{attachments:{type:Array as PropType<Attachment[]>,default:()=>[]},uploads:{type:Object as PropType<Record<string,Upload>>,default:()=>({})},canAcceptDrop:Boolean,showAdd:{type:Boolean,default:true},active:{type:Boolean,default:true},limits:Object as PropType<{count:number;size:string}>},emits:['add','remove','retry'],setup(props,{emit}){
  const rail=ref<HTMLDivElement|null>(null),fileInput=ref<HTMLInputElement|null>(null),left=ref(false),right=ref(false),dragging=ref(false),preview=ref<string|null>(null);
  let depth=0,previousCount:number|null=null,observer:ResizeObserver|null=null,disposed=false;
  const update=()=>{const n=rail.value;if(!n)return;left.value=n.scrollLeft>1;right.value=n.scrollLeft<n.scrollWidth-n.clientWidth-1;};
  const refresh=async()=>{await nextTick();if(disposed)return;const n=rail.value;if(n&&previousCount!==null&&props.attachments.length>previousCount)n.scrollLeft=n.scrollWidth-n.clientWidth;previousCount=props.attachments.length;update();};
  watch(()=>props.attachments.length,()=>void refresh(),{flush:'post'});watch(()=>props.attachments,()=>{if(preview.value&&!props.attachments.some(a=>a.id===preview.value))preview.value=null;},{deep:true});
  const page=(direction:number)=>{const n=rail.value;if(n)n.scrollBy({left:direction*n.clientWidth*.8,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
  const wheel=(event:WheelEvent)=>{const n=rail.value;if(!n||n.scrollWidth<=n.clientWidth)return;event.preventDefault();const amount=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;n.scrollLeft+=amount*(event.deltaMode===1?16:event.deltaMode===2?n.clientWidth:1);update();};
  const transfer=(event:DragEvent)=>props.active&&event.dataTransfer?.types.includes('Files')?event.dataTransfer:null;
  const reset=()=>{depth=0;dragging.value=false;};
  const enter=(event:DragEvent)=>{if(!transfer(event))return;event.preventDefault();depth++;dragging.value=true;};
  const over=(event:DragEvent)=>{const dt=transfer(event);if(!dt)return;event.preventDefault();dt.dropEffect=props.canAcceptDrop?'copy':'none';};
  const leave=(event:DragEvent)=>{if(!transfer(event))return;depth=Math.max(0,depth-1);if(!depth)dragging.value=false;const out=event.clientX<=0||event.clientY<=0||event.clientX>=innerWidth||event.clientY>=innerHeight;if((event.target===document.body||event.target===document.documentElement)&&out)reset();};
  const drop=(event:DragEvent)=>{const dt=transfer(event);if(!dt)return;event.preventDefault();reset();if(!props.canAcceptDrop)return;const files=Array.from(dt.files),directories=new Set<File>();let index=0;for(const item of Array.from(dt.items)){if(item.kind!=='file')continue;const file=files[index++];if(item.webkitGetAsEntry?.()?.isDirectory&&file)directories.add(file);}emit('add',files,directories);};
  watch(()=>props.active,active=>{if(!active)reset();});
  onMounted(()=>{observer=new ResizeObserver(update);if(rail.value)observer.observe(rail.value);rail.value?.addEventListener('wheel',wheel,{passive:false});document.addEventListener('dragenter',enter);document.addEventListener('dragover',over);document.addEventListener('dragleave',leave);document.addEventListener('drop',drop);window.addEventListener('dragend',reset);void refresh();});
  onBeforeUnmount(()=>{disposed=true;observer?.disconnect();rail.value?.removeEventListener('wheel',wheel);document.removeEventListener('dragenter',enter);document.removeEventListener('dragover',over);document.removeEventListener('dragleave',leave);document.removeEventListener('drop',drop);window.removeEventListener('dragend',reset);preview.value=null;reset();});
  return()=>{const shown=props.attachments.find(a=>a.id===preview.value);return el('div','root',[
    props.showAdd?el('button','add','＋',{type:'button','aria-label':'添加附件',disabled:!props.canAcceptDrop,title:!props.canAcceptDrop?'当前暂不能添加附件':undefined,onClick:()=>fileInput.value?.click()}):null,
    h('input',{ref:fileInput,type:'file',multiple:true,hidden:true,disabled:!props.canAcceptDrop,'aria-label':'选择附件',onChange:(e:Event)=>{const input=e.target as HTMLInputElement;if(props.canAcceptDrop&&input.files?.length)emit('add',Array.from(input.files),new Set<File>());input.value='';}}),
    el('div','railWrap',[
      left.value?el('button','page','‹',{type:'button','aria-label':'向左查看附件',onClick:()=>page(-1)}):null,
      el('div','rail',props.attachments.map(a=>{const name=a.file.name||(a.kind==='image'?'待发送图片':'文件'),upload=props.uploads[a.id];if(a.kind==='image')return el('article','imageItem',[
        el('button','thumbnail',[h('img',{src:a.previewUrl,alt:name})],{type:'button','aria-label':'查看原图 '+name,disabled:!a.previewUrl,onClick:()=>preview.value=a.id}),el('button','remove','×',{type:'button','aria-label':'移除图片 '+name,onClick:()=>emit('remove',a.id)}),
      ],{key:a.id,'data-attachment-id':a.id,'data-upload-status':upload?.status||'uploading'});const status=upload?.status||'uploading',progress=upload?.status==='uploading'&&upload.total&&upload.total>0&&upload.loaded!==undefined?Math.min(1,Math.max(0,upload.loaded/upload.total)):null,meta=status==='uploading'?'上传中…':status==='error'?'上传失败':[(name.split('.').length>1?name.split('.').at(-1)?.toUpperCase().slice(0,8):''),sizeText(a.file.size)].filter(Boolean).join(' ');
        return el('article','fileCard',[el('span','fileIcon',status==='uploading'?'◌':'▤',{'aria-hidden':true}),el(status==='error'?'button':'span','fileBody',[el('span','name',name),el('span','meta',meta)],status==='error'?{type:'button','aria-label':'重试上传 '+name,onClick:()=>emit('retry',a.id)}:{'aria-label':'待发送文件 '+name}),el('button','remove','×',{type:'button','aria-label':'移除文件 '+name,onClick:()=>emit('remove',a.id)}),status==='uploading'?el('span','progress',[el('span','progressBar',null,{style:progress===null?undefined:{width:progress*100+'%'}})],{role:'progressbar','aria-label':'上传 '+name,'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':progress===null?undefined:Math.round(progress*100)}):null],{key:a.id,'data-attachment-id':a.id,'data-upload-status':status});
      }),{ref:rail,role:'group','aria-label':'待发送附件',onScroll:update,hidden:!props.attachments.length}),
      right.value?el('button','page','›',{type:'button','aria-label':'向右查看附件',onClick:()=>page(1)}):null,
    ],{hidden:!props.attachments.length}),
    dragging.value?h(Teleport,{to:'body'},[el('div','dropOverlay',[el('div','dropCard',[el('span','dropIcon',props.canAcceptDrop?'⇩':'⊘',{'aria-hidden':true}),el('h2','dropTitle',props.canAcceptDrop?'拖放文件以添加附件':'当前暂不能添加附件'),props.canAcceptDrop&&props.limits?el('p','dropNote',`最多 ${props.limits.count} 个文件，单个不超过 ${props.limits.size}`):null])],{role:'status','data-attachment-drop-disabled':!props.canAcceptDrop})]):null,
    shown?.previewUrl?h(ImageLightbox,{src:shown.previewUrl,alt:shown.file.name||'原图',onClose:()=>preview.value=null}):null,
  ]);};
}});
