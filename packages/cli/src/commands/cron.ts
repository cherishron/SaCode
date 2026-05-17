import chalk from "chalk";
import type { TaskScheduler, CronTask, CreateTaskInput } from "@sacode/core";

const defaultStoragePath = process.env.SACODE_TASKS_PATH || ".sacode/tasks.json";

let schedulerInstance: TaskScheduler | null = null;

async function getScheduler(): Promise<TaskScheduler> {
  if (!schedulerInstance) {
    const { createTaskScheduler } = await import("@sacode/core");
    schedulerInstance = createTaskScheduler({
      storagePath: defaultStoragePath,
      autoStart: false,
      persistTasks: true,
    });
  }
  return schedulerInstance;
}

export async function listCronJobs(options: { all?: boolean }): Promise<void> {
  const scheduler = await getScheduler();
  const tasks = scheduler.listTasks();
  const showAll = options.all ?? false;
  const tasksToShow = showAll ? tasks : tasks.filter((t) => t.enabled);

  console.log(chalk.cyan("[D] Cron Jobs\n"));

  if (tasksToShow.length === 0) {
    console.log(chalk.gray("[!] No cron jobs found. Use 'sacode cron add' to create one."));
    return;
  }

  for (const task of tasksToShow) {
    const statusIcon = task.enabled ? chalk.green("*") : chalk.red("o");
    const typeIcon = getTypeIcon(task.type ?? "once");
    const message = task.message ?? "";

    console.log(`  ${statusIcon} ${chalk.bold(task.name)} ${typeIcon}`);
    console.log(`      ${chalk.gray("ID:")} ${task.id}`);
    console.log(`      ${chalk.gray("Schedule:")} ${formatSchedule(task)}`);
    console.log(`      ${chalk.gray("Message:")} ${message.substring(0, 50)}${message.length > 50 ? "..." : ""}`);
    console.log(`      ${chalk.gray("Target:")} ${task.channel}:${task.chatId}`);

    if (task.lastRunAt) {
      console.log(`      ${chalk.gray("Last Run:")} ${formatDate(task.lastRunAt)}`);
    }
    if (task.nextRunAt) {
      console.log(`      ${chalk.gray("Next Run:")} ${formatDate(task.nextRunAt)}`);
    }
    console.log(`      ${chalk.gray("Runs:")} ${task.runCount}`);
    console.log();
  }

  const stats = scheduler.getStats();
  console.log(chalk.gray(`Total: ${tasksToShow.length} job(s) (showing ${showAll ? "all" : "enabled only"}) | Global: ${stats.total} total, ${stats.enabled} enabled`));
}

export async function addCronJob(options: {
  name: string;
  message: string;
  type?: "interval" | "once" | "cron";
  every?: string;
  cron?: string;
  at?: string;
  channel?: string;
  chatId?: string;
  disable?: boolean;
}): Promise<void> {
  const type = options.type ?? "interval";

  const config: CreateTaskInput["config"] = {};

  if (type === "interval" && options.every) {
    const seconds = parseDuration(options.every);
    if (seconds === null) {
      console.log(chalk.red("[x] Invalid interval format. Use: 60, 5m, 2h, 1d"));
      return;
    }
    config.interval = seconds;
  } else if (type === "cron" && options.cron) {
    config.cronExpression = options.cron;
  } else if (type === "once" && options.at) {
    const date = new Date(options.at);
    if (isNaN(date.getTime())) {
      console.log(chalk.red("[x] Invalid datetime format. Use ISO format: 2024-01-20T10:00:00Z"));
      return;
    }
    config.executeAt = date;
  } else {
    console.log(chalk.red("[x] Missing schedule specification"));
    console.log(chalk.gray("  --every <duration>  for interval (e.g. 60, 5m, 2h)"));
    console.log(chalk.gray("  --cron <expr>       for cron (e.g. '0 9 * * *')"));
    console.log(chalk.gray("  --at <datetime>     for once (e.g. 2024-01-20T10:00:00Z)"));
    return;
  }

  const channel = options.channel ?? "telegram";
  const chatId = options.chatId ?? "";

  if (!chatId) {
    console.log(chalk.red("[x] Chat ID is required. Use --chat-id <id>"));
    return;
  }

  const input: CreateTaskInput = {
    name: options.name,
    type,
    config,
    message: options.message,
    channel: channel as CreateTaskInput["channel"],
    chatId,
    enabled: !options.disable,
  };

  const scheduler = await getScheduler();
  const task = await scheduler.addTask(input);

  console.log(chalk.green("+ Cron job created"));
  console.log(chalk.gray(`  ID:       ${task.id}`));
  console.log(chalk.gray(`  Name:     ${task.name}`));
  console.log(chalk.gray(`  Type:     ${task.type}`));
  console.log(chalk.gray(`  Schedule: ${formatSchedule(task)}`));
  console.log(chalk.gray(`  Target:   ${task.channel}:${task.chatId}`));
  if (task.nextRunAt) {
    console.log(chalk.gray(`  Next Run: ${formatDate(task.nextRunAt)}`));
  }
}

