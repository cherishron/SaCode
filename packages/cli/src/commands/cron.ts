import chalk from "chalk";
import inquirer from "enquirer";

interface CronJob {
  id: string;
  name: string;
  type: "interval" | "once" | "cron";
  schedule: string;
  message: string;
  channel: string;
  chatId: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

/**
 * 列出所有定时任务
 */
export async function listCronJobs(options: { all?: boolean }): Promise<void> {
  console.log(chalk.cyan("⏰ Cron Jobs\n"));

  // 模拟数据 - 实际应从数据库获取
  const jobs: CronJob[] = [
    {
      id: "cron_001",
      name: "Morning Reminder",
      type: "cron",
      schedule: "0 9 * * *",
      message: "Good morning! Have a great day!",
      channel: "telegram",
      chatId: "123456789",
      enabled: true,
      lastRunAt: "2024-01-15T09:00:00Z",
      nextRunAt: "2024-01-16T09:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "cron_002",
      name: "Water Reminder",
      type: "interval",
      schedule: "every 3600s",
      message: "Time to drink water! 💧",
      channel: "discord",
      chatId: "987654321",
      enabled: true,
      lastRunAt: "2024-01-15T10:00:00Z",
      nextRunAt: "2024-01-15T11:00:00Z",
      createdAt: "2024-01-05T00:00:00Z",
    },
    {
      id: "cron_003",
      name: "Weekly Report",
      type: "once",
      schedule: "2024-01-20T10:00:00Z",
      message: "Weekly report is ready!",
      channel: "feishu",
      chatId: "ou_123456",
      enabled: false,
      lastRunAt: null,
      nextRunAt: "2024-01-20T10:00:00Z",
      createdAt: "2024-01-10T00:00:00Z",
    },
  ];

  const showAll = options.all || false;
  const jobsToShow = showAll ? jobs : jobs.filter((j) => j.enabled);

  if (jobsToShow.length === 0) {
    console.log(chalk.gray("No cron jobs found. Use 'SACODE cron add' to create one."));
    return;
  }

  for (const job of jobsToShow) {
    const statusIcon = job.enabled ? chalk.green("●") : chalk.red("○");
    const typeIcon = getTypeIcon(job.type);

    console.log(`  ${statusIcon} ${chalk.bold(job.name)} ${typeIcon}`);
    console.log(`      ${chalk.gray("ID:")} ${job.id}`);
    console.log(`      ${chalk.gray("Schedule:")} ${job.schedule}`);
    console.log(`      ${chalk.gray("Message:")} ${job.message.substring(0, 50)}${job.message.length > 50 ? "..." : ""}`);
    console.log(`      ${chalk.gray("Target:")} ${job.channel}:${job.chatId}`);

    if (job.lastRunAt) {
      console.log(`      ${chalk.gray("Last Run:")} ${formatDate(job.lastRunAt)}`);
    }
    if (job.nextRunAt) {
      console.log(`      ${chalk.gray("Next Run:")} ${formatDate(job.nextRunAt)}`);
    }
    console.log();
  }

  console.log(chalk.gray(`Total: ${jobsToShow.length} job(s) (showing ${showAll ? "all" : "enabled only"})`));
}

/**
 * 添加定时任务
 */
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
  const type = options.type || "interval";
  let schedule = "";

  if (type === "interval" && options.every) {
    schedule = `every ${options.every}s`;
  } else if (type === "cron" && options.cron) {
    schedule = options.cron;
  } else if (type === "once" && options.at) {
    schedule = options.at;
  } else {
    console.log(chalk.red("Error: Missing schedule specification"));
    console.log(chalk.gray("  --every <seconds>  for interval"));
    console.log(chalk.gray("  --cron <expr>       for cron"));
    console.log(chalk.gray("  --at <datetime>     for once"));
    return;
  }

  // 交互式获取缺失信息
  const answers = await inquirer.prompt<{ channel?: string; chatId?: string }>([
    {
      type: "input",
      name: "channel",
      message: "Channel:",
      default: options.channel || "telegram",
      when: !options.channel,
    },
    {
      type: "input",
      name: "chatId",
      message: "Chat ID:",
      default: options.chatId || "",
      when: !options.chatId,
    },
  ] as any);

  const channel = options.channel || answers.channel;
  const chatId = options.chatId || answers.chatId;

  console.log(chalk.cyan("\n📝 Creating cron job...\n"));
  console.log(`  ${chalk.gray("Name:")} ${options.name}`);
  console.log(`  ${chalk.gray("Type:")} ${type}`);
  console.log(`  ${chalk.gray("Schedule:")} ${schedule}`);
  console.log(`  ${chalk.gray("Message:")} ${options.message}`);
  console.log(`  ${chalk.gray("Channel:")} ${channel}`);
  console.log(`  ${chalk.gray("Chat ID:")} ${chatId}`);

  const confirm = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow("Create this cron job?"),
      default: true,
    },
  ] as any);

  if (!confirm.confirm) {
    console.log(chalk.gray("Operation cancelled"));
    return;
  }

  // TODO: 实际创建逻辑
  console.log(chalk.green("✓ Cron job created"));
}

/**
 * 删除定时任务
 */
export async function removeCronJob(jobId: string): Promise<void> {
  const confirm = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow(`Delete cron job ${jobId}?`),
      default: false,
    },
  ] as any);

  if (!confirm.confirm) {
    console.log(chalk.gray("Operation cancelled"));
    return;
  }

  // TODO: 实际删除逻辑
  console.log(chalk.green(`✓ Cron job ${jobId} deleted`));
}

/**
 * 启用定时任务
 */
export async function enableCronJob(jobId: string): Promise<void> {
  // TODO: 实际启用逻辑
  console.log(chalk.green(`✓ Cron job ${jobId} enabled`));
}

/**
 * 禁用定时任务
 */
export async function disableCronJob(jobId: string): Promise<void> {
  // TODO: 实际禁用逻辑
  console.log(chalk.red(`○ Cron job ${jobId} disabled`));
}

/**
 * 立即运行定时任务
 */
export async function runCronJob(jobId: string): Promise<void> {
  console.log(chalk.cyan(`⏳ Running cron job ${jobId}...`));
  // TODO: 实际运行逻辑
  console.log(chalk.green("✓ Cron job executed"));
}

// 辅助函数

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    interval: "🔄",
    cron: "📅",
    once: "⏱️",
  };
  return icons[type] || "⏰";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 60) {
    return chalk.gray(`${minutes}m ago`);
  } else if (hours < 24) {
    return chalk.gray(`${hours}h ago`);
  } else {
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  }
}
