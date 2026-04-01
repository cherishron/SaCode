import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "@/lib/api";

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string | undefined;
  role: "user" | "admin";
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem("token"));
  const initialized = ref(false);

  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isAdmin = computed(() => user.value?.role === "admin");

  /**
   * 设置 token
   */
  function setToken(tokenStr: string) {
    token.value = tokenStr;
    localStorage.setItem("token", tokenStr);
  }

  /**
   * 设置用户信息
   */
  function setUser(userData: User) {
    user.value = userData;
  }

  /**
   * 设置认证数据（公共方法）
   */
  function setAuthData(tokenStr: string, userData: User) {
    token.value = tokenStr;
    user.value = userData;
    localStorage.setItem("token", tokenStr);
  }

  /**
   * 清除认证数据
   */
  function clearAuthData() {
    user.value = null;
    token.value = null;
    localStorage.removeItem("token");
  }

  async function init() {
    if (token.value) {
      try {
        const response = await api.get<{ user: User }>("/auth/me");
        user.value = response.user;
      } catch (error) {
        console.error("[Auth] Failed to fetch user info:", error);
        clearAuthData();
      }
    }
    initialized.value = true;
  }

  async function login(username: string, password: string): Promise<boolean> {
    try {
      const response = await api.post<{ token: string; user: User }>("/auth/login", {
        username,
        password,
      });

      setAuthData(response.token, response.user);
      return true;
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      return false;
    }
  }

  async function register(username: string, email: string, password: string): Promise<boolean> {
    try {
      const response = await api.post<{ token: string; user: User }>("/auth/register", {
        username,
        email,
        password,
      });

      setAuthData(response.token, response.user);
      return true;
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      return false;
    }
  }

  function logout() {
    clearAuthData();
  }

  return {
    user,
    token,
    initialized,
    isAuthenticated,
    isAdmin,
    setToken,
    setUser,
    setAuthData,
    init,
    login,
    register,
    logout,
  };
});
