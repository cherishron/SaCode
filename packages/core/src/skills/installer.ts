import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { Skill, SkillInstallOptions, SkillLockEntry, SkillLockfile } from "./types";
import { SkillLoader } from "./loader";
import { SkillRegistry } from "./registry";

/**
 * SkillInstaller 配置
 */
export interface SkillInstallerConfig {
  /** Skills 目录路径 */
  skillsDir: string;
  /** 注册中心实例 */
  registry?: SkillRegistry;
  /** 最大单个文件大小 (字节)，默认 1MB */
  maxFileSize: number;
  /** 最大总文件大小 (字节)，默认 10MB */
  maxTotalSize: number;
  /** 最大文件数量，默认 100 */
  maxFileCount: number;
  /** 允许的文件扩展名白名单 */
  allowedExtensions: string[];
}

/**
 * 默认安装器配置
 */
const DEFAULT_INSTALLER_CONFIG: Omit<SkillInstallerConfig, "skillsDir" | "registry"> = {
  maxFileSize: 1024 * 1024, // 1MB
  maxTotalSize: 10 * 1024 * 1024, // 10MB
  maxFileCount: 100,
  allowedExtensions: [
    ".md", ".txt", ".json", ".yaml", ".yml",
    ".ts", ".tsx", ".js", ".jsx", ".mjs",
    ".css", ".scss", ".less",
    ".html", ".xml", ".svg",
  ],
};

/**
 * 安全验证错误
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Skill 安装器
 *
 * 支持从 ClawHub 安装、更新、管理技能
 *
 * @example
 * ```typescript
 * const installer = new SkillInstaller({ skillsDir: ".saclaw/skills" });
 * await installer.install("calendar-helper");
 * await installer.update("calendar-helper");
 * await installer.uninstall("calendar-helper");
 * ```
 */
export class SkillInstaller {
  private config: SkillInstallerConfig;
  private lockfilePath: string;
  private registry: SkillRegistry;
  private loader: SkillLoader;

  constructor(options: Partial<SkillInstallerConfig> & { skillsDir: string }) {
    this.config = { ...DEFAULT_INSTALLER_CONFIG, ...options };
    this.lockfilePath = path.join(this.config.skillsDir, ".clawhub", "lock.json");
    this.registry = options.registry ?? new SkillRegistry();
    this.loader = new SkillLoader({ skillsDir: this.config.skillsDir });
  }

  /**
   * 验证文件路径安全性
   * 防止路径遍历攻击
   */
  private validateFilePath(filePath: string, targetDir: string): string {
    // 规范化路径
    const normalizedPath = path.normalize(filePath);
    
    // 检查是否为绝对路径
    if (path.isAbsolute(normalizedPath)) {
      throw new SecurityError(`Absolute path not allowed: ${filePath}`);
    }
    
    // 检查路径遍历
    if (normalizedPath.startsWith("..") || normalizedPath.includes(path.sep + "..")) {
      throw new SecurityError(`Path traversal detected: ${filePath}`);
    }
    
    // 检查是否包含可疑字符
    if (/[<>:"|?*\x00-\x1f]/.test(normalizedPath)) {
      throw new SecurityError(`Invalid characters in path: ${filePath}`);
    }
    
    // 计算完整路径并验证
    const fullPath = path.resolve(targetDir, normalizedPath);
    const resolvedTarget = path.resolve(targetDir);
    
    if (!fullPath.startsWith(resolvedTarget + path.sep) && fullPath !== resolvedTarget) {
      throw new SecurityError(`Path escapes target directory: ${filePath}`);
    }
    
    return fullPath;
  }

  /**
   * 验证文件扩展名
   */
  private validateFileExtension(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !this.config.allowedExtensions.includes(ext)) {
      throw new SecurityError(`File extension not allowed: ${ext} (${filePath})`);
    }
  }

