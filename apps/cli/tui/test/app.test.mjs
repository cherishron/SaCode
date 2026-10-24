import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/app.mjs";
import { referenceMessageView } from '../src/file-references.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeClient {
  constructor() {
    this.handlers = new Set();
    this.calls = [];
    this.answers = [];
    this.settled = false;
    this.holdTurn = false;
    this.cancelled = false;
  }

  onNotification(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(message) {
    for (const handler of this.handlers) handler(message);
  }

  async request(method, params = {}) {
    this.calls.push({ method, params });
    switch (method) {
      case "initialize":
        return { protocolVersion: "0.1", capabilities: [] };
      case "session/catalog":
        return { root: "D:/demo", entries: [{ id: "s1", title: "演示会话", current: true }] };
      case "workspace/get":
        return { sessionId: "s1", directory: "D:/demo" };
      case "usage/status":
        return { used: 10, budget: 100, over: false };
      case "custom/describe":
        return { models: [{ id: "coding", name: "编程模型", enabled: true, bindings: [{ enabled: true }] }] };
      case "session/projection": {
        const rows = [
          { id: "event-1", eventType: "user/message", text: "历史问题", attachments: [] },
          { id: "event-2", eventType: "assistant/message", text: "历史回答", attachments: [] },
        ];
        if (this.settled) rows.push({ id: "event-9", eventType: "assistant/message", text: "收到", attachments: [] });
        return { sessionId: "s1", messageRows: rows, toolCalls: [] };
      }
      case "session/append":
      case "session/submit":
        return { events: 3, durable: 2 };
      case "task/start":
      case "turn/start":
        return { started: true, provider: "fixture" };
      case "turn/poll":
        if (this.holdTurn && !this.cancelled) {
          return { frames: [], settled: false, turnId: 1, nextCursor: 0, used: 0, budget: 100, over: false };
        }
        if (this.cancelled) {
          return { frames: [], settled: true, turnId: 1, nextCursor: 0, cancelled: true, finishReason: "cancelled", text: "", used: 0, budget: 100, over: false };
        }
        this.settled = true;
        return { frames: ["text:收到"], settled: true, turnId: 1, nextCursor: 1, text: "收到", used: 12, budget: 100, over: false };
      case "turn/cancel":
        this.cancelled = true;
        return { cancelRequested: true, wasRunning: true };
      case "approval/answer":
        this.answers.push(params);
        return { accepted: true, state: params.decision };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }

  get stderrText() {
    return "";
  }
}

test("App：连接后显示会话、目录与历史投影", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host", version: "0.0.0-test" }));
  for (let i = 0; i < 50 && !app.lastFrame()?.includes('历史回答'); i++) await sleep(40);
  const frame = app.lastFrame();
  assert.match(frame, /SaCode/);
  assert.match(frame, /演示会话/);
  assert.match(frame, /D:\/demo/);
  assert.match(frame, /历史回答/);
  app.unmount();
});

test("App：输入消息后由宿主结算，界面只显示投影", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host", version: "0.0.0-test" }));
  await sleep(80);
  app.stdin.write("你好");
  await sleep(10);
  app.stdin.write("\r");
  await sleep(120);
  const frame = app.lastFrame();
  assert.ok(client.calls.some((call) => call.method === "session/append"
    && call.params.eventType === "user/message" && call.params.data === "你好"));
  assert.ok(client.calls.some((call) => call.method === "task/start"));
  assert.match(frame, /收到/);
  app.unmount();
});

test("App：审批只发 allowed-once/denied，不在前端伪造结果", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host", version: "0.0.0-test" }));
  await sleep(80);
  client.emit({
    jsonrpc: "2.0",
    method: "approval/asked",
    params: { approvalId: 5, tool: "write", source: "model", sessionId: "s1", argumentsJson: "{\"path\":\"a.txt\"}" },
  });
  await sleep(30);
  assert.match(app.lastFrame(), /审批 #5/);
  assert.match(app.lastFrame(), /write/);
  app.stdin.write("y");
  await sleep(60);
  assert.deepEqual(client.answers, [{ approvalId: 5, decision: "allowed-once" }]);
  app.unmount();
});

test("App：审批待答时 Ctrl+C 先拒票再取消整轮", async () => {
  const client = new FakeClient();
  client.holdTurn = true;
  const app = render(React.createElement(App, { client, hostPath: "fake-host", version: "0.0.0-test" }));
  await sleep(80);
  app.stdin.write("改文件");
  await sleep(10);
  app.stdin.write("\r");
  await sleep(120);
  client.emit({
    jsonrpc: "2.0",
    method: "approval/asked",
    params: { approvalId: 7, tool: "write", source: "model", sessionId: "s1", argumentsJson: "{\"path\":\"a.txt\"}" },
  });
  await sleep(40);
  assert.match(app.lastFrame(), /审批 #7/);
  app.stdin.write("\x03");
  await sleep(220);
  assert.deepEqual(client.answers, [{ approvalId: 7, decision: "denied" }]);
  assert.ok(client.calls.some((call) => call.method === "turn/cancel"), "取消审批后必须向宿主发 turn/cancel");
  app.unmount();
});

test("App：全屏窄窗口审批接管焦点，不再叠放输入框", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, ...args) => {
    if (method === "session/projection") return {
      sessionId: "s1", toolCalls: [],
      messageRows: Array.from({ length: 10 }, (_, index) => ({
        id: `long-${index}`, eventType: "assistant/message", text: "long conversation ".repeat(20),
      })),
    };
    return request(method, ...args);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host", mode: "screen" }));
  try {
    await sleep(80);
    Object.defineProperty(app.stdout, "columns", { value: 48, configurable: true });
    Object.defineProperty(app.stdout, "rows", { value: 18, configurable: true });
    app.stdout.emit("resize");
    client.emit({ method: "approval/asked", params: {
      approvalId: 9, sessionId: "s1", tool: "write", argumentsJson: '{"path":"README.md"}',
    } });
    await sleep(60);
    const frame = app.lastFrame();
    assert.match(frame, /审批 #9/);
    assert.match(frame, /\[y\][\s\S]*\[n\]/);
    assert.doesNotMatch(frame, /请先回答上方审批|输入任务，或/);
    assert.ok(frame.split("\n").length <= 18, "底部关键控件不能被长历史挤出终端");
    assert.doesNotMatch(frame, /tokens/);
    Object.defineProperty(app.stdout, "columns", { value: 100, configurable: true });
    Object.defineProperty(app.stdout, "rows", { value: 30, configurable: true });
    app.stdout.emit("resize");
    await sleep(40);
    assert.match(app.lastFrame(), /仅针对本次调用/);
    assert.match(app.lastFrame(), /tokens/);
  } finally { app.unmount(); }
});

test("App：生成中回车保留草稿，输入历史退回恢复原草稿", async () => {
  const client = new FakeClient();
  client.holdTurn = true;
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("第一条"); await sleep(10);
    app.stdin.write("\r"); await sleep(80);
    app.stdin.write("下一条草稿"); await sleep(10);
    app.stdin.write("\r"); await sleep(40);
    assert.match(app.lastFrame(), /下一条草稿▌/);
    assert.equal(client.calls.filter((call) => call.method === "task/start").length, 1);
    app.stdin.write("\x1b[A"); await sleep(20);
    app.stdin.write("\x1b[B"); await sleep(30);
    assert.match(app.lastFrame(), /下一条草稿▌/);
    app.stdin.write("\x03"); await sleep(200);
  } finally { app.unmount(); }
});

