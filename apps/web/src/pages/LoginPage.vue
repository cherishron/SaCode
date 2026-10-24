<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-brand">
        <img src="/sacode-logo.png" width="36" height="36" alt="SaCode" />
        <div class="login-brand-text">
          <span class="login-title">SaCode</span>
          <span class="login-subtitle">让灵感，有迹可循。</span>
        </div>
      </div>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <label class="field">
        <span>用户名</span>
        <input v-model="username" autocomplete="username" :disabled="busy" />
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" />
      </label>
      <button class="btn primary" type="submit" :disabled="busy">
        {{ busy ? '登录中…' : '登录' }}
      </button>
      <p class="login-hint">Web 工作台 · 只读模式</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useRouter, useRoute } from 'vue-router';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await auth.login(username.value, password.value);
    const redirect = (route.query.redirect as string) || '/workbench';
    router.push(redirect);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
