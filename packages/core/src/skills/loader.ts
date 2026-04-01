import * as fs from "fs";
import * as path from "path";
import type {
  Skill,
  SkillLoadResult,
  SkillLoaderOptions,
  SkillDiscoveryEvent,
} from "./types";
import { SkillSchema, DEFAULT_SKILL_LOADER_OPTIONS } from "./types";

/**
 * Skills 加载器
 * 
 * 从文件系统加载和管理 Skills
 * 
 * @example
 * ```typescript
 * const loader = new SkillLoader({ skillsDir: ".saclaw/skills" });
 * const skills = await loader.discover();
 * const prompt = loader.assemblePrompt(["setup", "add-telegram"]);
 * ```
 */
export class SkillLoader {
  private options: SkillLoaderOptions;
  private skills: Map<string, SkillLoadResult> = new Map();
  private eventListeners: Map<string, ((event: SkillDiscoveryEvent) => void)[]> = new Map();

  constructor(options: Partial<SkillLoaderOptions> = {}) {
    this.options = { ...DEFAULT_SKILL_LOADER_OPTIONS, ...options };
  }

  /**
   * 加载单个 Skill
   */
  async load(skillPath: string): Promise<SkillLoadResult> {
    const skillFile = path.join(skillPath, this.options.skillFileName);
    const result: SkillLoadResult = {
      skill: {
        name: path.basename(skillPath),
        instructions: "",
        enabled: true,
        version: "1.0.0",
      },
      path: skillPath,
      loadedAt: new Date(),
    };

    try {
      if (!fs.existsSync(skillFile)) {
        throw new Error(`Skill file not found: ${skillFile}`);
      }

      const content = await fs.promises.readFile(skillFile, "utf-8");
      const parsed = this.parseSkillFile(content, path.basename(skillPath));
      result.skill = SkillSchema.parse(parsed);
      
      this.skills.set(result.skill.name, result);
      this.emit("loaded", result.skill.name, skillPath);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      this.emit("error", result.skill.name, skillPath, result.error);
    }

    return result;
  }

  /**
   * 发现并加载所有 Skills
   */
  async discover(): Promise<SkillLoadResult[]> {
    const results: SkillLoadResult[] = [];
    const skillsDir = this.resolveSkillsDir();

    if (!fs.existsSync(skillsDir)) {
      return results;
    }

    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(skillsDir, entry.name);
      const result = await this.load(skillPath);
      results.push(result);

      // 递归加载子目录
      if (this.options.recursive) {
        const subResults = await this.discoverSubSkills(skillPath);
        results.push(...subResults);
      }
    }

