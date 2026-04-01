/**
 * SaClaw Container Module - 沙箱配置
 *
 * 提供容器安全隔离和资源限制配置
 */

import { z } from "zod";

// ============================================================================
// Sandbox Security Configuration
// ============================================================================

/**
 * 安全能力配置
 */
export const SecurityOptionsSchema = z.object({
  /** 禁止特权模式 */
  noNewPrivileges: z.boolean().default(true),
  /** 只读根文件系统 */
  readOnlyRootFilesystem: z.boolean().default(true),
  /** 允许的能力列表 */
  capabilities: z.array(z.string()).optional(),
  /** 禁止的能力列表 */
  dropCapabilities: z.array(z.string()).default(["ALL"]),
  /** Seccomp 配置文件 */
  seccompProfile: z.string().optional(),
  /** AppArmor 配置文件 */
  apparmorProfile: z.string().optional(),
  /** 用户命名空间 */
  userNsMode: z.enum(["host", "private"]).optional(),
  /** 以非 root 用户运行 */
  runAsNonRoot: z.boolean().default(true),
  /** 运行用户 UID */
  runAsUser: z.number().optional(),
  /** 运行组 GID */
  runAsGroup: z.number().optional(),
});
export type SecurityOptions = z.infer<typeof SecurityOptionsSchema>;

/**
 * 资源限制配置
 */
export const ResourceLimitsSchema = z.object({
  /** 内存限制 (如 512m, 1g) */
  memory: z.string().default("512m"),
  /** 内存保留 (软限制) */
  memoryReservation: z.string().optional(),
  /** 内存交换限制 */
  memorySwap: z.string().optional(),
  /** CPU 配额 (如 1.0 = 1 核) */
  cpuQuota: z.number().min(0.1).max(16).default(1.0),
  /** CPU 份额 (相对权重) */
  cpuShares: z.number().min(2).max(262144).optional(),
  /** CPU 核心 (指定核心) */
  cpusetCpus: z.string().optional(),
  /** 进程数限制 (PIDs) */
  pidsLimit: z.number().min(1).max(65535).default(256),
  /** 文件描述符限制 */
  ulimitNofile: z.number().optional(),
  /** IO 权重 */
  ioWeight: z.number().min(10).max(1000).optional(),
  /** IO 读速率限制 (字节/秒) */
  ioReadBps: z.number().optional(),
  /** IO 写速率限制 (字节/秒) */
  ioWriteBps: z.number().optional(),
});
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;

/**
 * 网络隔离配置
 */
export const NetworkIsolationSchema = z.object({
  /** 网络模式: none (完全隔离), bridge (桥接), host (主机网络) */
  networkMode: z.enum(["none", "bridge", "host"]).default("none"),
  /** 自定义网络名称 */
  networkName: z.string().optional(),
  /** DNS 服务器 */
  dns: z.array(z.string()).optional(),
  /** DNS 搜索域 */
  dnsSearch: z.array(z.string()).optional(),
  /** 禁用 DNS */
  dnsOptions: z.array(z.string()).optional(),
  /** 允许的外部主机 */
  extraHosts: z.array(z.string()).optional(),
  /** 端口映射 (仅 bridge 模式) */
  portMappings: z
    .array(
      z.object({
        containerPort: z.number(),
        hostPort: z.number().optional(),
        protocol: z.enum(["tcp", "udp"]).default("tcp"),
      })
    )
    .optional(),
  /** 允许的 IP 地址范围 */
  ipRanges: z.array(z.string()).optional(),
});
export type NetworkIsolation = z.infer<typeof NetworkIsolationSchema>;

/**
 * 文件系统隔离配置
 */
export const FilesystemIsolationSchema = z.object({
  /** 临时文件系统 (tmpfs) 挂载 */
  tmpfs: z
    .array(
      z.object({
        path: z.string(),
        size: z.string().optional(), // 如 64m
        mode: z.string().optional(), // 如 1777
      })
    )
    .optional(),
  /** 只读挂载点 */
  readOnlyPaths: z.array(z.string()).optional(),
  /** 隐藏路径 (空挂载) */
  maskedPaths: z.array(z.string()).optional(),
  /** 卷挂载 */
  volumes: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        readOnly: z.boolean().default(false),
        type: z.enum(["bind", "volume", "tmpfs"]).default("bind"),
      })
    )
    .optional(),
  /** 工作目录大小限制 */
  workspaceSize: z.string().optional(),
});
export type FilesystemIsolation = z.infer<typeof FilesystemIsolationSchema>;

