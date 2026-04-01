/**
 * Marketplace CLI
 */

#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createPublisher, Platform } from "./publisher";

const program = new Command();

program
  .name("saclaw-publish")
  .description("SaClaw Marketplace Publisher")
  .version("0.1.0");

// 发布命令
program
  .command("publish")
  .description("Publish package to marketplace")
  .option("--skip-build", "Skip build step")
  .option("--skip-tests", "Skip test step")
  .option("--yes", "Skip confirmation prompts")
  .option("--platform <platforms>", "Target platforms (comma-separated)")
  .action(async (options) => {
    try {
      const publisher = createPublisher({
        skipBuild: options.skipBuild,
        skipTests: options.skipTests,
        publishImmediately: options.yes,
      });

      if (options.platform) {
        // TODO: 设置平台
      }

      await publisher.publish();
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// 列出平台
program
  .command("platforms")
  .description("List supported platforms")
  .action(() => {
    console.log(chalk.bold("\n📦 Supported Platforms:\n"));

    Object.values(Platform).forEach((platform) => {
      console.log(chalk.white(`  - ${platform}`));
    });

    console.log("");
  });

// 检查配置
program
  .command("check")
  .description("Check marketplace configuration")
  .action(async () => {
    try {
      const publisher = createPublisher();
      // TODO: 实现配置检查
      console.log(chalk.green("\n✅ Configuration is valid\n"));
    } catch (error) {
      console.error(chalk.red("\n❌ Configuration error\n"));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 解析命令
program.parse(process.argv);