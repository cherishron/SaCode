import chalk from "chalk";

const platforms = [
  { name: "wechat", displayName: "微信", status: "disconnected" },
  { name: "qq", displayName: "QQ", status: "disconnected" },
  { name: "telegram", displayName: "Telegram", status: "disconnected" },
  { name: "discord", displayName: "Discord", status: "disconnected" },
  { name: "dingtalk", displayName: "钉钉", status: "disconnected" },
  { name: "feishu", displayName: "飞书", status: "disconnected" },
];

export async function listIMConnections(): Promise<void> {
  console.log(chalk.cyan("📱 IM Connections\n"));

  for (const platform of platforms) {
    const statusIcon =
      platform.status === "connected" ? chalk.green("●") : chalk.red("○");
    console.log(`  ${statusIcon} ${platform.displayName} (${platform.name})`);
  }

  console.log();
  console.log(chalk.gray("Use 'SACODE im connect <platform>' to connect"));
}

export async function connectIM(
  platform: string,
  options: { config?: string }
): Promise<void> {
  const found = platforms.find((p) => p.name === platform);

  if (!found) {
    console.log(chalk.red(`Unknown platform: ${platform}`));
    console.log(chalk.gray("Available platforms: " + platforms.map((p) => p.name).join(", ")));
    return;
  }

  console.log(chalk.cyan(`🔌 Connecting to ${found.displayName}...`));

  if (options.config) {
    console.log(chalk.gray(`Config: ${options.config}`));
  }

  // TODO: 实际连接逻辑
  console.log(chalk.green(`✓ Connected to ${found.displayName}`));
}

export async function disconnectIM(platform: string): Promise<void> {
  const found = platforms.find((p) => p.name === platform);

  if (!found) {
    console.log(chalk.red(`Unknown platform: ${platform}`));
    return;
  }

  console.log(chalk.cyan(`🔌 Disconnecting from ${found.displayName}...`));
  // TODO: 实际断开连接逻辑
  console.log(chalk.green(`✓ Disconnected from ${found.displayName}`));
}
