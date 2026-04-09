/**
 * useHistory Hook - 历史记录持久化
 *
 * 提供历史记录的持久化存储和访问：
 * - 自动保存到文件
 * - 限制最大条目数
 * - 支持不同类型的历史（输入、命令等）
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// 类型定义
// ============================================================================

export interface HistoryItem {
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 类型 */
  type?: "input" | "command" | "search";
}

export interface UseHistoryOptions {
  /** 历史文件路径 */
  filePath?: string;
  /** 最大历史条目数 */
  maxSize?: number;
  /** 历史类型 */
  type?: "input" | "command" | "search";
  /** 是否自动保存 */
  autoSave?: boolean;
  /** 是否自动加载 */
  autoLoad?: boolean;
}

export interface UseHistoryResult {
  /** 历史记录 */
  history: string[];
  /** 历史条目（含元数据） */
  items: HistoryItem[];
  /** 添加历史 */
  add: (content: string) => void;
  /** 清除历史 */
  clear: () => void;
  /** 保存到文件 */
  save: () => void;
  /** 从文件加载 */
  load: () => void;
  /** 获取上一条 */
  getPrevious: (currentIndex: number) => string | null;
  /** 获取下一条 */
  getNext: (currentIndex: number) => string | null;
  /** 搜索历史 */
  search: (query: string) => string[];
}

// ============================================================================
// 默认配置
// ============================================================================

function getDefaultHistoryPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, ".sacode", "history.json");
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useHistory(options: UseHistoryOptions = {}): UseHistoryResult {
  const {
    filePath = getDefaultHistoryPath(),
    maxSize = 1000,
    type = "input",
    autoSave = true,
    autoLoad = true,
  } = options;

  const [items, setItems] = useState<HistoryItem[]>([]);

  // 历史记录（仅内容）- memoize to keep stable reference
  const history = useMemo(() => items.map((item) => item.content), [items]);

  // 加载历史
  const load = useCallback(() => {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content) as HistoryItem[];
        setItems(data.slice(-maxSize));
      }
    } catch (error) {
      // 加载失败，使用空历史
      setItems([]);
    }
  }, [filePath, maxSize]);

  // 保存历史
  const save = useCallback(() => {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf-8");
    } catch (error) {
      // 保存失败，忽略
    }
  }, [filePath, items]);

  // 添加历史
  const add = useCallback(
    (content: string) => {
      if (!content.trim()) return;

      // 去重：移除相同内容的旧条目
      setItems((prev) => {
        const filtered = prev.filter((item) => item.content !== content);
        const newItem: HistoryItem = {
          content,
          timestamp: Date.now(),
          type,
        };
        const updated = [...filtered, newItem];

        // 限制最大条目数
        if (updated.length > maxSize) {
          return updated.slice(-maxSize);
        }

        return updated;
      });
    },
    [type, maxSize]
  );

  // 清除历史
  const clear = useCallback(() => {
    setItems([]);
  }, []);

  // 获取上一条
  const getPrevious = useCallback(
    (currentIndex: number): string | null => {
      if (currentIndex <= 0 || history.length === 0) return null;
      return history[currentIndex - 1] ?? null;
    },
    [history]
  );

  // 获取下一条
  const getNext = useCallback(
    (currentIndex: number): string | null => {
      if (currentIndex >= history.length - 1) return null;
      return history[currentIndex + 1] ?? null;
    },
    [history]
  );

  // 搜索历史
  const search = useCallback(
    (query: string): string[] => {
      if (!query) return history;

      const queryLower = query.toLowerCase();
      return history.filter((item) =>
        item.toLowerCase().includes(queryLower)
      );
    },
    [history]
  );

  // 自动加载
  useEffect(() => {
    if (autoLoad) {
      load();
    }
  }, [autoLoad, load]);

  // 自动保存
  useEffect(() => {
    if (autoSave && items.length > 0) {
      save();
    }
  }, [autoSave, items, save]);

  return {
    history,
    items,
    add,
    clear,
    save,
    load,
    getPrevious,
    getNext,
    search,
  };
}

export default useHistory;
