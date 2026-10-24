import assert from "node:assert/strict";
import test from "node:test";
import { commandMatches, parseCommand, displayText } from "../src/commands.mjs";
import { modelOptions, readSession, selectSession, toolsWithResults } from "../src/actions.mjs";

test("命令：过滤补全、别名和带空格目录参数", () => {
  assert.deepEqual(commandMatches("/mo").map((item) => item.name), ["/model"]);
  assert.deepEqual(commandMatches("/model "), []);
  assert.deepEqual(parseCommand("/dir D:/Project with spaces"), { name: "/directory", argument: "D:/Project with spaces" });
  assert.equal(parseCommand("/chat").name, "/resume");
  assert.equal(displayText("中文\x1b[31m"), "中文\\u001b[31m");
});

test("命令：模型选择只读取本地目录且过滤停用/未绑定模型", async () => {
  const calls = [];
  const client = { async request(method) {
    calls.push(method);
    return { models: [
      { id: "good", name: "可选", enabled: true, bindings: [{ enabled: true }] },
      { id: "disabled", enabled: false, bindings: [{ enabled: true }] },
      { id: "unbound", enabled: true, bindings: [] },
    ] };
  } };
  const options = await modelOptions(client);
  assert.deepEqual(options.map((item) => item.id), ["", "good"]);
  assert.deepEqual(calls, ["custom/describe"], "不能调用会访问供应商的 model/list");
});

test("命令：会话切换必须确认成功再回读，不把持久化失败当成功", async () => {
  const calls = [];
  const client = { async request(method, params) {
    calls.push({ method, params });
    if (method === "session/select") return { selected: false, id: params.sessionId };
    return {};
  } };
  await assert.rejects(selectSession(client, "s2"), /unconfirmed/);
  assert.equal(calls.length, 1);
  client.request = async (method, params) => {
    if (method === "session/select") return { selected: true, id: params.sessionId };
    if (method === "session/catalog") return { entries: [{ id: "s2", current: true, title: "恢复会话" }] };
    if (method === "workspace/get") return { directory: "D:/project" };
    if (method === "session/projection") return { sessionId: "s2", messageRows: [] };
    return { used: 10 };
  };
  assert.equal((await selectSession(client, "s2")).sessionId, "s2");
  assert.equal((await readSession(client)).directory, "D:/project");
});

test("命令：工具结果按宿主消息 ID 关联，不用正文猜测", () => {
  const calls = toolsWithResults({ toolCalls: [
    { id: "t1", resultMessageId: "event-4", status: "completed" },
    { id: "t2", resultMessageId: "missing", status: "unknown" },
  ], messageRows: [{ id: "event-4", eventType: "tool/result", text: "真实返回" }] });
  assert.equal(calls[0].resultText, "真实返回");
  assert.equal(calls[1].resultText, undefined);
});