test("App：中间插入与行首行尾编辑后的内容按真实消息提交", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    for (const input of ["你好", "\x1b[D", "世界", "\x01", "前", "\x05", "后", "\r"]) {
      app.stdin.write(input); await sleep(20);
    }
    await sleep(100);
    assert.ok(client.calls.some((call) => call.method === "session/append" && call.params.data === "前你世界好后"));
  } finally { app.unmount(); }
});

test("App：完整审批参数可翻页，查看不答票，拒绝仍只带工单号", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    client.emit({ method: "approval/asked", params: {
      approvalId: 99, sessionId: "s1", tool: "write",
      argumentsJson: "参数开头\n" + "正文\n".repeat(60) + "参数末尾",
    } });
    await sleep(30);
    app.stdin.write("d"); await sleep(60);
    assert.match(app.lastFrame(), /参数开头/);
    assert.equal(client.answers.length, 0);
    for (let i = 0; i < 10; i++) { app.stdin.write("\x1b[6~"); await sleep(10); }
    assert.match(app.lastFrame(), /参数末尾/);
    app.stdin.write("n"); await sleep(50);
    assert.deepEqual(client.answers, [{ approvalId: 99, decision: "denied" }]);
  } finally { app.unmount(); }
});

test("App：全屏长对话默认显示末尾，PageUp 可读较早内容并返回最新", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, ...args) => method === "session/projection" ? {
    sessionId: "s1", toolCalls: [], messageRows: [{ id: "long", eventType: "assistant/message",
      text: "最早正文\n" + "中间行\n".repeat(60) + "最新正文" }],
  } : request(method, ...args);
  const app = render(React.createElement(App, { client, hostPath: "fake-host", mode: "screen" }));
  try {
    await sleep(100);
    assert.match(app.lastFrame(), /最新正文/);
    for (let i = 0; i < 10; i++) { app.stdin.write("\x1b[5~"); await sleep(10); }
    assert.match(app.lastFrame(), /最早正文/);
    for (let i = 0; i < 10; i++) { app.stdin.write("\x1b[6~"); await sleep(10); }
    assert.match(app.lastFrame(), /最新正文/);
  } finally { app.unmount(); }
});

test("App：多行粘贴只填草稿，不触发发送，审批详情控制码可见转义", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("第一行\n第二行"); await sleep(30);
    assert.match(app.lastFrame(), /第一行[\s\S]*第二行▌/);
    assert.equal(client.calls.filter((call) => call.method === "task/start").length, 0);
    client.emit({ method: "approval/asked", params: {
      approvalId: 101, sessionId: "s1", tool: "write", argumentsJson: "内容\x1b[2J末尾",
    } });
    await sleep(20);
    app.stdin.write("d"); await sleep(40);
    assert.match(app.lastFrame(), /内容\\u001b\[2J末尾/);
    app.stdin.write("n"); await sleep(30);
    assert.match(app.lastFrame(), /第一行[\s\S]*第二行▌/);
  } finally { app.unmount(); }
});

test("App：斜杠菜单可发现命令，Tab 补全，真实模型 ID 进入起轮参数", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("/mo"); await sleep(30);
    assert.match(app.lastFrame(), /\/model.*选择/);
    app.stdin.write("\t"); await sleep(20);
    assert.match(app.lastFrame(), /\/model ▌/);
    app.stdin.write("\r"); await sleep(50);
    assert.match(app.lastFrame(), /编程模型/);
    app.stdin.write("\x1b[B"); await sleep(10);
    app.stdin.write("\r"); await sleep(30);
    app.stdin.write("解释项目"); await sleep(10);
    app.stdin.write("\r"); await sleep(120);
    assert.ok(client.calls.some((call) => call.method === "task/start" && call.params.customModelId === "coding"));
    assert.ok(!client.calls.some((call) => call.method === "model/list"));
  } finally { app.unmount(); }
});

test("App：Ctrl+J 多行原文提交，Ctrl+C 清空草稿但不退出", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    for (const input of ["待清空", "\x03", "第一行", "\n", "第二行"]) {
      app.stdin.write(input); await sleep(20);
    }
    assert.match(app.lastFrame(), /第一行[\s\S]*第二行/);
    app.stdin.write("\r"); await sleep(120);
    assert.ok(client.calls.some((call) => call.method === "session/append" && call.params.data === "第一行\n第二行"));
  } finally { app.unmount(); }
});

