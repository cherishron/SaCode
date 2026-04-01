<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const error = ref<string | null>(null);

onMounted(async () => {
  const token = route.query.token as string;

  if (!token) {
    error.value = "OAuth 回调缺少 token 参数";
    setTimeout(() => router.push("/login"), 2000);
    return;
  }

  try {
    // 保存 token
    localStorage.setItem("token", token);

    // 获取用户信息
    const response = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("获取用户信息失败");
    }

    const user = await response.json();

    // 设置 token 并初始化用户信息
    authStore.setToken(token);
    authStore.setUser(user);

    // 跳转到仪表盘
    router.push("/dashboard");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "OAuth 登录失败";
    setTimeout(() => router.push("/login"), 2000);
  }
});
</script>

<template>
  <div class="callback-container">
    <div v-if="error" class="error-message">
      <tiny-icon name="error" />
      <span>{{ error }}</span>
      <p>正在跳转到登录页面...</p>
    </div>
    <div v-else class="loading-message">
      <tiny-loading />
      <span>正在完成登录...</span>
    </div>
  </div>
</template>

<style scoped>
.callback-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%);
}

.error-message,
.loading-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.error-message {
  color: #ef4444;
}

.loading-message {
  color: #374151;
}
</style>
