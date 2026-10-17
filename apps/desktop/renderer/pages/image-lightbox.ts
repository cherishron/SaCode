// 对照冻结上游 ui-primitives/ImageLightbox：原图覆盖视口，关闭后恢复入口焦点。
// 上游 MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
// 使用原生模态顶层，避免父级 transform 或其他弹层截断遮罩。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,Teleport} from 'vue';

export const ImageLightbox=defineComponent({
  name:'SaCodeImageLightbox',
  props:{src:{type:String,required:true},alt:{type:String,default:'原图'}},
  emits:['close'],
  setup(props,{emit}){
    const dialog=ref<HTMLDialogElement|null>(null),close=ref<HTMLButtonElement|null>(null);
    let opener:HTMLElement|null=null;
    onMounted(()=>{
      opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
      dialog.value?.showModal();close.value?.focus();
    });
    onBeforeUnmount(()=>{dialog.value?.close();if(opener?.isConnected)opener.focus();});
    return()=>h(Teleport,{to:'body'},[h('dialog',{
      ref:dialog,class:'attachments-lightbox','aria-label':'图片预览',
      onCancel:(event:Event)=>{event.preventDefault();event.stopPropagation();emit('close');},
      onKeydown:(event:KeyboardEvent)=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close');}
        if(event.key==='Tab'){event.preventDefault();event.stopPropagation();close.value?.focus();}
      },
    },[
      h('div',{class:'attachments-lightbox-mask','aria-hidden':true,onMousedown:()=>emit('close')}),
      h('img',{class:'attachments-original',src:props.src,alt:props.alt}),
      h('button',{ref:close,type:'button',class:'attachments-lightbox-close','aria-label':'关闭图片预览',onClick:()=>emit('close')},[
        h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':true},[h('path',{d:'M6 6l12 12M18 6L6 18'})]),
      ]),
    ])]);
  },
});