test("App：生成中命令不能切换会话或目录", async () => {
  const client = new FakeClient(); client.holdTurn = true;
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("开始"); await sleep(10); app.stdin.write("\r"); await sleep(70);
    for (const command of ["/new ", "/directory D:/other", "/resume ", "/rename 新名", "/archive "]) {
      app.stdin.write(command); await sleep(10); app.stdin.write("\r"); await sleep(20);
    }
    assert.ok(!client.calls.some((call) => ["session/create", "session/select", "session/rename", "session/archive", "workspace/set-directory"].includes(call.method)));
    app.stdin.write("\x03"); await sleep(180);
  } finally { app.unmount(); }
});

test("App：新建、目录设置、恢复会话的实际接线与回读", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let active = "s1";
  let directory = "D:/demo";
  client.request = async (method, params = {}) => {
    if (!["session/create", "session/select", "workspace/set-directory", "session/catalog", "workspace/get", "session/projection"].includes(method)) return request(method, params);
    client.calls.push({ method, params });
    if (method === "session/create") return { id: "s2", saved: true };
    if (method === "session/select") { active = params.sessionId; return { id: active, selected: true, saved: true }; }
    if (method === "workspace/set-directory") { directory = params.directory; return { saved: true }; }
    if (method === "workspace/get") return { directory };
    if (method === "session/catalog") return { entries: [
      { id: "s1", title: "旧会话", current: active === "s1" },
      { id: "s2", title: "新会话", current: active === "s2" },
    ] };
    return { sessionId: active, messageRows: [], toolCalls: [] };
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  const send = async (text) => { app.stdin.write(text); await sleep(15); app.stdin.write("\r"); await sleep(80); };
  try {
    await sleep(80);
    await send("/new 新会话");
    assert.ok(client.calls.some((call) => call.method === "session/select" && call.params.sessionId === "s2"));
    assert.match(app.lastFrame(), /新会话/);
    await send("/directory D:/other project");
    assert.ok(client.calls.some((call) => call.method === "workspace/set-directory" && call.params.sessionId === "s2" && call.params.directory === "D:/other project"));
    assert.match(app.lastFrame(), /D:\/other project/);
    app.stdin.write("\x1b"); await sleep(20);
    await send("/resume");
    assert.match(app.lastFrame(), /恢复会话/);
    app.stdin.write("\r"); await sleep(80);
    assert.equal(active, "s1");
    assert.match(app.lastFrame(), /旧会话/);
  } finally { app.unmount(); }
});

test("App：模型目录失败可退回，不伪造选项、不起模型请求", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, ...args) => {
    if (method === "custom/describe") throw new Error("registry-read-failed");
    return request(method, ...args);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("/model"); await sleep(10); app.stdin.write("\r"); await sleep(50);
    assert.match(app.lastFrame(), /registry-read-failed/);
    assert.doesNotMatch(app.lastFrame(), /编程模型/);
    app.stdin.write("\x1b"); await sleep(30);
    assert.doesNotMatch(app.lastFrame(), /↑↓ 选择/);
    assert.ok(!client.calls.some((call) => call.method === "task/start"));
  } finally { app.unmount(); }
});

test("App：新建写入结果未知时冻结输入，不自动重试或在旧会话继续发送", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, ...args) => {
    if (method === "session/create") {
      client.calls.push({ method });
      throw new Error("timeout: session/create");
    }
    return request(method, ...args);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("/new 新会话"); await sleep(10); app.stdin.write("\r"); await sleep(50);
    assert.match(app.lastFrame(), /修改未确认/);
    app.stdin.write("不要误发送"); await sleep(10); app.stdin.write("\r"); await sleep(30);
    assert.equal(client.calls.filter((call) => call.method === "session/create").length, 1);
    assert.ok(!client.calls.some((call) => call.method === "session/append"));
  } finally { app.unmount(); }
});

test("App：工具菜单显示关联结果，stats读取真实回执，Esc返回不发送", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, ...args) => {
    if (method === "session/projection") return { sessionId: "s1", messageRows: [
      { id: "event-4", eventType: "tool/result", text: "README真实结果" },
    ], toolCalls: [{ id: "t1", name: "read", arguments: '{"path":"README.md"}', status: "completed", callId: "c1", resultMessageId: "event-4" }] };
    return request(method, ...args);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("/tools"); await sleep(10); app.stdin.write("\r"); await sleep(40);
    app.stdin.write("\r"); await sleep(40);
    assert.match(app.lastFrame(), /README真实结果/);
    assert.match(app.lastFrame(), /调用：c1/);
    app.stdin.write("\x1b"); await sleep(15);
    app.stdin.write("/stats"); await sleep(10); app.stdin.write("\r"); await sleep(40);
    assert.match(app.lastFrame(), /"used": 10/);
    app.stdin.write("\x1b"); await sleep(15);
    assert.ok(!client.calls.some((call) => call.method === "session/append"));
    assert.ok(client.calls.filter((call) => call.method === "usage/status").length >= 2);
  } finally { app.unmount(); }
});

test("App：撤销重做与词删除可操作，发送后不能撤销回旧草稿", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  const key = async (value) => { app.stdin.write(value); await sleep(20); };
  try {
    await sleep(80);
    await key("hello 世界"); await key("\x17");
    assert.match(app.lastFrame(), /hello ▌/);
    await key("\x1a");
    assert.match(app.lastFrame(), /hello 世界▌/);
    await key("\x19");
    assert.match(app.lastFrame(), /hello ▌/);
    await key("\r"); await sleep(100);
    await key("\x1a");
    assert.match(app.lastFrame(), /输入任务，或 \/ 查看命令/);
    assert.equal(client.calls.filter((call) => call.method === "task/start").length, 1);
  } finally { app.unmount(); }
});

