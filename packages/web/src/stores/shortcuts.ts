import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useRouter } from "vue-router";

export interface Shortcut {
  id: string;
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  description: string;
  category: "navigation" | "action" | "chat" | "system";
  action: () => void;
  enabled?: boolean;
  global?: boolean;
}

export const useShortcutsStore = defineStore("shortcuts", () => {
  const shortcuts = ref<Map<string, Shortcut>>(new Map());
  const enabled = ref(true);
  const showHelp = ref(false);

  const router = useRouter();

  // 计算所有启用的快捷键
  const enabledShortcuts = computed(() => {
    const result: Shortcut[] = [];
    shortcuts.value.forEach((shortcut) => {
      if (shortcut.enabled !== false) {
        result.push(shortcut);
      }
    });
    return result;
  });

  // 按类别分组
  const shortcutsByCategory = computed(() => {
    const categories: Record<string, Shortcut[]> = {
      navigation: [],
      action: [],
      chat: [],
      system: [],
    };

    shortcuts.value.forEach((shortcut) => {
      if (shortcut.enabled !== false) {
        categories[shortcut.category]?.push(shortcut);
      }
    });

    return categories;
  });

  // 注册快捷键
  function register(shortcut: Shortcut) {
    shortcuts.value.set(shortcut.id, shortcut);
  }

  // 批量注册
  function registerAll(newShortcuts: Shortcut[]) {
    newShortcuts.forEach((shortcut) => {
      shortcuts.value.set(shortcut.id, shortcut);
    });
  }

  // 注销快捷键
  function unregister(id: string) {
    shortcuts.value.delete(id);
  }

  // 启用/禁用快捷键
  function setEnabled(id: string, isEnabled: boolean) {
    const shortcut = shortcuts.value.get(id);
    if (shortcut) {
      shortcut.enabled = isEnabled;
    }
  }

  // 全局启用/禁用
  function setGlobalEnabled(isEnabled: boolean) {
    enabled.value = isEnabled;
  }

  // 显示帮助
  function openHelp() {
    showHelp.value = true;
  }

  function closeHelp() {
    showHelp.value = false;
  }

  // 检查是否匹配快捷键
  function matchesShortcut(
    event: KeyboardEvent,
    shortcut: Shortcut
  ): boolean {
    // 检查按键
    const key = event.key.toLowerCase();
    if (key !== shortcut.key.toLowerCase()) return false;

    // 检查修饰键
    const ctrl = shortcut.ctrl ?? false;
    const alt = shortcut.alt ?? false;
    const shift = shortcut.shift ?? false;
    const meta = shortcut.meta ?? false;

    // Windows: Ctrl, macOS: Meta (Cmd)
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;

    if (ctrl && !isCtrlOrMeta) return false;
    if (!ctrl && isCtrlOrMeta) return false;
    if (alt && !event.altKey) return false;
    if (!alt && event.altKey) return false;
    if (shift && !event.shiftKey) return false;
    if (!shift && event.shiftKey) return false;

    // macOS 下 meta 键的单独检查
    if (meta && !event.metaKey) return false;

    return true;
  }

  // 键盘事件处理器
  function handleKeyDown(event: KeyboardEvent) {
    // 忽略输入框中的快捷键（除非是全局快捷键）
    const target = event.target as HTMLElement;
    const isInputElement =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    // 帮助快捷键：? 或 Ctrl+/
    if (event.key === "?" || (event.ctrlKey && event.key === "/")) {
      showHelp.value = !showHelp.value;
      event.preventDefault();
      return;
    }

    if (!enabled.value) return;

    // 查找匹配的快捷键
    for (const shortcut of enabledShortcuts.value) {
      // 非全局快捷键在输入框中不触发
      if (isInputElement && !shortcut.global) continue;

      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }

  // 获取快捷键显示文本
  function getShortcutText(shortcut: Shortcut): string {
    const parts: string[] = [];

    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

    if (shortcut.ctrl) {
      parts.push(isMac ? "⌘" : "Ctrl");
    }
    if (shortcut.alt) {
      parts.push(isMac ? "⌥" : "Alt");
    }
    if (shortcut.shift) {
      parts.push(isMac ? "⇧" : "Shift");
    }
    if (shortcut.meta) {
      parts.push("⌘");
    }

    // 格式化按键
    let key = shortcut.key.toUpperCase();
    if (key === "ESCAPE") key = "Esc";
    if (key === "ARROWUP") key = "↑";
    if (key === "ARROWDOWN") key = "↓";
    if (key === "ARROWLEFT") key = "←";
    if (key === "ARROWRIGHT") key = "→";
    if (key === "ENTER") key = "↵";
    if (key === " ") key = "Space";

    parts.push(key);

    return parts.join(isMac ? "" : "+");
  }

  // 初始化默认快捷键
  function initDefaultShortcuts() {
    registerAll([
      // 导航快捷键
      {
        id: "nav-home",
        key: "g",
        ctrl: true,
        description: "前往首页",
        category: "navigation",
        action: () => router.push("/dashboard"),
        global: true,
      },
      {
        id: "nav-chat",
        key: "g",
        ctrl: true,
        shift: true,
        description: "前往对话",
        category: "navigation",
        action: () => router.push("/chat"),
        global: true,
      },
      {
        id: "nav-im",
        key: "i",
        ctrl: true,
        description: "前往 IM 管理",
        category: "navigation",
        action: () => router.push("/im"),
        global: true,
      },
      {
        id: "nav-settings",
        key: ",",
        ctrl: true,
        description: "前往设置",
        category: "navigation",
        action: () => router.push("/settings"),
        global: true,
      },

      // 操作快捷键
      {
        id: "action-new-chat",
        key: "n",
        ctrl: true,
        description: "新建对话",
        category: "action",
        action: () => {
          window.dispatchEvent(new CustomEvent("shortcut:new-chat"));
        },
      },
      {
        id: "action-search",
        key: "k",
        ctrl: true,
        description: "搜索",
        category: "action",
        action: () => {
          window.dispatchEvent(new CustomEvent("shortcut:search"));
        },
        global: true,
      },
      {
        id: "action-theme",
        key: "t",
        ctrl: true,
        shift: true,
        description: "切换主题",
        category: "action",
        action: () => {
          window.dispatchEvent(new CustomEvent("shortcut:toggle-theme"));
        },
        global: true,
      },

      // 聊天快捷键
      {
        id: "chat-send",
        key: "Enter",
        ctrl: true,
        description: "发送消息",
        category: "chat",
        action: () => {
          window.dispatchEvent(new CustomEvent("shortcut:send-message"));
        },
      },
      {
        id: "chat-clear",
        key: "Delete",
        ctrl: true,
        shift: true,
        description: "清空对话",
        category: "chat",
        action: () => {
          window.dispatchEvent(new CustomEvent("shortcut:clear-chat"));
        },
      },

      // 系统快捷键
      {
        id: "system-help",
        key: "/",
        ctrl: true,
        description: "显示快捷键帮助",
        category: "system",
        action: () => {
          showHelp.value = !showHelp.value;
        },
        global: true,
      },
      {
        id: "system-escape",
        key: "Escape",
        description: "关闭弹窗/取消",
        category: "system",
        action: () => {
          if (showHelp.value) {
            showHelp.value = false;
          } else {
            window.dispatchEvent(new CustomEvent("shortcut:escape"));
          }
        },
        global: true,
      },
    ]);
  }

  // 初始化
  function init() {
    initDefaultShortcuts();
    document.addEventListener("keydown", handleKeyDown);
  }

  // 清理
  function cleanup() {
    document.removeEventListener("keydown", handleKeyDown);
    shortcuts.value.clear();
  }

  return {
    // 状态
    shortcuts,
    enabled,
    showHelp,

    // 计算属性
    enabledShortcuts,
    shortcutsByCategory,

    // 方法
    init,
    cleanup,
    register,
    registerAll,
    unregister,
    setEnabled,
    setGlobalEnabled,
    openHelp,
    closeHelp,
    getShortcutText,
  };
});
