/**
 * CLI UI 渲染组件
 * 
 * 提供 Claude Code 风格的终端渲染
 */

import chalk from "chalk";
import hljs from "highlight.js";

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  name: string;
  status: "running" | "success" | "error";
  args?: Record<string, unknown>;
  result?: string;
  duration?: number;
  error?: string;
}

/**
 * 渲染工具调用面板
 */
export function renderToolPanel(tool: ToolCallInfo): string {
  const lines: string[] = [];
  const width = 50;
  
  // 图标和状态
  const statusIcon = {
    running: chalk.yellow("⏳"),
    success: chalk.green("✓"),
    error: chalk.red("✗"),
  }[tool.status];
  
  const toolIcon = getToolIcon(tool.name);
  
  // 标题行
  const title = `${toolIcon} ${tool.name}`;
  lines.push(chalk.cyan("┏") + chalk.cyan("━".repeat(width - 2)) + chalk.cyan("┓"));
  lines.push(
    chalk.cyan("┃ ") +
    statusIcon + " " +
    chalk.bold(title) +
    " ".repeat(Math.max(0, width - title.length - 5)) +
    chalk.cyan("┃")
  );
  
  // 参数行
  if (tool.args && Object.keys(tool.args).length > 0) {
    const argsPreview = formatArgsPreview(tool.args);
    lines.push(
      chalk.cyan("┃ ") +
      chalk.gray("📋 ") +
      argsPreview.slice(0, width - 6) +
      " ".repeat(Math.max(0, width - argsPreview.length - 6)) +
      chalk.cyan("┃")
    );
  }
  
  // 执行时间
  if (tool.duration !== undefined) {
    const timeStr = formatDuration(tool.duration);
    lines.push(
      chalk.cyan("┃ ") +
      chalk.gray("⏱️  ") +
      timeStr +
      " ".repeat(width - timeStr.length - 6) +
      chalk.cyan("┃")
    );
  }
  
  // 结果预览
  if (tool.result && tool.status === "success") {
    const resultPreview = tool.result.slice(0, 100).replace(/\n/g, " ");
    lines.push(
      chalk.cyan("┃ ") +
      chalk.gray("📄 ") +
      resultPreview +
      (tool.result.length > 100 ? "..." : "") +
      " ".repeat(Math.max(0, width - resultPreview.length - 9)) +
      chalk.cyan("┃")
    );
  }
  
  // 错误信息
  if (tool.error) {
    const errorPreview = tool.error.slice(0, 80).replace(/\n/g, " ");
    lines.push(
      chalk.cyan("┃ ") +
      chalk.red("❌ ") +
      chalk.red(errorPreview) +
      " ".repeat(Math.max(0, width - errorPreview.length - 6)) +
      chalk.cyan("┃")
    );
  }
  
  lines.push(chalk.cyan("┗") + chalk.cyan("━".repeat(width - 2)) + chalk.cyan("┛"));
  
  return lines.join("\n");
}

/**
 * 获取工具图标
 */
function getToolIcon(name: string): string {
  const icons: Record<string, string> = {
    read_file: "📖",
    write_file: "📝",
    replace: "✏️",
    edit_file: "✏️",
    delete_file: "🗑️",
    list_directory: "📁",
    glob: "🔍",
    grep_tool: "🔍",
    web_search: "🌐",
    web_fetch: "🌐",
    run_shell_command: "💻",
    think: "💭",
    plan: "📋",
    get_current_time: "🕐",
    save_memory: "💾",
    todo_read: "📋",
    todo_write: "✅",
    ask_user_question: "❓",
    image_read: "🖼️",
    task: "🤖",
  };
  
  return icons[name] ?? "🔧";
}

/**
 * 格式化参数预览
 */
function formatArgsPreview(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  
  if (entries.length === 0) return "";
  
  // 只显示最重要的参数
  const priorityKeys = ["path", "file_path", "query", "pattern", "command", "url"];
  const important = entries.find(([k]) => priorityKeys.includes(k));
  
  if (important) {
    const value = String(important[1]).slice(0, 40);
    return `${important[0]}: ${value}${String(important[1]).length > 40 ? "..." : ""}`;
  }
  
  // 否则显示第一个参数
  const [key, value] = entries[0] ?? ["", ""];
  return `${key}: ${String(value).slice(0, 40)}`;
}

