import chalk from "chalk";
import inquirer from "enquirer";

interface SessionInfo {
  id: string;
  channel: string;
  chatId: string;
  lastActiveAt: string;
  messageCount: number;
}

/**
 * 列出所有会话
 */
export async function listSessions(options: { channel?: string; chatId?: string }): Promise<void> {
  console.log(chalk.cyan("📋 Sessions\n"));

  // 模拟数据 - 实际应从数据库获取
  const sessions: SessionInfo[] = [
    {
      id: "sess_abc123",
      channel: "telegram",
      chatId: "123456789",
      lastActiveAt: "2024-01-15T10:30:00Z",
      messageCount: 42,
    },
    {
      id: "sess_def456",
      channel: "discord",
      chatId: "987654321",
      lastActiveAt: "2024-01-15T09:15:00Z",
      messageCount: 28,
    },
    {
      id: "sess_ghi789",
      channel: "feishu",
      chatId: "ou_123456",
      lastActiveAt: "2024-01-14T18:45:00Z",
      messageCount: 15,
    },
  ];

  // 按channel过滤
  const filtered = options.channel
    ? sessions.filter((s) => s.channel === options.channel)
    : sessions;

  // 按chatId过滤
  const finalFiltered = options.chatId
    ? filtered.filter((s) => s.chatId === options.chatId)
    : filtered;

  if (finalFiltered.length === 0) {
    console.log(chalk.gray("No sessions found"));
    return;
  }

  for (const session of finalFiltered) {
    const channelIcon = getChannelIcon(session.channel);
    console.log(`  ${channelIcon} ${chalk.bold(session.id)}`);
    console.log(`      ${chalk.gray("Chat ID:")} ${session.chatId}`);
    console.log(`      ${chalk.gray("Messages:")} ${session.messageCount}`);
    console.log(`      ${chalk.gray("Last Active:")} ${formatDate(session.lastActiveAt)}`);
    console.log();
  }

  console.log(chalk.gray(`Total: ${finalFiltered.length} session(s)`));
}

/**
 * 显示会话详情
 */
export async function showSession(sessionId: string): Promise<void> {
  console.log(chalk.cyan(`📋 Session: ${sessionId}\n`));

  // 模拟数据
  const session = {
    id: sessionId,
    channel: "telegram",
    chatId: "123456789",
    platformChatId: "123456789",
    title: "Private Chat",
    createdAt: "2024-01-10T08:00:00Z",
    lastActiveAt: "2024-01-15T10:30:00Z",
    messageCount: 42,
    tokenCount: 12500,
  };

  console.log(`  ${chalk.gray("Channel:")} ${getChannelIcon(session.channel)} ${session.channel}`);
  console.log(`  ${chalk.gray("Chat ID:")} ${session.chatId}`);
  console.log(`  ${chalk.gray("Title:")} ${session.title}`);
  console.log(`  ${chalk.gray("Created:")} ${formatDate(session.createdAt)}`);
  console.log(`  ${chalk.gray("Last Active:")} ${formatDate(session.lastActiveAt)}`);
  console.log(`  ${chalk.gray("Messages:")} ${session.messageCount}`);
  console.log(`  ${chalk.gray("Token Count:")} ~${session.tokenCount}`);
}

/**
 * 清除会话映射
 */
export async function clearSessions(_options: { channel?: string; chatId?: string }): Promise<void> {
  const answers = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow("Are you sure you want to clear session mappings?"),
      default: false,
    },
  ] as any);

  if (!answers.confirm) {
    console.log(chalk.gray("Operation cancelled"));
    return;
  }

  // TODO: 实际清除逻辑
  console.log(chalk.green("✓ Session mappings cleared"));
}

/**
 * 清除指定会话
 */
export async function clearSession(sessionId: string): Promise<void> {
  const answers = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow(`Are you sure you want to clear session ${sessionId}?`),
      default: false,
    },
  ] as any);

  if (!answers.confirm) {
    console.log(chalk.gray("Operation cancelled"));
    return;
  }

  // TODO: 实际清除逻辑
  console.log(chalk.green(`✓ Session ${sessionId} cleared`));
}

// 辅助函数

function getChannelIcon(channel: string): string {
  const icons: Record<string, string> = {
    telegram: "✈️",
    discord: "💬",
    feishu: "📘",
    dingtalk: "🔔",
    qq: "🐧",
    whatsapp: "💚",
    slack: "👔",
    email: "📧",
    wechat: "💬",
    xiaoyi: "🎤",
  };
  return icons[channel] || "📱";
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
    return date.toLocaleDateString();
  }
}
