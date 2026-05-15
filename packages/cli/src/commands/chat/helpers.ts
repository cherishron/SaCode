import { spawnSync } from "child_process";
import * as nodeFs from "fs";
import * as nodePath from "path";

export function detectProjectType(cwd: string, pkg: Record<string, unknown>): string {
  const name = (pkg.name as string) || "";
  const desc = (pkg.description as string) || "";

  if (pkg.workspaces || nodeFs.existsSync(nodePath.join(cwd, "pnpm-workspace.yaml"))) return "Monorepo 项目";
  if (pkg.bin || desc.includes("CLI") || desc.includes("cli") || name.includes("cli")) return "CLI 工具";
  if (pkg.main || pkg.module || pkg.exports) return "库/SDK";

  const deps = (pkg.dependencies as Record<string, string>) || {};
  if (deps.react || deps.vue || deps.angular || deps.svelte) return "Web 应用";
  if (deps.express || deps.koa || deps.fastify || deps.hono) return "API 服务";

  return "项目";
}

export function detectTechStack(cwd: string, pkg: Record<string, unknown>): string[] {
  const tech: string[] = [];
  const deps = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };

  if (nodeFs.existsSync(nodePath.join(cwd, "bun.lockb"))) tech.push("**运行时**: Bun");
  else if (nodeFs.existsSync(nodePath.join(cwd, "yarn.lock"))) tech.push("**包管理**: Yarn");
  else if (nodeFs.existsSync(nodePath.join(cwd, "pnpm-lock.yaml"))) tech.push("**包管理**: pnpm");
  else tech.push("**包管理**: npm");

  if (nodeFs.existsSync(nodePath.join(cwd, "tsconfig.json"))) tech.push("**语言**: TypeScript");
  else tech.push("**语言**: JavaScript");

  if (deps.react) tech.push(`**前端**: React ${deps.react}`);
  if (deps.vue) tech.push(`**前端**: Vue ${deps.vue}`);
  if (deps["@angular/core"]) tech.push(`**前端**: Angular ${deps["@angular/core"]}`);
  if (deps.express) tech.push(`**HTTP**: Express ${deps.express}`);
  if (deps.hono) tech.push(`**HTTP**: Hono ${deps.hono}`);
  if (deps.fastify) tech.push(`**HTTP**: Fastify ${deps.fastify}`);
  if (deps.vitest) tech.push(`**测试**: Vitest ${deps.vitest}`);
  if (deps.jest) tech.push(`**测试**: Jest ${deps.jest}`);
  if (deps.mocha) tech.push(`**测试**: Mocha ${deps.mocha}`);
  if (deps.vite) tech.push(`**构建**: Vite ${deps.vite}`);
  if (deps.webpack) tech.push(`**构建**: Webpack ${deps.webpack}`);
  if (deps.esbuild) tech.push(`**构建**: esbuild ${deps.esbuild}`);
  if (deps.tsup) tech.push(`**构建**: tsup ${deps.tsup}`);
  if (deps["@prisma/client"]) tech.push("**ORM**: Prisma");
  if (deps.drizzle) tech.push("**ORM**: Drizzle");
  if (deps.typeorm) tech.push("**ORM**: TypeORM");

  return tech;
}

