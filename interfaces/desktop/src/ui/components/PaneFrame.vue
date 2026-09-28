<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { CloseIcon, EllipsisIcon } from 'tdesign-icons-vue-next';

const props = defineProps<{
  title: string;
  focus?: boolean;
  closable?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  split: [axis: 'row' | 'column'];
  rename: [title: string];
  maximize: [];
  replace: [];
}>();

const menuOpen = ref(false);
const menuWrap = ref<HTMLElement | null>(null);

function onDocPointer(e: PointerEvent) {
  if (!menuWrap.value?.contains(e.target as Node)) menuOpen.value = false;
}

onMounted(() => document.addEventListener('pointerdown', onDocPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer));
const renaming = ref(false);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function startRename() {
  menuOpen.value = false;
  draft.value = props.title;
  renaming.value = true;
  void nextTick(() => inputRef.value?.focus());
}

function commitRename() {
  const next = draft.value.trim();
  renaming.value = false;
  if (next && next !== props.title) emit('rename', next);
}

function cancelRename() {
  renaming.value = false;
}
</script>

<template>
  <section class="pane" :class="{ 'pane-focus': focus }">
    <header class="pane-head">
      <span class="pane-head-status">
        <slot name="status" />
      </span>
      <!-- 双击就地改名（契约 C1）；拖拽区双击例外 -->
      <input
        v-if="renaming"
        ref="inputRef"
        v-model="draft"
        class="pane-head-rename"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
        @blur="commitRename"
      />
      <div
        v-else
        class="pane-head-title"
        :title="title"
        @dblclick="startRename"
      >
        {{ title }}
      </div>
      <div class="pane-head-actions">
        <slot name="actions" />
        <div ref="menuWrap" class="pane-menu-wrap" @click.stop>
          <button
            class="ghost-btn"
            type="button"
            title="更多"
            @click="menuOpen = !menuOpen"
          >
            <EllipsisIcon size="13" />
          </button>
          <div v-if="menuOpen" class="pane-menu">
            <button type="button" @click="menuOpen = false; emit('split', 'row')">
              向右拆分
            </button>
            <button type="button" @click="menuOpen = false; emit('split', 'column')">
              向下拆分
            </button>
            <button type="button" @click="menuOpen = false; emit('maximize')">
              独占
            </button>
            <button type="button" @click="menuOpen = false; emit('replace')">
              更换
            </button>
            <button type="button" @click="startRename">
              重命名
            </button>
          </div>
        </div>
        <button
          v-if="closable"
          class="ghost-btn"
          type="button"
          title="关闭"
          @click="emit('close')"
        >
          <CloseIcon size="13" />
        </button>
      </div>
    </header>
    <div class="pane-body">
      <slot />
    </div>
  </section>
</template>
