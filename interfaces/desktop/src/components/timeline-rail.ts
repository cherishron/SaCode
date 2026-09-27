/** TimelineRail — 会话边缘历史导航
 * 右缘刻度列（每轮对话一个刻度，点击跳转到对应历史）+「回到最新」悬浮按钮。
 * 注意：桌面端是全量重建渲染（render → replaceChildren），本组件随每次
 * rerender 重建；刻度点击、按钮显隐、高亮同步均为局部 DOM 操作，
 * 不触发 rerender，避免滚动位置被重建打断。
 */
import { el } from '../dom.ts';
import type { TimelineItem } from '../app/service.ts';

export interface TimelineAnchor {
  /** 对应消息节点上的 data-msg-index */
  msgIndex: number;
  /** tooltip 摘要文本 */
  label: string;
}

/** 锚点摘要最大长度 */
export const ANCHOR_LABEL_MAX = 48;
/** 刻度数量上限（超出时均匀抽样，保留首尾） */
export const MAX_ANCHORS = 80;
/** 距底部超过该距离（px）时显示「回到最新」按钮 */
export const JUMP_VISIBLE_THRESHOLD = 96;
/** 距底部小于该距离（px）视为贴底（供滚动跟随判定） */
export const AT_BOTTOM_THRESHOLD = 24;
/** 跳转定位时消息顶部预留的呼吸间距（px） */
const SCROLL_OFFSET = 12;

/**
 * 从（已按会话过滤的）timeline 提取导航锚点。
 * 粒度：每轮对话一个锚点（user 消息）；
 * 无 user 时退化为 assistant 消息；再无则退化为全部消息。
 */
export function collectTimelineAnchors(items: TimelineItem[]): TimelineAnchor[] {
  const byKind = (kind: TimelineItem['kind']): TimelineAnchor[] =>
    items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.kind === kind)
      .map(({ item, index }) => ({ msgIndex: index, label: anchorLabel(item.text) }));

  const userAnchors = byKind('user');
  if (userAnchors.length > 0) return sampleAnchors(userAnchors);
  const assistantAnchors = byKind('assistant');
  if (assistantAnchors.length > 0) return sampleAnchors(assistantAnchors);
  return sampleAnchors(
    items.map((item, index) => ({ msgIndex: index, label: anchorLabel(item.text) })),
  );
}

function anchorLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '(空消息)';
  return flat.length > ANCHOR_LABEL_MAX ? `${flat.slice(0, ANCHOR_LABEL_MAX)}…` : flat;
}

function sampleAnchors(anchors: TimelineAnchor[]): TimelineAnchor[] {
  if (anchors.length <= MAX_ANCHORS) return anchors;
  const step = (anchors.length - 1) / (MAX_ANCHORS - 1);
  const sampled: TimelineAnchor[] = [];
  for (let i = 0; i < MAX_ANCHORS; i++) {
    sampled.push(anchors[Math.round(i * step)]);
  }
  return sampled;
}

export interface TimelineNavigation {
  /** 右缘刻度列（挂到 .timeline-region） */
  rail: HTMLElement;
  /** 「回到最新」悬浮按钮（挂到 .timeline-region） */
  jumpButton: HTMLElement;
  /** 立即重算按钮显隐与刻度高亮（render 恢复 scrollTop 后主动调用） */
  refresh: () => void;
}

/**
 * 为一个 timeline 滚动容器构建边缘导航。
 * @param timelineEl 滚动容器（须为 position:relative 且消息节点带 data-msg-index）
 */
export function buildTimelineNavigation(
  timelineEl: HTMLElement,
  anchors: TimelineAnchor[],
): TimelineNavigation {
  const scrollToMessage = (msgIndex: number) => {
    const target = timelineEl.querySelector<HTMLElement>(`[data-msg-index="${msgIndex}"]`);
    if (!target) return;
    timelineEl.scrollTo({ top: Math.max(0, target.offsetTop - SCROLL_OFFSET), behavior: 'smooth' });
  };

  const ticks = anchors.map((anchor) =>
    el('button', {
      className: 'timeline-rail-tick',
      dataset: { msgIndex: String(anchor.msgIndex) },
      title: anchor.label,
      'aria-label': `跳转到: ${anchor.label}`,
      onclick: () => scrollToMessage(anchor.msgIndex),
    }),
  );

  const rail = el('nav', { className: 'timeline-rail', 'aria-label': '会话历史导航' }, ticks);

  const jumpButton = el('button', {
    className: 'timeline-jump-latest',
    title: '滚动到最新消息',
    'aria-label': '回到最新消息',
    onclick: () => {
      timelineEl.scrollTo({ top: timelineEl.scrollHeight, behavior: 'smooth' });
    },
  }, ['↓ 回到最新']);

  /** 视口中线所在的锚点序号（-1 表示在首个锚点之前） */
  const activeAnchorIndex = (): number => {
    const probe = timelineEl.scrollTop + timelineEl.clientHeight / 2;
    let active = -1;
    for (let i = 0; i < anchors.length; i++) {
      const target = timelineEl.querySelector<HTMLElement>(`[data-msg-index="${anchors[i].msgIndex}"]`);
      if (!target) continue;
      if (target.offsetTop <= probe) active = i;
      else break;
    }
    return active;
  };

  const refresh = () => {
    const distanceFromBottom =
      timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight;
    jumpButton.classList.toggle('visible', distanceFromBottom > JUMP_VISIBLE_THRESHOLD);
    const active = activeAnchorIndex();
    ticks.forEach((tick, index) => tick.classList.toggle('active', index === active));
  };

  // rAF 节流：scroll 高频触发时合并重算
  let frame = 0;
  timelineEl.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  });

  refresh();
  return { rail, jumpButton, refresh };
}
