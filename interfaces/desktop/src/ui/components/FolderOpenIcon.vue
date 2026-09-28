<script setup lang="ts">
defineProps<{
  size?: number | string;
}>();
</script>

<template>
  <svg
    :width="size ?? 14"
    :height="size ?? 14"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M1 20H19.5L22.5 10H4L1 20ZM1 20L1 3.5L7 3.5L10 6L19.5 6L19.5 10"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="square"
    />
  </svg>
</template>
