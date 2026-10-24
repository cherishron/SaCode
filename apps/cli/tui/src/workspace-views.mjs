import { characters } from "./editor.mjs";

export function safeRelativePath(path) {
  if (typeof path !== "string" || !path || path.length > 512 || /[\\:\x00-\x1f\x7f]/.test(path)
    || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("仅允许工作区内的相对路径");
  return path;
}

export function referenceToken(text, cursor) {
  const before = characters(text).slice(0, cursor).join("");
  const match = before.match(/(?:^|\s)@(?:"([^"\r\n]*)|([^\s"@]*))$/u);
  if (!match) return null;
  const quoted = match[1] !== undefined;
  const query = quoted ? match[1] : match[2];
  const slash = query.lastIndexOf("/");
  const directory = slash < 0 ? "" : query.slice(0, slash);
  return { start: cursor - characters((quoted ? '@"' : "@") + query).length, end: cursor, directory,
    prefix: query.slice(slash + 1) };
}

export async function fileOptions(client, directory, prefix, expectedDirectory) {
  if (directory) safeRelativePath(directory);
  const reply = await client.request("workspace/files", { path: directory }, 15000);
  if (reply.directory !== expectedDirectory) throw new Error("文件列表工作区已变化，请重新打开");
  if (reply.error) throw new Error(`目录读取失败：${reply.error}`);
  const items = (Array.isArray(reply.files) ? reply.files : []).filter((entry) => typeof entry.name === "string"
    && entry.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) && !entry.name.includes("/"))
    .map((entry) => {
      const path = safeRelativePath(directory ? directory + "/" + entry.name : entry.name);
      return { id: path, path, isDir: entry.isDir === true, label: `${entry.isDir ? "目录" : "文件"}  ${entry.name}${entry.isDir ? "/" : ""}` };
    }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));
  return { items, limited: reply.files?.length >= 200 };
}

export function insertReference(text, token, path) {
  safeRelativePath(path);
  const chars = characters(text);
  // JSON引号保留空格/引号路径；仅路径文本，不宣称已上传或已读正文。
  const insert = "@" + JSON.stringify(path) + " ";
  return { text: chars.slice(0, token.start).join("") + insert + chars.slice(token.end).join(""),
    cursor: token.start + characters(insert).length };
}

function validateGitReply(reply, identity) {
  if (reply?.sessionId !== identity.sessionId || reply.directory !== identity.directory) throw new Error("Git 回执不属于当前会话或工作区");
  if (reply.failure || reply.exitCode !== 0) throw new Error(`Git 查询失败（${reply.failure || "exit"}，退出码 ${reply.exitCode}）${reply.diagnostic ? "：" + reply.diagnostic : ""}`);
  if (typeof reply.output !== "string") throw new Error("Git 回执缺少正文");
}

export function parseStatus(output, truncated = false) {
  const parts = output.split("\0");
  if (truncated || parts.at(-1) === "") parts.pop();
  const entries = [];
  let branch = "";
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index];
    if (record.startsWith("## ")) { branch = record.slice(3); continue; }
    if (record.length < 4 || record[2] !== " ") throw new Error("Git 状态格式无效");
    const item = { path: record.slice(3), x: record[0], y: record[1] };
    if (/[RC]/.test(item.x + item.y)) {
      if (++index >= parts.length) { if (truncated) break; throw new Error("Git 重命名记录不完整"); }
      item.oldPath = parts[index];
    }
    entries.push(item);
  }
  return { entries, branch };
}

export async function changedFiles(client, identity) {
  const reply = await client.request("workspace/git-status", identity, 15000);
  validateGitReply(reply, identity);
  const parsed = parseStatus(reply.output, reply.truncated);
  const items = [];
  for (const entry of parsed.entries) {
    if (entry.x === "?" && entry.y === "?") {
      items.push({ id: `untracked:${entry.path}`, path: entry.path, scope: "untracked", label: `未跟踪（无基线差异） ${entry.path}` });
      continue;
    }
    for (const [scope, status] of [["index", entry.x], ["working", entry.y]]) {
      if (status !== " ") items.push({ id: `${scope}:${entry.path}`, path: entry.path, scope,
        label: `${scope === "index" ? "暂存" : "未暂存"} ${status}  ${entry.path}${entry.oldPath ? ` ← ${entry.oldPath}` : ""}` });
    }
  }
  return { items, branch: parsed.branch, truncated: reply.truncated === true };
}

export async function readWorkspaceDiff(client, identity, path, scope) {
  safeRelativePath(path);
  if (!["working", "index"].includes(scope)) throw new Error("不支持的差异范围");
  const reply = await client.request("workspace/git-diff", { ...identity, path, scope }, 15000);
  validateGitReply(reply, identity);
  if (reply.path !== path || reply.scope !== scope) throw new Error("Git 差异路径或范围不匹配");
  return { text: reply.output, truncated: reply.truncated === true };
}
