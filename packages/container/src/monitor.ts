/**
 * SaClaw Container Module - 资源监控
 *
 * 容器资源使用监控和统计
 */

import { z } from "zod";
import type { Logger } from "./index";

// ============================================================================
// Types
// ============================================================================

/**
 * 资源使用快照
 */
export const ResourceSnapshotSchema = z.object({
  /** 容器 ID */
  containerId: z.string(),
  /** 时间戳 */
  timestamp: z.string(),
  /** CPU 使用率 (%) */
  cpuPercent: z.number(),
  /** 内存使用 (字节) */
  memoryUsage: z.number(),
  /** 内存限制 (字节) */
  memoryLimit: z.number(),
  /** 内存使用率 (%) */
  memoryPercent: z.number(),
  /** 网络接收 (字节) */
  networkRxBytes: z.number(),
  /** 网络发送 (字节) */
  networkTxBytes: z.number(),
  /** 网络接收速率 (字节/秒) */
  networkRxRate: z.number().optional(),
  /** 网络发送速率 (字节/秒) */
  networkTxRate: z.number().optional(),
  /** 块设备读取 (字节) */
  blockReadBytes: z.number(),
  /** 块设备写入 (字节) */
  blockWriteBytes: z.number(),
  /** 块设备读取速率 (字节/秒) */
  blockReadRate: z.number().optional(),
  /** 块设备写入速率 (字节/秒) */
  blockWriteRate: z.number().optional(),
  /** 进程数 */
  pids: z.number(),
});
export type ResourceSnapshot = z.infer<typeof ResourceSnapshotSchema>;

/**
 * 资源统计汇总
 */
export const ResourceStatsSchema = z.object({
  /** 容器 ID */
  containerId: z.string(),
  /** 监控时长 (毫秒) */
  duration: z.number(),
  /** 采样次数 */
  sampleCount: z.number(),
  /** CPU 使用率 - 平均 */
  cpuPercentAvg: z.number(),
  /** CPU 使用率 - 最大 */
  cpuPercentMax: z.number(),
  /** 内存使用 - 平均 (字节) */
  memoryUsageAvg: z.number(),
  /** 内存使用 - 最大 (字节) */
  memoryUsageMax: z.number(),
  /** 内存使用率 - 平均 (%) */
  memoryPercentAvg: z.number(),
  /** 内存使用率 - 最大 (%) */
  memoryPercentMax: z.number(),
  /** 网络总接收 (字节) */
  networkRxTotal: z.number(),
  /** 网络总发送 (字节) */
  networkTxTotal: z.number(),
  /** 网络接收峰值速率 (字节/秒) */
  networkRxRateMax: z.number(),
  /** 网络发送峰值速率 (字节/秒) */
  networkTxRateMax: z.number(),
  /** 块设备总读取 (字节) */
  blockReadTotal: z.number(),
  /** 块设备总写入 (字节) */
  blockWriteTotal: z.number(),
  /** 块设备读取峰值速率 (字节/秒) */
  blockReadRateMax: z.number(),
  /** 块设备写入峰值速率 (字节/秒) */
  blockWriteRateMax: z.number(),
  /** 进程数 - 平均 */
  pidsAvg: z.number(),
  /** 进程数 - 最大 */
  pidsMax: z.number(),
});
export type ResourceStats = z.infer<typeof ResourceStatsSchema>;

/**
 * 监控配置
 */
export const MonitorConfigSchema = z.object({
  /** 采样间隔 (毫秒) */
  sampleInterval: z.number().default(1000),
  /** 最大历史记录数 */
  maxHistorySize: z.number().default(3600), // 1 小时 @ 1s 间隔
  /** 是否启用网络监控 */
  enableNetworkMonitor: z.boolean().default(true),
  /** 是否启用块设备监控 */
  enableBlockMonitor: z.boolean().default(true),
});
export type MonitorConfig = z.infer<typeof MonitorConfigSchema>;

// ============================================================================
// ResourceMonitor Class
// ============================================================================

/**
 * 资源监控器
 */
export class ResourceMonitor {
  private config: MonitorConfig;
  private logger: Logger;
  private history: Map<string, ResourceSnapshot[]> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private lastSnapshot: Map<string, ResourceSnapshot> = new Map();

  constructor(config: Partial<MonitorConfig> = {}, logger?: Logger) {
    this.config = MonitorConfigSchema.parse(config);
    this.logger = logger ?? console;
  }