export function analyzeDirectory(dirPath: string, depth: number, maxDepth: number): string {
  if (depth >= maxDepth) return "";

  const ignore = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", "__pycache__"]);
  const lines: string[] = [];

  try {
    const entries = nodeFs.readdirSync(dirPath, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (ignore.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".github") continue;

      const indent = "  ".repeat(depth);
      const fullPath = nodePath.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`);
        const subTree = analyzeDirectory(fullPath, depth + 1, maxDepth);
        if (subTree) lines.push(subTree);
      } else if (depth === 0) {
        lines.push(`${indent}${entry.name}`);
      }
    }
  } catch {
    return lines.join("\n");
  }

  return lines.join("\n");
}

export function categorizeDependencies(deps: Record<string, string>): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    "AI/LLM": [],
    "Web 框架": [],
    "数据库": [],
    "认证": [],
    "测试": [],
    "构建工具": [],
    "UI 组件": [],
    "工具库": [],
  };

  for (const [name, version] of Object.entries(deps)) {
    const entry = `${name} ${version}`;

    if (name.includes("openai") || name.includes("anthropic") || name.includes("llm") || name.includes("ai")) categories["AI/LLM"]!.push(entry);
    else if (name.includes("express") || name.includes("koa") || name.includes("fastify") || name.includes("hono")) categories["Web 框架"]!.push(entry);
    else if (name.includes("prisma") || name.includes("drizzle") || name.includes("typeorm") || name.includes("mongoose") || name.includes("knex")) categories["数据库"]!.push(entry);
    else if (name.includes("passport") || name.includes("auth") || name.includes("jwt") || name.includes("oauth")) categories["认证"]!.push(entry);
    else if (name.includes("vitest") || name.includes("jest") || name.includes("mocha") || name.includes("chai") || name.includes("testing")) categories["测试"]!.push(entry);
    else if (name.includes("vite") || name.includes("webpack") || name.includes("esbuild") || name.includes("rollup") || name.includes("tsup")) categories["构建工具"]!.push(entry);
    else if (name.includes("react") || name.includes("vue") || name.includes("angular") || name.includes("svelte") || name.includes("ink")) categories["UI 组件"]!.push(entry);
    else categories["工具库"]!.push(entry);
  }

  return categories;
}

export function detectConfigFiles(cwd: string): string[] {
  const configs: string[] = [];
  const configFiles = [
    { file: "tsconfig.json", desc: "TypeScript 配置" },
    { file: ".eslintrc.js", desc: "ESLint 配置" },
    { file: ".eslintrc.json", desc: "ESLint 配置" },
    { file: "eslint.config.js", desc: "ESLint 配置" },
    { file: ".prettierrc", desc: "Prettier 配置" },
    { file: "prettier.config.js", desc: "Prettier 配置" },
    { file: "vite.config.ts", desc: "Vite 配置" },
    { file: "vitest.config.ts", desc: "Vitest 配置" },
    { file: ".env.example", desc: "环境变量示例" },
    { file: "Dockerfile", desc: "Docker 配置" },
    { file: "docker-compose.yml", desc: "Docker Compose" },
    { file: ".github/workflows", desc: "GitHub Actions" },
    { file: "pnpm-workspace.yaml", desc: "pnpm 工作区" },
  ];

  for (const { file, desc } of configFiles) {
    if (nodeFs.existsSync(nodePath.join(cwd, file))) configs.push(`**${file}** — ${desc}`);
  }

  return configs;
}

export function detectConventions(cwd: string, pkg: Record<string, unknown>): string[] {
  const conventions: string[] = [];

  if (nodeFs.existsSync(nodePath.join(cwd, "tsconfig.json"))) {
    try {
      const tsconfig = JSON.parse(nodeFs.readFileSync(nodePath.join(cwd, "tsconfig.json"), "utf-8"));
      if (tsconfig.compilerOptions?.strict) conventions.push("TypeScript 严格模式");
    } catch {
      // ignore invalid tsconfig
    }
  }

  if (nodeFs.existsSync(nodePath.join(cwd, ".eslintrc.js")) || nodeFs.existsSync(nodePath.join(cwd, "eslint.config.js"))) conventions.push("遵循 ESLint 规范");
  if (nodeFs.existsSync(nodePath.join(cwd, ".prettierrc")) || nodeFs.existsSync(nodePath.join(cwd, "prettier.config.js"))) conventions.push("使用 Prettier 格式化");

  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  if (devDeps.husky) conventions.push("使用 Husky 管理 Git Hooks");
  if (devDeps["lint-staged"]) conventions.push("提交前自动 lint (lint-staged)");
  if (devDeps.vitest || devDeps.jest) conventions.push("编写单元测试");

  return conventions;
}

export function getGitBranch(cwd: string): string | undefined {
  try {
    const result = spawnSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}