  /**
   * 验证文件大小和数量
   */
  private validateFiles(files: Record<string, string>): void {
    // 检查文件数量
    const fileCount = Object.keys(files).length;
    if (fileCount > this.config.maxFileCount) {
      throw new SecurityError(`Too many files: ${fileCount} > ${this.config.maxFileCount}`);
    }
    
    let totalSize = 0;
    
    for (const [filePath, content] of Object.entries(files)) {
      const size = Buffer.byteLength(content, "utf-8");
      totalSize += size;
      
      // 检查单个文件大小
      if (size > this.config.maxFileSize) {
        throw new SecurityError(
          `File too large: ${filePath} (${(size / 1024).toFixed(2)}KB > ${this.config.maxFileSize / 1024}KB)`
        );
      }
      
      // 验证扩展名
      this.validateFileExtension(filePath);
    }
    
    // 检查总大小
    if (totalSize > this.config.maxTotalSize) {
      throw new SecurityError(
        `Total size too large: ${(totalSize / 1024 / 1024).toFixed(2)}MB > ${this.config.maxTotalSize / 1024 / 1024}MB`
      );
    }
  }

  /**
   * 安装技能
   */
  async install(slug: string, options?: Partial<SkillInstallOptions>): Promise<Skill> {
    const targetDir = options?.targetDir ?? path.join(this.config.skillsDir, this.sanitizeSlug(slug));

    // 检查是否已安装
    if (fs.existsSync(targetDir) && !options?.force) {
      throw new Error(`Skill already installed: ${slug}. Use --force to overwrite.`);
    }

    // 从注册中心下载
    const { files, version } = await this.registry.downloadSkill(slug, options?.version);

    // 安全验证
    this.validateFiles(files);

    // 确保目录存在
    await fs.promises.mkdir(targetDir, { recursive: true });

    // 写入文件 (带安全验证)
    for (const [filePath, content] of Object.entries(files)) {
      const safePath = this.validateFilePath(filePath, targetDir);
      await fs.promises.mkdir(path.dirname(safePath), { recursive: true });
      await fs.promises.writeFile(safePath, content, "utf-8");
    }

    // 计算校验和
    const checksum = this.computeChecksum(files);

    // 更新锁文件
    await this.updateLockfile({
      slug,
      version,
      installedAt: new Date(),
      path: targetDir,
      checksum,
    });

    // 加载并返回技能
    const result = await this.loader.load(targetDir);
    if (result.error) {
      throw new Error(`Failed to load installed skill: ${result.error}`);
    }

    return result.skill;
  }

  /**
   * 更新技能
   */
  async update(slug: string, version?: string): Promise<Skill> {
    const lockfile = await this.readLockfile();
    const entry = lockfile.skills.find((s) => s.slug === slug);

    if (!entry) {
      throw new Error(`Skill not installed: ${slug}`);
    }

    // 下载新版本
    const { files, version: newVersion } = await this.registry.downloadSkill(slug, version);

    // 安全验证
    this.validateFiles(files);

    // 写入文件 (带安全验证)
    for (const [filePath, content] of Object.entries(files)) {
      const safePath = this.validateFilePath(filePath, entry.path);
      await fs.promises.mkdir(path.dirname(safePath), { recursive: true });
      await fs.promises.writeFile(safePath, content, "utf-8");
    }

    // 更新锁文件
    await this.updateLockfile({
      slug,
      version: newVersion,
      installedAt: new Date(),
      path: entry.path,
      checksum: this.computeChecksum(files),
    });

    // 重新加载
    const result = await this.loader.load(entry.path);
    if (result.error) {
      throw new Error(`Failed to reload updated skill: ${result.error}`);
    }

    return result.skill;
  }

  /**
   * 清理 slug，移除危险字符
   */
  private sanitizeSlug(slug: string): string {
    // 只允许字母、数字、连字符和下划线
    const sanitized = slug.replace(/[^a-zA-Z0-9_-]/g, "");
    if (sanitized !== slug || sanitized.length === 0) {
      throw new SecurityError(`Invalid slug format: ${slug}`);
    }
    return sanitized;
  }