test("App：历史搜索可取消恢复草稿，命中只回填不自动请求", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  const key = async (value) => { app.stdin.write(value); await sleep(20); };
  try {
    await sleep(80);
    await key("搜索目标"); await key("\r"); await sleep(120);
    await key("未发送草稿"); await key("\x12"); await key("目标");
    assert.match(app.lastFrame(), /搜索目标/);
    await key("\x1b");
    assert.match(app.lastFrame(), /未发送草稿▌/);
    await key("\x12"); await key("目标"); await key("\r");
    assert.match(app.lastFrame(), /搜索目标▌/);
    assert.equal(client.calls.filter((call) => call.method === "task/start").length, 1);
  } finally { app.unmount(); }
});

test("App：工具详情 e 真正展开全部结果，展开不答审批或请求模型", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, ...args) => method === "session/projection" ? {
    sessionId: "s1", messageRows: [{ id: "event-4", eventType: "tool/result", text: "头部\n" + "正文\n".repeat(60) + "尾部标记" }],
    toolCalls: [{ id: "t1", eventSeq: 3, name: "read", arguments: "{}", status: "completed", callId: "c1", resultMessageId: "event-4" }],
  } : request(method, ...args);
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("/tools"); await sleep(15); app.stdin.write("\r"); await sleep(50);
    app.stdin.write("\r"); await sleep(50);
    assert.doesNotMatch(app.lastFrame(), /尾部标记/);
    app.stdin.write("e"); await sleep(40);
    for (let i = 0; i < 10; i++) { app.stdin.write("\x1b[6~"); await sleep(10); }
    assert.match(app.lastFrame(), /尾部标记/);
    app.stdin.write("e"); await sleep(40);
    assert.doesNotMatch(app.lastFrame(), /尾部标记/);
    assert.equal(client.answers.length, 0);
    assert.ok(!client.calls.some((call) => call.method === "task/start"));
  } finally { app.unmount(); }
});

test("App：审批默认 Enter 拒绝，预览/搜索按键不能意外放行", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    client.emit({ method: "approval/asked", params: { approvalId: 301, sessionId: "s1", tool: "edit",
      argumentsJson: JSON.stringify({ path: "a.txt", old_string: "未完成", new_string: "已完成" }) } });
    await sleep(30);
    assert.match(app.lastFrame(), /非磁盘差异/);
    app.stdin.write("\x12"); await sleep(20);
    assert.doesNotMatch(app.lastFrame(), /历史搜索：/);
    app.stdin.write("\r"); await sleep(40);
    assert.deepEqual(client.answers, [{ approvalId: 301, decision: "denied" }]);
    assert.ok(!client.calls.some((call) => call.method === "task/start"));
  } finally { app.unmount(); }
});

test("App：Home/End和终端DEL按编辑语义处理，发送文本没有控制字节", async () => {
  const client = new FakeClient();
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    for (const input of ["ab", "\x1b[H", "X", "\x1b[F", "Y", "\x7f", "\r"]) {
      app.stdin.write(input); await sleep(20);
    }
    await sleep(100);
    assert.ok(client.calls.some((call) => call.method === "session/append" && call.params.data === "Xab"));
  } finally { app.unmount(); }
});

test("App：@文件只浏览并补全路径，含空格路径不误发送，Esc恢复编辑", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === "workspace/files") {
      client.calls.push({ method, params });
      return { directory: "D:/demo", files: [{ name: "中文 README.md", isDir: false }] };
    }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    for (let i = 0; i < 75 && !app.lastFrame()?.includes('输入任务，或'); i++) await sleep(40);
    app.stdin.write("解释 @");
    for (let i = 0; i < 75 && !app.lastFrame()?.includes('文件  中文 README.md'); i++) await sleep(40);
    assert.match(app.lastFrame(), /文件  中文 README.md/);
    app.stdin.write("\t");
    for (let i = 0; i < 75 && !app.lastFrame()?.includes('@"中文 README.md"'); i++) await sleep(40);
    assert.match(app.lastFrame(), /@"中文 README.md"/);
    assert.ok(!client.calls.some((call) => ["attachment/upload", "task/start", "tool/call"].includes(call.method)));
    await sleep(40); // 等补全后的输入焦点监听完成切换，不把同帧Enter交给旧菜单闭包。
    app.stdin.write("\r"); await sleep(130);
    assert.match(app.lastFrame(), /确认读取并发送文本引用/);
    assert.ok(!client.calls.some((call) => ['session/append', 'extension/call', 'task/start'].includes(call.method)));
    app.stdin.write('\r'); await sleep(40); // 默认取消，草稿仍保留。
    assert.match(app.lastFrame(), /解释 @"中文 README.md"/);
  } finally { app.unmount(); }
});

test("App：/diff显示真实回执patch或失败，不修改文件、不请求模型", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === "workspace/git-status") return { ...params, output: "## main\0 M a.txt\0", exitCode: 0, failure: "", truncated: false };
    if (method === "workspace/git-diff") {
      client.calls.push({ method, params });
      return { ...params, output: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new", exitCode: 0, failure: "", truncated: false };
    }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("/diff"); await sleep(15); app.stdin.write("\r"); await sleep(60);
    assert.match(app.lastFrame(), /未暂存 M.*a.txt/);
    app.stdin.write("\r"); await sleep(60);
    assert.match(app.lastFrame(), /\+new/);
    assert.ok(client.calls.some((call) => call.method === "workspace/git-diff" && call.params.scope === "working"));
    assert.ok(!client.calls.some((call) => ["task/start", "execution/propose"].includes(call.method)));
  } finally { app.unmount(); }
});

