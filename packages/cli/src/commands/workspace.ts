import chalk from "chalk";
import inquirer from "enquirer";
import fs from "fs/promises";
import path from "path";

interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  files: string[];
}

const defaultWorkspacePath = process.env.SACODE_WORKSPACE || path.join(process.env.HOME || "", ".SACODE", "workspace");

const templates: WorkspaceTemplate[] = [
  {
    id: "default",
    name: "Default",
    description: "Default workspace with basic configuration",
    files: ["SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
  },
  {
    id: "developer",
    name: "Developer",
    description: "Workspace optimized for software development",
    files: ["SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md", "MEMORY.md", "PROJECT.md"],
  },
  {
    id: "assistant",
    name: "Personal Assistant",
    description: "Workspace optimized for personal assistance tasks",
    files: ["SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md", "MEMORY.md", "CALENDAR.md"],
  },
];

/**
 * 初始化工作空间
 */
export async function initWorkspace(templateId?: string): Promise<void> {
  const workspacePath = defaultWorkspacePath;

  // 检查工作空间是否已存在
  try {
    await fs.access(workspacePath);
    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: chalk.yellow("Workspace already exists. Overwrite?"),
        default: false,
      },
    ]);
    if (!answers.overwrite) {
      console.log(chalk.gray("Operation cancelled"));
      return;
    }
  } catch {
    // 工作空间不存在，继续创建
  }

  // 选择模板
  let selectedTemplate = templateId ? templates.find((t) => t.id === templateId) : undefined;

  if (!selectedTemplate) {
    console.log(chalk.cyan("📁 Available Templates\n"));
    for (const t of templates) {
      console.log(`  ${chalk.bold(t.id.padEnd(15))} ${t.name}`);
      console.log(`      ${chalk.gray(t.description)}`);
    }
    console.log();

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "template",
        message: "Select a template:",
        choices: templates.map((t) => ({ name: t.name, value: t.id })),
        default: "default",
      },
    ]);

    selectedTemplate = templates.find((t) => t.id === answers.template);
  }

  if (!selectedTemplate) {
    console.log(chalk.red("Invalid template"));
    return;
  }

  console.log(chalk.cyan(`\n📂 Creating workspace from template: ${selectedTemplate.name}\n`));

  // 创建工作空间目录
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(path.join(workspacePath, ".SACODE"), { recursive: true });

  // 创建模板文件
  for (const file of selectedTemplate.files) {
    const filePath = path.join(workspacePath, file);
    await fs.writeFile(filePath, getTemplateContent(file), "utf-8");
    console.log(chalk.gray(`  Created: ${file}`));
  }

  // 创建配置文件
  const configPath = path.join(workspacePath, ".SACODE", "settings.json");
  const config = {
    template: selectedTemplate.id,
    language: "zh-CN",
    defaultModel: "minimax-m2.5",
    thinking: false,
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(chalk.gray(`  Created: .SACODE/settings.json`));

  console.log(chalk.green("\n✓ Workspace initialized"));
  console.log(chalk.gray(`  Location: ${workspacePath}`));
}

/**
 * 显示工作空间信息
 */
export async function showWorkspace(): Promise<void> {
  const workspacePath = defaultWorkspacePath;

  console.log(chalk.cyan("📁 Workspace\n"));

  console.log(`  ${chalk.gray("Path:")} ${workspacePath}`);

  // 检查是否存在
  try {
    await fs.access(workspacePath);
  } catch {
    console.log(chalk.yellow("\n⚠️  Workspace not initialized"));
    console.log(chalk.gray("  Run 'SACODE workspace init' to create one"));
    return;
  }

  // 读取配置
  const configPath = path.join(workspacePath, ".SACODE", "settings.json");
  try {
    const configData = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configData);
    console.log(`  ${chalk.gray("Template:")} ${config.template || "default"}`);
    console.log(`  ${chalk.gray("Language:")} ${config.language || "zh-CN"}`);
    console.log(`  ${chalk.gray("Default Model:")} ${config.defaultModel || "minimax-m2.5"}`);
  } catch {
    console.log(chalk.yellow("\n⚠️  No configuration found"));
  }

  // 列出文件
  console.log(chalk.gray("\n  Files:"));
  const files = await fs.readdir(workspacePath, { withFileTypes: true });
  for (const file of files) {
    if (!file.name.startsWith(".")) {
      const icon = file.isDirectory() ? "📁" : "📄";
      console.log(`    ${icon} ${file.name}`);
    }
  }
}

/**
 * 列出所有模板
 */
export async function listTemplates(): Promise<void> {
  console.log(chalk.cyan("📋 Workspace Templates\n"));

  for (const t of templates) {
    console.log(`  ${chalk.bold(t.name)} (${t.id})`);
    console.log(`      ${chalk.gray(t.description)}`);
    console.log(`      ${chalk.gray("Files:")} ${t.files.join(", ")}`);
    console.log();
  }
}

/**
 * 编辑工作空间文件
 */
export async function editFile(filename: string): Promise<void> {
  const workspacePath = defaultWorkspacePath;
  const filePath = path.join(workspacePath, filename);

  try {
    await fs.access(filePath);
  } catch {
    console.log(chalk.red(`File not found: ${filename}`));
    return;
  }

  // 使用系统默认编辑器打开
  const { exec } = await import("child_process");
  const isWindows = process.platform === "win32";

  if (isWindows) {
    exec(`notepad "${filePath}"`);
  } else {
    exec(`${process.env.EDITOR || "vi"} "${filePath}"`);
  }
}

// 辅助函数

function getTemplateContent(filename: string): string {
  const templates: Record<string, string> = {
    "SOUL.md": `# SOUL.md - AI 核心人格

你是 SACODE，一个基于 iFlow SDK 的 AI 助手。

## 核心特质
- 友善、专业、乐于助人
- 保持简洁直接的沟通风格
- 主动帮助用户解决问题

## 行为准则
- 尊重用户隐私
- 诚实透明
- 持续学习改进
`,

    "USER.md": `# USER.md - 用户信息

## 基本信息
- 用户名: [待填写]
- 偏好: [待填写]

## 常用操作
- [ ] 添加常用操作说明
`,

    "AGENTS.md": `# AGENTS.md - 工作空间行为指南

## 交互规则
- 使用中文交流
- 保持友好和专业
- 及时响应用户需求

## 任务处理
- 理解用户意图后再执行
- 复杂任务先确认再执行
- 及时汇报进度
`,

    "TOOLS.md": `# TOOLS.md - 工具策略

## 可用工具
- 文件操作 (read_file, write_file, list_directory)
- 搜索 (search_file_content, web_search)
- 命令执行 (execute_command)
- 浏览器控制 (browser_navigate, browser_click)

## 使用原则
- 安全第一，不执行危险命令
- 确认后再执行不可逆操作
- 保护用户隐私数据
`,

    "MEMORY.md": `# MEMORY.md - 长期记忆

## 重要信息
- [在此记录重要的用户信息、偏好、习惯]

## 决策记录
- [记录重要的决策和原因]

## 学习总结
- [记录从交互中学到的经验]
`,

    "PROJECT.md": `# PROJECT.md - 项目信息

## 当前项目
- 项目名称: [待填写]
- 技术栈: [待填写]
- 代码位置: [待填写]

## 开发规范
- [添加项目特定的开发规范]
`,

    "CALENDAR.md": `# CALENDAR.md - 日历/提醒

## 定期任务
- [添加需要定期执行的任务]

## 重要日期
- [记录重要的日期和事件]
`,
  };

  return templates[filename] || `# ${filename}\n\n在此添加内容\n`;
}
