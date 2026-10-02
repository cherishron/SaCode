<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  equalizeAt,
  leaves as treeLeaves,
  setRatio,
  type SplitDir,
  type SplitNode as SplitNodeModel,
} from '../logic/split-tree.ts';
import { LOAD_MIME, SWAP_MIME } from '../logic/split-slots.ts';

/**
 * SplitNode — 递归分屏节点（二叉树：叶 = 槽位，内部节点 = 一次切分）。
 * 只做几何与分隔线；格内容由父级 `#leaf` 插槽提供。
 * 比例 = 长子 a 的份额（与 split-tree.ts 一致）。
 */
const props = defineProps<{
  node: SplitNodeModel;
  path: string;
  maximized: number | null;
}>();

const emit = defineEmits<{
  focus: [slot: number];
  resize: [path: string, ratio: number];
  equalize: [path: string];
  swap: [from: number, to: number];
  load: [slot: number, id: string];
  dropHover: [slot: number | null];
}>();

type LeafSlotProps = { slot: number; path: string };

defineSlots<{
  leaf(props: LeafSlotProps): unknown;
}>();

/** 打破递归插槽的类型自引用（入参收成 unknown 再收窄） */
function forwardLeaf(props: unknown): LeafSlotProps {
  return props as LeafSlotProps;
}

const dragOver = ref(false);

function hasSlot(node: SplitNodeModel, slot: number): boolean {
  const pending: SplitNodeModel[] = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if ('leaf' in current) {
      if (current.leaf === slot) return true;
    } else {
      pending.push(current.a, current.b);
    }
  }
  return false;
}

const branch = computed(() => ('leaf' in props.node ? null : props.node));
const showA = computed(
  () => !branch.value || props.maximized === null || !hasSlot(branch.value.b, props.maximized),
);
const showB = computed(
  () => !branch.value || props.maximized === null || !hasSlot(branch.value.a, props.maximized),
);
const solo = computed(() => !!(branch.value && (!showA.value || !showB.value)));

function childStyle(side: 'a' | 'b') {
  if (!branch.value || solo.value) return { flex: '1 1 0' };
  // 长子 a 定宽/高，次子 b 吃掉余量（.split-child.second = flex 1），分隔线 1px 不挤爆
  if (side === 'b') return {};
  const size = `${(branch.value.ratio * 100).toFixed(4)}%`;
  return branch.value.dir === 'col' ? { width: size, flex: '0 0 auto' } : { height: size, flex: '0 0 auto' };
}

function axisClass(dir: SplitDir): string {
  // split-tree 的 col = 左右并排（竖分隔线）；row = 上下堆叠（横分隔线）
  return dir === 'row' ? 'axis-row' : 'axis-column';
}

function dividerClass(dir: SplitDir): string {
  return dir === 'row' ? 'row' : 'column';
}

