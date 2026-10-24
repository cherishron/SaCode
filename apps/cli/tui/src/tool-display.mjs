// 只格式化宿主已给出的内容；不读本地文件、不凭一行 +/- 伪造文件 diff。
export function formatToolResult(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  } catch { return value; }
}

export function isUnifiedDiff(text) {
  return /^--- .+\r?\n\+\+\+ .+/m.test(text) && /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text);
}

export function approvalPreview(approval) {
  try {
    const args = JSON.parse(approval.argumentsJson);
    if (approval.tool === "edit" && typeof args.old_string === "string" && typeof args.new_string === "string") {
      return { title: "拟替换片段（来自请求，非磁盘差异）", lines: [
        ...args.old_string.split("\n").map((line) => `- ${line}`),
        ...args.new_string.split("\n").map((line) => `+ ${line}`),
      ] };
    }
    if (approval.tool === "write" && typeof args.content === "string") {
      return { title: "拟写入内容（可能覆盖文件，非已执行结果）", lines: args.content.split("\n") };
    }
    if (typeof args.command === "string") return { title: "请求执行的命令", lines: args.command.split("\n") };
  } catch { /* 非 JSON 工单仍可 d 查看原始参数。 */ }
  return null;
}
