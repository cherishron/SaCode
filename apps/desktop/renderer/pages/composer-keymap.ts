// 冻结上游 ui-conversation/keymap 与 submission-policy 的 Vue 编辑器绑定。
// MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt；业务送达由调用方负责。
export type SubmitMode='queue'|'steer';
export type BusyEnter=SubmitMode;
export function resolveSubmitMode(preferred:BusyEnter,running:boolean,accelerated:boolean,steeringAvailable:boolean):SubmitMode {
  if(!running||!steeringAvailable)return 'queue';
  return accelerated?(preferred==='queue'?'steer':'queue'):preferred;
}
export interface KeymapHandlers {
  canSubmit():boolean;
  submit(accelerated:boolean):void;
  arbitrate?(key:'enter'|'escape'|'tab'|'tabBack'|'up'|'down',composing:boolean):'pass'|'consumed';
  dismissPopup?():void;
  space?():boolean;
}

export function installComposerKeymap(root:HTMLElement,handlers:KeymapHandlers):()=>void {
  let composing=false,composingUntil=0;
  const start=()=>{composing=true;root.setAttribute('data-composer-composing','');};
  const end=()=>{composing=false;composingUntil=Date.now()+10;root.removeAttribute('data-composer-composing');};
  const onKey=(event:KeyboardEvent)=>{
    const inComposition=composing||Date.now()<composingUntil||event.isComposing||event.keyCode===229;
    const arbitration=({ArrowUp:'up',ArrowDown:'down',Tab:event.shiftKey?'tabBack':'tab',Escape:'escape'} as const)[event.key as 'ArrowUp'|'ArrowDown'|'Tab'|'Escape'];
    if(arbitration){
      if(arbitration==='escape')handlers.dismissPopup?.();
      if(handlers.arbitrate?.(arbitration,inComposition)==='consumed'){event.preventDefault();event.stopPropagation();}
      return;
    }
    if(event.key===' '&&!inComposition&&handlers.space?.()){event.preventDefault();return;}
    if(event.key!=='Enter')return;
    // 混合修饰键不是发送手势；交给应用快捷键，但阻止编辑器插入意外换行。
    if(event.altKey||event.getModifierState('AltGraph')||(event.ctrlKey&&event.metaKey)||(event.shiftKey&&(event.ctrlKey||event.metaKey))){event.preventDefault();return;}
    if(event.shiftKey)return;
    // 候选词确认由浏览器处理；不能阻止其默认行为，也不能冒泡到全局发送。
    if(inComposition){event.stopPropagation();return;}
    event.preventDefault();event.stopPropagation();
    if(handlers.arbitrate?.('enter',false)==='consumed'||event.repeat||!handlers.canSubmit())return;
    handlers.submit(event.ctrlKey||event.metaKey);
  };
  root.addEventListener('compositionstart',start);root.addEventListener('compositionend',end);root.addEventListener('keydown',onKey);
  return()=>{root.removeEventListener('compositionstart',start);root.removeEventListener('compositionend',end);root.removeEventListener('keydown',onKey);root.removeAttribute('data-composer-composing');};
}

const bindings=new WeakMap<HTMLElement,{dispose:()=>void;handlers:KeymapHandlers}>();
// 指令只注册一次监听；更新时读取新的状态，卸载时释放根节点绑定。
export const keymapDirective={
  mounted(root:HTMLElement,binding:{value:KeymapHandlers}){
    const state={handlers:binding.value,dispose:()=>{}};
    state.dispose=installComposerKeymap(root,{
      canSubmit:()=>state.handlers.canSubmit(),submit:accelerated=>state.handlers.submit(accelerated),
      arbitrate:(key,composing)=>state.handlers.arbitrate?.(key,composing)||'pass',
      dismissPopup:()=>state.handlers.dismissPopup?.(),space:()=>state.handlers.space?.()||false,
    });bindings.set(root,state);
  },
  updated(root:HTMLElement,binding:{value:KeymapHandlers}){const state=bindings.get(root);if(state)state.handlers=binding.value;},
  beforeUnmount(root:HTMLElement){bindings.get(root)?.dispose();bindings.delete(root);},
};
