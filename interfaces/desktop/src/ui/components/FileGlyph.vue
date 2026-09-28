<script setup lang="ts">
import { computed } from 'vue';
import { fileExtension, fileKind, iconTone } from '../utils/file-kind';

/**
 * FileGlyph — 彩色文件夹 / 按后缀着色的文件图标。
 * 目录用实心文件夹；文件用文档轮廓 + 后缀角标。
 */
const props = defineProps<{
  name: string;
  isDir?: boolean;
  size?: number;
  expanded?: boolean;
}>();

const tone = computed(() => iconTone(props.name, props.isDir));
const kind = computed(() => fileKind(props.name, props.isDir));
const extLabel = computed(() => {
  if (props.isDir) return '';
  const ext = fileExtension(props.name);
  if (!ext || ext.length > 4) return '';
  return ext.slice(0, 4);
});
const px = computed(() => props.size ?? 14);
</script>

<template>
  <span
    class="file-glyph"
    :class="[`tone-${tone}`, `kind-${kind}`, { 'is-dir': isDir }]"
    :style="{ width: `${px}px`, height: `${px}px`, fontSize: `${Math.max(8, px * 0.55)}px` }"
    aria-hidden="true"
  >
    <!-- 文件夹 -->
    <svg
      v-if="isDir"
      class="file-glyph-svg"
      viewBox="0 0 24 24"
      :width="px"
      :height="px"
    >
      <path
        v-if="expanded"
        class="glyph-fill"
        d="M1.5 19.5h20.2l2.1-9.2H4.2L1.5 19.5zm.3-15.2h6.4l2 2.4h12.1v3.4H2.2l-.4-5.8z"
      />
      <path
        v-else
        class="glyph-fill"
        d="M1.8 5.2h7.1l2.1 2.3h11.2v3.2H2.2l-.4-5.5zm-.4 7h20.8L20 19.6H1.8L1.4 12.2z"
      />
    </svg>

    <!-- 文件：圆角文档 + 后缀 -->
    <svg
      v-else
      class="file-glyph-svg"
      viewBox="0 0 24 24"
      :width="px"
      :height="px"
    >
      <path
        class="glyph-stroke"
        d="M6.2 2.8h8.2l4.4 4.4v14H6.2z"
        fill="none"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path class="glyph-fill" d="M14.2 2.8l4.6 4.6h-4.6z" />
    </svg>
    <span v-if="extLabel" class="file-glyph-ext">{{ extLabel }}</span>
  </span>
</template>