// ============================================================================
// Sandbox Profiles - 预设配置
// ============================================================================

/**
 * 沙箱级别
 */
export type SandboxLevel = "strict" | "moderate" | "permissive" | "custom";

/**
 * 完整的沙箱配置
 */
export const SandboxConfigSchema = z.object({
  /** 沙箱级别 */
  level: z.enum(["strict", "moderate", "permissive", "custom"]).default("moderate"),
  /** 安全配置 */
  security: SecurityOptionsSchema,
  /** 资源限制 */
  resources: ResourceLimitsSchema,
  /** 网络隔离 */
  network: NetworkIsolationSchema,
  /** 文件系统隔离 */
  filesystem: FilesystemIsolationSchema.optional(),
  /** 执行超时 */
  timeout: z.number().default(300000),
  /** 允许退出代码 */
  allowedExitCodes: z.array(z.number()).default([0]),
});
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

/**
 * 沙箱预设配置
 */
export const SANDBOX_PRESETS: Record<SandboxLevel, Partial<SandboxConfig>> = {
  /**
   * 严格模式 - 最高安全级别
   * - 完全网络隔离
   * - 只读文件系统
   * - 最小资源限制
   * - 禁止所有能力
   */
  strict: {
    level: "strict",
    security: {
      noNewPrivileges: true,
      readOnlyRootFilesystem: true,
      dropCapabilities: ["ALL"],
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
    },
    resources: {
      memory: "256m",
      cpuQuota: 0.5,
      pidsLimit: 64,
    },
    network: {
      networkMode: "none",
    },
    filesystem: {
      tmpfs: [
        { path: "/tmp", size: "64m", mode: "1777" },
        { path: "/var/tmp", size: "32m", mode: "1777" },
      ],
      maskedPaths: ["/proc/*", "/sys/*", "/dev/*"],
    },
    timeout: 60000,
  },

  /**
   * 适中模式 - 平衡安全与功能
   * - 无网络访问
   * - 有限资源
   * - 必要能力
   */
  moderate: {
    level: "moderate",
    security: {
      noNewPrivileges: true,
      readOnlyRootFilesystem: true,
      dropCapabilities: ["ALL"],
      capabilities: ["NET_BIND_SERVICE"],
      runAsNonRoot: true,
      runAsUser: 1000,
    },
    resources: {
      memory: "512m",
      cpuQuota: 1.0,
      pidsLimit: 128,
    },
    network: {
      networkMode: "none",
    },
    filesystem: {
      tmpfs: [
        { path: "/tmp", size: "128m", mode: "1777" },
      ],
    },
    timeout: 180000,
  },

  /**
   * 宽松模式 - 较少限制
   * - 桥接网络
   * - 较大资源
   * - 更多能力
   */
  permissive: {
    level: "permissive",
    security: {
      noNewPrivileges: true,
      readOnlyRootFilesystem: false,
      dropCapabilities: ["SYS_ADMIN", "SYS_MODULE"],
      runAsNonRoot: false,
    },
    resources: {
      memory: "1g",
      cpuQuota: 2.0,
      pidsLimit: 256,
    },
    network: {
      networkMode: "bridge",
      dns: ["8.8.8.8", "8.8.4.4"],
    },
    filesystem: {
      tmpfs: [
        { path: "/tmp", size: "256m", mode: "1777" },
      ],
    },
    timeout: 300000,
  },

  /**
   * 自定义模式 - 使用者自行配置
   */
  custom: {},
};

/**
 * 获取沙箱配置
 */
export function getSandboxConfig(level: SandboxLevel): SandboxConfig {
  const preset = SANDBOX_PRESETS[level];

  return SandboxConfigSchema.parse({
    ...preset,
    level,
    security: {
      ...SANDBOX_PRESETS.moderate.security,
      ...preset.security,
    },
    resources: {
      ...SANDBOX_PRESETS.moderate.resources,
      ...preset.resources,
    },
    network: {
      ...SANDBOX_PRESETS.moderate.network,
      ...preset.network,
    },
    filesystem: {
      ...SANDBOX_PRESETS.moderate.filesystem,
      ...preset.filesystem,
    },
  });
}

/**
 * 合并沙箱配置
 */
