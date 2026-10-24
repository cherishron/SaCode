// 纯展示组件：不持有业务状态，不直接调宿主。
import React from "react";
import { Box, Text } from "ink";
import { THEME } from "./theme.mjs";
import { characters } from "./editor.mjs";
import { COMMANDS, displayText } from "./commands.mjs";
import { Markdown } from "./markdown.mjs";
import { inputLines } from "./input-layout.mjs";
import { approvalPreview, formatToolResult, isUnifiedDiff } from "./tool-display.mjs";

export const h = React.createElement;

const TOOL_STATUS = {
  running: { mark: "·", label: "进行中", color: THEME.warning },
  completed: { mark: "✓", label: "已完成", color: THEME.success },
  failed: { mark: "×", label: "失败", color: THEME.danger },
  denied: { mark: "−", label: "已拒绝", color: THEME.warning },
  cancelled: { mark: "○", label: "已取消" },
  unknown: { mark: "?", label: "未知" },
};

export function Header({ version, sessionTitle, compact = false }) {
  return h(
    Box,
    { flexDirection: "column", flexShrink: 0, marginY: compact ? 0 : 1 },
    h(
      Box,
      { justifyContent: "space-between" },
      h(Text, { bold: true, color: THEME.accent }, "✦ SaCode", h(Text, { bold: false, dimColor: true }, " CLI")),
      h(Text, { dimColor: true }, `v${version}`),
    ),
    h(Text, { wrap: "truncate-middle" },
      displayText(sessionTitle || "当前会话"),
    ),
  );
}

function roleMeta(role) {
  if (role === "user") return { mark: ">" };
  if (role === "assistant") return { mark: "✦" };
  return { mark: "·" };
}

export function MessageRow({ role, text, references, streaming = false, compact = false }) {
  const meta = roleMeta(role);
  return h(
    Box,
    { flexDirection: "row", flexShrink: 0, marginBottom: compact ? 0 : 1 },
    h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: role === "user" ? THEME.accent : undefined, bold: true }, `${meta.mark} `)),
    h(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 },
      role === "assistant" ? h(Markdown, { text, pending: streaming }) : h(Text, { wrap: "wrap" }, displayText(text)),
      references?.length ? h(Text, { dimColor: true, wrap: 'wrap' }, `文件引用快照：${references.map((file) => `${displayText(file.path)}（${file.bytes} B）`).join('、')} · 正文已随消息保存`) : null,
      streaming ? h(Text, { dimColor: true, color: THEME.accent }, "正在回复…") : null,
    ),
  );
}

export function ToolCard({ call, compact = false, expanded = false }) {
  const status = TOOL_STATUS[call.status] || TOOL_STATUS.unknown;
  const result = formatToolResult(call.resultText);
  const lines = String(result ?? "").split("\n");
  const limit = expanded ? lines.length : compact ? 3 : 6;
  const shown = lines.slice(0, limit);
  const isDiff = isUnifiedDiff(result || "");
  return h(Box, { flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: status.color, borderDimColor: !status.color, paddingX: 1, marginBottom: 1 },
    h(ToolCallRow, { call }),
    result !== undefined ? h(Box, { flexDirection: "column" },
      shown.map((line, li) => {
        if (isDiff && /^[-+]/.test(line)) {
          return h(Text, { key: li, color: line.startsWith("+") ? THEME.success : THEME.danger, wrap: "wrap" }, displayText(line) || " ");
        }
        return h(Text, { key: li, wrap: "wrap" }, displayText(line) || " ");
      }),
      lines.length > limit ? h(Text, { dimColor: true }, `…另有 ${lines.length - limit} 行 · /tools 查看并展开`) : null,
    ) : h(Text, { dimColor: true }, call.status === "running" ? "正在执行，等待宿主结果…" : "没有关联结果，不推断成功。"),
  );
}

export function ToolCallRow({ call, width }) {
  const status = TOOL_STATUS[call.status] || { ...TOOL_STATUS.unknown, label: String(call.status || "未知") };
  const summary = summarizeArguments(call.arguments, Math.max(16, (width || 80) - 30));
  return h(
    Box,
    { flexShrink: 0 },
    h(Text, { color: status.color }, `${status.mark} `),
    h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
      h(Text, { wrap: "truncate-middle" },
        displayText(call.name || "tool"),
        summary ? h(Text, { dimColor: true }, `  ${summary}`) : null,
      ),
    ),
    h(Text, { color: status.color, dimColor: !status.color }, `  ${displayText(status.label)}`),
  );
}