test("App：文件浏览Esc收起后迟到结果不重开，失败不变成空目录", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let resolveFiles;
  client.request = async (method, params) => method === "workspace/files"
    ? new Promise((resolve) => { resolveFiles = resolve; }) : request(method, params);
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  try {
    await sleep(80);
    app.stdin.write("@"); await sleep(150);
    assert.ok(resolveFiles);
    app.stdin.write("\x1b"); await sleep(20);
    resolveFiles({ directory: "D:/demo", files: [{ name: "late.txt" }] }); await sleep(40);
    assert.doesNotMatch(app.lastFrame(), /文件  late.txt/);
    assert.match(app.lastFrame(), /@▌/);
    assert.ok(!client.calls.some((call) => call.method === "task/start"));
  } finally { app.unmount(); }
});

test("App：Git失败不显示干净仓库，未跟踪文件不发空patch请求", async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let failing = true;
  client.request = async (method, params) => {
    if (method === "workspace/git-status") return { ...params, output: failing ? "" : "## main\0?? draft.txt\0",
      failure: failing ? "git-process-failed" : "", exitCode: failing ? -1 : 0, truncated: false };
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: "fake-host" }));
  const send = async () => { app.stdin.write("/diff"); await sleep(15); app.stdin.write("\r"); await sleep(50); };
  try {
    await sleep(80);
    await send();
    assert.match(app.lastFrame(), /git-process-failed/);
    assert.doesNotMatch(app.lastFrame(), /当前状态没有变更/);
    app.stdin.write("\x1b"); await sleep(15);
    failing = false;
    await send();
    app.stdin.write("\r"); await sleep(40);
    assert.match(app.lastFrame(), /没有索引基线/);
    assert.ok(!client.calls.some((call) => call.method === "workspace/git-diff"));
  } finally { app.unmount(); }
});

test('App：技能/MCP/权限/计划菜单读取Host事实，不安装/连接/改模式', async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'initialize') return { capabilities: ['skill/list', 'skill/get', 'mcp/list', 'mcp/status', 'approval/get-mode', 'plan/get-mode'] };
    const replies = {
      'skill/list': [{ name: 'review', description: '审查技能' }],
      'skill/get': { name: 'review', description: '审查', content: '# 技能正文测试' },
      'mcp/list': { servers: ['demo'] }, 'mcp/status': { connected: false },
      'approval/get-mode': { ok: true, mode: 'build' }, 'plan/get-mode': { ok: true, active: false },
    };
    if (method in replies) { client.calls.push({ method, params }); return replies[method]; }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (text) => { app.stdin.write(text); await sleep(30); };
  const command = async (text) => { await key(text); await key('\r'); await sleep(30); };
  try {
    await sleep(80);
    await command('/skills'); assert.match(app.lastFrame(), /review.*审查技能/);
    await key('\r'); assert.match(app.lastFrame(), /技能正文测试/);
    await key('\x1b'); await command('/mcp'); await key('\r');
    assert.match(app.lastFrame(), /未连接/);
    await key('\x1b'); await command('/permissions'); assert.match(app.lastFrame(), /build/);
    await key('\x1b'); await command('/plan'); assert.match(app.lastFrame(), /未进入/);
    assert.ok(!client.calls.some((call) => /mcp\/(connect|tools|call)|set-mode|session\/append|task\/start/.test(call.method)));
  } finally { app.unmount(); }
});

test('App：能力未声明明确报错，技能浏览取消后迟到响应不重开', async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let resolveList;
  let capability = false;
  client.request = async (method, params) => {
    if (method === 'initialize') return { capabilities: capability ? ['skill/list'] : [] };
    if (method === 'skill/list') return new Promise((resolve) => { resolveList = resolve; });
    return request(method, params);
  };
  let app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  try {
    await sleep(80); app.stdin.write('/skills'); await sleep(15); app.stdin.write('\r'); await sleep(40);
    assert.match(app.lastFrame(), /未声明 skill\/list/);
  } finally { app.unmount(); }
  capability = true;
  app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  try {
    await sleep(80); app.stdin.write('/skills'); await sleep(15); app.stdin.write('\r'); await sleep(30);
    app.stdin.write('\x1b'); await sleep(20);
    resolveList([{ name: 'late', description: '不应出现' }]); await sleep(50);
    assert.doesNotMatch(app.lastFrame(), /late.*不应出现/);
  } finally { app.unmount(); }
});

test('App：只读能力入口拒绝执行型参数；任务在途不查询技能/MCP或模式', async () => {
  const client = new FakeClient();
  client.holdTurn = true;
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const send = async (command) => { app.stdin.write(command); await sleep(15); app.stdin.write('\r'); await sleep(35); };
  try {
    await sleep(80);
    await send('/permissions yolo');
    assert.match(app.lastFrame(), /不支持执行/);
    await send('开始任务');
    await send('/mcp connect');
    await send('/skills ');
    await send('/plan ');
    assert.ok(!client.calls.some((call) => /mcp\/|skill\/|set-mode|get-mode/.test(call.method)));
    app.stdin.write('\x03'); await sleep(180);
  } finally { app.unmount(); }
});

test('App：换会话清除未发草稿及撤销历史，同会话只查看目录不抹输入历史', async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let active = 's1';
  client.request = async (method, params) => {
    if (method === 'session/catalog') return { entries: [
      { id: 's1', title: '会话一', current: active === 's1' }, { id: 's2', title: '会话二', current: active === 's2' },
    ] };
    if (method === 'session/select') { active = params.sessionId; return { selected: true, saved: true, id: active }; }
    if (method === 'session/projection') return { sessionId: active, messageRows: [], toolCalls: [] };
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (value) => { app.stdin.write(value); await sleep(25); };
  try {
    await sleep(80);
    await key('旧会话输入'); await key('\r'); await sleep(100);
    await key('/directory '); await key('\r'); await sleep(50); await key('\x1b');
    await key('\x1b[A');
    assert.match(app.lastFrame(), /旧会话输入▌/);
    await key('\x03');
    await key('/resume '); await key('\r'); await sleep(40);
    // 对话框打开时保留草稿不应跨会话残留；切换后撤销也不能找回来。
    await key('\x1b[B'); await key('\r'); await sleep(60);
    await key('\x1a'); await key('\x1b[A');
    assert.equal(active, 's2');
    assert.match(app.lastFrame(), /输入任务，或 \/ 查看命令/);
  } finally { app.unmount(); }
});

