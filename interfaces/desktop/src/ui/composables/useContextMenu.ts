/**
 * 全局右键菜单 composable — 按页面场景配置不同菜单项。
 *
 * 用法：
 * 1. App.vue 调用 useContextMenu() 获取 register/trigger/close。
 * 2. 各页面/组件 onMounted 调用 register('page-id', items) 注册自己的菜单项。
 * 3. 模板根元素 @contextmenu="trigger('page-id', $event)" 触发。
 * 4. 未注册的页面右键 → 阻止默认菜单（不弹任何自定义菜单也不弹浏览器菜单）。
 */

import { ref, type Ref } from 'vue';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 菜单项之间的分隔线 */
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface RegisteredPage {
  items: ContextMenuItem[] | ((ev: MouseEvent) => ContextMenuItem[]);
}

const registry = new Map<string, RegisteredPage>();
const activeMenu: Ref<ContextMenuState | null> = ref(null);

/** 注册某页面的右键菜单项。items 可以是静态数组或根据点击位置动态生成的函数。 */
function register(pageId: string, items: ContextMenuItem[] | ((ev: MouseEvent) => ContextMenuItem[]) ) {
  registry.set(pageId, { items });
}

/** 注销页面菜单 */
function unregister(pageId: string) {
  registry.delete(pageId);
}

/** 触发右键菜单。必须在 @contextmenu 事件中调用，ev 已被 preventDefault。 */
function trigger(pageId: string, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();

  const page = registry.get(pageId);
  if (!page) {
    // 未注册的页面：仅阻止浏览器默认菜单，不弹自定义菜单
    activeMenu.value = null;
    return;
  }

  const items = typeof page.items === 'function' ? page.items(ev) : page.items;
  if (items.length === 0) {
    activeMenu.value = null;
    return;
  }

  // 钳制在视口内
  const menuWidth = 200;
  const menuHeight = items.length * 32 + 8;
  const x = Math.min(ev.clientX, window.innerWidth - menuWidth - 4);
  const y = Math.min(ev.clientY, window.innerHeight - menuHeight - 4);

  activeMenu.value = { x, y, items };
}

/** 关闭当前菜单（点击菜单项后或外部 pointerdown 自动调用） */
function close() {
  activeMenu.value = null;
}

/** 全局屏蔽浏览器默认右键菜单 — 在 App.vue onMounted 里挂载 */
function disableBrowserContextMenu() {
  const handler = (e: MouseEvent) => {
    // 如果有自定义菜单在显示，或者有文本被选中，阻止浏览器默认菜单
    if (activeMenu.value || window.getSelection()?.toString()) {
      e.preventDefault();
    }
    // 如果没有自定义菜单且没有选中文本，也阻止默认菜单（桌面应用不需要浏览器右键菜单）
    e.preventDefault();
  };
  document.addEventListener('contextmenu', handler, true);
  return () => document.removeEventListener('contextmenu', handler, true);
}

export function useContextMenu() {
  return {
    activeMenu,
    register,
    unregister,
    trigger,
    close,
    disableBrowserContextMenu,
  };
}

// ── 文本选择与复制 ──────────────────────────────────────────

/** 复制选中文本到剪贴板 */
export async function copySelection(): Promise<boolean> {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/** 检查当前是否有选中文本 */
export function hasSelection(): boolean {
  return !!window.getSelection()?.toString().trim();
}
