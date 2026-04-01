<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const activeTab = ref<"login" | "register">("login");
const loading = ref(false);
const errorMessage = ref("");

// 登录表单
const loginForm = ref({
  username: "",
  password: "",
});

// 注册表单
const registerForm = ref({
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
});

// OAuth 提供商
const oauthProviders = [
  { name: "github", label: "GitHub", color: "#333" },
  { name: "google", label: "Google", color: "#4285f4" },
  { name: "wechat", label: "微信", color: "#07c160" },
  { name: "qq", label: "QQ", color: "#12b7f5" },
];

onMounted(() => {
  // 检查 URL 参数中的错误信息
  const error = route.query.error as string;
  if (error) {
    errorMessage.value = decodeURIComponent(error);
  }
});

async function handleLogin() {
  if (!loginForm.value.username || !loginForm.value.password) {
    errorMessage.value = "请填写用户名和密码";
    return;
  }

  loading.value = true;
  errorMessage.value = "";

  const success = await authStore.login(loginForm.value.username, loginForm.value.password);

  if (success) {
    const redirect = route.query.redirect as string;
    router.push(redirect || "/dashboard");
  } else {
    errorMessage.value = "用户名或密码错误";
  }

  loading.value = false;
}

async function handleRegister() {
  if (!registerForm.value.username || !registerForm.value.email || !registerForm.value.password) {
    errorMessage.value = "请填写所有必填项";
    return;
  }

  if (registerForm.value.password !== registerForm.value.confirmPassword) {
    errorMessage.value = "两次输入的密码不一致";
    return;
  }

  loading.value = true;
  errorMessage.value = "";

  const success = await authStore.register(
    registerForm.value.username,
    registerForm.value.email,
    registerForm.value.password
  );

  if (success) {
    router.push("/dashboard");
  } else {
    errorMessage.value = "注册失败，用户名或邮箱可能已存在";
  }

  loading.value = false;
}

function handleOAuthLogin(provider: string) {
  // 跳转到 OAuth 授权页面
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const baseUrl = apiUrl || window.location.origin.replace(/:\d+/, ":3000");
  window.location.href = `${baseUrl}/api/auth/oauth/${provider}`;
}
</script>

<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1>SaClaw</h1>
        <p>多端 AI 助手框架</p>
      </div>

      <tiny-tabs v-model="activeTab">
        <tiny-tab-item title="登录" name="login">
          <form @submit.prevent="handleLogin" class="auth-form">
            <tiny-form label-width="0">
              <tiny-form-item>
                <tiny-input
                  v-model="loginForm.username"
                  placeholder="用户名"
                  prefix-icon="user"
                  size="medium"
                />
              </tiny-form-item>
              <tiny-form-item>
                <tiny-input
                  v-model="loginForm.password"
                  type="password"
                  placeholder="密码"
                  prefix-icon="lock"
                  size="medium"
                  show-password
                />
              </tiny-form-item>
              <tiny-form-item>
                <tiny-button
                  type="primary"
                  native-type="submit"
                  :loading="loading"
                  size="medium"
                  round
                >
                  登录
                </tiny-button>
              </tiny-form-item>
            </tiny-form>
          </form>
        </tiny-tab-item>

        <tiny-tab-item title="注册" name="register">
          <form @submit.prevent="handleRegister" class="auth-form">
            <tiny-form label-width="0">
              <tiny-form-item>
                <tiny-input
                  v-model="registerForm.username"
                  placeholder="用户名"
                  prefix-icon="user"
                  size="medium"
                />
              </tiny-form-item>
              <tiny-form-item>
                <tiny-input
                  v-model="registerForm.email"
                  placeholder="邮箱"
                  prefix-icon="mail"
                  size="medium"
                />
              </tiny-form-item>
              <tiny-form-item>
                <tiny-input
                  v-model="registerForm.password"
                  type="password"
                  placeholder="密码"
                  prefix-icon="lock"
                  size="medium"
                  show-password
                />
              </tiny-form-item>
              <tiny-form-item>
                <tiny-input
                  v-model="registerForm.confirmPassword"
                  type="password"
                  placeholder="确认密码"
                  prefix-icon="lock"
                  size="medium"
                  show-password
                />
              </tiny-form-item>
              <tiny-form-item>
                <tiny-button
                  type="primary"
                  native-type="submit"
                  :loading="loading"
                  size="medium"
                  round
                >
                  注册
                </tiny-button>
              </tiny-form-item>
            </tiny-form>
          </form>
        </tiny-tab-item>
      </tiny-tabs>

      <tiny-alert
        v-if="errorMessage"
        type="error"
        :title="errorMessage"
        closable
        @close="errorMessage = ''"
      />

      <div class="oauth-section">
        <tiny-divider>或使用第三方账号登录</tiny-divider>
        <div class="oauth-buttons">
          <tiny-button
            v-for="provider in oauthProviders"
            :key="provider.name"
            size="medium"
            round
            :style="{ borderColor: provider.color, color: provider.color }"
            @click="handleOAuthLogin(provider.name)"
          >
            {{ provider.label }}
          </tiny-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%);
}

.login-card {
  width: 400px;
  padding: 32px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.dark .login-card {
  background: #1f2937;
}

.login-header {
  text-align: center;
  margin-bottom: 24px;
}

.login-header h1 {
  font-size: 32px;
  font-weight: 700;
  color: #f97316;
  margin: 0 0 8px 0;
}

.login-header p {
  color: #6b7280;
  margin: 0;
}

.auth-form {
  margin-top: 16px;
}

.auth-form :deep(.tiny-form-item) {
  margin-bottom: 16px;
}

.auth-form :deep(.tiny-button) {
  width: 100%;
}

.oauth-section {
  margin-top: 24px;
}

.oauth-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 16px;
}

.oauth-buttons :deep(.tiny-button) {
  flex: 1;
  min-width: 80px;
  max-width: 100px;
}
</style>