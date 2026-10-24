// 命令定义同时驱动菜单与帮助，未实现的能力不放假入口。
export const COMMANDS = Object.freeze([
  { name: "/help", description: "帮助与快捷键" },
  { name: "/auth", description: "安全表单配置供应商、模型和凭据（不联网）" },
  { name: "/model", description: "选择本进程使用的已配置模型（不请求供应商）" },
  { name: "/resume", description: "选择并恢复已有会话" },
  { name: "/new", description: "新建并切换会话，可跟会话标题" },
  { name: "/rename", description: "重命名当前会话：/rename 新标题（需确认）" },
  { name: "/archive", description: "归档非当前会话（保留记录，需确认）" },
  { name: "/directory", description: "查看工作目录；跟绝对路径可切换目录" },
  { name: "/tools", description: "查看本会话工具调用与返回结果" },
  { name: "/diff", description: "只读查看当前工作区实际 Git 差异" },
  { name: "/skills", description: "浏览宿主技能目录和正文（不执行）" },
  { name: "/mcp", description: "查看已注册 MCP 与连接状态（不连接/探测）" },
  { name: "/permissions", description: "查看实际权限档位（不改变）" },
  { name: "/plan", description: "查看计划模式当前状态（不改变）" },
  { name: "/compact", description: "压缩会话历史以节省 token（有损，需确认）" },
  { name: "/clear", description: "清空对话历史，保留会话身份与配置（需确认）" },
  { name: "/stats", description: "读取宿主实际用量" },
  { name: "/about", description: "版本与当前入口" },
  { name: "/screen", description: "切换标准历史输出 / 全屏翻阅模式" },
  { name: "/quit", description: "退出（进行中请先取消并等待结算）" },
]);

export function commandMatches(text) {
  if (!/^\/[^\s]*$/.test(text)) return [];
  return COMMANDS.filter((command) => command.name.startsWith(text.toLowerCase()));
}

export function parseCommand(text) {
  const match = text.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const aliases = { "/?": "/help", "/exit": "/quit", "/chat": "/resume", "/dir": "/directory" };
  const raw = match?.[1] || "";
  return { name: aliases[raw] || raw, argument: match?.[2]?.trim() || "" };
}

// 输出控制字符可见化，不把 Host/模型/文件内容当作终端指令执行。
export function displayText(value) {
  return String(value ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