  /**
   * 开始监控容器
   */
  async startMonitoring(
    containerId: string,
    getStatsFn: () => Promise<Partial<ResourceSnapshot>>
  ): Promise<void> {
    if (this.intervals.has(containerId)) {
      this.logger.warn(`Already monitoring container: ${containerId}`);
      return;
    }

    this.logger.info(`Starting monitoring for container: ${containerId}`);

    // 初始化历史记录
    if (!this.history.has(containerId)) {
      this.history.set(containerId, []);
    }

    // 立即采集一次
    await this.collect(containerId, getStatsFn);

    // 定时采集
    const interval = setInterval(async () => {
      await this.collect(containerId, getStatsFn);
    }, this.config.sampleInterval);

    this.intervals.set(containerId, interval);
  }

  /**
   * 停止监控容器
   */
  stopMonitoring(containerId: string): void {
    const interval = this.intervals.get(containerId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(containerId);
      this.logger.info(`Stopped monitoring container: ${containerId}`);
    }
  }

  /**
   * 获取最新快照
   */
  getLatestSnapshot(containerId: string): ResourceSnapshot | undefined {
    return this.lastSnapshot.get(containerId);
  }

  /**
   * 获取历史快照
   */
  getHistory(containerId: string, limit?: number): ResourceSnapshot[] {
    const history = this.history.get(containerId) ?? [];
    if (limit) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * 计算统计汇总
   */
  getStats(containerId: string, duration?: number): ResourceStats | null {
    const history = this.history.get(containerId);
    if (!history || history.length === 0) {
      return null;
    }

    // 过滤时间范围
    let samples = history;
    if (duration) {
      const cutoff = Date.now() - duration;
      samples = history.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
    }

    if (samples.length === 0) {
      return null;
    }

    const cpuPercentAvg = this.average(samples.map((s) => s.cpuPercent));
    const cpuPercentMax = Math.max(...samples.map((s) => s.cpuPercent));

    const memoryUsageAvg = this.average(samples.map((s) => s.memoryUsage));
    const memoryUsageMax = Math.max(...samples.map((s) => s.memoryUsage));
    const memoryPercentAvg = this.average(samples.map((s) => s.memoryPercent));
    const memoryPercentMax = Math.max(...samples.map((s) => s.memoryPercent));

    const networkRxRates = samples
      .map((s) => s.networkRxRate)
      .filter((r): r is number => r !== undefined);
    const networkTxRates = samples
      .map((s) => s.networkTxRate)
      .filter((r): r is number => r !== undefined);

    const blockReadRates = samples
      .map((s) => s.blockReadRate)
      .filter((r): r is number => r !== undefined);
    const blockWriteRates = samples
      .map((s) => s.blockWriteRate)
      .filter((r): r is number => r !== undefined);

    const timeStart = new Date(samples[0]!.timestamp).getTime();
    const timeEnd = new Date(samples[samples.length - 1]!.timestamp).getTime();

    return {
      containerId,
      duration: timeEnd - timeStart,
      sampleCount: samples.length,
      cpuPercentAvg,
      cpuPercentMax,
      memoryUsageAvg,
      memoryUsageMax,
      memoryPercentAvg,
      memoryPercentMax,
      networkRxTotal: samples[samples.length - 1]?.networkRxBytes ?? 0,
      networkTxTotal: samples[samples.length - 1]?.networkTxBytes ?? 0,
      networkRxRateMax: networkRxRates.length > 0 ? Math.max(...networkRxRates) : 0,
      networkTxRateMax: networkTxRates.length > 0 ? Math.max(...networkTxRates) : 0,
      blockReadTotal: samples[samples.length - 1]?.blockReadBytes ?? 0,
      blockWriteTotal: samples[samples.length - 1]?.blockWriteBytes ?? 0,
      blockReadRateMax: blockReadRates.length > 0 ? Math.max(...blockReadRates) : 0,
      blockWriteRateMax: blockWriteRates.length > 0 ? Math.max(...blockWriteRates) : 0,
      pidsAvg: this.average(samples.map((s) => s.pids)),
      pidsMax: Math.max(...samples.map((s) => s.pids)),
    };
  }

  /**
   * 清除历史记录
   */
  clearHistory(containerId?: string): void {
    if (containerId) {
      this.history.delete(containerId);
    } else {
      this.history.clear();
    }
  }

  /**
   * 停止所有监控
   */
  stopAll(): void {
    for (const [containerId, interval] of this.intervals) {
      clearInterval(interval);
      this.logger.info(`Stopped monitoring container: ${containerId}`);
    }
    this.intervals.clear();
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async collect(
    containerId: string,
    getStatsFn: () => Promise<Partial<ResourceSnapshot>>
  ): Promise<void> {
    try {
      const partial = await getStatsFn();
      const now = new Date().toISOString();

      const snapshot: ResourceSnapshot = {
        containerId,
        timestamp: now,
        cpuPercent: partial.cpuPercent ?? 0,
        memoryUsage: partial.memoryUsage ?? 0,
        memoryLimit: partial.memoryLimit ?? 0,
        memoryPercent: partial.memoryPercent ?? 0,
        networkRxBytes: partial.networkRxBytes ?? 0,
        networkTxBytes: partial.networkTxBytes ?? 0,
        networkRxRate: partial.networkRxRate,
        networkTxRate: partial.networkTxRate,
        blockReadBytes: partial.blockReadBytes ?? 0,
        blockWriteBytes: partial.blockWriteBytes ?? 0,
        blockReadRate: partial.blockReadRate,
        blockWriteRate: partial.blockWriteRate,
        pids: partial.pids ?? 0,
      };

      // 计算速率
      const last = this.lastSnapshot.get(containerId);
      if (last) {
        const timeDiff =
          (new Date(snapshot.timestamp).getTime() -
            new Date(last.timestamp).getTime()) /
          1000;

        if (timeDiff > 0) {
          if (snapshot.networkRxBytes !== undefined && last.networkRxBytes !== undefined) {
            snapshot.networkRxRate =
              (snapshot.networkRxBytes - last.networkRxBytes) / timeDiff;
          }
          if (snapshot.networkTxBytes !== undefined && last.networkTxBytes !== undefined) {
            snapshot.networkTxRate =
              (snapshot.networkTxBytes - last.networkTxBytes) / timeDiff;
          }
          if (snapshot.blockReadBytes !== undefined && last.blockReadBytes !== undefined) {
            snapshot.blockReadRate =
              (snapshot.blockReadBytes - last.blockReadBytes) / timeDiff;
          }
          if (snapshot.blockWriteBytes !== undefined && last.blockWriteBytes !== undefined) {
            snapshot.blockWriteRate =
              (snapshot.blockWriteBytes - last.blockWriteBytes) / timeDiff;
          }
        }
      }

      // 保存
      this.lastSnapshot.set(containerId, snapshot);

      const history = this.history.get(containerId);
      if (history) {
        history.push(snapshot);

        // 限制历史记录大小
        if (history.length > this.config.maxHistorySize) {
          history.shift();
        }
      }
    } catch (error) {
      this.logger.error(`Failed to collect stats for ${containerId}:`, error);
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

// ============================================================================
// Docker Stats Parser
// ============================================================================

/**
 * 解析 docker stats 输出
 */
export function parseDockerStats(output: string): Partial<ResourceSnapshot> {
  try {
    // Docker stats --no-stream --format "{{json .}}" 输出
    const data = JSON.parse(output);

    return {
      cpuPercent: parseFloat(data.CPUPerc?.replace("%", "") ?? "0"),
      memoryUsage: parseMemoryValue(data.MemUsage?.split("/")[0] ?? "0"),
      memoryLimit: parseMemoryValue(data.MemUsage?.split("/")[1] ?? "0"),
      memoryPercent: parseFloat(data.MemPerc?.replace("%", "") ?? "0"),
      networkRxBytes: parseMemoryValue(data.NetIO?.split("/")[0] ?? "0"),
      networkTxBytes: parseMemoryValue(data.NetIO?.split("/")[1] ?? "0"),
      blockReadBytes: parseMemoryValue(data.BlockIO?.split("/")[0] ?? "0"),
      blockWriteBytes: parseMemoryValue(data.BlockIO?.split("/")[1] ?? "0"),
      pids: parseInt(data.PIDs ?? "0", 10),
    };
  } catch {
    return {};
  }
}

/**
 * 解析内存值 (如 512MiB -> 536870912)
 */
function parseMemoryValue(value: string): number {
  const match = value.trim().match(/^([\d.]+)\s*([KMGT]?i?B?)?$/i);
  if (!match) return 0;

  const num = parseFloat(match[1] ?? "0");
  const unit = (match[2] ?? "B").toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    KIB: 1024,
    MB: 1000 * 1000,
    MIB: 1024 * 1024,
    GB: 1000 * 1000 * 1000,
    GIB: 1024 * 1024 * 1024,
    TB: 1000 * 1000 * 1000 * 1000,
    TIB: 1024 * 1024 * 1024 * 1024,
  };

  return num * (multipliers[unit] ?? 1);
}

// ============================================================================
// All exports are defined inline with `export const/class/function` above
// ============================================================================