test('App：会话搜索与归档确认默认取消，选择后实际写并回读', async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let entries = [{ id: 's1', title: '当前会话', durable: 2, current: true, archived: false },
    { id: 's2', title: '项目Alpha', durable: 3, current: false, archived: false, workspaceDirectory: 'D:/alpha' }];
  client.request = async (method, params) => {
    if (method === 'initialize') return { capabilities: ['session/archive', 'session/rename'] };
    if (method === 'session/catalog') return { entries };
    if (method === 'session/archive') {
      client.calls.push({ method, params });
      entries = entries.map((entry) => entry.id === params.sessionId ? { ...entry, archived: params.archived, durable: entry.durable + 1 } : entry);
      return { saved: true, sessionId: 's2', revision: entries[1].durable };
    }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await sleep(100);
    await key('/archive'); await key('\r'); await key('Alpha');
    assert.match(app.lastFrame(), /项目Alpha/);
    assert.doesNotMatch(app.lastFrame(), /● 当前/);
    await key('\r'); assert.match(app.lastFrame(), /确认归档/);
    await key('\r'); // 默认取消
    assert.equal(client.calls.filter((call) => call.method === 'session/archive').length, 0);
    await key('/archive'); await key('\r'); await key('\r'); await key('\x1b[A'); await key('\r');
    assert.equal(entries[1].archived, true);
    await key('/archive'); await key('\r'); await key('\x01');
    assert.match(app.lastFrame(), /已归档/);
    await key('\r'); await key('\x1b[A'); await key('\r');
    assert.equal(entries[1].archived, false);
    assert.ok(!client.calls.some((call) => call.method === 'task/start'));
  } finally { app.unmount(); }
});

test('App：重命名必须确认，当前会话写入未知会冻结输入且不重试', async () => {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'initialize') return { capabilities: ['session/rename'] };
    if (method === 'session/catalog') return { entries: [{ id: 's1', title: '旧标题', durable: 2, current: true, archived: false }] };
    if (method === 'session/rename') { client.calls.push({ method, params }); throw new Error('timeout'); }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await sleep(100);
    await key('/rename 新标题'); await key('\r');
    assert.match(app.lastFrame(), /确认重命名/);
    assert.equal(client.calls.filter((call) => call.method === 'session/rename').length, 0);
    await key('\x1b[A'); await key('\r');
    assert.match(app.lastFrame(), /修改未确认/);
    await key('禁止发送'); await key('\r');
    assert.equal(client.calls.filter((call) => call.method === 'session/rename').length, 1);
    assert.ok(!client.calls.some((call) => call.method === 'session/append'));
  } finally { app.unmount(); }
});

async function waitForFrame(app, pattern) {
  for (let i = 0; i < 100 && !pattern.test(app.lastFrame() || ''); i++) await sleep(20);
  assert.match(app.lastFrame(), pattern);
  await sleep(20); // 可见帧之后等待输入监听器effect交接。
}

function metadataClient() {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.entries = [{ id: 's1', title: '当前会话', durable: 2, current: true, archived: false },
    { id: 's2', title: '归档项目', durable: 3, current: false, archived: true, workspaceDirectory: 'D:/archived' }];
  client.request = async (method, params = {}) => {
    if (method === 'initialize') return { capabilities: ['session/rename', 'session/archive'] };
    if (method === 'session/catalog') return { entries: client.entries };
    if (method === 'session/rename' || method === 'session/archive') {
      client.calls.push({ method, params });
      await client.beforeWrite?.();
      client.entries = client.entries.map((entry) => entry.id !== params.sessionId ? entry : { ...entry,
        durable: entry.durable + 1, ...(method === 'session/rename' ? { title: params.title } : { archived: params.archived }) });
      return { saved: true, sessionId: params.sessionId, revision: client.entries.find((entry) => entry.id === params.sessionId).durable };
    }
    return request(method, params);
  };
  return client;
}

test('App：会话搜索无匹配不发送，过滤重置焦点，恢复归档不自动切换', async () => {
  const client = metadataClient();
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(30); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('/resume '); await key('\r'); await waitForFrame(app, /搜索：/);
    await key('不存在'); await key('\r');
    assert.match(app.lastFrame(), /无匹配会话/);
    await key('\x15'); await key('\x01');
    assert.match(app.lastFrame(), /归档项目/);
    await key('\r'); await waitForFrame(app, /确认恢复归档/);
    assert.match(app.lastFrame(), /❯ 取消（默认）/);
    assert.doesNotMatch(app.lastFrame(), /Enter 发送|输入任务，或/);
    await key('不应进入草稿'); await key('\x1b[A'); await key('\r');
    await waitForFrame(app, /已恢复归档/);
    assert.equal(client.entries[1].archived, false);
    assert.ok(!client.calls.some((call) => ['session/select', 'session/append', 'task/start'].includes(call.method)));
    assert.doesNotMatch(app.lastFrame(), /不应进入草稿/);
  } finally { app.unmount(); }
});

test('App：重命名保存期间重复Enter和Esc不重复写，成功即时显示新标题', async () => {
  const client = metadataClient();
  let release;
  client.beforeWrite = () => new Promise((resolve) => { release = resolve; });
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(30); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('/rename 底栏新标题'); await key('\r'); await waitForFrame(app, /确认重命名/);
    await key('\x1b[A'); await key('\r'); await waitForFrame(app, /等待宿主保存并回读/);
    await key('\r'); await key('\r'); await key('\x1b'); await key('不能发送');
    assert.equal(client.calls.filter((call) => call.method === 'session/rename').length, 1);
    assert.match(app.lastFrame(), /确认重命名/);
    release(); await waitForFrame(app, /会话已重命名/);
    assert.match(app.lastFrame(), /底栏新标题.*D:\/demo/);
    assert.doesNotMatch(app.lastFrame(), /不能发送/);
    assert.ok(!client.calls.some((call) => call.method === 'session/append'));
  } finally { release?.(); app.unmount(); }
});

