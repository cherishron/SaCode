/* 原生 dialog 负责模态层、Tab 范围与最上层 Escape；Vue 只持有展示状态。
   不写会话事实，不引入第二份 Vue 或模板编译器。 */
"use strict";
window.SaCodeDialog = {
  props: { open: Boolean, modal: { type: Boolean, default: true }, adjustable: Boolean, title: { type: String, default: "详情" } },
  emits: ["close"],
  setup(props, { emit, slots }) {
    const { h, ref, watch, onMounted, onBeforeUnmount } = window.Vue;
    const node = ref(null);
    const frame = ref(null);
    let dragController = null;
    const fit = (rect) => {
      const width = Math.max(1, Math.min(Math.max(320, rect.width), innerWidth-32));
      const height = Math.max(1, Math.min(Math.max(160, rect.height), innerHeight-32));
      return { width, height, x: Math.max(16, Math.min(rect.x, innerWidth-width-16)), y: Math.max(16, Math.min(rect.y, innerHeight-height-16)) };
    };
    const constrain = () => { if (frame.value) frame.value = fit(frame.value); };
    const beginDrag = (event, resize) => {
      if (!props.adjustable || event.button !== 0 || (!resize && event.target.closest('button'))) return;
      event.preventDefault(); event.currentTarget.focus();
      const rect = node.value.getBoundingClientRect(), initial = { x:rect.x, y:rect.y, width:rect.width, height:rect.height };
      const x = event.clientX, y = event.clientY, pointer = event.pointerId;
      event.currentTarget.setPointerCapture(pointer);
      if (dragController) dragController.abort();
      dragController = new AbortController();
      const signal = dragController.signal;
      window.addEventListener('pointermove', move => {
        if (move.pointerId !== pointer) return;
        const dx=move.clientX-x, dy=move.clientY-y;
        frame.value = fit(resize ? { ...initial, width:initial.width+dx, height:initial.height+dy } : { ...initial, x:initial.x+dx, y:initial.y+dy });
      }, { signal });
      const end = e => { if(e.pointerId===pointer) { dragController.abort(); dragController=null; } };
      window.addEventListener('pointerup', end, { signal }); window.addEventListener('pointercancel', end, { signal });
    };
    const keyAdjust = (event, resize) => {
      if (!props.adjustable || event.target!==event.currentTarget || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const rect=node.value.getBoundingClientRect(), dx=event.key==='ArrowLeft'?-16:event.key==='ArrowRight'?16:0, dy=event.key==='ArrowUp'?-16:event.key==='ArrowDown'?16:0;
      frame.value=fit(resize ? {x:rect.x,y:rect.y,width:rect.width+dx,height:rect.height+dy} : {x:rect.x+dx,y:rect.y+dy,width:rect.width,height:rect.height});
    };
    let opener = null;
    const restore = () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    };
    const sync = () => {
      if (!node.value) return;
      if (props.open && !node.value.open) {
        opener = document.activeElement;
        if (props.modal) node.value.showModal();
        else { node.value.show(); node.value.querySelector('button').focus(); }
        constrain();
      } else if (!props.open && node.value.open) {
        node.value.close();
        if (dragController) { dragController.abort(); dragController=null; }
        restore();
      }
    };
    watch(() => props.open, sync, { flush: "post" });
    onMounted(() => { sync(); window.addEventListener('resize', constrain); });
    onBeforeUnmount(() => {
      if (node.value && node.value.open) node.value.close();
      restore();
      window.removeEventListener('resize', constrain);
      if (dragController) dragController.abort();
    });
    return () => h("dialog", {
      ref: node, class: "sacode-dialog", "aria-label": props.title,
      style: frame.value ? {left:frame.value.x+'px',top:frame.value.y+'px',right:'auto',width:frame.value.width+'px',height:frame.value.height+'px',maxHeight:'none'} : null,
      "aria-modal": props.modal ? "true" : "false",
      onCancel: (event) => { event.preventDefault(); emit("close"); },
      onKeydown: (event) => {
        if (!props.modal && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); emit("close"); }
      },
    }, [
      h("header", { class: "dialog-header" + (props.adjustable ? " movable-header" : ""), tabindex: props.adjustable ? 0 : undefined,
        "aria-label": props.adjustable ? "移动预览，支持方向键" : undefined,
        onPointerdown: e=>beginDrag(e,false), onKeydown:e=>keyAdjust(e,false) }, [
        h("h2", null, props.title),
        h("button", { class: "btn", autofocus: true, "aria-label": "关闭" + props.title,
          onClick: () => emit("close") }, "关闭"),
      ]),
      h("div", { class: "dialog-body" }, slots.default ? slots.default() : []),
      props.adjustable ? h('button', {class:'float-resize', 'aria-label':'调整预览大小，支持方向键',
        onPointerdown:e=>beginDrag(e,true), onKeydown:e=>keyAdjust(e,true)}, '↘') : null,
    ]);
  },
};