export async function removeCronJob(jobId: string): Promise<void> {
  const scheduler = await getScheduler();
  const removed = await scheduler.removeTask(jobId);

  if (removed) {
    console.log(chalk.green(`+ Cron job ${jobId} deleted`));
  } else {
    console.log(chalk.red(`[x] Cron job not found: ${jobId}`));
  }
}

export async function enableCronJob(jobId: string): Promise<void> {
  const scheduler = await getScheduler();
  const task = await scheduler.enableTask(jobId);

  if (task) {
    console.log(chalk.green(`+ Cron job "${task.name}" enabled`));
    if (task.nextRunAt) {
      console.log(chalk.gray(`  Next Run: ${formatDate(task.nextRunAt)}`));
    }
  } else {
    console.log(chalk.red(`[x] Cron job not found: ${jobId}`));
  }
}

export async function disableCronJob(jobId: string): Promise<void> {
  const scheduler = await getScheduler();
  const task = await scheduler.disableTask(jobId);

  if (task) {
    console.log(chalk.red(`o Cron job "${task.name}" disabled`));
  } else {
    console.log(chalk.red(`[x] Cron job not found: ${jobId}`));
  }
}

export async function runCronJob(jobId: string): Promise<void> {
  const scheduler = await getScheduler();
  const task = scheduler.getTask(jobId);

  if (!task) {
    console.log(chalk.red(`[x] Cron job not found: ${jobId}`));
    return;
  }

  console.log(chalk.cyan(`~ Running cron job "${task.name}"...`));
  const result = await scheduler.runTask(jobId);

  if (result.success) {
    console.log(chalk.green("+ Cron job executed successfully"));
    if (result.response) {
      console.log(chalk.gray(`  Response: ${result.response}`));
    }
  } else {
    console.log(chalk.red(`[x] Cron job execution failed: ${result.error ?? "unknown error"}`));
  }
}

export async function showCronStats(): Promise<void> {
  const scheduler = await getScheduler();
  const stats = scheduler.getStats();

  console.log(chalk.cyan("[D] Cron Statistics\n"));
  console.log(`  ${chalk.gray("Total:")}     ${stats.total}`);
  console.log(`  ${chalk.gray("Enabled:")}   ${stats.enabled}`);
  console.log(`  ${chalk.gray("Disabled:")}  ${stats.disabled}`);
  console.log();
  console.log(`  ${chalk.gray("By Type:")}`);
  console.log(`    Interval: ${stats.byType.interval}`);
  console.log(`    Cron:     ${stats.byType.cron}`);
  console.log(`    Once:     ${stats.byType.once}`);
  console.log();
  console.log(`  ${chalk.gray("Total Runs:")}   ${stats.totalRuns}`);
  console.log(`  ${chalk.gray("Success Rate:")} ${(stats.successRate * 100).toFixed(1)}%`);
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    interval: "[SYNC]",
    cron: "[CAL]",
    once: "[TM]",
  };
  return icons[type] ?? "[TM]";
}

function formatSchedule(task: CronTask): string {
  const config = task.config ?? {};
  switch (task.type) {
    case "interval":
      return `every ${config.interval ?? "?"}s`;
    case "cron":
      return config.cronExpression ?? "?";
    case "once":
      return config.executeAt?.toISOString() ?? "?";
    default:
      return "?";
  }
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / (1000 * 60));
  const hours = Math.floor(absDiff / (1000 * 60 * 60));

  if (diff > 0) {
    if (minutes < 60) return chalk.gray(`${minutes}m ago`);
    if (hours < 24) return chalk.gray(`${hours}h ago`);
  } else {
    if (minutes < 60) return chalk.green(`in ${minutes}m`);
    if (hours < 24) return chalk.green(`in ${hours}h`);
  }

  return date.toLocaleDateString() + " " + date.toLocaleTimeString();
}

function parseDuration(input: string): number | null {
  const num = parseInt(input, 10);
  if (!isNaN(num) && !input.match(/[a-zA-Z]/)) {
    return num;
  }

  const match = input.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  switch (match[2]) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: return null;
  }
}