export function mergeSandboxConfig(
  level: SandboxLevel,
  overrides?: Partial<SandboxConfig>
): SandboxConfig {
  const base = getSandboxConfig(level);

  if (!overrides) return base;

  return SandboxConfigSchema.parse({
    ...base,
    ...overrides,
    security: {
      ...base.security,
      ...overrides.security,
    },
    resources: {
      ...base.resources,
      ...overrides.resources,
    },
    network: {
      ...base.network,
      ...overrides.network,
    },
    filesystem: {
      ...base.filesystem,
      ...overrides.filesystem,
    },
  });
}

// ============================================================================
// Docker 参数生成
// ============================================================================

/**
 * 将沙箱配置转换为 Docker 命令行参数
 */
export function sandboxToDockerArgs(config: SandboxConfig): string[] {
  const args: string[] = [];

  // 安全配置
  const { security } = config;

  if (security.noNewPrivileges) {
    args.push("--security-opt", "no-new-privileges:true");
  }

  if (security.readOnlyRootFilesystem) {
    args.push("--read-only");
  }

  if (security.dropCapabilities && security.dropCapabilities.length > 0) {
    args.push("--cap-drop", security.dropCapabilities.join(","));
  }

  if (security.capabilities && security.capabilities.length > 0) {
    args.push("--cap-add", security.capabilities.join(","));
  }

  if (security.seccompProfile) {
    args.push("--security-opt", `seccomp=${security.seccompProfile}`);
  }

  if (security.apparmorProfile) {
    args.push("--security-opt", `apparmor=${security.apparmorProfile}`);
  }

  if (security.runAsNonRoot) {
    args.push("--security-opt", "no-new-privileges:true");
  }

  if (security.runAsUser !== undefined) {
    args.push("--user", `${security.runAsUser}${security.runAsGroup ? `:${security.runAsGroup}` : ""}`);
  }

  // 资源限制
  const { resources } = config;

  args.push("--memory", resources.memory);

  if (resources.memoryReservation) {
    args.push("--memory-reservation", resources.memoryReservation);
  }

  if (resources.memorySwap) {
    args.push("--memory-swap", resources.memorySwap);
  }

  args.push("--cpus", resources.cpuQuota.toString());

  if (resources.cpuShares) {
    args.push("--cpu-shares", resources.cpuShares.toString());
  }

  if (resources.cpusetCpus) {
    args.push("--cpuset-cpus", resources.cpusetCpus);
  }

  args.push("--pids-limit", resources.pidsLimit.toString());

  if (resources.ulimitNofile) {
    args.push("--ulimit", `nofile=${resources.ulimitNofile}`);
  }

  if (resources.ioWeight) {
    args.push("--io-weight", resources.ioWeight.toString());
  }

  // 网络配置
  const { network } = config;

  args.push("--network", network.networkMode);

  if (network.networkName && network.networkMode !== "host") {
    args.push("--network", network.networkName);
  }

  if (network.dns && network.dns.length > 0) {
    args.push("--dns", network.dns.join(" "));
  }

  if (network.dnsSearch && network.dnsSearch.length > 0) {
    args.push("--dns-search", network.dnsSearch.join(" "));
  }

  if (network.dnsOptions && network.dnsOptions.length > 0) {
    args.push("--dns-option", network.dnsOptions.join(" "));
  }

  if (network.extraHosts && network.extraHosts.length > 0) {
    network.extraHosts.forEach((host) => {
      args.push("--add-host", host);
    });
  }

  if (network.portMappings && network.networkMode === "bridge") {
    network.portMappings.forEach((mapping) => {
      const hostPort = mapping.hostPort ? `${mapping.hostPort}:` : "";
      args.push("-p", `${hostPort}${mapping.containerPort}/${mapping.protocol}`);
    });
  }

  // 文件系统配置
  const { filesystem } = config;

  if (filesystem?.tmpfs) {
    filesystem.tmpfs.forEach((t) => {
      let tmpfsOpt = t.path;
      const opts: string[] = [];
      if (t.size) opts.push(`size=${t.size}`);
      if (t.mode) opts.push(`mode=${t.mode}`);
      if (opts.length > 0) {
        tmpfsOpt += `:${opts.join(",")}`;
      }
      args.push("--tmpfs", tmpfsOpt);
    });
  }

  if (filesystem?.volumes) {
    filesystem.volumes.forEach((v) => {
      const vol = `${v.source}:${v.target}`;
      const opts = v.readOnly ? ":ro" : "";
      args.push("-v", `${vol}${opts}`);
    });
  }

  return args;
}

// ============================================================================
// All exports are defined inline with `export const/function` above
// ============================================================================
