/** 会话标题栏 — 会话标题 + 右侧工具按钮 + 更多菜单 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';

export type ConversationMode = 'plan' | 'build' | 'yolo';

export interface MoreMenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  separator?: boolean;
  onclick?: () => void;
}

export function buildConversationHeader(
  app: DesktopApp,
  shell: { contextOpen: boolean },
  _currentMode: ConversationMode,
  _onModeChange: (mode: ConversationMode) => void,
  actions: {
    onToggleContext: () => void;
    onCloseSession: () => void;
    onMore: () => void;
  },
) {
  const title = app.currentConversationId
    ? app.desktopConversations.find((item) => item.id === app.currentConversationId)?.title.slice(0, 40)
      || app.currentConversationId.slice(0, 8)
    : '新会话';

  return el('div', { className: 'conversation-header' }, [
    el('div', { className: 'conversation-header-left' }, [
      el('span', { className: 'conversation-title' }, [String(title)]),
    ]),

    el('div', { className: 'conversation-header-right' }, [
      el('button', {
        className: `header-btn ${shell.contextOpen ? 'active' : ''}`,
        title: '右侧工具栏',
        onclick: actions.onToggleContext,
      }, ['▦']),
      el('button', {
        className: 'header-btn',
        title: '更多',
        onclick: actions.onMore,
      }, ['⋯']),
      el('button', {
        className: 'header-btn',
        title: '关闭会话',
        onclick: actions.onCloseSession,
      }, ['×']),
    ]),
  ]);
}

export function buildMoreMenu(
  items: MoreMenuItem[],
  position: { x: number; y: number },
  onClose: () => void,
) {
  const overlay = el('div', {
    className: 'more-menu-overlay',
    onclick: onClose,
  });

  const menu = el('div', {
    className: 'more-menu',
    style: `left:${position.x}px;top:${position.y}px`,
  }, items.map((item) => {
    if (item.separator) {
      return el('div', { className: 'more-menu-separator' });
    }
    return el('div', {
      className: `more-menu-item ${item.danger ? 'danger' : ''}`,
      onclick: () => {
        item.onclick?.();
        onClose();
      },
    }, [
      item.icon ? el('span', {}, [item.icon]) : '',
      el('span', {}, [item.label || '']),
    ].filter(Boolean) as Node[]);
  }));

  // 把 overlay 和 menu 放在一起返回
  const container = document.createDocumentFragment();
  container.append(overlay, menu);
  return container;
}

export function defaultMoreMenuItems(): MoreMenuItem[] {
  return [
    { label: '向右分屏', onclick: () => {} },
    { label: '打开右侧工具栏', onclick: () => {} },
    { label: '关闭右侧工具栏', onclick: () => {} },
    { separator: true },
    { label: '关闭会话', onclick: () => {} },
    { label: '删除会话', danger: true, onclick: () => {} },
  ];
}

const MODE_ORDER: ConversationMode[] = ['plan', 'build', 'yolo'];

const MODE_META: Record<ConversationMode, { label: string; title: string }> = {
  plan: { label: '规划', title: '规划模式：只分析不修改代码（点击切换为构建）' },
  build: { label: '构建', title: '构建模式：规划+执行，关键步骤需确认（点击切换为 YOLO）' },
  yolo: { label: 'YOLO', title: 'YOLO 模式：全自动执行，无需确认（点击切换为规划）' },
};

export function nextMode(current: ConversationMode): ConversationMode {
  const idx = MODE_ORDER.indexOf(current);
  return MODE_ORDER[(idx + 1) % MODE_ORDER.length];
}

export function buildModeButton(
  current: ConversationMode,
  onChange: (mode: ConversationMode) => void,
): Node {
  const meta = MODE_META[current];
  return el('button', {
    className: `mode-cycle-btn mode-${current}`,
    title: meta.title,
    onclick: () => onChange(nextMode(current)),
  }, [meta.label]);
}

export function modeLabel(mode: ConversationMode): string {
  return mode === 'plan' ? '规划' : mode === 'build' ? '构建' : 'YOLO';
}
