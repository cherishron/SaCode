import chalk from "chalk";

interface Tool {
  name: string;
  description: string;
  params: string[];
}

const tools: Tool[] = [
  { name: "read_file", description: "读取文件内容", params: ["path"] },
  { name: "write_file", description: "写入文件内容", params: ["path", "content"] },
  { name: "list_directory", description: "列出目录内容", params: ["path"] },
  { name: "search_files", description: "搜索文件", params: ["pattern", "path"] },
  { name: "execute_command", description: "执行命令", params: ["command"] },
  { name: "browser_navigate", description: "浏览器导航", params: ["url"] },
  { name: "browser_screenshot", description: "浏览器截图", params: [] },
];

export async function listTools(): Promise<void> {
  console.log(chalk.cyan("🔧 Tools\n"));

  for (const tool of tools) {
    console.log(`  ${chalk.green(tool.name)}`);
    console.log(`    ${chalk.gray(tool.description)}`);
    if (tool.params.length > 0) {
      console.log(`    ${chalk.gray("Params: " + tool.params.join(", "))}`);
    }
  }

  console.log();
  console.log(chalk.gray("Use 'saclaw tool run <name> -p key=value' to run a tool"));
}

export async function runTool(
  name: string,
  options: { param?: string[] }
): Promise<void> {
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    console.log(chalk.red(`Tool not found: ${name}`));
    return;
  }

  console.log(chalk.cyan(`🔧 Running tool: ${name}\n`));

  // 解析参数
  const params: Record<string, string> = {};
  if (options.param) {
    for (const p of options.param) {
      const parts = p.split("=");
      const key = parts[0];
      if (key) {
        params[key] = parts.slice(1).join("=");
      }
    }
  }

  console.log(chalk.gray("Parameters:"));
  for (const [key, value] of Object.entries(params)) {
    console.log(`  ${key}: ${value}`);
  }

  // TODO: 实际工具执行逻辑
  console.log();
  console.log(chalk.green("✓ Tool executed (simulated)"));
}
