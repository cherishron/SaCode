import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCliToolRegistryAdapter } from "./capabilities";
import { ensureProviderStore, providerConfigFromStore } from "./provider-store";
import { collectWorkspaceContext, type WorkspaceContextSummary } from "./workspace-context";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  details?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  provider: {
    type: string;
    model: string;
    baseUrl?: string;
    apiKeyPresent: boolean;
    apiKeyEnv: string;
  };
  workspace: WorkspaceContextSummary;
}

export function formatDoctorReport(report: DoctorReport): string {
  return [
    "SaCode Doctor",
    "",
    "Provider",
    `- Type: ${report.provider.type}`,
    `- Model: ${report.provider.model}`,
    ...(report.provider.baseUrl ? [`- Base URL: ${report.provider.baseUrl}`] : []),
    `- API key: ${report.provider.apiKeyPresent ? `${report.provider.apiKeyEnv} is set` : `${report.provider.apiKeyEnv} is missing`}`,
    "",
    "Workspace",
    `- CWD: ${report.workspace.cwd}`,
    ...(report.workspace.projectName ? [`- Project: ${report.workspace.projectName}`] : []),
    ...(report.workspace.packageManager ? [`- Package manager: ${report.workspace.packageManager}`] : []),
    ...(report.workspace.git ? [`- Git: ${report.workspace.git.branch ?? "unknown"} (${report.workspace.git.changedFiles} changed, ${report.workspace.git.untrackedFiles} untracked)`] : []),
    "",
    "Checks",
    ...report.checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.message}${check.details ? `\n  ${check.details}` : ""}`),
    "",
    report.ok ? "Doctor passed" : "Doctor found blocking issues",
  ].join("\n");
}

export async function runDoctor(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<DoctorReport> {
  const provider = await getProviderDiagnostics(env);
  const workspace = await collectWorkspaceContext(cwd);
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion(process.version));
  checks.push(checkProviderKey(provider.apiKeyPresent, provider.apiKeyEnv));
  checks.push(checkWorkspace(workspace));
  checks.push(await checkGit(cwd));
  checks.push(await checkToolRegistry(cwd));

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    provider,
    workspace,
  };
}

export async function getProviderDiagnostics(env: NodeJS.ProcessEnv = process.env): Promise<DoctorReport["provider"]> {
  if (env.AI_PROVIDER) return getProviderDiagnosticsFromEnv(env);

  const store = await ensureProviderStore();
  const storeConfig = providerConfigFromStore(store, env);
  if (storeConfig) {
    const provider = store.providers.find((item) => `${item.id}/${storeConfig.model}` === store.defaultModel);
    const apiKeyEnv = provider?.apiKeyEnv ?? `${storeConfig.type.toUpperCase()}_API_KEY`;
    return {
      type: storeConfig.type,
      model: storeConfig.model,
      ...(storeConfig.baseUrl && { baseUrl: storeConfig.baseUrl }),
      apiKeyPresent: Boolean(storeConfig.apiKey),
      apiKeyEnv,
    };
  }

  return getProviderDiagnosticsFromEnv(env);
}

function getProviderDiagnosticsFromEnv(env: NodeJS.ProcessEnv = process.env): DoctorReport["provider"] {
  const type = env.AI_PROVIDER || "openai";
  const upperType = type.toUpperCase();
  const apiKeyEnv = `${upperType}_API_KEY`;
  const modelEnv = `${upperType}_MODEL`;
  const baseUrlEnv = `${upperType}_BASE_URL`;

  return {
    type,
    model: env[modelEnv] || defaultModelFor(type),
    ...(env[baseUrlEnv] && { baseUrl: env[baseUrlEnv] }),
    apiKeyPresent: Boolean(env[apiKeyEnv]),
    apiKeyEnv,
  };
}

function checkNodeVersion(version: string): DoctorCheck {
  const major = Number(version.replace(/^v/, "").split(".")[0] ?? 0);
  if (major >= 22) {
    return { name: "Node.js", status: "pass", message: `${version} is supported` };
  }

  return {
    name: "Node.js",
    status: "fail",
    message: `${version} is not supported`,
    details: "SaCode requires Node.js >= 22.0.0",
  };
}

function checkProviderKey(apiKeyPresent: boolean, apiKeyEnv: string): DoctorCheck {
  if (apiKeyPresent) {
    return { name: "Provider API key", status: "pass", message: `${apiKeyEnv} is set` };
  }

  return {
    name: "Provider API key",
    status: "fail",
    message: `${apiKeyEnv} is not set`,
    details: `Run "sacode config init" to create user-level provider configuration, then export ${apiKeyEnv}. The value is never printed by doctor.`,
  };
}

function checkWorkspace(workspace: WorkspaceContextSummary): DoctorCheck {
  if (workspace.configFiles.includes("package.json")) {
    return { name: "Workspace", status: "pass", message: workspace.projectName ? `Detected ${workspace.projectName}` : "package.json found" };
  }

  return {
    name: "Workspace",
    status: "warn",
    message: "No package.json found in current directory",
    details: "SaCode can still run, but coding context will be limited.",
  };
}

async function checkGit(cwd: string): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: 5000 });
    if (stdout.trim() === "true") {
      return { name: "Git", status: "pass", message: "Inside a git worktree" };
    }
  } catch {
    return { name: "Git", status: "warn", message: "Not inside a git worktree" };
  }

  return { name: "Git", status: "warn", message: "Git worktree status unknown" };
}

async function checkToolRegistry(cwd: string): Promise<DoctorCheck> {
  const { capabilities, registry } = createCliToolRegistryAdapter(cwd);
  try {
    const tools = registry.list();
    if (tools.length > 0) {
      return { name: "Tools", status: "pass", message: `${tools.length} tools available` };
    }
    return { name: "Tools", status: "fail", message: "No tools available" };
  } finally {
    await capabilities.shutdown();
  }
}

function defaultModelFor(type: string): string {
  switch (type) {
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "deepseek":
      return "deepseek-chat";
    case "moonshot":
      return "moonshot-v1-8k";
    case "zhipu":
      return "glm-4-plus";
    case "openai":
    default:
      return "gpt-4o";
  }
}
