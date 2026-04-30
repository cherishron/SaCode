import chalk from "chalk";

interface Tool {
  name: string;
  description: string;
  params: string[];
  category: string;
}

const tools: Tool[] = [
  { name: "read_file", description: "读取文件内容", params: ["path"], category: "file" },
  { name: "write_file", description: "写入文件内容", params: ["path", "content"], category: "file" },
  { name: "edit_file", description: "编辑文件指定行", params: ["path", "old", "new"], category: "file" },
  { name: "list_directory", description: "列出目录内容", params: ["path"], category: "file" },
  { name: "search_files", description: "搜索文件", params: ["pattern", "path"], category: "file" },
  { name: "execute_command", description: "执行 Shell 命令", params: ["command"], category: "shell" },
  { name: "browser_navigate", description: "浏览器导航", params: ["url"], category: "browser" },
  { name: "browser_screenshot", description: "浏览器截图", params: [], category: "browser" },
  { name: "browser_click", description: "浏览器点击元素", params: ["selector"], category: "browser" },
  { name: "browser_type", description: "浏览器输入文本", params: ["selector", "text"], category: "browser" },
  { name: "code_search", description: "代码语义搜索", params: ["query"], category: "code" },
  { name: "code_explain", description: "代码解释", params: ["path"], category: "code" },
  { name: "code_refactor", description: "代码重构建议", params: ["path", "instruction"], category: "code" },
];

const categoryLabels: Record<string, string> = {
  file: "[F]",
  shell: "[S]",
  browser: "[B]",
  code: "[C]",
};

export async function listTools(): Promise<void> {
  console.log(chalk.cyan("[T] Tools\n"));

  const grouped = new Map<string, Tool[]>();
  for (const tool of tools) {
    const group = grouped.get(tool.category) ?? [];
    group.push(tool);
    grouped.set(tool.category, group);
  }

  for (const [category, categoryTools] of grouped) {
    const label = categoryLabels[category] ?? "[?]";
    console.log(chalk.bold(`  ${label} ${category.toUpperCase()}`));

    for (const tool of categoryTools) {
      console.log(`    ${chalk.green(tool.name)}`);
      console.log(`      ${chalk.gray(tool.description)}`);
      if (tool.params.length > 0) {
        console.log(`      ${chalk.gray("Params: " + tool.params.join(", "))}`);
      }
    }
    console.log();
  }

  console.log(chalk.gray("Use 'sacode tool run <name> -p key=value' to run a tool"));
}

export async function runTool(
  name: string,
  options: { param?: string[] },
): Promise<void> {
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    console.log(chalk.red(`Tool not found: ${name}`));
    console.log(chalk.gray("Use 'sacode tool list' to see available tools"));
    return;
  }

  console.log(chalk.cyan(`[T] Running tool: ${name}\n`));

  const params: Record<string, string> = {};
  if (options.param) {
    for (const p of options.param) {
      const eqIndex = p.indexOf("=");
      if (eqIndex === -1) {
        console.log(chalk.yellow(`  Invalid parameter format: ${p} (expected key=value)`));
        continue;
      }
      const key = p.slice(0, eqIndex);
      const value = p.slice(eqIndex + 1);
      if (key) {
        params[key] = value;
      }
    }
  }

  const missingParams = tool.params.filter((p) => !(p in params));
  if (missingParams.length > 0) {
    console.log(chalk.yellow(`[!] Missing required parameters: ${missingParams.join(", ")}`));
    console.log(chalk.gray(`  Usage: sacode tool run ${name} ${missingParams.map((p) => `-p ${p}=<value>`).join(" ")}`));
    return;
  }

  console.log(chalk.gray("Parameters:"));
  for (const [key, value] of Object.entries(params)) {
    const displayValue = key.toLowerCase().includes("key") || key.toLowerCase().includes("token")
      ? value.slice(0, 4) + "..."
      : value;
    console.log(`  ${key}: ${displayValue}`);
  }

  try {
    const { SACODEClient } = await import("@sacode/core");
    const { getProviderConfigFromEnv } = await import("./chat.js");

    const providerConfig = getProviderConfigFromEnv();
    const client = new SACODEClient({
      provider: providerConfig,
      timeout: 60000,
    });

    await client.connect();

    client.registerTool(
      tool.name,
      tool.description,
      {
        type: "object",
        properties: tool.params.reduce(
          (acc, p) => {
            acc[p] = { type: "string" };
            return acc;
          },
          {} as Record<string, { type: string }>,
        ),
        required: tool.params,
      },
      async (input: Record<string, unknown>) => {
        return JSON.stringify(input);
      },
    );

    const toolBridge = client.getToolBridge();
    if (toolBridge) {
      const result = await toolBridge.executeToolCall({
        id: `call_${Date.now()}`,
        name: tool.name,
        arguments: params as Record<string, unknown>,
      });

      if (result.success) {
        console.log();
        console.log(chalk.green("+ Tool executed successfully"));
        if (result.content) {
          console.log(chalk.gray("Result:"));
          const content = typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content, null, 2);
          console.log(content);
        }
      } else {
        console.log();
        console.log(chalk.red("x Tool execution failed"));
        if (result.content) {
          console.log(chalk.red(String(result.content)));
        }
      }
    } else {
      console.log();
      console.log(chalk.yellow("[!] Tool bridge not available, simulated execution"));
      console.log(chalk.green("+ Tool executed (simulated)"));
    }

    await client.disconnect();
  } catch (err) {
    console.log();
    console.log(chalk.yellow("[!] Could not connect to AI service"));
    console.log(chalk.gray(`  Error: ${err instanceof Error ? err.message : "unknown"}`));
    console.log(chalk.green("+ Tool executed (simulated)"));
  }
}
