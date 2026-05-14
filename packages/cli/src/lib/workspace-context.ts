import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CONFIG_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "AGENTS.md",
  "README.md",
];

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

export interface WorkspaceContextSummary {
  cwd: string;
  projectName?: string;
  packageManager?: string;
  scripts: string[];
  workspacePackages: string[];
  configFiles: string[];
  topLevelEntries: string[];
  git?: {
    branch?: string;
    changedFiles: number;
    untrackedFiles: number;
  };
}

export async function collectWorkspaceContext(cwd = process.cwd()): Promise<WorkspaceContextSummary> {
  const [packageInfo, configFiles, topLevelEntries, git] = await Promise.all([
    readPackageInfo(cwd),
    listExistingConfigFiles(cwd),
    listTopLevelEntries(cwd),
    readGitInfo(cwd),
  ]);

  return {
    cwd,
    ...packageInfo,
    configFiles,
    topLevelEntries,
    ...(git && { git }),
  };
}

export function formatWorkspaceContext(summary: WorkspaceContextSummary): string {
  const lines = [
    "上下文概览:",
    `- 工作目录: ${summary.cwd}`,
  ];

  if (summary.projectName) lines.push(`- 项目名称: ${summary.projectName}`);
  if (summary.packageManager) lines.push(`- 包管理器: ${summary.packageManager}`);
  if (summary.git) {
    lines.push(`- Git 分支: ${summary.git.branch ?? "unknown"}`);
    lines.push(`- Git 改动: ${summary.git.changedFiles} changed, ${summary.git.untrackedFiles} untracked`);
  }
  if (summary.scripts.length > 0) lines.push(`- 常用脚本: ${summary.scripts.join(", ")}`);
  if (summary.workspacePackages.length > 0) lines.push(`- Workspace 包: ${summary.workspacePackages.slice(0, 8).join(", ")}${summary.workspacePackages.length > 8 ? " ..." : ""}`);
  if (summary.configFiles.length > 0) lines.push(`- 关键文件: ${summary.configFiles.join(", ")}`);
  if (summary.topLevelEntries.length > 0) lines.push(`- 顶层结构: ${summary.topLevelEntries.join(", ")}`);

  return lines.join("\n");
}

export function workspaceContextToPrompt(summary: WorkspaceContextSummary): string {
  return [
    "Current workspace context:",
    `- cwd: ${summary.cwd}`,
    summary.projectName ? `- project: ${summary.projectName}` : undefined,
    summary.packageManager ? `- packageManager: ${summary.packageManager}` : undefined,
    summary.git ? `- git: branch=${summary.git.branch ?? "unknown"}, changed=${summary.git.changedFiles}, untracked=${summary.git.untrackedFiles}` : undefined,
    summary.scripts.length > 0 ? `- scripts: ${summary.scripts.join(", ")}` : undefined,
    summary.workspacePackages.length > 0 ? `- workspacePackages: ${summary.workspacePackages.slice(0, 12).join(", ")}` : undefined,
    summary.configFiles.length > 0 ? `- configFiles: ${summary.configFiles.join(", ")}` : undefined,
  ].filter(Boolean).join("\n");
}

async function readPackageInfo(cwd: string): Promise<Pick<WorkspaceContextSummary, "projectName" | "packageManager" | "scripts" | "workspacePackages">> {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf-8"));
    const scripts = Object.keys(packageJson.scripts ?? {}).slice(0, 12);
    const workspacePackages = await readWorkspacePackages(cwd);

    return {
      projectName: typeof packageJson.name === "string" ? packageJson.name : undefined,
      packageManager: detectPackageManager(packageJson.packageManager),
      scripts,
      workspacePackages,
    };
  } catch {
    return { scripts: [], workspacePackages: [] };
  }
}

async function readWorkspacePackages(cwd: string): Promise<string[]> {
  const packagesDir = path.join(cwd, "packages");
  try {
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`).slice(0, 20);
  } catch {
    return [];
  }
}

function detectPackageManager(packageManager: unknown): string | undefined {
  if (typeof packageManager === "string") return packageManager;
  return undefined;
}

async function listExistingConfigFiles(cwd: string): Promise<string[]> {
  const results = await Promise.all(CONFIG_FILES.map(async (file) => {
    try {
      await fs.access(path.join(cwd, file));
      return file;
    } catch {
      return undefined;
    }
  }));
  return results.filter((file): file is string => Boolean(file));
}

async function listTopLevelEntries(cwd: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    return entries
      .filter((entry) => !IGNORED_DIRS.has(entry.name))
      .slice(0, 16)
      .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name);
  } catch {
    return [];
  }
}

async function readGitInfo(cwd: string): Promise<WorkspaceContextSummary["git"] | undefined> {
  try {
    const [{ stdout: branchOutput }, { stdout: statusOutput }] = await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], { cwd, timeout: 5000 }),
      execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 5000 }),
    ]);
    const lines = statusOutput.split("\n").filter(Boolean);
    return {
      branch: branchOutput.trim() || undefined,
      changedFiles: lines.filter((line) => !line.startsWith("??")).length,
      untrackedFiles: lines.filter((line) => line.startsWith("??")).length,
    };
  } catch {
    return undefined;
  }
}
