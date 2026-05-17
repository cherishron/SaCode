/**
 * Bun 运行时检测
 */

const isBun = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";

export function isBunAvailable(): boolean {
  return isBun;
}

export function getBunVersion(): string | undefined {
  if (!isBun) return undefined;
  const bun = (globalThis as { Bun?: { version?: string } }).Bun;
  return bun?.version;
}

export function getInstallPrompt(): string {
  return [
    "Bun 运行时未检测到。SaCode CLI 需要 Bun 运行时。",
    "",
    "安装 Bun:",
    "  macOS/Linux: curl -fsSL https://bun.sh/install | bash",
    "  Windows:     powershell -c \"irm bun.sh/install.ps1 | iex\"",
    "  npm:         npm install -g bun",
    "",
    "安装后请重新运行 sacode 命令。",
  ].join("\n");
}
