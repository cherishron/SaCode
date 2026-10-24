<template>
  <div class="nf">
    <h1 class="code">404</h1>
    <p class="muted">页面不存在或路径无效。</p>
    <button class="btn primary" @click="goWorkbench">返回工作台</button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goWorkbench(): void {
  void router.push('/workbench');
}
</script>
