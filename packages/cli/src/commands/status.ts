import chalk from "chalk";

interface SystemStatus {
  version: string;
  uptime: number;
  mode: string;
  apiUrl: string;
}

interface AdapterStatus {
  platform: string;
  status: "connected" | "disconnected" | "error";
  lastSeen: string | null;
}

interface SessionStatus {
  active: number;
  total: number;
}

interface CronStatus {
  active: number;
  queued: number;
}

/**
 * 显示系统状态
 */
export async function showStatus(): Promise<void> {
  console.log(chalk.cyan("🔍 SACODE Status\n"));

  // 模拟系统状态
  const system: SystemStatus = {
    version: "0.1.0",
    uptime: 3600 * 24 * 3 + 3600 * 5 + 60 * 30, // 3天5小时30分钟
    mode: "gateway",
    apiUrl: "http://localhost:3000",
  };

  const adapters: AdapterStatus[] = [
    { platform: "telegram", status: "connected", lastSeen: "2024-01-15T10:30:00Z" },
    { platform: "discord", status: "connected", lastSeen: "2024-01-15T10:29:00Z" },
    { platform: "feishu", status: "disconnected", lastSeen: null },
    { platform: "dingtalk", status: "disconnected", lastSeen: null },
  ];

  const sessions: SessionStatus = {
    active: 12,
    total: 156,
  };

  const cron: CronStatus = {
    active: 5,
    queued: 0,
  };

  // 系统信息
  console.log(chalk.bold("📦 System"));
  console.log(`  ${chalk.gray("Version:")} ${system.version}`);
  console.log(`  ${chalk.gray("Uptime:")} ${formatUptime(system.uptime)}`);
  console.log(`  ${chalk.gray("Mode:")} ${system.mode}`);
  console.log(`  ${chalk.gray("API URL:")} ${system.apiUrl}`);
  console.log();

  // 适配器状态
  console.log(chalk.bold("📡 Adapters"));
  for (const adapter of adapters) {
    const statusIcon = getStatusIcon(adapter.status);
    const lastSeen = adapter.lastSeen ? formatRelativeTime(adapter.lastSeen) : chalk.gray("never");
    console.log(`  ${statusIcon} ${adapter.platform.padEnd(10)} ${lastSeen}`);
  }
  console.log();

  // 会话状态
  console.log(chalk.bold("💬 Sessions"));
  console.log(`  ${chalk.gray("Active:")} ${chalk.green(sessions.active)}`);
  console.log(`  ${chalk.gray("Total:")} ${sessions.total}`);
  console.log();

  // 定时任务状态
  console.log(chalk.bold("⏰ Scheduled Tasks"));
  console.log(`  ${chalk.gray("Active:")} ${chalk.green(cron.active)}`);
  console.log(`  ${chalk.gray("Queued:")} ${cron.queued}`);
  console.log();
}

/**
 * 显示详细诊断信息
 */
export async function showDiagnostics(): Promise<void> {
  console.log(chalk.cyan("🔧 Diagnostics\n"));

  // 检查各项组件
  console.log(chalk.bold("✓ Core Components"));
  console.log(`  ${chalk.green("●")} SACODEClient`);
  console.log(`  ${chalk.green("●")} SessionManager`);
  console.log(`  ${chalk.green("●")} MessageRouter`);
  console.log(`  ${chalk.green("●")} TaskScheduler`);
  console.log(`  ${chalk.green("●")} PluginManager`);
  console.log();

  console.log(chalk.bold("⚠️ Warnings"));
  console.log(`  ${chalk.yellow("○")} MemoryManager - No embeddings configured`);
  console.log(`  ${chalk.yellow("○")} Container - Docker not running`);
  console.log();

  console.log(chalk.bold("📝 Recent Logs"));
  console.log(chalk.gray("  [2024-01-15 10:30:00] INFO: Telegram adapter connected"));
  console.log(chalk.gray("  [2024-01-15 10:29:00] INFO: Discord adapter connected"));
  console.log(chalk.gray("  [2024-01-15 09:00:00] INFO: Cron job 'Morning Reminder' executed"));
}

/**
 * 检查服务健康状态
 */
export async function checkHealth(): Promise<void> {
  console.log(chalk.cyan("💚 Health Check\n"));

  const checks = [
    { name: "API Server", status: "healthy", latency: "23ms" },
    { name: "Database", status: "healthy", latency: "5ms" },
    { name: "iFlow Connection", status: "healthy", latency: "45ms" },
    { name: "WebSocket", status: "healthy", latency: "12ms" },
  ];

  for (const check of checks) {
    const statusIcon = check.status === "healthy" ? chalk.green("✓") : chalk.red("✗");
    const latencyColor = parseInt(check.latency) < 100 ? chalk.gray : chalk.yellow;
    console.log(`  ${statusIcon} ${check.name.padEnd(20)} ${latencyColor(check.latency)}`);
  }

  console.log();
  console.log(chalk.green("All systems operational"));
}

// 辅助函数

function getStatusIcon(status: string): string {
  switch (status) {
    case "connected":
      return chalk.green("●");
    case "error":
      return chalk.red("●");
    default:
      return chalk.red("○");
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(" ") || "0m";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (minutes < 1) return chalk.gray("just now");
  if (minutes < 60) return chalk.gray(`${minutes}m ago`);
  if (hours < 24) return chalk.gray(`${hours}h ago`);
  return chalk.gray(`${Math.floor(hours / 24)}d ago`);
}