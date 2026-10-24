// 协议夹具宿主：只实现 TUI 用到的动词，用来验证“前端不伪造审批/结算”。
// 不接模型、不读会话日志，任何真实任务都必须走仓颉宿主。
import { createInterface } from "node:readline";

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

let pollCount = 0;
let approvalDecision = "";
let cancelled = false;
let submitted = "";

const rows = [
  { id: "event-1", eventType: "user/message", text: "历史问题", attachments: [] },
  { id: "event-2", eventType: "assistant/message", text: "历史回答", attachments: [] },
];
const toolCalls = [
  {
    id: "tool-event-3",
    callId: "call-1",
    eventSeq: 3,
    name: "read",
    arguments: "{\"path\":\"README.md\"}",
    resultMessageId: "event-4",
    status: "completed",
  },
];

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    continue;
  }
  const reply = (result) => send({ jsonrpc: "2.0", id: request.id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id: request.id, error: { code, message } });
  const params = request.params || {};

  switch (request.method) {
    case "initialize":
      reply({ protocolVersion: "0.1", capabilities: [] });
      break;
    case "session/catalog":
      reply({
        root: process.cwd(),
        entries: [{ id: "s1", title: "夹具会话", durable: 2, status: "ready", workspaceDirectory: process.cwd(), current: true, archived: false, updatedAt: "" }],
        source: "durable-log",
      });
      break;
    case "workspace/get":
      reply({ sessionId: "s1", revision: 1, directory: process.cwd(), configured: true, available: true, scope: "session" });
      break;
    case "usage/status":
      reply({ used: 10, budget: 100, over: false, verdict: "ok", badUsage: 0 });
      break;
    case "session/projection":
      reply({
        sessionId: "s1",
        projection: 2,
        events: 4,
        durable: 4,
        pending: 0,
        truncatedTail: false,
        messages: [],
        messageRows: rows,
        toolCalls,
        questionCards: [],
        todos: null,
        planActive: false,
        planCards: [],
      });
      break;
    case "session/append":
    case "session/submit":
      submitted = String(params.data ?? "");
      reply({ events: 3, durable: 2 });
      break;
    case "task/start":
    case "turn/start":
      pollCount = 0;
      reply({ started: true, limit: 1, epoch: 1, provider: "fixture", goal: false });
      break;
    case "turn/poll": {
      pollCount += 1;
      if (pollCount === 1) {
        reply({ frames: ["projection:tools", "text:你好"], turn: true, running: true, settled: false, questionId: "", turnId: 7, nextCursor: 2 });
        break;
      }
      if (pollCount === 2) {
        notify("approval/asked", {
          approvalId: 5,
          tool: "write",
          source: "model",
          sessionId: "s1",
          turnRequestId: "req-1",
          argumentsJson: "{\"path\":\"a.txt\"}",
        });
        reply({ frames: ["text:，世界"], turn: true, running: true, settled: false, questionId: "", turnId: 7, nextCursor: 4 });
        break;
      }
      if (!approvalDecision && !cancelled) {
        reply({ frames: [], turn: true, running: true, settled: false, questionId: "", turnId: 7, nextCursor: 4 });
        break;
      }
      reply({
        frames: [],
        turn: false,
        running: false,
        settled: true,
        questionId: "",
        turnId: 7,
        nextCursor: 4,
        cancelled,
        delivered: 1,
        text: cancelled ? "" : "你好，世界",
        finishReason: cancelled ? "cancelled" : "stop",
        interrupted: false,
        settledToolCalls: 1,
        pendingToolCalls: 0,
        overflow: 0,
        dropped: 0,
        usage: "12/100",
        usageVerdict: "ok",
        used: 12,
        budget: 100,
        over: false,
        elapsedMs: 50,
        ttftMs: 10,
        tokensPerSecond: 20,
      });
      break;
    }
    case "approval/answer":
      approvalDecision = String(params.decision ?? "");
      reply({ accepted: true, state: approvalDecision });
      break;
    case "turn/cancel":
      cancelled = true;
      reply({ cancelRequested: true, wasRunning: true, extensionCallsCancelled: 0, inflightCalls: 0 });
      break;
    default:
      fail(-32601, `method-not-found:${request.method}`);
  }
}
