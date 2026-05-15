import chalk from "chalk";
import { SACODEClient, type ProviderConfig } from "@sacode/core";
import { resolveProviderConfig } from "../../lib/provider-config.js";
import { compareVersions } from "./helpers.js";

export async function checkAndUpdateVersion(currentVersion: string): Promise<void> {
  try {
    const { execSync } = await import("child_process");
    const latestVersion = execSync("npm view @cherishron/sacode-cli version", { encoding: "utf-8" }).trim();

    if (compareVersions(latestVersion, currentVersion) > 0) {
      console.log(chalk.cyan(`\n[更新] 发现新版本: ${currentVersion} → ${latestVersion}`));
      console.log(chalk.gray("  为避免未确认的全局安装，本次仅提示更新。"));
      console.log(chalk.gray("  如需更新，请手动执行: npm install -g @cherishron/sacode-cli@latest\n"));
    }
  } catch {
    // ignore network and npm errors
  }
}

export async function loadPackageVersion(): Promise<string> {
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const packageJsonPath = join(import.meta.dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function loadChatRuntime(): Promise<{
  client: SACODEClient;
  providerConfig: ProviderConfig;
  cwd: string;
  version: string;
}> {
  const version = await loadPackageVersion();
  await checkAndUpdateVersion(version);

  let providerConfig = await resolveProviderConfig();

  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    try {
      const { CodingPlanAccountManager } = await import("../../auth/account-manager.js");
      const { getProviderPreset, getBaseUrl } = await import("../../auth/providers.js");
      const manager = new CodingPlanAccountManager();
      const account = await manager.getActiveAccount();

      if (account) {
        const preset = getProviderPreset(account.provider);
        const baseUrl = account.baseUrl || (preset ? getBaseUrl(preset, account.protocol) : undefined);

        providerConfig = {
          type: "openai",
          apiKey: account.apiKey,
          model: account.defaultModel || preset?.models[0] || providerConfig.model || "gpt-4o",
          ...(baseUrl && { baseUrl }),
        };
      }
    } catch {
      // keep existing provider config
    }
  }

  let client: SACODEClient;

  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    console.log(chalk.yellow("[!] API key 未配置或无效"));
    console.log(chalk.gray("  请使用 /auth 命令添加 CodingPlan 账户"));
    console.log(chalk.gray("  或在 ~/.sacode/providers.json / 系统环境变量中设置"));
    console.log("");

    const dummyConfig: ProviderConfig = {
      type: "openai",
      apiKey: "placeholder",
      model: providerConfig.model ?? "gpt-4o",
    };
    client = new SACODEClient({
      provider: dummyConfig,
      timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
    });
  } else {
    client = new SACODEClient({
      provider: providerConfig,
      timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
    });

    try {
      await client.connect();
    } catch (error) {
      console.log(chalk.yellow("[!] 连接 AI 服务失败: " + (error instanceof Error ? error.message : "未知错误")));
      console.log(chalk.gray("  将以离线模式启动，请稍后使用 /auth 配置"));
      console.log("");
    }
  }

  return {
    client,
    providerConfig,
    cwd: process.cwd(),
    version,
  };
}

export function registerCleanup(client: SACODEClient, unmount: () => void): void {
  const cleanup = () => {
    unmount();
    client.disconnect();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
