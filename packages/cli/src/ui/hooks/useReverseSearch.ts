/**
 * useReverseSearch Hook - 反向搜索 (Ctrl+R)
 *
 * 实现类似 Bash 的反向历史搜索功能：
 * - Ctrl+R: 进入搜索模式
 * - 输入关键词过滤历史
 * - Ctrl+R 循环匹配项
 * - Enter 选择
 * - Esc/Ctrl+G 取消
 */

import { useState, useCallback, useMemo } from "react";

// ============================================================================
// 类型定义
// ============================================================================

export interface ReverseSearchResult {
  /** 匹配的历史项 */
  item: string;
  /** 匹配位置 */
  index: number;
}

export interface UseReverseSearchOptions {
  /** 历史记录 */
  history: string[];
  /** 最大显示结果数 */
  maxResults?: number;
  /** 选择回调 */
  onSelect?: (item: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

export interface UseReverseSearchResult {
  /** 是否处于搜索模式 */
  isActive: boolean;
  /** 搜索查询 */
  query: string;
  /** 匹配结果 */
  results: ReverseSearchResult[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 当前选中项 */
  selected: ReverseSearchResult | null;
  /** 进入搜索模式 */
  start: () => void;
  /** 退出搜索模式 */
  stop: () => void;
  /** 更新查询 */
  updateQuery: (query: string) => void;
  /** 选择下一个 */
  next: () => void;
  /** 选择上一个 */
  prev: () => void;
  /** 确认选择 */
  confirm: () => void;
  /** 取消 */
  cancel: () => void;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useReverseSearch(
  options: UseReverseSearchOptions
): UseReverseSearchResult {
  const { history, maxResults = 10, onSelect, onCancel } = options;

  const [isActive, setIsActive] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 过滤历史记录
  const results = useMemo((): ReverseSearchResult[] => {
    if (!isActive || !query) return [];

    const queryLower = query.toLowerCase();
    const matches: ReverseSearchResult[] = [];

    // 从最新的历史开始搜索
    for (let i = history.length - 1; i >= 0 && matches.length < maxResults; i--) {
      const item = history[i];
      if (item?.toLowerCase().includes(queryLower)) {
        matches.push({ item, index: i });
      }
    }

    return matches;
  }, [isActive, query, history, maxResults]);

  // 当前选中项
  const selected = useMemo(() => {
    if (results.length === 0) return null;
    return results[selectedIndex] ?? null;
  }, [results, selectedIndex]);

  // 进入搜索模式
  const start = useCallback(() => {
    setIsActive(true);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  // 退出搜索模式
  const stop = useCallback(() => {
    setIsActive(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  // 更新查询
  const updateQuery = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setSelectedIndex(0);
  }, []);

  // 选择下一个 (更早的历史)
  const next = useCallback(() => {
    if (results.length === 0) return;
    setSelectedIndex((prev) => (prev + 1) % results.length);
  }, [results.length]);

  // 选择上一个 (更近的历史)
  const prev = useCallback(() => {
    if (results.length === 0) return;
    setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
  }, [results.length]);

  // 确认选择
  const confirm = useCallback(() => {
    if (selected) {
      onSelect?.(selected.item);
    }
    stop();
  }, [selected, onSelect, stop]);

  // 取消
  const cancel = useCallback(() => {
    onCancel?.();
    stop();
  }, [onCancel, stop]);

  return {
    isActive,
    query,
    results,
    selectedIndex,
    selected,
    start,
    stop,
    updateQuery,
    next,
    prev,
    confirm,
    cancel,
  };
}

export default useReverseSearch;
