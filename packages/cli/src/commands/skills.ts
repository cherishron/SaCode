import chalk from "chalk";
import {
  SkillLoader,
  SkillRegistry,
  SkillInstaller,
  SkillHubAdapter,
  type RegistryType,
} from "@sacode/core";
import * as path from "path";
import * as fs from "fs";

const DEFAULT_SKILLS_DIR = ".SACODE/skills";

function getSkillsDir(): string {
  return path.resolve(process.cwd(), DEFAULT_SKILLS_DIR);
}

/**
 * 创建注册表客户端
 *
 * @param registry - 注册表类型: "clawhub" 或 "skillhub"
 */
function createRegistry(registry: RegistryType = "clawhub"): SkillRegistry {
  if (registry === "skillhub") {
    const config: { registryUrl?: string; token?: string } = {};
    if (process.env.SKILLHUB_URL) {
      config.registryUrl = process.env.SKILLHUB_URL;
    }
    if (process.env.SKILLHUB_TOKEN) {
      config.token = process.env.SKILLHUB_TOKEN;
    }
    return new SkillHubAdapter(config);
  }
  const config: { registryUrl?: string; token?: string } = {};
  if (process.env.CLAWHUB_URL) {
    config.registryUrl = process.env.CLAWHUB_URL;
  }
  if (process.env.CLAWHUB_TOKEN) {
    config.token = process.env.CLAWHUB_TOKEN;
  }
  return new SkillRegistry(config);
}

/**
 * 获取注册表显示名称
 */
function getRegistryDisplayName(registry: RegistryType): string {
  return registry === "skillhub" ? "SkillHub (腾讯云镜像)" : "ClawHub";
}

/**
 * 搜索技能
 */
export async function searchSkills(options: {
  query?: string;
  tags?: string;
  limit?: number;
  registry?: RegistryType;
}): Promise<void> {
  const registryType = options.registry ?? "clawhub";
  console.log(chalk.cyan(`\n🔍 搜索技能 (${getRegistryDisplayName(registryType)})...\n`));

  const registry = createRegistry(registryType);

  try {
    const tags = options.tags?.split(",").map((t) => t.trim());
    const searchParams: { tags?: string[]; limit: number; query?: string } = {
      limit: options.limit ?? 20,
    };
    if (options.query) {
      searchParams.query = options.query;
    }
    if (tags && tags.length > 0) {
      searchParams.tags = tags;
    }
    const result = await registry.search(searchParams);

    if (result.entries.length === 0) {
      console.log(chalk.yellow("未找到匹配的技能"));
      return;
    }

    console.log(chalk.gray(`找到 ${result.total} 个技能\n`));

    for (const skill of result.entries) {
      console.log(chalk.bold.green(skill.slug) + chalk.gray(` v${skill.latestVersion}`));
      if (skill.description) {
        console.log(chalk.gray(`  ${skill.description}`));
      }
      if (skill.tags.length > 0) {
        console.log(chalk.blue(`  标签: ${skill.tags.join(", ")}`));
      }
      console.log(chalk.gray(`  安装: SACODE skills install ${skill.slug}${registryType === "skillhub" ? " --registry skillhub" : ""}`));
      console.log();
    }

    if (result.hasMore) {
      console.log(chalk.gray("使用 --limit 查看更多结果"));
    }
  } catch (error) {
    console.error(chalk.red("搜索失败:"), error instanceof Error ? error.message : String(error));
  }
}

/**
 * 安装技能
 */
export async function installSkill(
  slug: string,
  options: { version?: string; force?: boolean; registry?: RegistryType }
): Promise<void> {
  const registryType = options.registry ?? "clawhub";
  console.log(chalk.cyan(`\n📦 安装技能: ${slug} (${getRegistryDisplayName(registryType)})\n`));

  const skillsDir = getSkillsDir();
  const registry = createRegistry(registryType);
  const installer = new SkillInstaller({ skillsDir, registry });

  try {
    const installOptions: { targetDir: string; force: boolean; enable: true; version?: string } = {
      targetDir: path.join(skillsDir, slug),
      force: options.force ?? false,
      enable: true,
    };
    if (options.version) {
      installOptions.version = options.version;
    }
    const skill = await installer.install(slug, installOptions);

    console.log(chalk.green(`✓ 已安装: ${skill.name} v${skill.version}`));
    if (skill.description) {
      console.log(chalk.gray(`  ${skill.description}`));
    }
    console.log(chalk.gray(`\n位置: ${path.join(skillsDir, slug)}`));
  } catch (error) {
    console.error(chalk.red("安装失败:"), error instanceof Error ? error.message : String(error));
  }
}

/**
 * 更新技能
 */
export async function updateSkill(
  slug: string,
  options: { version?: string; registry?: RegistryType }
): Promise<void> {
  const registryType = options.registry ?? "clawhub";
  console.log(chalk.cyan(`\n🔄 更新技能: ${slug} (${getRegistryDisplayName(registryType)})\n`));

  const skillsDir = getSkillsDir();
  const registry = createRegistry(registryType);
  const installer = new SkillInstaller({ skillsDir, registry });

  try {
    const skill = await installer.update(slug, options.version);
    console.log(chalk.green(`✓ 已更新: ${skill.name} v${skill.version}`));
  } catch (error) {
    console.error(chalk.red("更新失败:"), error instanceof Error ? error.message : String(error));
  }
}

/**
 * 更新所有技能
 */