export function ToolActivity({ calls, width, compact = false }) {
  if (calls.length === 0) return null;
  return h(Box, {
    flexDirection: "column", flexShrink: 0, marginBottom: compact ? 0 : 1,
    borderStyle: THEME.border, borderTop: true, borderBottom: false,
    borderLeft: false, borderRight: false, borderDimColor: true,
  },
  h(Text, { dimColor: true }, `工具活动 · ${calls.length} 项${compact ? "" : "（最近）"}`),
  calls.map((call) => h(ToolCallRow, { key: `${call.id}-${call.status}`, call, width })),
  );
}

export function EmptyState({ compact = false }) {
  return h(Box, { flexDirection: "column", flexShrink: 0, marginTop: compact ? 0 : 1 },
    h(Text, { bold: true }, "开始使用"),
    h(Text, { dimColor: true }, compact ? "/auth 配置 · / 查看命令" : "1. /auth 配置供应商  2. /model 选择模型  3. 输入任务"),
    !compact ? h(Box, { marginTop: 1, flexDirection: "column" },
      h(Text, null, "  /resume 恢复会话 · /new 新建会话 · /help 快捷键"),
      h(Text, { dimColor: true }, "  有模型配置时才能执行任务；审批请求会单独显示。"),
    ) : null,
  );
}

// 工具参数只做一层摘要：完整 JSON 属于日志，不该在终端里铺满屏幕。
export function summarizeArguments(raw, max = 80) {
  if (typeof raw !== "string" || raw.length === 0) return "";
  let value = raw;
  try {
    const parsed = JSON.parse(raw);
    const preferred = ["path", "file_path", "command", "pattern", "query", "title", "objective"];
    for (const key of preferred) {
      if (typeof parsed?.[key] === "string" && parsed[key].length > 0) {
        value = parsed[key];
        break;
      }
    }
    if (value === raw) value = JSON.stringify(parsed);
  } catch {
    // 非 JSON 参数原样截断，不猜结构。
  }
  value = displayText(value).replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function ApprovalBox({ approval, compact = false, details = false, selected = 1, answering = false }) {
  const args = summarizeArguments(approval.argumentsJson, 120);
  const preview = !details && !compact ? approvalPreview(approval) : null;
  return h(
    Box,
    { flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: THEME.warning, paddingX: 1, marginBottom: compact ? 0 : 1 },
    h(Text, { bold: true, color: THEME.warning, wrap: "truncate-end" }, `审批 #${approval.approvalId} · ${displayText(approval.tool || "tool")}`),
    !compact ? h(Text, { dimColor: true }, answering ? "正在确认工单结果…" : "仅针对本次调用") : null,
    args ? h(Text, { wrap: "truncate-middle", dimColor: true }, `参数摘要：${args}`) : null,
    preview ? h(Box, { flexDirection: "column" },
      h(Text, { dimColor: true }, preview.title),
      preview.lines.slice(0, 3).map((line, index) => h(Text, { key: index, wrap: "truncate-end" }, displayText(line) || " ")),
      preview.lines.length > 3 ? h(Text, { dimColor: true }, "… d 查看完整请求") : null,
    ) : null,
    h(Text, { dimColor: true, wrap: "truncate-end" }, `[d] ${details ? "返回对话" : "查看完整参数"} · PgUp/PgDn 翻页`),
    h(Box, { flexDirection: "column" },
      h(Text, { color: selected === 0 ? THEME.accent : undefined, bold: selected === 0 },
        `${selected === 0 ? "❯" : " "} [y] 允许一次`),
      !answering ? h(Text, { color: selected === 1 ? THEME.danger : undefined, bold: selected === 1 },
        `${selected === 1 ? "❯" : " "} [n] 拒绝（默认）`) : null,
    ),
    !answering ? h(Text, { dimColor: true, wrap: "truncate-end" }, "↑↓ 选择 · Enter 确认 · Ctrl+C 取消本轮") : null,
  );
}

export function Composer({ value, cursor = characters(value).length, busy, placeholder, approvalPending = false, compact = false, width = 80 }) {
  const { lines, cursorRow } = inputLines(value, cursor, Math.max(2, width - 6));
  const maxLines = compact ? 2 : 4;
  const firstLine = Math.max(0, cursorRow - maxLines + 1);
  return h(
    Box,
    {
      flexShrink: 0, borderStyle: "round", borderLeft: false, borderRight: false,
      borderColor: approvalPending ? THEME.warning : undefined,
      borderDimColor: busy && !approvalPending, paddingX: 1,
    },
    h(Text, { color: !busy && !approvalPending ? THEME.accent : undefined, bold: true }, "> "),
    value.length > 0 && !approvalPending ? h(Box, { flexDirection: "column", flexShrink: 1, minWidth: 0 },
      lines.slice(firstLine, firstLine + maxLines).map((line, index) => {
        const chars = characters(line.text);
        const localCursor = Math.max(0, cursor - line.start);
        const current = firstLine + index === cursorRow;
        return h(Text, { key: line.start, wrap: "wrap" }, current
          ? displayText(chars.slice(0, localCursor).join("")) + "▌" + displayText(chars.slice(localCursor).join(""))
          : displayText(line.text) || " ");
      }),
    ) : h(Box, { flexShrink: 1, minWidth: 0 }, h(
      Text,
      { dimColor: value.length === 0 || approvalPending, wrap: "truncate-start" },
      approvalPending ? "请先回答上方审批" : placeholder,
    )),
  );
}

export function StatusBar({ busy, usage, notice, error, compact = false, approvalPending = false, inputActive = true, cwd, modelLabel, sessionTitle }) {
  let text;
  let color;
  if (error) { text = `错误：${error}`; color = THEME.danger; }
  else if (notice) { text = notice; color = THEME.warning; }
  else if (approvalPending) { text = "等待审批 · y / n · Ctrl+C 取消"; color = THEME.warning; }
  else if (busy) { text = "处理中 · Ctrl+C 取消"; color = THEME.accent; }
  else if (!inputActive) text = '当前输入由上方面板接管';
  else text = compact ? "Enter 发送 · / 命令 · Ctrl+J 换行" : "Enter 发送 · Ctrl+J 换行 · / 命令 · Ctrl+D 退出";
  const budget = Number.isFinite(usage?.budget) && usage.budget > 0 ? `/${usage.budget}` : "";
  return h(
    Box,
    { flexShrink: 0, flexDirection: "column" },
    cwd ? h(Text, { dimColor: true, wrap: "truncate-middle" }, `${sessionTitle ? displayText(sessionTitle) + ' · ' : ''}${displayText(cwd)}  ·  ${displayText(modelLabel || "宿主默认路由")}（/model）`) : null,
    h(Box, { justifyContent: "space-between" },
    h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
      h(Text, { color, dimColor: !color, wrap: "truncate-end" }, displayText(text)),
    ),
    !compact && Number.isFinite(usage?.used) ? h(Text, {
      color: usage.over ? THEME.danger : undefined, dimColor: !usage.over,
    }, `  ${usage.used}${budget} tokens`) : null),
  );
}

