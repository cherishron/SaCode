/* 原生 dialog 负责模态层、Tab 范围与最上层 Escape；Vue 只持有展示状态。
   不写会话事实，不引入第二份 Vue 或模板编译器。 */
"use strict";
window.SaCodeDialog = {
  props: { open: Boolean, modal: { type: Boolean, default: true }, title: { type: String, default: "详情" } },
  emits: ["close"],
  setup(props, { emit, slots }) {
    const { h, ref, watch, onMounted, onBeforeUnmount } = window.Vue;
    const node = ref(null);
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
      } else if (!props.open && node.value.open) {
        node.value.close();
        restore();
      }
    };
    watch(() => props.open, sync, { flush: "post" });
    onMounted(sync);
    onBeforeUnmount(() => {
      if (node.value && node.value.open) node.value.close();
      restore();
    });
    return () => h("dialog", {
      ref: node, class: "sacode-dialog", "aria-label": props.title,
      "aria-modal": props.modal ? "true" : "false",
      onCancel: (event) => { event.preventDefault(); emit("close"); },
      onKeydown: (event) => {
        if (!props.modal && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); emit("close"); }
      },
    }, [
      h("header", { class: "dialog-header" }, [
        h("h2", null, props.title),
        h("button", { class: "btn", autofocus: true, "aria-label": "关闭" + props.title,
          onClick: () => emit("close") }, "关闭"),
      ]),
      h("div", { class: "dialog-body" }, slots.default ? slots.default() : []),
    ]);
  },
};
