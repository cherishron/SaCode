import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SACODE_DIR = join(homedir(), ".sacode");
const IM_CONFIG_PATH = join(SACODE_DIR, "im-connections.json");

interface IMConnection {
  platform: string;
  displayName: string;
  status: "connected" | "disconnected" | "connecting" | "error";
  connectedAt?: string;
  error?: string;
}

const PLATFORMS: Array<{ name: string; displayName: string; envKeys: string[] }> = [
  { name: "wechat", displayName: "微信", envKeys: ["WECHAT_APP_ID", "WECHAT_APP_SECRET"] },
  { name: "qq", displayName: "QQ", envKeys: ["QQ_APP_ID", "QQ_APP_SECRET"] },
  { name: "telegram", displayName: "Telegram", envKeys: ["TELEGRAM_BOT_TOKEN"] },
  { name: "discord", displayName: "Discord", envKeys: ["DISCORD_BOT_TOKEN"] },
  { name: "dingtalk", displayName: "钉钉", envKeys: ["DINGTALK_APP_KEY", "DINGTALK_APP_SECRET"] },
  { name: "feishu", displayName: "飞书", envKeys: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"] },
  { name: "slack", displayName: "Slack", envKeys: ["SLACK_BOT_TOKEN"] },
  { name: "whatsapp", displayName: "WhatsApp", envKeys: ["WHATSAPP_API_KEY"] },
  { name: "xiaoyi", displayName: "小艺", envKeys: ["XIAOYI_AK", "XIAOYI_SK"] },
  { name: "email", displayName: "Email", envKeys: ["EMAIL_SMTP_HOST", "EMAIL_SMTP_USER"] },
];

function loadConnections(): IMConnection[] {
  if (!existsSync(IM_CONFIG_PATH)) {
    return PLATFORMS.map((p) => ({
      platform: p.name,
      displayName: p.displayName,
      status: "disconnected" as const,
    }));
  }

  try {
    const raw = readFileSync(IM_CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as IMConnection[];
  } catch {
    return PLATFORMS.map((p) => ({
      platform: p.name,
      displayName: p.displayName,
      status: "disconnected" as const,
    }));
  }
}

function saveConnections(connections: IMConnection[]): void {
  if (!existsSync(SACODE_DIR)) {
    writeFileSync(SACODE_DIR, "", "utf-8");
  }
  writeFileSync(IM_CONFIG_PATH, JSON.stringify(connections, null, 2), "utf-8");
}

function isPlatformConfigured(platform: typeof PLATFORMS[number]): boolean {
  return platform.envKeys.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0;
  });
}

export async function listIMConnections(): Promise<void> {
  console.log(chalk.cyan("[IM] IM Connections\n"));

  const connections = loadConnections();

  for (const conn of connections) {
    const platform = PLATFORMS.find((p) => p.name === conn.platform);
    const configured = platform ? isPlatformConfigured(platform) : false;
    const statusIcon =
      conn.status === "connected" ? chalk.green("*") :
      conn.status === "connecting" ? chalk.yellow("~") :
      conn.status === "error" ? chalk.red("x") :
      configured ? chalk.yellow("o") : chalk.red("o");

    const statusText =
      conn.status === "connected" ? chalk.green("connected") :
      conn.status === "connecting" ? chalk.yellow("connecting...") :
      conn.status === "error" ? chalk.red("error") :
      configured ? chalk.yellow("configured") : chalk.gray("not configured");

    console.log(`  ${statusIcon} ${conn.displayName} (${conn.platform}) - ${statusText}`);

    if (conn.status === "connected" && conn.connectedAt) {
      console.log(`      ${chalk.gray("Connected at:")} ${conn.connectedAt}`);
    }
    if (conn.status === "error" && conn.error) {
      console.log(`      ${chalk.gray("Error:")} ${chalk.red(conn.error)}`);
    }
  }

  console.log();
  console.log(chalk.gray("Use 'sacode im connect <platform>' to connect"));
  console.log(chalk.gray("Use 'sacode im disconnect <platform>' to disconnect"));
}

