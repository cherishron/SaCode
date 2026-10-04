// 安装源使用浏览器顶层浮层，避免被原生模态框的滚动区裁剪或变成不可交互的外部元素。
import {defineComponent,h,ref,watch,nextTick,onMounted,onBeforeUnmount,useId,type PropType} from 'vue';
export function validRegistry(text:string):boolean {try{const url=new URL(text.trim());return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&!/\s/.test(text.trim());}catch{return false;}}
let instance=0;
export const RegistryPicker=defineComponent({name:'SaCodeRegistryPicker',props:{open:Boolean,busy:Boolean,value:{type:String,default:''},custom:{type:String,default:''},options:{type:Array as PropType<{name:string;url:string}[]>,default:()=>[]}},emits:['close','toggle','choose','custom'],setup(props,{emit}){
  const id='registry-'+useId()+'-'+(++instance),anchor=ref<HTMLButtonElement|null>(null),panel=ref<HTMLFieldSetElement|null>(null),customInput=ref<HTMLInputElement|null>(null),pickedCustom=ref(false);
  let observer:ResizeObserver|null=null,frame=0,disposed=false;
  const place=()=>{frame=0;if(!props.open||!anchor.value||!panel.value)return;const a=anchor.value.getBoundingClientRect(),p=panel.value.getBoundingClientRect(),margin=12,gap=6;
    const below=innerHeight-a.bottom-gap-margin,above=a.top-gap-margin,down=below>=p.height||below>=above;
    const maxHeight=Math.max(40,Math.min(innerHeight-margin*2,down?below:above));panel.value.style.maxHeight=maxHeight+'px';
    const height=Math.min(p.height,maxHeight),left=Math.max(margin,Math.min(a.right-p.width,innerWidth-margin-p.width));
    panel.value.style.left=left+'px';panel.value.style.top=Math.max(margin,Math.min(down?a.bottom+gap:a.top-gap-height,innerHeight-margin-height))+'px';
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
  const close=(restore=false)=>{emit('close');if(restore)void nextTick(()=>anchor.value?.focus({preventScroll:true}));};
  const pointer=(event:PointerEvent)=>{if(props.open&&event.target instanceof Node&&!panel.value?.contains(event.target)&&!anchor.value?.contains(event.target))close();};
  const escape=(event:KeyboardEvent)=>{if(props.open&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);}};
  const sync=async()=>{await nextTick();if(disposed||!panel.value)return;const shown=panel.value.matches(':popover-open');if(props.open&&!shown){pickedCustom.value=!!props.value&&!props.options.some(r=>r.url===props.value);panel.value.showPopover();place();}else if(!props.open&&shown)panel.value.hidePopover();};
  watch(()=>props.open,()=>void sync(),{flush:'post'});watch(()=>[props.custom,props.options,props.value],schedule,{flush:'post'});
  onMounted(()=>{observer=new ResizeObserver(schedule);if(anchor.value)observer.observe(anchor.value);if(panel.value)observer.observe(panel.value);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',escape,true);void sync();});
  onBeforeUnmount(()=>{disposed=true;observer?.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',escape,true);if(panel.value?.matches(':popover-open'))panel.value.hidePopover();});
  const customText=()=>props.custom||(pickedCustom.value&&!props.options.some(r=>r.url===props.value)?props.value:'');
  const edit=(text:string)=>{pickedCustom.value=true;emit('custom',text);if(validRegistry(text))emit('choose',text.trim());};
  return()=>h('div',{class:'plugin-manager-registryPicker'},[
    h('button',{ref:anchor,type:'button',class:'plugin-manager-button','data-install-registry-toggle':'',disabled:props.busy,'aria-expanded':props.open,'aria-controls':id,onClick:()=>emit('toggle')},['安装源',h('span',{class:'plugin-manager-registryChosen'},' · '+(props.options.find(r=>r.url===props.value)?.name||(props.value?'自定义地址':'默认安装源')))]),
    h('fieldset',{id,ref:panel,popover:'manual',class:'plugin-manager-registry','data-install-registry':'','aria-label':'从哪个 npm 源下载插件',onKeydown:(event:KeyboardEvent)=>{
      if(event.key!=='Tab'||event.ctrlKey||event.altKey||event.metaKey||event.isComposing)return;
      event.preventDefault();event.stopPropagation();const radio=panel.value?.querySelector<HTMLInputElement>('input[type=radio]:checked');
      if(event.shiftKey&&event.target===customInput.value)radio?.focus();else if(!event.shiftKey&&event.target!==customInput.value)customInput.value?.focus();else close(true);
    }},[
      h('legend','从哪个 npm 源下载插件'),...props.options.map(r=>h('label',{class:'plugin-manager-registryOption',key:r.url},[h('input',{type:'radio',name:id,checked:!pickedCustom.value&&props.value===r.url,disabled:props.busy,onChange:()=>{pickedCustom.value=false;emit('custom','');emit('choose',r.url);}}),r.name])),
      h('div',{class:'plugin-manager-registryCustom'},[h('label',{class:'plugin-manager-registryOption'},[h('input',{type:'radio',name:id,checked:pickedCustom.value,disabled:props.busy,onChange:()=>{pickedCustom.value=true;customInput.value?.focus();}}),'自定义地址']),
        h('input',{ref:customInput,class:'plugin-manager-input',value:customText(),'aria-label':'自定义安装源','aria-invalid':!!customText()&&!validRegistry(customText()),disabled:props.busy,placeholder:'https://npm.example.com/',onInput:(e:Event)=>edit((e.target as HTMLInputElement).value),onFocus:()=>pickedCustom.value=true}),
        !!customText()&&!validRegistry(customText())?h('p',{class:'plugin-manager-error',role:'alert'},'请输入以 http:// 或 https:// 开头的有效地址'):null,
        h('p',{class:'plugin-manager-note'},'私有源凭据请放在本机 .npmrc 中。'),
      ]),
    ]),
  ]);
}});
