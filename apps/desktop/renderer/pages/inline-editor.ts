// 承接 DSH 66e10182 / b88b6c24 的多行编辑与输入法防护契约，沿用唯一 Vue runtime。
import { defineComponent, h, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';

export const InlineEditor = defineComponent({
  name: 'SaCodeInlineEditor',
  props: { value: { type: String, required: true }, label: { type: String, required: true }, busy: Boolean, className: String, maxlength: Number },
  emits: ['change', 'save', 'cancel'],
  setup(props, { emit }) {
    const node = ref<HTMLTextAreaElement | null>(null);
    let disposed = false, observer: ResizeObserver | undefined, width = -1;
    const fit = async () => {
      await nextTick();
      const element = node.value;
      if (disposed || !element) return;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
    };
    onMounted(() => {
      const element = node.value;
      element?.focus();
      void fit();
      if (element && typeof ResizeObserver !== 'undefined') {
        width = element.clientWidth;
        observer = new ResizeObserver(() => {
          // 高度变化也会触发 observer；只在宽度变化时重排，避免自触发循环。
          if (disposed || element.clientWidth === width) return;
          width = element.clientWidth;
          void fit();
        });
        observer.observe(element);
      }
    });
    watch(() => props.value, () => { void fit(); });
    onBeforeUnmount(() => { disposed = true; observer?.disconnect(); });
    return () => h('textarea', {
      ref: node, class: props.className, rows: 1, value: props.value, maxlength: props.maxlength,
      'aria-label': props.label, 'aria-busy': props.busy, readOnly: props.busy,
      onInput: (event: Event) => { if (!props.busy) emit('change', (event.target as HTMLTextAreaElement).value); },
      onKeydown: (event: KeyboardEvent) => {
        if (props.busy || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); emit('cancel');
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) emit('save');
        }
      },
    });
  },
});