  /**
   * 卸载技能
   */
  async uninstall(slug: string): Promise<void> {
    const lockfile = await this.readLockfile();
    const entryIndex = lockfile.skills.findIndex((s) => s.slug === slug);

    if (entryIndex === -1) {
      throw new Error(`Skill not installed: ${slug}`);
    }

    const entry = lockfile.skills[entryIndex];
    if (!entry) {
      throw new Error(`Invalid lockfile entry for: ${slug}`);
    }

    // 删除文件
    if (fs.existsSync(entry.path)) {
      await fs.promises.rm(entry.path, { recursive: true });
    }

    // 从锁文件中移除
    lockfile.skills.splice(entryIndex, 1);
    lockfile.updatedAt = new Date();
    await this.writeLockfile(lockfile);

    // 从加载器中移除
    this.loader.remove(slug);
  }

  /**
   * 列出已安装的技能
   */
  async list(): Promise<SkillLockEntry[]> {
    const lockfile = await this.readLockfile();
    return lockfile.skills;
  }

  /**
   * 检查更新
   */
  async checkUpdates(): Promise<{ slug: string; currentVersion: string; latestVersion: string }[]> {
    const lockfile = await this.readLockfile();
    const updates: { slug: string; currentVersion: string; latestVersion: string }[] = [];

    for (const entry of lockfile.skills) {
      try {
        const skillInfo = await this.registry.getSkill(entry.slug);
        if (skillInfo && skillInfo.latestVersion !== entry.version) {
          updates.push({
            slug: entry.slug,
            currentVersion: entry.version,
            latestVersion: skillInfo.latestVersion,
          });
        }
      } catch {
        // 忽略单个技能的检查错误
      }
    }

    return updates;
  }

  /**
   * 更新所有技能
   */
  async updateAll(): Promise<{ slug: string; version: string }[]> {
    const updates = await this.checkUpdates();
    const results: { slug: string; version: string }[] = [];

    for (const update of updates) {
      try {
        const skill = await this.update(update.slug, update.latestVersion);
        results.push({ slug: update.slug, version: skill.version ?? "unknown" });
      } catch {
        // 忽略单个更新错误
      }
    }

    return results;
  }

  /**
   * 读取锁文件
   */
  private async readLockfile(): Promise<SkillLockfile> {
    if (!fs.existsSync(this.lockfilePath)) {
      return {
        version: 1,
        updatedAt: new Date(),
        skills: [],
      };
    }

    const content = await fs.promises.readFile(this.lockfilePath, "utf-8");
    const parsed = JSON.parse(content) as SkillLockfile;

    // 转换日期字符串为 Date 对象
    return {
      ...parsed,
      updatedAt: new Date(parsed.updatedAt),
      skills: parsed.skills.map((s) => ({
        ...s,
        installedAt: new Date(s.installedAt),
      })),
    };
  }

  /**
   * 写入锁文件
   */
  private async writeLockfile(lockfile: SkillLockfile): Promise<void> {
    const dir = path.dirname(this.lockfilePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(this.lockfilePath, JSON.stringify(lockfile, null, 2), "utf-8");
  }

  /**
   * 更新锁文件条目
   */
  private async updateLockfile(entry: SkillLockEntry): Promise<void> {
    const lockfile = await this.readLockfile();

    // 移除旧条目
    const existingIndex = lockfile.skills.findIndex((s) => s.slug === entry.slug);
    if (existingIndex !== -1) {
      lockfile.skills.splice(existingIndex, 1);
    }

    // 添加新条目
    lockfile.skills.push(entry);
    lockfile.updatedAt = new Date();

    await this.writeLockfile(lockfile);
  }

  /**
   * 计算文件校验和
   */
  private computeChecksum(files: Record<string, string>): string {
    const content = Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("\n");

    return crypto.createHash("sha256").update(content).digest("hex");
  }
}

/**
 * 创建 SkillInstaller 实例
 */
export function createSkillInstaller(options: Partial<SkillInstallerConfig> & { skillsDir: string }): SkillInstaller {
  return new SkillInstaller(options);
}