function onDividerDown(event: PointerEvent) {
  if (event.button !== 0 || !branch.value || solo.value) return;
  event.preventDefault();
  const node = branch.value;
  const host = (event.currentTarget as HTMLElement).parentElement;
  const start = node.dir === 'col' ? event.clientX : event.clientY;
  const total = Math.max(
    1,
    node.dir === 'col' ? host?.clientWidth || 1 : host?.clientHeight || 1,
  );
  const startRatio = node.ratio;
  const minRatio = Math.min(0.45, 96 / total);
  const move = (ev: PointerEvent) => {
    const now = node.dir === 'col' ? ev.clientX : ev.clientY;
    const delta = (now - start) / total;
    emit('resize', props.path, Math.min(1 - minRatio, Math.max(minRatio, startRatio + delta)));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onDividerKeydown(event: KeyboardEvent) {
  if (!branch.value || solo.value) return;
  const node = branch.value;
  const step = event.shiftKey ? 0.1 : 0.05;
  const forward =
    node.dir === 'col'
      ? event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : 0
      : event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : 0;
  if (!forward) return;
  event.preventDefault();
  emit('resize', props.path, Math.min(0.9, Math.max(0.1, node.ratio + forward * step)));
}

function isSplitDrag(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types;
  if (!types) return false;
  return types.includes(SWAP_MIME) || types.includes(LOAD_MIME);
}

function onLeafDragOver(ev: DragEvent) {
  if (!isSplitDrag(ev) || !('leaf' in props.node)) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  dragOver.value = true;
  emit('dropHover', props.node.leaf);
}

function onLeafDragLeave() {
  if (!dragOver.value) return;
  dragOver.value = false;
  emit('dropHover', null);
}

function onLeafDrop(ev: DragEvent) {
  if (!('leaf' in props.node)) return;
  const dt = ev.dataTransfer;
  if (!dt) return;
  dragOver.value = false;
  emit('dropHover', null);
  const fromRaw = dt.getData(SWAP_MIME);
  if (fromRaw) {
    ev.preventDefault();
    const from = Number(fromRaw);
    if (Number.isSafeInteger(from) && from !== props.node.leaf) emit('swap', from, props.node.leaf);
    return;
  }
  const sessionId = dt.getData(LOAD_MIME);
  if (sessionId) {
    ev.preventDefault();
    emit('load', props.node.leaf, sessionId);
  }
}

function onLeafPointerDown() {
  if ('leaf' in props.node) emit('focus', props.node.leaf);
}

/** 调试/测试可达：本子树的可见槽序 */
defineExpose({
  visibleSlots: () => ('leaf' in props.node ? [props.node.leaf] : treeLeaves(props.node)),
  equalize: () => ('leaf' in props.node ? null : equalizeAt(props.node, '')),
  setRatio: (ratio: number) => ('leaf' in props.node ? null : setRatio(props.node, '', ratio)),
});
</script>

<template>
  <div
    v-if="'leaf' in node"
    class="split-leaf pane-anchor"
    :class="{ 'drop-target': dragOver }"
    @pointerdown="onLeafPointerDown"
    @dragover="onLeafDragOver"
    @dragleave="onLeafDragLeave"
    @drop="onLeafDrop"
  >
    <slot name="leaf" :slot="node.leaf" :path="path" />
  </div>
  <div v-else class="split-node" :class="axisClass(node.dir)">
    <div v-if="showA" class="split-child first" :style="childStyle('a')">
      <SplitNode
        :node="node.a"
        :path="`${path}a`"
        :maximized="maximized"
        @focus="emit('focus', $event)"
        @resize="(p, r) => emit('resize', p, r)"
        @equalize="emit('equalize', $event)"
        @swap="(x, y) => emit('swap', x, y)"
        @load="(slot, id) => emit('load', slot, id)"
        @drop-hover="emit('dropHover', $event)"
      >
        <template #leaf="leafProps"><slot name="leaf" v-bind="forwardLeaf(leafProps)" /></template>
      </SplitNode>
    </div>
    <div
      v-if="showA && showB"
      class="split-divider"
      :class="dividerClass(node.dir)"
      role="separator"
      tabindex="0"
      :aria-label="`调整 ${node.dir === 'col' ? '左右' : '上下'} 分格比例`"
      :aria-orientation="node.dir === 'col' ? 'vertical' : 'horizontal'"
      aria-valuemin="15"
      aria-valuemax="85"
      :aria-valuenow="Math.round(node.ratio * 100)"
      @pointerdown.prevent="onDividerDown"
      @keydown="onDividerKeydown"
      @dblclick="emit('equalize', path)"
    />
    <div v-if="showB" class="split-child second" :style="childStyle('b')">
      <SplitNode
        :node="node.b"
        :path="`${path}b`"
        :maximized="maximized"
        @focus="emit('focus', $event)"
        @resize="(p, r) => emit('resize', p, r)"
        @equalize="emit('equalize', $event)"
        @swap="(x, y) => emit('swap', x, y)"
        @load="(slot, id) => emit('load', slot, id)"
        @drop-hover="emit('dropHover', $event)"
      >
        <template #leaf="leafProps"><slot name="leaf" v-bind="forwardLeaf(leafProps)" /></template>
      </SplitNode>
    </div>
  </div>
</template>
