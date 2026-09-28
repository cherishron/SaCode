<script setup lang="ts">
defineProps<{
  size?: number | string;
}>();
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M12 18C8.13401 18 5 14.866 5 11M12 18C15.866 18 19 14.866 19 11M12 18V21M7 21H17M12 15C9.79086 15 8 13.2091 8 11V6C8 3.79086 9.79086 2 12 2C14.2091 2 16 3.79086 16 6V11C16 13.2091 14.2091 15 12 15Z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="square"
    />
  </svg>
</template>
