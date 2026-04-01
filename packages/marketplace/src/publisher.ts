/**
 * Marketplace 发布器
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import semver from "semver";
import {
  PublishConfig,
  PublishOptions,
  PublishResult,
  Platform,
  ExtensionInfo,
} from "./types";
import { loadConfigFromPackageJson } from "./config";

/**
 * 发布器类
 */
export class MarketplacePublisher {
  private config: PublishConfig;
  private options: PublishOptions;
  private cwd: string;

  constructor(config: PublishConfig, options: PublishOptions = {}) {
    this.config = config;
    this.options = options;
    this.cwd = options.cwd || process.cwd();
  }

  /**
   * 发布到所有平台
   */
  async publish(): Promise<PublishResult[]> {
    console.log(chalk.bold("\n📦 SACODE Marketplace Publisher\n"));

    // 验证版本号
    if (!this.validateVersion()) {
      throw new Error("Invalid version number");
    }

    // 构建
    if (!this.options.skipBuild) {
      await this.build();
    }

    // 测试
    if (!this.options.skipTests) {
      await this.test();
    }

    // 确认发布
    if (!this.options.publishImmediately) {
      const confirmed = await this.confirmPublish();
      if (!confirmed) {
        console.log(chalk.yellow("\n❌ 发布已取消"));
        return [];
      }
    }

    // 发布到各个平台
    const results: PublishResult[] = [];
    for (const platform of this.config.platforms) {
      const result = await this.publishToPlatform(platform);
      results.push(result);
    }

    // 打印结果
    this.printResults(results);

    return results;
  }

  /**
   * 验证版本号
   */
  private validateVersion(): boolean {
    if (!semver.valid(this.config.version)) {
      console.error(chalk.red(`❌ 无效的版本号: ${this.config.version}`));
      return false;
    }

    // 检查版本是否提升
    const packageJsonPath = path.join(this.cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8")
      );
      if (semver.lte(this.config.version, packageJson.version)) {
        console.error(
          chalk.red(
            `❌ 新版本 ${this.config.version} 必须大于当前版本 ${packageJson.version}`
          )
        );
        return false;
      }
    }

    return true;
  }

  /**
   * 构建
   */
  private async build(): Promise<void> {
    const spinner = ora("Building package...").start();

    try {
      execSync("pnpm build", { cwd: this.cwd, stdio: "pipe" });
      spinner.succeed(chalk.green("Build completed"));
    } catch (error) {
      spinner.fail(chalk.red("Build failed"));
      throw error;
    }
  }

  /**
   * 测试
   */
  private async test(): Promise<void> {
    const spinner = ora("Running tests...").start();

    try {
      execSync("pnpm test", { cwd: this.cwd, stdio: "pipe" });
      spinner.succeed(chalk.green("Tests passed"));
    } catch (error) {
      spinner.fail(chalk.red("Tests failed"));
      throw error;
    }
  }

  /**
   * 确认发布
   */
  private async confirmPublish(): Promise<boolean> {
    console.log(chalk.bold("\n📋 发布信息:\n"));
    console.log(chalk.white(`  名称: ${this.config.name}`));
    console.log(chalk.white(`  版本: ${this.config.version}`));
    console.log(
      chalk.white(
        `  平台: ${this.config.platforms.map((p) => Platform[p]).join(", ")}`
      )
    );
    console.log(chalk.white(`  类型: ${this.config.prerelease ? "预发布" : "正式"}`));
    console.log(chalk.white(`  标签: ${this.config.tag}\n`));

    if (this.config.releaseNotes) {
      console.log(chalk.bold("📝 发布说明:\n"));
      console.log(chalk.gray(this.config.releaseNotes));
      console.log("");
    }

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: "确认发布?",
        default: false,
      },
    ]);

    return confirmed;
  }

  /**
   * 发布到指定平台
   */
  private async publishToPlatform(platform: Platform): Promise<PublishResult> {
    const spinner = ora(`Publishing to ${Platform[platform]}...`).start();

    try {
      switch (platform) {
        case Platform.VSCode:
          return await this.publishToVSCode(spinner);
        case Platform.OpenVSX:
          return await this.publishToOpenVSX(spinner);
        case Platform.NPM:
          return await this.publishToNPM(spinner);
        case Platform.Docker:
          return await this.publishToDocker(spinner);
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      spinner.fail(
        chalk.red(`Failed to publish to ${Platform[platform]}`)
      );
      return {
        platform,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 发布到 VSCode Marketplace
   */
  private async publishToVSCode(
    spinner: ora.Ora
  ): Promise<PublishResult> {
    try {
      const command = this.config.prerelease
        ? "vsce publish --pre-release"
        : "vsce publish";

      execSync(command, { cwd: this.cwd, stdio: "pipe" });

      const url = `https://marketplace.visualstudio.com/items?itemName=${this.config.publisher}.${this.config.name}`;
      spinner.succeed(chalk.green(`Published to VSCode Marketplace`));

      return {
        platform: Platform.VSCode,
        success: true,
        url,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 发布到 Open VSX
   */
  private async publishToOpenVSX(
    spinner: ora.Ora
  ): Promise<PublishResult> {
    try {
      const command = "ovsx publish";
      execSync(command, { cwd: this.cwd, stdio: "pipe" });

      const url = `https://open-vsx.org/extension/${this.config.publisher}/${this.config.name}`;
      spinner.succeed(chalk.green(`Published to Open VSX`));

      return {
        platform: Platform.OpenVSX,
        success: true,
        url,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 发布到 NPM
   */
  private async publishToNPM(spinner: ora.Ora): Promise<PublishResult> {
    try {
      const tag = this.config.prerelease ? "beta" : "latest";
      const command = `npm publish --tag ${tag}`;
      execSync(command, { cwd: this.cwd, stdio: "pipe" });

      const url = `https://www.npmjs.com/package/${this.config.name}`;
      spinner.succeed(chalk.green(`Published to NPM`));

      return {
        platform: Platform.NPM,
        success: true,
        url,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 发布到 Docker Hub
   */
  private async publishToDocker(
    spinner: ora.Ora
  ): Promise<PublishResult> {
    try {
      const tag = this.config.prerelease
        ? `${this.config.version}-beta`
        : this.config.version;

      execSync(`docker build -t ${this.config.name}:${tag} .`, {
        cwd: this.cwd,
        stdio: "pipe",
      });

      execSync(`docker push ${this.config.name}:${tag}`, {
        cwd: this.cwd,
        stdio: "pipe",
      });

      const url = `https://hub.docker.com/r/${this.config.name}`;
      spinner.succeed(chalk.green(`Published to Docker Hub`));

      return {
        platform: Platform.Docker,
        success: true,
        url,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 打印发布结果
   */
  private printResults(results: PublishResult[]): void {
    console.log(chalk.bold("\n📊 发布结果:\n"));

    results.forEach((result) => {
      if (result.success) {
        console.log(
          chalk.green(`✅ ${Platform[result.platform]}: ${result.url}`)
        );
      } else {
        console.log(
          chalk.red(`❌ ${Platform[result.platform]}: ${result.error}`)
        );
      }
    });

    const allSuccess = results.every((r) => r.success);
    if (allSuccess) {
      console.log(chalk.bold("\n🎉 所有平台发布成功！\n"));
    } else {
      console.log(chalk.bold("\n⚠️ 部分平台发布失败\n"));
    }
  }
}

/**
 * 创建发布器
 */
export function createPublisher(
  options: PublishOptions = {}
): MarketplacePublisher {
  const config = loadConfigFromPackageJson(options.cwd);
  return new MarketplacePublisher(config, options);
}