/**
 * 格式化持续时间
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * 渲染 Markdown 内容
 */
export function renderMarkdown(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  
  for (const line of lines) {
    // 代码块
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // 结束代码块
        result.push(renderCodeBlock(codeLines.join("\n"), codeLang));
        codeLines = [];
        inCodeBlock = false;
      } else {
        // 开始代码块
        codeLang = line.slice(3).trim();
        inCodeBlock = true;
      }
      continue;
    }
    
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    
    // 标题
    if (line.startsWith("### ")) {
      result.push(chalk.bold.cyan(line.slice(4)));
      continue;
    }
    if (line.startsWith("## ")) {
      result.push(chalk.bold.green(line.slice(3)));
      continue;
    }
    if (line.startsWith("# ")) {
      result.push(chalk.bold.magenta(line.slice(2)));
      continue;
    }
    
    // 列表
    if (line.match(/^[-*]\s/)) {
      result.push(chalk.gray("• ") + line.slice(2));
      continue;
    }
    if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\./)?.[1] ?? "1";
      result.push(chalk.gray(`${num}. `) + line.slice(num.length + 2));
      continue;
    }
    
    // 行内代码
    let processedLine = line.replace(
      /`([^`]+)`/g,
      (_, code) => chalk.bgGray.black(` ${code} `)
    );
    
    // 粗体
    processedLine = processedLine.replace(
      /\*\*([^*]+)\*\*/g,
      (_, text) => chalk.bold(text)
    );
    
    // 斜体
    processedLine = processedLine.replace(
      /\*([^*]+)\*/g,
      (_, text) => chalk.italic(text)
    );
    
    result.push(processedLine);
  }
  
  return result.join("\n");
}

/**
 * 渲染代码块
 */
function renderCodeBlock(code: string, lang: string): string {
  const lines: string[] = [];
  const codeLines = code.split("\n");
  
  // 头部
  lines.push(chalk.gray("┌─" + (lang ? ` ${lang} ` : "") + "─".repeat(40 - (lang?.length ?? 0) - 3) + "┐"));
  
  // 代码行
  for (const line of codeLines.slice(0, 20)) {
    try {
      const highlighted = lang ? hljs.highlight(line, { language: lang }).value : line;
      lines.push(chalk.gray("│ ") + highlighted + chalk.reset(""));
    } catch {
      lines.push(chalk.gray("│ ") + line);
    }
  }
  
  if (codeLines.length > 20) {
    lines.push(chalk.gray("│ ... (" + (codeLines.length - 20) + " more lines)"));
  }
  
  // 底部
  lines.push(chalk.gray("└" + "─".repeat(49) + "┘"));
  
  return lines.join("\n");
}

/**
 * 渲染思考过程
 */
export function renderThinking(content: string, collapsed: boolean = true): string {
  const lines: string[] = [];
  
  lines.push(chalk.dim("┌─ 💭 Thinking " + "─".repeat(35) + "┐"));
  
  if (!collapsed) {
    const contentLines = content.split("\n").slice(0, 10);
    for (const line of contentLines) {
      lines.push(chalk.dim("│ ") + chalk.italic.gray(line.slice(0, 47)));
    }
    if (content.split("\n").length > 10) {
      lines.push(chalk.dim("│ ... (collapsed)"));
    }
  }
  
  lines.push(chalk.dim("└" + "─".repeat(49) + "┘"));
  
  return lines.join("\n");
}

/**
 * 渲染进度条
 */
export function renderProgress(current: number, total: number, label: string): string {
  const width = 30;
  const percent = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  
  const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  
  return `${label}: [${bar}] ${percent}% (${current}/${total})`;
}

/**
 * 渲染欢迎消息
 */
export function renderWelcome(): string {
  const lines = [
    chalk.cyan("\n🦞 SACODE - 多端 AI 助手"),
    chalk.gray("─".repeat(30)),
    chalk.gray("输入消息开始对话，输入 'exit' 退出"),
    chalk.gray("输入 '/help' 查看可用命令"),
    "",
  ];
  
  return lines.join("\n");
}

/**
 * 渲染用户输入提示
 */
export function renderPrompt(): string {
  return chalk.green("You: ");
}

/**
 * 渲染 AI 响应前缀
 */
export function renderAssistantPrefix(): string {
  return chalk.cyan("SACODE: ");
}
