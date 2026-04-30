/**
 * 依赖完整性检查
 */

export interface DependencyCheckResult {
  available: boolean;
  missing: string[];
  message?: string;
}

export async function checkCoreDependency(): Promise<DependencyCheckResult> {
  const missing: string[] = [];

  try {
    await import("@sacode/core");
  } catch {
    missing.push("@sacode/core");
  }

  if (missing.length > 0) {
    return {
      available: false,
      missing,
      message: `缺少核心依赖: ${missing.join(", ")}。请运行 'bun install' 安装依赖。`,
    };
  }

  return { available: true, missing: [] };
}

export function getMissingDependenciesMessage(missing: string[]): string {
  return [
    "SaCode CLI 缺少必要依赖:",
    ...missing.map((dep) => `  - ${dep}`),
    "",
    "请运行以下命令安装依赖:",
    "  bun install",
    "",
    "如果问题仍然存在，请尝试:",
    "  bun install --force",
  ].join("\n");
}
