<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import { useThemeStore } from "@/stores/theme";

// 初始化主题
const themeStore = useThemeStore();

onMounted(() => {
  // 初始化主题：应用存储的主题 + 监听系统主题变化
  themeStore.init();
});
</script>

<template>
  <RouterView />
</template>

<style>
/* 全局样式已在 style.css 中定义 */
</style>