    return results;
  }

  /**
   * 递归加载子目录中的 Skills
   */
  private async discoverSubSkills(basePath: string): Promise<SkillLoadResult[]> {
    const results: SkillLoadResult[] = [];
    
    try {
      const entries = await fs.promises.readdir(basePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const skillFile = path.join(basePath, entry.name, this.options.skillFileName);
        if (fs.existsSync(skillFile)) {
          const result = await this.load(path.join(basePath, entry.name));
          results.push(result);
        }
        
        // 继续递归
        const subResults = await this.discoverSubSkills(path.join(basePath, entry.name));
        results.push(...subResults);
      }
    } catch {
      // 忽略读取错误
    }

    return results;
  }

  /**
   * 解析 Skill 文件
   * 
   * 支持格式：
   * - 纯 Markdown（整个文件作为 instructions）
   * - 带 YAML frontmatter 的 Markdown (ClawHub 兼容)
   */
  private parseSkillFile(content: string, defaultName: string): Skill {
    // 检查是否有 YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1] ?? "";
      const instructions = frontmatterMatch[2]?.trim() ?? "";

      // 解析 YAML frontmatter (简化的行解析)
      const parseField = (field: string): string | undefined => {
        const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
        return match?.[1]?.trim();
      };

      const parseArray = (field: string): string[] | undefined => {
        // 支持 [item1, item2] 格式
        const inlineMatch = frontmatter.match(new RegExp(`^${field}:\\s*\\[(.+)\\]$`, "m"));
        if (inlineMatch?.[1]) {
          return inlineMatch[1].split(",").map((t) => t.trim());
        }
        // 支持多行列表格式
        const listMatch = frontmatter.match(new RegExp(`^${field}:\\s*$`, "m"));
        if (listMatch) {
          const lines = frontmatter.split("\n");
          const startIndex = lines.findIndex((l) => l.match(new RegExp(`^${field}:`)));
          const items: string[] = [];
          for (let i = startIndex + 1; i < lines.length; i++) {
            const itemMatch = lines[i]?.match(/^\s*-\s*(.+)$/);
            if (itemMatch) {
              items.push(itemMatch[1]?.trim() ?? "");
            } else if (!lines[i]?.trim().startsWith("-") && lines[i]?.trim()) {
              break;
            }
          }
          return items.length > 0 ? items : undefined;
        }
        return undefined;
      };

      const tools = parseArray("tools");
      const tags = parseArray("tags");
      const dependencies = parseArray("dependencies");
      const envMatch = frontmatter.match(/env:\s*\n((?:\s+-\s+.+\n?)+)/);
      const configEnv = envMatch?.[1]
        ?.split("\n")
        .map((l) => l.match(/^\s*-\s*(.+)$/)?.[1]?.trim())
        .filter((s): s is string => !!s);

      return {
        name: parseField("name") ?? defaultName,
        slug: parseField("slug"),
        description: parseField("description"),
        instructions,
        tools,
        enabled: parseField("enabled") !== "false",
        version: parseField("version") ?? "1.0.0",
        tags,
        author: parseField("author"),
        homepage: parseField("homepage"),
        repository: parseField("repository"),
        dependencies,
        config: configEnv && configEnv.length > 0 ? { env: configEnv } : undefined,
      };
    }

    // 纯 Markdown 格式
    // 尝试从第一个标题提取名称
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const name = titleMatch?.[1]?.trim() ?? defaultName;
    
    // 移除标题行作为描述
    const instructions = titleMatch?.[0]
      ? content.replace(titleMatch[0], "").trim()
      : content.trim();

    return {
      name,
      instructions,
      enabled: true,
      version: "1.0.0",
    };
  }

  /**
   * 获取已加载的 Skill
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name)?.skill;
  }

  /**
   * 获取所有已加载的 Skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values())
      .map((r) => r.skill)
      .filter((s) => s.enabled);
  }

  /**
   * 将 Skills 组装成提示词
   * 
   * @param skillNames 要包含的 Skill 名称列表（为空则包含全部）
   * @param format 格式化模板
   */
  assemblePrompt(skillNames?: string[], format?: string): string {
    const skills = skillNames
      ? skillNames.map((name) => this.get(name)).filter((s): s is Skill => s !== undefined)
      : this.getAll();

    if (skills.length === 0) {
      return "";
    }

    const template = format ?? DEFAULT_SKILL_TEMPLATE;

    return skills
      .map((skill) => {
        let result = template
          .replace("{{name}}", skill.name)
          .replace("{{description}}", skill.description ?? "")
          .replace("{{instructions}}", skill.instructions);
        
        if (skill.tools && skill.tools.length > 0) {
          result = result.replace("{{tools}}", skill.tools.join(", "));
        } else {
          result = result.replace("{{tools}}", "无限制");
        }

        return result;
      })
      .join("\n\n");
  }

  /**
   * 重新加载所有 Skills
   */
  async reload(): Promise<SkillLoadResult[]> {
    this.skills.clear();
    return this.discover();
  }

  /**
   * 移除 Skill
   */
  remove(name: string): boolean {
    const result = this.skills.get(name);
    if (result) {
      this.skills.delete(name);
      this.emit("removed", name, result.path);
      return true;
    }
    return false;
  }

  /**
   * 解析 Skills 目录路径
   */
  private resolveSkillsDir(): string {
    if (path.isAbsolute(this.options.skillsDir)) {
      return this.options.skillsDir;
    }
    return path.resolve(process.cwd(), this.options.skillsDir);
  }

  /**
   * 注册事件监听器
   */
  on(event: string, listener: (event: SkillDiscoveryEvent) => void): void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  /**
   * 触发事件
   */
  private emit(type: SkillDiscoveryEvent["type"], skillName: string, path: string, error?: string): void {
    const event: SkillDiscoveryEvent = {
      type,
      skillName,
      path,
      timestamp: new Date(),
    };

    if (error !== undefined) {
      event.error = error;
    }

    const listeners = this.eventListeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }
}

/**
 * 默认 Skill 提示词模板
 */
const DEFAULT_SKILL_TEMPLATE = `## Skill: {{name}}

{{#if description}}
**描述**: {{description}}
{{/if}}

### 使用指南

{{instructions}}

### 可用工具

{{tools}}
`;

/**
 * 创建 Skill 加载器实例
 */
export function createSkillLoader(options?: Partial<SkillLoaderOptions>): SkillLoader {
  return new SkillLoader(options);
}
