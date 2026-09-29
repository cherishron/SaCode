/** A small binary layout tree for independently sized conversation panes. */
export type SplitLayout = { pane: number } | {
  axis: 'row' | 'column';
  ratio: number;
  first: SplitLayout;
  second: SplitLayout;
};

export interface SavedWorkbenchLayout {
  layout: SplitLayout;
  taskIds: (string | null)[];
  activePane: number;
}

export function restoreWorkbenchLayout(raw: string | null): SavedWorkbenchLayout | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SavedWorkbenchLayout;
    if (!Array.isArray(value.taskIds) || value.taskIds.length < 1 || value.taskIds.length > 4
      || !value.taskIds.every((id) => id === null || typeof id === 'string')
      || !Number.isInteger(value.activePane) || value.activePane < 0 || value.activePane >= value.taskIds.length) return null;
    const visit = (node: SplitLayout, depth: number): number[] | null => {
      if (!node || typeof node !== 'object' || depth > 4) return null;
      if ('pane' in node) return Number.isInteger(node.pane) ? [node.pane] : null;
      if ((node.axis !== 'row' && node.axis !== 'column') || !Number.isFinite(node.ratio)
        || node.ratio < 0.15 || node.ratio > 0.85) return null;
      const left = visit(node.first, depth + 1);
      const right = visit(node.second, depth + 1);
      return left && right ? [...left, ...right] : null;
    };
    const indices = visit(value.layout, 0);
    if (!indices || indices.length !== value.taskIds.length
      || indices.some((index) => index < 0 || index >= indices.length)
      || new Set(indices).size !== indices.length) return null;
    return value;
  } catch { return null; }
}

export function splitPane(layout: SplitLayout, pane: number, next: number, axis: 'row' | 'column'): SplitLayout {
  if ('pane' in layout) return layout.pane === pane
    ? { axis, ratio: 0.5, first: layout, second: { pane: next } }
    : layout;
  return {
    ...layout,
    first: splitPane(layout.first, pane, next, axis),
    second: splitPane(layout.second, pane, next, axis),
  };
}

export function closePaneLayout(layout: SplitLayout, pane: number): SplitLayout {
  if ('pane' in layout) return layout;
  if ('pane' in layout.first && layout.first.pane === pane) return renumber(layout.second, pane);
  if ('pane' in layout.second && layout.second.pane === pane) return renumber(layout.first, pane);
  return renumber({
    ...layout,
    first: closeWithoutRenumber(layout.first, pane),
    second: closeWithoutRenumber(layout.second, pane),
  }, pane);
}

function closeWithoutRenumber(layout: SplitLayout, pane: number): SplitLayout {
  if ('pane' in layout) return layout;
  if ('pane' in layout.first && layout.first.pane === pane) return layout.second;
  if ('pane' in layout.second && layout.second.pane === pane) return layout.first;
  return { ...layout, first: closeWithoutRenumber(layout.first, pane), second: closeWithoutRenumber(layout.second, pane) };
}

function renumber(layout: SplitLayout, removed: number): SplitLayout {
  if ('pane' in layout) return { pane: layout.pane > removed ? layout.pane - 1 : layout.pane };
  return { ...layout, first: renumber(layout.first, removed), second: renumber(layout.second, removed) };
}

export function resizeSplit(layout: SplitLayout, path: string, ratio: number): SplitLayout {
  if ('pane' in layout) return layout;
  if (path === '') return { ...layout, ratio: Math.max(0.15, Math.min(0.85, ratio)) };
  return path[0] === 'a'
    ? { ...layout, first: resizeSplit(layout.first, path.slice(1), ratio) }
    : { ...layout, second: resizeSplit(layout.second, path.slice(1), ratio) };
}

export function layoutPanes(layout: SplitLayout): number[] {
  return 'pane' in layout ? [layout.pane] : [...layoutPanes(layout.first), ...layoutPanes(layout.second)];
}

/** Exchange two visual positions while keeping each pane's conversation state intact. */
export function swapPanePositions(layout: SplitLayout, first: number, second: number): SplitLayout {
  if (first === second) return layout;
  if ('pane' in layout) {
    return { pane: layout.pane === first ? second : layout.pane === second ? first : layout.pane };
  }
  return {
    ...layout,
    first: swapPanePositions(layout.first, first, second),
    second: swapPanePositions(layout.second, first, second),
  };
}