test('App：旧确认修订与Host冲突都阻断原确认，Esc后才可重新读取', async () => {
  for (const conflict of ['preflight', 'host']) {
    const client = metadataClient();
    if (conflict === 'host') client.beforeWrite = async () => { throw new Error('session-revision-conflict'); };
    const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
    const key = async (input) => { app.stdin.write(input); await sleep(30); };
    try {
      await waitForFrame(app, /输入任务，或/);
      await key('/rename 新标题'); await key('\r'); await waitForFrame(app, /确认重命名/);
      if (conflict === 'preflight') client.entries[0] = { ...client.entries[0], durable: 4 };
      await key('\x1b[A'); await key('\r'); await waitForFrame(app, /确认已失效/);
      await key('\r'); await key('\r');
      assert.equal(client.calls.filter((call) => call.method === 'session/rename').length, conflict === 'host' ? 1 : 0);
      await key('\x1b'); await waitForFrame(app, /输入任务，或/);
      assert.ok(!client.calls.some((call) => call.method === 'session/append'));
    } finally { app.unmount(); }
  }
});

test('App：会话目录读取在途可退出，迟到响应不重开面板', async () => {
  const client = metadataClient();
  const request = client.request.bind(client);
  let reads = 0;
  let release;
  client.request = async (method, params) => {
    if (method === 'session/catalog' && ++reads > 1) await new Promise((resolve) => { release = resolve; });
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(30); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('/resume '); await key('\r'); await waitForFrame(app, /正在读取宿主数据/);
    await key('\x1b'); await waitForFrame(app, /输入任务，或/);
    release(); await sleep(60);
    assert.doesNotMatch(app.lastFrame(), /搜索：|恢复会话/);
    assert.ok(!client.calls.some((call) => call.method === 'session/select'));
  } finally { release?.(); app.unmount(); }
});

test('App：审批接管输入时不能打开或执行会话元信息修改', async () => {
  const client = metadataClient();
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(30); };
  try {
    await waitForFrame(app, /输入任务，或/);
    client.emit({ method: 'approval/asked', params: { approvalId: 99, tool: 'write', source: 'model', sessionId: 's1', argumentsJson: '{}' } });
    await waitForFrame(app, /审批 #99/);
    await key('/rename 新标题'); await key('\r'); await key('/archive'); await key('\r');
    assert.ok(!client.calls.some((call) => ['session/rename', 'session/archive', 'session/select', 'task/start'].includes(call.method)));
    assert.doesNotMatch(app.lastFrame(), /确认重命名|确认归档/);
  } finally { app.unmount(); }
});

function referenceClient() {
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'extension/list') return { tools: [{ name: 'read', needsApproval: false }] };
    if (method === 'workspace/files') return { directory: 'D:/demo', files: [{ name: 'a.txt', isDir: false, size: 9 }] };
    if (method === 'extension/call') {
      client.calls.push({ method, params });
      await client.readHook?.();
      return { result: '引用正文😀' };
    }
    if (method === 'session/flush' || method === 'session/append') { client.calls.push({ method, params }); return { events: 4, durable: 4 }; }
    return request(method, params);
  };
  return client;
}

test('App：文本引用确认默认取消保留草稿；显式确认后read→flush→append→task/start', async () => {
  const client = referenceClient();
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('解释 @"a.txt" '); await key('\r'); await waitForFrame(app, /确认读取并发送文本引用/);
    assert.doesNotMatch(app.lastFrame(), /Enter 发送|输入任务，或/);
    assert.match(app.lastFrame(), /❯ 取消/);
    await key('\r');
    assert.match(app.lastFrame(), /解释 @"a.txt"/);
    assert.ok(!client.calls.some((call) => ['extension/call', 'session/append', 'task/start'].includes(call.method)));
    await key('\r'); await waitForFrame(app, /确认读取并发送文本引用/);
    await key('\x1b[A'); await key('\r'); await waitForFrame(app, /收到/);
    const sequence = client.calls.filter((call) => ['extension/call', 'session/flush', 'session/append', 'task/start'].includes(call.method));
    assert.deepEqual(sequence.map((call) => call.method), ['extension/call', 'session/flush', 'session/append', 'task/start']);
    const payload = sequence.find((call) => call.method === 'session/append').params.data;
    assert.ok(payload.includes('引用正文😀'));
    assert.equal(referenceMessageView(payload).text, '解释 @"a.txt"');
  } finally { app.unmount(); }
});

test('App：引用读取中重复Enter不重发；Esc等待结算后保留草稿且不起模型轮', async () => {
  const client = referenceClient();
  let release;
  client.readHook = () => new Promise((resolve) => { release = resolve; });
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('解释 @"a.txt" '); await key('\r'); await waitForFrame(app, /确认读取并发送文本引用/);
    await key('\x1b[A'); await key('\r'); await waitForFrame(app, /正在读取/);
    await key('\r'); await key('\r'); await key('\x1b');
    assert.match(app.lastFrame(), /取消已请求/);
    release(); await waitForFrame(app, /消息未发送/);
    assert.equal(client.calls.filter((call) => call.method === 'extension/call').length, 1);
    assert.equal(client.calls.filter((call) => call.method === 'session/flush').length, 1);
    assert.ok(!client.calls.some((call) => ['session/append', 'task/start'].includes(call.method)));
    await key('\x1b'); assert.match(app.lastFrame(), /解释 @"a.txt"/);
  } finally { release?.(); app.unmount(); }
});