export async function connectIM(
  platform: string,
  options: { config?: string },
): Promise<void> {
  const found = PLATFORMS.find((p) => p.name === platform);

  if (!found) {
    console.log(chalk.red(`Unknown platform: ${platform}`));
    console.log(chalk.gray("Available platforms: " + PLATFORMS.map((p) => p.name).join(", ")));
    return;
  }

  if (!isPlatformConfigured(found)) {
    console.log(chalk.yellow(`[!] Platform ${found.displayName} is not fully configured`));
    console.log(chalk.gray(`  Required environment variables: ${found.envKeys.join(", ")}`));
    return;
  }

  console.log(chalk.cyan(`[NET] Connecting to ${found.displayName}...`));

  if (options.config) {
    console.log(chalk.gray(`Config: ${options.config}`));
  }

  const connections = loadConnections();
  const connIndex = connections.findIndex((c) => c.platform === platform);

  if (connIndex !== -1 && connections[connIndex]?.status === "connected") {
    console.log(chalk.yellow(`[!] ${found.displayName} is already connected`));
    return;
  }

  try {
    const adapterModule = await import(`@sacode/adapters/${platform}.js`).catch(() => null);

    if (adapterModule) {
      const AdapterClass = adapterModule.default ?? adapterModule[Object.keys(adapterModule)[0] ?? ""];
      if (AdapterClass) {
        const adapter = new AdapterClass();
        await adapter.connect();

        if (connIndex !== -1 && connections[connIndex]) {
          connections[connIndex]!.status = "connected";
          connections[connIndex]!.connectedAt = new Date().toISOString();
          connections[connIndex]!.error = undefined;
        }
        saveConnections(connections);
      }
    } else {
      if (connIndex !== -1 && connections[connIndex]) {
        connections[connIndex]!.status = "connected";
        connections[connIndex]!.connectedAt = new Date().toISOString();
        connections[connIndex]!.error = undefined;
      }
      saveConnections(connections);
    }

    console.log(chalk.green(`+ Connected to ${found.displayName}`));
  } catch (err) {
    if (connIndex !== -1 && connections[connIndex]) {
      connections[connIndex]!.status = "error";
      connections[connIndex]!.error = err instanceof Error ? err.message : "unknown error";
    }
    saveConnections(connections);

    console.log(chalk.red(`x Failed to connect to ${found.displayName}`));
    console.log(chalk.gray(`  Error: ${err instanceof Error ? err.message : "unknown error"}`));
  }
}

export async function disconnectIM(platform: string): Promise<void> {
  const found = PLATFORMS.find((p) => p.name === platform);

  if (!found) {
    console.log(chalk.red(`Unknown platform: ${platform}`));
    return;
  }

  console.log(chalk.cyan(`[NET] Disconnecting from ${found.displayName}...`));

  const connections = loadConnections();
  const connIndex = connections.findIndex((c) => c.platform === platform);

  if (connIndex === -1 || connections[connIndex]?.status !== "connected") {
    console.log(chalk.yellow(`[!] ${found.displayName} is not connected`));
    return;
  }

  try {
    const adapterModule = await import(`@sacode/adapters/${platform}.js`).catch(() => null);

    if (adapterModule) {
      const AdapterClass = adapterModule.default ?? adapterModule[Object.keys(adapterModule)[0] ?? ""];
      if (AdapterClass) {
        const adapter = new AdapterClass();
        await adapter.disconnect();
      }
    }

    if (connIndex !== -1 && connections[connIndex]) {
      connections[connIndex]!.status = "disconnected";
      connections[connIndex]!.connectedAt = undefined;
    }
    saveConnections(connections);

    console.log(chalk.green(`+ Disconnected from ${found.displayName}`));
  } catch (err) {
    if (connIndex !== -1 && connections[connIndex]) {
      connections[connIndex]!.status = "error";
      connections[connIndex]!.error = err instanceof Error ? err.message : "unknown error";
    }
    saveConnections(connections);

    console.log(chalk.red(`x Failed to disconnect from ${found.displayName}`));
    console.log(chalk.gray(`  Error: ${err instanceof Error ? err.message : "unknown error"}`));
  }
}
