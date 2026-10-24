import assert from "node:assert/strict";
import test from "node:test";
import { changedFiles, fileOptions, insertReference, parseStatus, readWorkspaceDiff, referenceToken, safeRelativePath } from "../src/workspace-views.mjs";
import { normalizeInput } from "../src/terminal-input.mjs";

test("输入：Home/End 多种终端序列、DEL与Delete保持区分，不扫描粘贴内容", () => {
  for (const raw of ["\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~"]) assert.equal(normalizeInput("", {}, raw).key.home, true);
  for (const raw of ["\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~"]) assert.equal(normalizeInput("", {}, raw).key.end, true);
  assert.equal(normalizeInput("", { delete: true }, "\x7f").key.backspace, true);
  assert.equal(normalizeInput("", { delete: true }, "\x1b[3~").key.delete, true);
  assert.equal(normalizeInput("paste\x1b[H", {}, "paste\x1b[H").key.home, undefined);
});

test("引用：光标处识别中文与相对目录，不把邮箱当引用，空格路径安全引用", () => {
  const text = "请读 @src/ma";
  const token = referenceToken(text, Array.from(text).length);
  assert.equal(token.directory, "src");
  assert.equal(token.prefix, "ma");
  assert.equal(referenceToken("mail@example.test", 17), null);
  const result = insertReference(text, token, "src/中文 file.cj");
  assert.equal(result.text, '请读 @"src/中文 file.cj" ');
  assert.equal(referenceToken('读 @"dir space/ma', 16).directory, 'dir space');
  for (const path of ["../outside", "/etc", "C:/file", "src\\file", "a\nfile"]) assert.throws(() => safeRelativePath(path));
});

test("引用：只查询目录不读取上传文件，工作区错配/读取失败明确拒绝", async () => {
  const calls = [];
  const client = { async request(method, params) { calls.push({ method, params }); return { directory: "D:/demo", files: [{ name: "main.cj", isDir: false }, { name: "media", isDir: true }] }; } };
  const result = await fileOptions(client, "src", "m", "D:/demo");
  assert.equal(result.items[0].isDir, true);
  assert.deepEqual(calls, [{ method: "workspace/files", params: { path: "src" } }]);
  await assert.rejects(fileOptions(client, "src", "", "other"), /变化/);
  client.request = async () => ({ directory: "D:/demo", error: "read-error", files: [] });
  await assert.rejects(fileOptions(client, "", "", "D:/demo"), /读取失败/);
  await assert.rejects(fileOptions(client, "../outside", "", "D:/demo"), /相对路径/);
});

test("Git：NUL状态含中文/空格/rename与截断，区分暂存/工作区/未跟踪", async () => {
  const output = "## main\0MM 中文 file.txt\0R  new.txt\0old.txt\0?? draft.txt\0";
  const parsed = parseStatus(output);
  assert.equal(parsed.entries[1].oldPath, "old.txt");
  assert.equal(parseStatus("## main\0 M full\0 M partial", true).entries.length, 1);
  const identity = { sessionId: "s1", directory: "D:/demo" };
  const reply = { ...identity, output, exitCode: 0, failure: "", truncated: false };
  const result = await changedFiles({ request: async () => reply }, identity);
  assert.deepEqual(result.items.map((item) => item.scope), ["index", "working", "index", "untracked"]);
  await assert.rejects(changedFiles({ request: async () => ({ ...reply, exitCode: 1, failure: "not-repo" }) }, identity), /not-repo/);
  await assert.rejects(changedFiles({ request: async () => ({ ...reply, sessionId: "other" }) }, identity), /当前会话/);
});

test("Git：patch仅来自Host，严格核session/directory/path/scope及truncated", async () => {
  const identity = { sessionId: "s1", directory: "D:/demo" };
  const calls = [];
  const client = { async request(method, params) {
    calls.push({ method, params }); return { ...params, output: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new", failure: "", exitCode: 0, truncated: true };
  } };
  const result = await readWorkspaceDiff(client, identity, "a.txt", "working");
  assert.equal(result.truncated, true);
  assert.match(result.text, /\+new/);
  assert.equal(calls[0].method, "workspace/git-diff");
  client.request = async () => ({ ...identity, path: "wrong", scope: "working", output: "", exitCode: 0 });
  await assert.rejects(readWorkspaceDiff(client, identity, "a.txt", "working"), /不匹配/);
});
