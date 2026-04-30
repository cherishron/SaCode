import type { CommandContext } from "./types.js";
import chalk from "chalk";

/**
 * CodingPlan 多厂商认证管理命令
 */

export function registerAuthCommand(ctx: CommandContext): void {
  const auth = ctx.program.command("auth").description("CodingPlan 认证管理");

  auth
    .command("add")
    .description("添加 CodingPlan 账户")
    .option("--provider <provider>", "厂商 (aliyun/volcengine/baidu/tencent/zhipu/minimax/ucloud/kimi/custom)")
    .option("--key <apiKey>", "CodingPlan 专属 API Key")
    .option("--url <baseUrl>", "自定义 API 端点 (custom 厂商必填)")
    .option("--alias <alias>", "账户别名")
    .option("--protocol <protocol>", "协议 (openai/anthropic)", "openai")
    .option("--model <model>", "默认模型")
    .action(async (options) => {
      const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
      const { listProviders } = await import("../auth/providers.js");
      const manager = new CodingPlanAccountManager();

      let provider = options.provider;
      let apiKey = options.key;

      // 交互模式
      if (!provider) {
        const providers = listProviders();
        console.log(chalk.bold("\n可用的 CodingPlan 厂商:\n"));
        providers.forEach((p, i) => {
          const protocols = p.protocol === "both" ? "OpenAI + Anthropic" : p.protocol;
          console.log(chalk.white(`  ${i + 1}. ${p.name} (${p.models.length} 款模型, ${protocols})`));
          if (p.docs) console.log(chalk.gray(`     文档: ${p.docs}`));
        });
        console.log(chalk.white(`  ${providers.length + 1}. 自定义 (custom)`));
        console.log(chalk.yellow("\n请使用 --provider 参数指定厂商，例如:"));
        console.log(chalk.gray("  sacode auth add --provider aliyun --key sk-sp-xxx"));
        return;
      }

      if (!apiKey) {
        console.log(chalk.red("请提供 API Key: --key <your-api-key>"));
        return;
      }

      try {
        const account = await manager.addAccount(provider, apiKey, {
          alias: options.alias,
          protocol: options.protocol,
          baseUrl: options.url,
          defaultModel: options.model,
        });

        console.log(chalk.green("\n+ 账户已添加"));
        console.log(chalk.white(`  ID:       ${account.id}`));
        console.log(chalk.white(`  别名:     ${account.alias}`));
        console.log(chalk.white(`  厂商:     ${account.provider}`));
        console.log(chalk.white(`  端点:     ${account.baseUrl}`));
        console.log(chalk.white(`  协议:     ${account.protocol}`));
        console.log(chalk.white(`  默认模型: ${account.defaultModel || "未设置"}`));
        if (account.isActive) {
          console.log(chalk.green(`  状态:     当前激活 *`));
        }
      } catch (err) {
        console.error(chalk.red(`添加失败: ${err instanceof Error ? err.message : String(err)}`));
      }
    });

  auth
    .command("list")
    .description("列出所有账户")
    .action(async () => {
      const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
      const manager = new CodingPlanAccountManager();
      const accounts = await manager.listAccounts();

      if (accounts.length === 0) {
        console.log(chalk.yellow("没有配置任何账户。运行 'sacode auth add' 添加。"));
        return;
      }

      // 按厂商分组
      const grouped = new Map<string, typeof accounts>();
      for (const acc of accounts) {
        const key = acc.provider;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(acc);
      }

      console.log(chalk.bold("\nCodingPlan 账户:\n"));
      for (const [provider, accs] of grouped) {
        const preset = manager.getPreset(provider as any);
        console.log(chalk.blue(`  ${preset?.name || provider}`));
        for (const acc of accs) {
          const active = acc.isActive ? chalk.green("* ") : chalk.gray("o ");
          const model = acc.defaultModel ? chalk.gray(` [${acc.defaultModel}]`) : "";
          console.log(`    ${active}${acc.alias} (${acc.id})${model}`);
        }
      }
      console.log();
    });

  auth
    .command("switch <accountId>")
    .description("切换当前激活账户")
    .action(async (accountId: string) => {
      const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
      const manager = new CodingPlanAccountManager();

      try {
        await manager.switchAccount(accountId);
        const account = await manager.getActiveAccount();
        console.log(chalk.green(`+ 已切换到: ${account.alias} (${account.provider})`));
      } catch (err) {
        console.error(chalk.red(`切换失败: ${err instanceof Error ? err.message : String(err)}`));
      }
    });

  auth
    .command("remove <accountId>")
    .description("删除账户")
    .action(async (accountId: string) => {
      const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
      const manager = new CodingPlanAccountManager();

      try {
        await manager.removeAccount(accountId);
        console.log(chalk.green(`+ 账户已删除: ${accountId}`));
      } catch (err) {
        console.error(chalk.red(`删除失败: ${err instanceof Error ? err.message : String(err)}`));
      }
    });

  auth
    .command("current")
    .description("显示当前激活账户")
    .action(async () => {
      const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
      const manager = new CodingPlanAccountManager();

      try {
        const account = await manager.getActiveAccount();
        const preset = manager.getPreset(account.provider as any);
        console.log(chalk.bold("\n当前账户:\n"));
        console.log(chalk.white(`  别名:     ${account.alias}`));
        console.log(chalk.white(`  厂商:     ${preset?.name || account.provider}`));
        console.log(chalk.white(`  协议:     ${account.protocol}`));
        console.log(chalk.white(`  端点:     ${account.baseUrl}`));
        console.log(chalk.white(`  默认模型: ${account.defaultModel || "未设置"}`));
        console.log(chalk.gray(`  API Key:  ${account.apiKey.slice(0, 8)}${"*".repeat(20)}`));
        console.log(chalk.gray(`  创建时间: ${account.createdAt}`));
        if (account.lastUsedAt) {
          console.log(chalk.gray(`  最近使用: ${account.lastUsedAt}`));
        }
        console.log();
      } catch (err) {
        console.error(chalk.yellow(`${err instanceof Error ? err.message : String(err)}`));
      }
    });

  auth
    .command("validate")
    .description("验证当前账户是否有效")
    .action(async () => {
      const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
      const manager = new CodingPlanAccountManager();

      try {
        const account = await manager.getActiveAccount();
        console.log(chalk.blue(`验证中: ${account.alias} (${account.provider})...`));

        const result = await manager.validateAccount(account.id);
        if (result.valid) {
          console.log(chalk.green("+ 账户有效"));
        } else {
          console.log(chalk.red(`x 验证失败: ${result.error}`));
        }
      } catch (err) {
        console.error(chalk.red(`${err instanceof Error ? err.message : String(err)}`));
      }
    });

  auth
    .command("providers")
    .description("列出所有支持的厂商")
    .action(async () => {
      const { listProviders } = await import("../auth/providers.js");
      const providers = listProviders();

      console.log(chalk.bold("\n支持的 CodingPlan 厂商:\n"));
      for (const p of providers) {
        const protocols = p.protocol === "both" ? "OpenAI + Anthropic" : p.protocol;
        console.log(chalk.blue(`  ${p.name} (${p.id})`));
        console.log(chalk.white(`    协议: ${protocols}`));
        console.log(chalk.white(`    模型: ${p.models.join(", ")}`));
        if (p.openaiBaseUrl) console.log(chalk.gray(`    OpenAI:    ${p.openaiBaseUrl}`));
        if (p.anthropicBaseUrl) console.log(chalk.gray(`    Anthropic: ${p.anthropicBaseUrl}`));
        if (p.keyPrefix) console.log(chalk.gray(`    Key 前缀:  ${p.keyPrefix}`));
        if (p.docs) console.log(chalk.gray(`    文档: ${p.docs}`));
        console.log();
      }
    });
}

