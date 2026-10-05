import {defineComponent,h,ref,watch,onBeforeUnmount,type PropType} from 'vue';
import {ImageLightbox} from './image-lightbox';
type ImageRef={attachmentId:string;name?:string};
type Lease={url:string;release:()=>void};
type Entry={promise:Promise<string>;users:number};
const images=new Map<string,Entry>();

// 缓存只持有渲染字节；每个视图拿一份租约，最后一份释放即撤销 Blob URL。
export async function acquireImage(sessionId:string,attachmentId:string):Promise<Lease> {
 const key=JSON.stringify([sessionId,attachmentId]);
 let entry=images.get(key);
 if(!entry){
  const selected:Entry={users:0,promise:Promise.resolve('')};
  selected.promise=(async()=>{
   const api=(window as any).dsh;
   const result=await api.attachmentImageRead(sessionId,attachmentId);
   if(!result||result.attachmentId!==attachmentId||!['image/png','image/jpeg','image/gif'].includes(result.mediaType)||typeof result.data!=='string'||!result.data.length||result.data.length>28000000)throw Error('bad-image-response');
   const binary=atob(result.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   if(!bytes.length||bytes.length>20*1024*1024)throw Error('bad-image-response');
   return URL.createObjectURL(new Blob([bytes],{type:result.mediaType}));
  })().catch(error=>{if(images.get(key)===selected)images.delete(key);throw error;});
  images.set(key,selected);entry=selected;
 }
 const owned=entry,url=await owned.promise;owned.users++;
 let released=false;
 return {url,release(){if(released)return;released=true;if(--owned.users===0){URL.revokeObjectURL(url);if(images.get(key)===owned)images.delete(key);}}};
}

export const PersistedImage=defineComponent({name:'SaCodePersistedImage',props:{attachment:{type:Object as PropType<ImageRef>,required:true},sessionId:{type:String,required:true},mode:{type:String,default:'history'},label:{type:String,default:'历史图片'}},setup(props){
 const url=ref(''),status=ref('loading'),preview=ref(false);let serial=0,lease:Lease|null=null,disposed=false;
 function release(){lease?.release();lease=null;url.value='';preview.value=false;}
 async function load(){const ticket=++serial;release();status.value='loading';try{
  const next=await acquireImage(props.sessionId,props.attachment.attachmentId);
  if(disposed||ticket!==serial){next.release();return;}lease=next;url.value=next.url;
 }catch{if(!disposed&&ticket===serial)status.value='error';}}
 watch(()=>[props.sessionId,props.attachment.attachmentId],()=>void load(),{immediate:true});
 onBeforeUnmount(()=>{disposed=true;serial++;release();});
 return()=>{const shown=url.value;return h('span',{class:['persisted-image',props.mode==='queue'?'persisted-image-queue':'persisted-image-history'],'data-image-state':status.value},[
  h('button',{type:'button',class:'persisted-image-frame','aria-label':url.value&&status.value==='ready'?'查看原图 '+props.attachment.name:status.value==='error'?'重新加载图片 '+props.attachment.name:props.label+' '+props.attachment.name,onClick:()=>{if(status.value==='error')void load();else if(status.value==='ready')preview.value=true;}},[
   shown&&status.value!=='error'?h('img',{src:shown,alt:props.label+' '+(props.attachment.name||'图片附件'),onLoad:()=>{if(!disposed&&url.value===shown)status.value='ready';},onError:()=>{if(!disposed&&url.value===shown)status.value='error';}}):h('span',{role:'img','aria-label':props.label+' '+props.attachment.name},status.value==='error'?'图片不可用，点击重试':'加载图片…'),
  ]),
  preview.value?h(ImageLightbox,{src:url.value,alt:props.attachment.name||'原图',onClose:()=>preview.value=false}):null,
 ]);};
}});
