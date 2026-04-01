import { defineStore } from "pinia";
import { onScopeDispose, ref, watch } from "vue";

export type Theme = "light" | "dark" | "auto";

const THEME_KEY = "SACODE-theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function getStoredTheme(): Theme {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(THEME_KEY) as Theme | null;
    if (stored && ["light", "dark", "auto"].includes(stored)) {
      return stored;
    }
  }
  return "auto";
}

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>(getStoredTheme());
  const isDark = ref(false);

  // 保存清理函数引用，用于移除事件监听器
  let cleanupFn: (() => void) | null = null;

  function applyTheme(newTheme: Theme) {
    const effectiveTheme = newTheme === "auto" ? getSystemTheme() : newTheme;
    isDark.value = effectiveTheme === "dark";

    if (typeof document !== "undefined") {
      const html = document.documentElement;
      if (isDark.value) {
        html.classList.add("dark");
      } else {
        html.classList.remove("dark");
      }
    }
  }

  function setTheme(newTheme: Theme) {
    theme.value = newTheme;
    localStorage.setItem(THEME_KEY, newTheme);
    applyTheme(newTheme);
  }

  function toggleTheme() {
    setTheme(isDark.value ? "light" : "dark");
  }

  function setupSystemThemeListener() {
    // 如果已有监听器，跳过（防止重复绑定）
    if (cleanupFn) return;

    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handler = () => {
        if (theme.value === "auto") {
          applyTheme("auto");
        }
      };

      mediaQuery.addEventListener("change", handler);

      // 保存清理函数
      cleanupFn = () => {
        mediaQuery.removeEventListener("change", handler);
        cleanupFn = null;
      };

      // 自动清理：当 store 所在作用域销毁时自动移除监听器
      onScopeDispose(() => {
        if (cleanupFn) cleanupFn();
      });
    }
  }

  // 清理事件监听器，防止内存泄漏
  function cleanup() {
    if (cleanupFn) {
      cleanupFn();
    }
  }

  // 初始化方法 - 在应用启动时调用
  function init() {
    applyTheme(theme.value);
    setupSystemThemeListener();
  }

  // 监听主题变化
  watch(theme, (newTheme) => {
    applyTheme(newTheme);
  });

  return {
    theme,
    isDark,
    setTheme,
    toggleTheme,
    init,
    cleanup,
  };
});