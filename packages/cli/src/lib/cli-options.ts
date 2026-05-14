import path from "node:path";

export interface RootChatOptions {
  print?: boolean;
  json?: boolean;
  streamJson?: boolean;
}

export interface NormalizedRootChatOptions {
  message: string;
  print: boolean;
  json?: boolean;
  streamJson?: boolean;
}

export function normalizeRootPrompt(
  promptParts: string[],
  options: RootChatOptions
): NormalizedRootChatOptions | null {
  const message = promptParts.join(" ").trim();
  if (!message) return null;

  return {
    message,
    print: options.print ?? true,
    json: options.json,
    streamJson: options.streamJson,
  };
}

export function parseToolParams(params: string[] | undefined, cwd = process.cwd()): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const param of params ?? []) {
    const [key, ...valueParts] = param.split("=");
    if (!key) continue;

    const value = valueParts.join("=");
    parsed[key] = key === "path" || key === "cwd"
      ? normalizeWorkspacePath(value, cwd)
      : parseParamValue(value);
  }
  return parsed;
}

function normalizeWorkspacePath(value: string, cwd: string): string {
  if (!value || value.startsWith("/")) return value;
  return path.resolve(cwd, value);
}

function parseParamValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
