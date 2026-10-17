// DSH Tooltip 的经典脚本适配；Vue 指令保持锚点不变，提示只持有派生展示状态。
"use strict";
window.SaCodeTooltip = (function () {
  const states=new WeakMap(),visible=new Set();let sequence=0,pointer=false,listening=false;
  const clamp=(n,min,max)=>Math.max(min,Math.min(n,Math.max(min,max)));
  function fit(anchor,size,viewport,options={}) {
    const width=Math.min(size.width,viewport.width-24),height=Math.min(size.height,viewport.height-24),gap=options.gap??8;
    let side=options.side||'right';
    const above=anchor.top-gap-height>=12,below=anchor.bottom+gap+height<=viewport.height-12;
    if(side==='top'&&!above&&below)side='bottom';
    else if(side==='bottom'&&!below&&above)side='top';
    const x=side==='right'?anchor.right+10:options.align==='end'?anchor.right-width:(anchor.left+anchor.right-width)/2;
    const y=side==='right'?(anchor.top+anchor.bottom-height)/2:side==='top'?anchor.top-gap-height:anchor.bottom+gap;
    return {left:clamp(x,12,viewport.width-12-width),top:clamp(y,12,viewport.height-12-height),side};
  }
  const disabled=s=>s.options.disabled||s.node.disabled||s.node.getAttribute('aria-disabled')==='true';
  function globalListeners() {
    if(listening)return;listening=true;
    window.document.addEventListener('pointerdown',event=>{
      pointer=true;
      for(const s of visible)if(!s.node.contains(event.target)&&!s.bubble?.contains(event.target))s.dismiss();
    },true);
    window.document.addEventListener('keydown',event=>{
      pointer=false;
      if(event.key!=='Escape'&&event.key!=='Tab')return;
      for(const s of [...visible]){if(s.pinned&&event.key==='Escape'){event.preventDefault();event.stopPropagation();}for(const ancestor of s.suppressed){ancestor.hover=false;ancestor.focus=false;ancestor.pinned=false;}s.dismiss();}
    },true);
    window.document.addEventListener('scroll',()=>{for(const s of visible)s.schedule();},true);
    window.addEventListener('resize',()=>{for(const s of visible)s.schedule();});
  }
  function mount(node,binding) {
    globalListeners();
    const s={node,options:binding.value||{},hover:false,focus:false,pinned:false,bubble:null,timer:null,frame:0,observer:null,suppressed:[],alive:true};
    states.set(node,s);
    const id='sacode-tooltip-'+(++sequence);
    const cancel=()=>{window.clearTimeout(s.timer);s.timer=null;};
    const describe=present=>{
      const tokens=(node.getAttribute('aria-describedby')||'').split(/\s+/).filter(x=>x&&x!==id);
      if(present)tokens.push(id);
      if(tokens.length)node.setAttribute('aria-describedby',tokens.join(' '));else node.removeAttribute('aria-describedby');
    };
    const clipped=()=>{
      const rect=node.getBoundingClientRect();
      if(rect.bottom<=0||rect.top>=window.innerHeight||rect.right<=0||rect.left>=window.innerWidth)return true;
      for(let parent=node.parentElement;parent;parent=parent.parentElement){
        if(parent.tagName==='DIALOG')break;
        const css=window.getComputedStyle(parent),box=parent.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(css.overflowY)&& (rect.bottom<=box.top||rect.top>=box.bottom))return true;
        if(/auto|scroll|hidden|clip/.test(css.overflowX)&& (rect.right<=box.left||rect.left>=box.right))return true;
      }
      return false;
    };
    s.hide=(restore=true)=>{
      cancel();window.cancelAnimationFrame(s.frame);s.frame=0;s.observer?.disconnect();s.observer=null;
      s.bubble?.remove();s.bubble=null;visible.delete(s);describe(false);
      const previous=s.suppressed;s.suppressed=[];
      if(restore)for(const ancestor of previous)if(ancestor.alive&&!disabled(ancestor)&&(ancestor.hover||ancestor.focus))ancestor.show();
    };
    s.dismiss=()=>{s.hover=false;s.focus=false;s.pinned=false;s.hide();};
    const content=()=>{
      const bubble=s.bubble;if(!bubble)return;
      bubble.replaceChildren();
      const label=typeof s.options.label==='function'?s.options.label():s.options.label;
      if(label){const span=window.document.createElement('span');span.className='tooltip-label';span.textContent=label;bubble.append(span);}
      const keys=(s.options.shortcutKeys||[]).filter(key=>typeof key==='string');
      if(keys.length)bubble.setAttribute('aria-label',[label,keys.join(' ')].filter(Boolean).join(' '));else bubble.removeAttribute('aria-label');
      bubble.toggleAttribute('data-has-shortcut',!!keys.length);
      if(keys.length){
        const group=window.document.createElement('span');group.className='tooltip-keys'+(keys.includes('+')?' joined':'');
        for(const key of keys){const cap=window.document.createElement('kbd');cap.className=key==='+'?'tooltip-separator':'tooltip-key';cap.textContent=key;group.append(cap);}bubble.append(group);
      }
      bubble.dataset.pinned=String(s.pinned);bubble.style.maxWidth=Math.min(window.innerWidth/2,Number.isFinite(s.options.maxWidth)?s.options.maxWidth:Infinity)+'px';
    };
    s.position=()=>{
      if(!s.bubble)return;
      if(!node.isConnected||disabled(s)||clipped()){s.dismiss();return;}
      s.bubble.style.maxWidth=Math.min(window.innerWidth/2,Number.isFinite(s.options.maxWidth)?s.options.maxWidth:Infinity)+'px';
      const box=s.bubble.getBoundingClientRect(),pos=fit(node.getBoundingClientRect(),box,{width:window.innerWidth,height:window.innerHeight},s.options);
      s.bubble.style.left=pos.left+'px';s.bubble.style.top=pos.top+'px';s.bubble.dataset.side=pos.side;s.bubble.style.visibility='visible';
    };
    s.schedule=()=>{if(!s.frame)s.frame=window.requestAnimationFrame(()=>{s.frame=0;s.position();});};
    s.show=()=>{
      if(!s.alive||disabled(s)||clipped())return;
      cancel();
      for(let parent=node.parentElement;parent;parent=parent.parentElement){const ancestor=states.get(parent);if(ancestor?.bubble){s.suppressed.push(ancestor);ancestor.hide(false);}}
      if(!s.bubble){
        const bubble=window.document.createElement('span');s.bubble=bubble;bubble.id=id;bubble.className='sacode-tooltip';bubble.dataset.portal='true';bubble.setAttribute('role','tooltip');bubble.setAttribute('popover','manual');bubble.style.visibility='hidden';
        // 模态 dialog 之外的 DOM 属于 inert 范围；先保留其归属，再用 Popover 逃逸裁切。
        const portal=node.closest('dialog[open]')||window.document.body;
        portal.append(bubble);content();bubble.showPopover?.();visible.add(s);describe(true);
        s.observer=new window.ResizeObserver(()=>s.position());s.observer.observe(bubble);
      }else content();
      s.position();
    };
    const delayed=delay=>{cancel();if(delay>0)s.timer=window.setTimeout(s.show,delay);else s.show();};
    const handlers={
      mouseenter:()=>{s.hover=true;delayed(s.options.delayMs||0);},
      mouseleave:()=>{s.hover=false;cancel();if(!s.focus&&!s.pinned)s.hide();},
      focus:()=>{if(pointer)return;s.focus=true;delayed(s.options.focusDelayMs||0);},
      blur:()=>{s.focus=false;cancel();if(!s.hover&&!s.pinned)s.hide();},
      click:()=>{s.focus=false;cancel();if(s.options.openOnClick&&!disabled(s)&&!s.pinned){s.pinned=true;s.show();}else{s.pinned=false;s.hide();}},
    };
    s.handlers=handlers;for(const [event,handler]of Object.entries(handlers))node.addEventListener(event,handler);
    node.removeAttribute('title');
    s.update=options=>{s.options=options||{};node.removeAttribute('title');if(disabled(s))s.dismiss();else if(s.bubble){content();s.position();}};
    s.dispose=()=>{s.alive=false;s.hide();for(const [event,handler]of Object.entries(handlers))node.removeEventListener(event,handler);states.delete(node);};
  }
  const directive={mounted:mount,updated:(node,binding)=>states.get(node)?.update(binding.value),beforeUnmount:node=>states.get(node)?.dispose()};
  const wrap=(node,options)=>window.Vue.withDirectives(node,[[directive,options]]);
  return {wrap,directive,fit};
})();
