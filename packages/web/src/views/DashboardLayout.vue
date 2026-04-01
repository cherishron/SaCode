<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useShortcutsStore } from "@/stores/shortcuts";
import NotificationCenter from "@/components/NotificationCenter.vue";
import ShortcutHelp from "@/components/ShortcutHelp.vue";

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const shortcutsStore = useShortcutsStore();

const collapsed = ref(false);
const activeMenu = computed(() => {
  const path = router.currentRoute.value.path;
  if (path === "/" || path === "/dashboard") return "dashboard";
  if (path.startsWith("/chat")) return "chat";
  if (path.startsWith("/im")) return "im";
  if (path.startsWith("/settings")) return "settings";
  return "dashboard";
});

const menuItems = [
  { key: "dashboard", label: "仪表盘", icon: "home" },
  { key: "chat", label: "对话", icon: "chat" },
  { key: "im", label: "IM 管理", icon: "message" },
  { key: "settings", label: "设置", icon: "setting" },
];

// 路由映射
const routeMap: Record<string, string> = {
  dashboard: "/dashboard",
  chat: "/chat",
  im: "/im",
  settings: "/settings",
};

function handleMenuSelect(key: string) {
  router.push(routeMap[key] ?? `/${key}`);
}

function handleLogout() {
  authStore.logout();
  router.push("/login");
}

// 初始化快捷键
onMounted(() => {
  shortcutsStore.init();

  // 监听主题切换快捷键
  window.addEventListener("shortcut:toggle-theme", () => {
    themeStore.toggleTheme();
  });
});

onUnmounted(() => {
  shortcutsStore.cleanup();
});
</script>

<template>
  <div class="dashboard-layout">
    <aside class="sidebar" :class="{ collapsed }">
      <div class="sidebar-header">
        <h2 v-if="!collapsed">SaClaw</h2>
        <span v-else class="logo-mini">S</span>
      </div>

      <tiny-menu
        :data="menuItems"
        :default-active="activeMenu"
        :collapse="collapsed"
        @select="handleMenuSelect"
      />

      <div class="sidebar-footer">
        <tiny-button
          :icon="collapsed ? 'chevron-right' : 'chevron-left'"
          size="mini"
          @click="collapsed = !collapsed"
        />
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <div class="header-left">
          <h1>{{ router.currentRoute.value.meta.title || "仪表盘" }}</h1>
        </div>
        <div class="header-right">
          <NotificationCenter />
          <tiny-tooltip :content="themeStore.isDark ? '切换到浅色模式' : '切换到深色模式'">
            <tiny-button
              class="theme-toggle"
              :icon="themeStore.isDark ? 'sunny' : 'moon'"
              size="small"
              @click="themeStore.toggleTheme()"
            />
          </tiny-tooltip>
          <tiny-dropdown>
            <span class="user-info">
              <tiny-avatar
                :src="authStore.user?.avatar"
                :text="authStore.user?.username?.charAt(0).toUpperCase()"
                size="small"
              />
              <span class="username">{{ authStore.user?.username }}</span>
            </span>
            <template #dropdown>
              <tiny-dropdown-menu>
                <tiny-dropdown-item @click="router.push('/settings')">
                  设置
                </tiny-dropdown-item>
                <tiny-dropdown-item divided @click="handleLogout">
                  退出登录
                </tiny-dropdown-item>
              </tiny-dropdown-menu>
            </template>
          </tiny-dropdown>
        </div>
      </header>

      <div class="content">
        <slot />
      </div>
    </main>

    <!-- 快捷键帮助 -->
    <ShortcutHelp />
  </div>
</template>

<style scoped>
.dashboard-layout {
  display: flex;
  min-height: 100vh;
  background: #f9fafb;
}

.dark .dashboard-layout {
  background: #111827;
}

.sidebar {
  width: 240px;
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
}

.dark .sidebar {
  background: #1f2937;
  border-right-color: #374151;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #e5e7eb;
}

.dark .sidebar-header {
  border-bottom-color: #374151;
}

.sidebar-header h2 {
  font-size: 20px;
  font-weight: 700;
  color: #f97316;
  margin: 0;
}

.logo-mini {
  font-size: 24px;
  font-weight: 700;
  color: #f97316;
}

.sidebar :deep(.tiny-menu) {
  border-right: none;
  flex: 1;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: center;
}

.dark .sidebar-footer {
  border-top-color: #374151;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  height: 64px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.dark .header {
  background: #1f2937;
  border-bottom-color: #374151;
}

.header-left h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.theme-toggle {
  padding: 4px 8px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  color: #374151;
}

.dark .username {
  color: #e5e7eb;
}

.content {
  flex: 1;
  padding: 24px;
  overflow: auto;
}
</style>
