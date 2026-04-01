import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/Login.vue"),
      meta: { requiresAuth: false },
    },
    {
      path: "/auth/callback",
      name: "auth-callback",
      component: () => import("@/views/AuthCallback.vue"),
      meta: { requiresAuth: false },
    },
    {
      path: "/",
      redirect: "/dashboard",
      meta: { requiresAuth: true },
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("@/views/Dashboard.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/chat",
      name: "chat",
      component: () => import("@/views/Chat.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/im",
      name: "im",
      component: () => import("@/views/IM.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/plugins",
      name: "plugins",
      component: () => import("@/views/Plugins.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/containers",
      name: "containers",
      component: () => import("@/views/Containers.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/agents",
      name: "agents",
      component: () => import("@/views/Agents.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/Settings.vue"),
      meta: { requiresAuth: true },
    },
  ],
});

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // 等待 auth store 初始化
  if (!authStore.initialized) {
    await authStore.init();
  }

  const requiresAuth = to.meta.requiresAuth !== false;

  if (requiresAuth && !authStore.isAuthenticated) {
    next({ name: "login", query: { redirect: to.fullPath } });
  } else if (to.name === "login" && authStore.isAuthenticated) {
    next({ name: "dashboard" });
  } else {
    next();
  }
});

export default router;
