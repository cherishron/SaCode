import { el } from '../dom.ts';

export function clampWorkspaceSplit(ratio: number): number {
  return Math.max(0.25, Math.min(0.68, ratio));
}

/** Shared left-list/right-detail split for knowledge and automation. */
export function buildResizableWorkspace(
  ratio: number,
  onResize: (ratio: number) => void,
  left: Node,
  right: Node,
): HTMLElement {
  const split = el('div', {
    className: 'workspace-split',
    style: `--split-left:${clampWorkspaceSplit(ratio) * 100}%`,
  });
  const update = (next: number) => {
    const bounded = clampWorkspaceSplit(next);
    ratio = bounded;
    split.style.setProperty('--split-left', `${bounded * 100}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(bounded * 100)));
    onResize(bounded);
  };
  const divider = el('div', {
    className: 'workspace-split-divider', role: 'separator', tabIndex: 0,
    title: '拖动调整列表宽度；方向键微调',
    onpointerdown: (event: PointerEvent) => {
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      divider.classList.add('dragging');
    },
    onpointermove: (event: PointerEvent) => {
      if (!divider.hasPointerCapture(event.pointerId)) return;
      const bounds = split.getBoundingClientRect();
      if (bounds.width) update((event.clientX - bounds.left) / bounds.width);
    },
    onpointerup: (event: PointerEvent) => {
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      divider.classList.remove('dragging');
    },
    onpointercancel: () => divider.classList.remove('dragging'),
    onlostpointercapture: () => divider.classList.remove('dragging'),
    onkeydown: (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      update(ratio + (event.key === 'ArrowRight' ? 0.03 : -0.03));
    },
  });
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-valuemin', '25');
  divider.setAttribute('aria-valuemax', '68');
  divider.setAttribute('aria-valuenow', String(Math.round(clampWorkspaceSplit(ratio) * 100)));
  split.append(
    el('div', { className: 'workspace-split-list' }, [left]),
    divider,
    el('div', { className: 'workspace-split-detail' }, [right]),
  );
  return split;
}