test('App：引用读取超时冻结输入，不能重新Enter或在旧草稿继续发轮次', async () => {
  const client = referenceClient();
  client.readHook = async () => { throw new Error('timeout: extension/call'); };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('解释 @"a.txt" '); await key('\r'); await waitForFrame(app, /确认读取并发送文本引用/);
    await key('\x1b[A'); await key('\r'); await waitForFrame(app, /引用读取结果未知/);
    await key('\r'); await key('不应发送'); await key('\r');
    assert.equal(client.calls.filter((call) => call.method === 'extension/call').length, 1);
    assert.ok(!client.calls.some((call) => ['session/append', 'task/start'].includes(call.method)));
  } finally { app.unmount(); }
});

function actionClient() {
  const client = new FakeClient();
  const request = client.request.bind(client);
  let events = 3;
  client.request = async (method, params = {}) => {
    if (method === 'initialize') return { protocolVersion: '0.1', capabilities: ['compact/run', 'compact/describe', 'session/clear'] };
    if (method === 'model/registry/describe') return { providers: [], defaultProviderId: '', defaultModel: '', revision: 0, writable: false };
    if (method === 'compact/describe') return { sessionId: 's1', state: 'ready', reason: '', eventCount: 10, durableCount: 8, indexRevision: 0, strategy: 'local-extractive-v1', lossy: true, workspaceBound: false, beforeInputBound: null, afterInputBound: null };
    if (method === 'compact/run') { client.calls.push({ method, params }); return { sessionId: 's1', status: 'applied', reason: '', savedInputBound: 5000, strategy: 'local-extractive-v1', lossy: true }; }
    if (method === 'session/clear') { client.calls.push({ method, params }); events = 1; return { cleared: true, sessionId: params.sessionId, revision: 1 }; }
    if (method === 'session/projection') return { sessionId: 's1', events, durable: events, messageRows: events > 1 ? [{ id: 'e1', eventType: 'user/message', text: '旧消息' }] : [], toolCalls: events > 1 ? [{ id: 't1', name: 'read', status: 'completed' }] : [] };
    return request(method, params);
  };
  return client;
}

test('App：/compact默认取消不执行；确认后compact/run并刷新投影', async () => {
  const client = actionClient();
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('/compact'); await key('\r');
    for (let i = 0; i < 150 && !/压缩会话历史/.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), /压缩会话历史/);
    assert.match(app.lastFrame(), /有损/);
    assert.match(app.lastFrame(), /❯ 取消/);
    await key('\r'); // 默认取消
    assert.ok(!client.calls.some((c) => c.method === 'compact/run'));
    await key('/compact'); await key('\r');
    for (let i = 0; i < 150 && !/压缩会话历史/.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), /压缩会话历史/);
    await key('\x1b[A'); await key('\r'); // 确认
    for (let i = 0; i < 150 && !/已压缩/.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), /已压缩.*5000/);
    assert.ok(client.calls.some((c) => c.method === 'compact/run' && c.params.sessionId === 's1'));
    assert.ok(!client.calls.some((c) => c.method === 'task/start'));
  } finally { app.unmount(); }
});

test('App：/clear默认取消；确认后session/clear并刷新，无消息残留', async () => {
  const client = actionClient();
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    assert.match(app.lastFrame(), /旧消息/);
    await key('/clear'); await key('\r');
    for (let i = 0; i < 150 && !/清空对话历史/.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), /清空对话历史/);
    assert.match(app.lastFrame(), /1条消息.*1个工具调用/);
    await key('\r'); // 默认取消
    assert.match(app.lastFrame(), /旧消息/);
    await key('/clear'); await key('\r');
    for (let i = 0; i < 150 && !/清空对话历史/.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), /清空对话历史/);
    await key('\x1b[A'); await key('\r'); // 确认
    for (let i = 0; i < 150 && !/已清空/.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), /已清空/);
    assert.ok(client.calls.some((c) => c.method === 'session/clear' && c.params.sessionId === 's1'));
    assert.ok(!client.calls.some((c) => c.method === 'task/start'));
    // Static模式不清除已打印历史，但投影已刷新；不检查旧消息消失
  } finally { app.unmount(); }
});

test('App：compact在途拒绝后保留确认页显示错误，不自动重试', async () => {
  const client = actionClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'compact/run') { client.calls.push({ method, params }); throw new Error('-32001 session-resources-in-flight'); }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('/compact'); await key('\r'); await waitForFrame(app, /压缩会话历史/);
    await key('\x1b[A'); await key('\r'); await waitForFrame(app, /session-resources-in-flight|Esc返回/);
    await key('\r');
    assert.equal(client.calls.filter((c) => c.method === 'compact/run').length, 1);
    await key('\x1b'); assert.match(app.lastFrame(), /输入任务，或/);
  } finally { app.unmount(); }
});

test('App：运行中不能执行compact/clear', async () => {
  const client = actionClient(); client.holdTurn = true;
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(30); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('开始'); await key('\r'); await sleep(80);
    await key('/compact'); await key('\r'); await key('/clear'); await key('\r');
    assert.ok(!client.calls.some((c) => ['compact/run', 'session/clear'].includes(c.method)));
    await key('\x03'); await sleep(150);
  } finally { app.unmount(); }
});

test('App：引用消息append回执非持久则不起模型轮，冻结且不重复追加', async () => {
  const client = referenceClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'session/append') { client.calls.push({ method, params }); return { events: 5, durable: 4 }; }
    return request(method, params);
  };
  const app = render(React.createElement(App, { client, hostPath: 'fake-host' }));
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await waitForFrame(app, /输入任务，或/);
    await key('解释 @"a.txt" '); await key('\r'); await waitForFrame(app, /确认读取并发送文本引用/);
    await key('\x1b[A'); await key('\r'); await waitForFrame(app, /引用消息或模型起轮未确认/);
    await key('\r'); await key('不再发送'); await key('\r');
    assert.equal(client.calls.filter((call) => call.method === 'session/append').length, 1);
    assert.ok(!client.calls.some((call) => call.method === 'task/start'));
  } finally { app.unmount(); }
});