export function ErrorScreen({ message, stderr, hostPath }) {
  return h(
    Box,
    { flexDirection: "column", borderStyle: THEME.border, borderColor: THEME.danger, paddingX: 1 },
    h(Text, { bold: true, color: THEME.danger }, "无法连接 SaCode 宿主"),
    h(Text, { wrap: "wrap" }, displayText(message)),
    hostPath ? h(Text, { dimColor: true, wrap: "wrap" }, `宿主：${hostPath}`) : null,
    stderr ? h(Text, { dimColor: true, wrap: "wrap" }, `宿主输出（尾部）：\n${displayText(stderr)}`) : null,
    h(Text, { dimColor: true }, "Ctrl+C 退出"),
  );
}

export const HELP_LINES = [
  "直接输入消息后回车，SaCode 会读文件、提出修改并等待你审批。",
  "",
  ...COMMANDS.map((command) => `${command.name.padEnd(12)}${command.description}`),
  "",
  "Ctrl+C   生成中取消；空闲有草稿时清空；空草稿退出",
  "Ctrl+D   退出",
  "↑ / ↓    翻阅输入历史",
  "← / →    移动光标；Ctrl+A / Ctrl+E 行首 / 行尾",
  "Home / End 行首 / 行尾；终端 DEL 删除光标前字符",
  "@路径     补全不读正文；发送前确认后经Host读取文本快照，默认取消",
  "Ctrl+J / Alt+Enter 换行；Ctrl+U / Ctrl+K 删除光标前 / 后",
  "Ctrl+W   删除光标前一个词",
  "Ctrl+← / Ctrl+→ 按空白分隔的词移动光标",
  "Ctrl+Z / Ctrl+Y 撤销 / 重做",
  "Ctrl+R   搜索输入历史，Enter 回填但不发送，Esc 恢复草稿",
  "PgUp/PgDn 翻阅对话（全屏模式）；审批时 d 查看完整参数",
  "Esc      取消本轮 / 清空输入",
  "/screen  切换标准历史输出 / 全屏翻阅模式",
];