export async function updateAllSkills(options?: { registry?: RegistryType }): Promise<void> {
  const registryType = options?.registry ?? "clawhub";
  console.log(chalk.cyan(`\n🔄 检查技能更新 (${getRegistryDisplayName(registryType)})...\n`));

  const skillsDir = getSkillsDir();
  const registry = createRegistry(registryType);
  const installer = new SkillInstaller({ skillsDir, registry });

  try {
    // 检查更新
    const updates = await installer.checkUpdates();

    if (updates.length === 0) {
      console.log(chalk.green("✓ 所有技能已是最新版本"));
      return;
    }

    console.log(chalk.yellow(`发现 ${updates.length} 个可更新技能:\n`));
    for (const update of updates) {
      console.log(`  ${update.slug}: ${update.currentVersion} -> ${update.latestVersion}`);
    }
    console.log();

    // 执行更新
    const results = await installer.updateAll();

    console.log(chalk.green(`\n✓ 已更新 ${results.length} 个技能`));
    for (const result of results) {
      console.log(`  ${result.slug}: ${result.version}`);
    }
  } catch (error) {
    console.error(chalk.red("更新失败:"), error instanceof Error ? error.message : String(error));
  }
}

/**
 * 列出已安装技能
 */
export async function listSkills(): Promise<void> {
  console.log(chalk.cyan("\n📋 已安装技能\n"));

  const skillsDir = getSkillsDir();

  if (!fs.existsSync(skillsDir)) {
    console.log(chalk.yellow("未找到技能目录"));
    console.log(chalk.gray("使用 'SACODE skills search <query>' 搜索并安装技能"));
    return;
  }

  const loader = new SkillLoader({ skillsDir });
  const results = await loader.discover();

  if (results.length === 0) {
    console.log(chalk.yellow("未安装任何技能"));
    console.log(chalk.gray("使用 'SACODE skills search <query>' 搜索技能"));
    return;
  }

  for (const result of results) {
    const status = result.error ? chalk.red("✗") : chalk.green("✓");
    console.log(`${status} ${chalk.bold(result.skill.name)}`);
    if (result.skill.version) {
      console.log(chalk.gray(`  版本: ${result.skill.version}`));
    }
    if (result.skill.description) {
      console.log(chalk.gray(`  描述: ${result.skill.description}`));
    }
    if (result.error) {
      console.log(chalk.red(`  错误: ${result.error}`));
    }
    console.log();
  }
}

/**
 * 卸载技能
 */
export async function uninstallSkill(slug: string): Promise<void> {
  console.log(chalk.cyan(`\n🗑️  卸载技能: ${slug}\n`));

  const skillsDir = getSkillsDir();
  const installer = new SkillInstaller({ skillsDir });

  try {
    await installer.uninstall(slug);
    console.log(chalk.green(`✓ 已卸载: ${slug}`));
  } catch (error) {
    console.error(chalk.red("卸载失败:"), error instanceof Error ? error.message : String(error));
  }
}

/**
 * 登录注册表
 */
export async function loginRegistry(options: {
  token?: string;
  registry?: RegistryType;
}): Promise<void> {
  const registryType = options.registry ?? "clawhub";
  console.log(chalk.cyan(`\n🔐 登录 ${getRegistryDisplayName(registryType)}\n`));

  const registry = createRegistry(registryType);

  if (options.token) {
    registry.setToken(options.token);
    const result = await registry.validateToken();

    if (result.valid) {
      console.log(chalk.green(`✓ 登录成功: ${result.username ?? "unknown"}`));
      // TODO: 持久化 token
    } else {
      console.log(chalk.red("✗ Token 无效"));
    }
  } else {
    console.log(chalk.yellow("请在浏览器中完成登录..."));
    console.log(chalk.gray("或者使用 --token <token> 参数"));
    // TODO: 实现浏览器登录流程
  }
}

/**
 * 登录 ClawHub (兼容旧接口)
 */
export async function loginClawHub(options: { token?: string }): Promise<void> {
  return loginRegistry({ ...options, registry: "clawhub" });
}

/**
 * 发布技能
 */
export async function publishSkill(
  skillPath: string,
  options: { slug?: string; version?: string; registry?: RegistryType }
): Promise<void> {
  const registryType = options.registry ?? "clawhub";
  console.log(chalk.cyan(`\n📤 发布技能到 ${getRegistryDisplayName(registryType)}\n`));

  const registry = createRegistry(registryType);

  try {
    // 读取 SKILL.md
    const skillFile = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      console.log(chalk.red("✗ 未找到 SKILL.md 文件"));
      return;
    }

    // 加载技能
    const loader = new SkillLoader({ skillsDir: path.dirname(skillPath) });
    const result = await loader.load(skillPath);

    if (result.error) {
      console.log(chalk.red(`✗ 加载技能失败: ${result.error}`));
      return;
    }

    // 收集所有文件
    const files: Record<string, string> = {};
    const collectFiles = async (dir: string, base: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await collectFiles(fullPath, base);
        } else {
          const relativePath = path.relative(base, fullPath);
          files[relativePath] = await fs.promises.readFile(fullPath, "utf-8");
        }
      }
    };

    await collectFiles(skillPath, skillPath);

    // 发布
    const skillName = result.skill.name ?? result.skill.slug ?? "untitled-skill";
    const publishData: {
      slug: string;
      name: string;
      version: string;
      files: Record<string, string>;
      tags?: string[];
    } = {
      slug: options.slug ?? result.skill.slug ?? skillName.toLowerCase().replace(/\s+/g, "-"),
      name: skillName,
      version: options.version ?? result.skill.version ?? "1.0.0",
      files,
    };
    if (result.skill.tags) {
      publishData.tags = result.skill.tags;
    }
    const publishResult = await registry.publishSkill(publishData);

    console.log(chalk.green(`✓ 已发布: v${publishResult.version}`));
    console.log(chalk.gray(`发布时间: ${publishResult.publishedAt.toLocaleString()}`));
  } catch (error) {
    console.error(chalk.red("发布失败:"), error instanceof Error ? error.message : String(error));
  }
}
