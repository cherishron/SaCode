<template>
  <div class="app" :class="{ 'workbench-shell': route.name === 'workbench' }">
    <header class="topbar">
      <span class="brand"
        ><img src="/sacode-logo.png" width="24" height="24" alt="" />SaCode<span class="web-edition"
          >Web</span
        ></span
      >
      <span class="spacer" />
      <span v-if="auth.owner" class="user">{{ auth.owner.username }}</span>
      <button
        type="button"
        class="btn ghost"
        data-theme-toggle
        :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '浅色' : '深色' }}
      </button>
      <button v-if="auth.authenticated" class="btn ghost" @click="doLogout">退出</button>
    </header>
    <main class="content"><router-view /></main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuthStore } from './stores/auth';
import { useRoute, useRouter } from 'vue-router';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// 主题：默认深色；用户选择存 localStorage（主题非凭据，可落盘）。
// CSP 禁止内联脚本，故初始化放在本模块（外部 JS）内执行。
type Theme = 'dark' | 'light';
const STORAGE_KEY = 'sacode-theme';
function readSavedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    // 存储不可用时不阻断页面，保持默认深色。
    return 'dark';
  }
}

// 必须先读取偏好再注册立即执行的监听器，避免刷新时把保存的浅色覆盖为深色。
const theme = ref<Theme>(readSavedTheme());

function applyTheme(next: Theme): void {
  document.documentElement.dataset.theme = next;
}

watch(
  theme,
  (next) => {
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略写入失败 */
    }
  },
  { immediate: true },
);

function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}

async function doLogout(): Promise<void> {
  await auth.logout();
  router.push('/login');
}
</script>
