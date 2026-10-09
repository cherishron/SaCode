// Computer Use 协议夹具：只实现仓颉侧 ComputerProviderClient 需要的 NDJSON JSON-RPC 行为，
// 不加载 @qwen-code/cua-sdk、不触碰真实桌面。场景由 args.scenario 选择。
// 存在意义是让「取消后仍等真实终态」「嵌套 ok 不能盖住根失败」这类契约可被独立复现。
import readline from "node:readline";

const state = { invokes: 0, cancels: 0 };
const pending = new Map();
// 观察面按 pid:windowId 存一次性的 observationId：用过即销，重复使用要报 stale。
const observations = new Map();

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const okEnvelope = (id, verb, content, failureKind = "", message = "") =>
  send({ jsonrpc: "2.0", id, result: { ok: failureKind === "", verb, content, failureKind, message } });
const failEnvelope = (id, verb, content, failureKind, message) =>
  send({ jsonrpc: "2.0", id, result: { ok: false, verb, content, failureKind, message } });

const surface = (args) => `${args.pid}:${args.windowId}`;
const newId = () => `${crypto.randomUUID()}`;

// 已登记的调用在收到取消后按场景决定终态；夹具绝不由取消推断「动作没发生」。
function onCancel(id) {
  const job = pending.get(id);
  if (!job) return;
  job.cancels += 1;
  state.cancels += 1;
  if (job.scenario === "cancel-committed") {
    job.timer = setTimeout(() => {
      pending.delete(id);
      okEnvelope(id, job.verb, { operation: { committed: true }, cancelCount: job.cancels });
    }, 20);
  } else if (job.scenario === "cancel-refused") {
    job.timer = setTimeout(() => {
      pending.delete(id);
      failEnvelope(id, job.verb, { operation: { committed: false } }, "refused", "已拒绝");
    }, 20);
  }
  // never：只记账，永不回帧，由调用方超时得出 outcome-unknown。
}

function dispatch(id, verb, args) {
  state.invokes += 1;
  const scenario = args.scenario;
  if (scenario === "status") return okEnvelope(id, verb, { invokes: state.invokes, pending: pending.size, cancels: state.cancels });
  if (scenario === "nested") return failEnvelope(id, verb, { ok: true }, "native-refused", "真实失败");
  if (scenario === "bad-frame") return send({ jsonrpc: "2.0", id, result: "result 不是对象" });
  if (scenario === "wrong-id") return okEnvelope(id + 1000000, verb, {});
  if (scenario === "wrong-type") return send({ jsonrpc: "2.0", id, result: { ok: "true", verb, content: {}, failureKind: "", message: "" } });
  if (scenario === "error-envelope") return send({ jsonrpc: "2.0", id, error: { code: -32000, message: "fixture error" } });
  if (scenario === "cancel-committed" || scenario === "cancel-refused" || scenario === "never") {
    pending.set(id, { verb, scenario, cancels: 0, timer: null });
    // 没人取消也要自解，避免调用方轮询失败时无限挂起；两个取消分支之外都给终态。
    if (scenario === "never") return;
    const job = pending.get(id);
    job.timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      if (scenario === "cancel-committed") okEnvelope(id, verb, { operation: { committed: true }, cancelCount: job.cancels });
      else failEnvelope(id, verb, { operation: { committed: false } }, "refused", "已拒绝");
    }, 3000);
    return;
  }
  if (verb === "window.observe") {
    const observationId = newId();
    observations.set(surface(args), observationId);
    return okEnvelope(id, verb, { observationId, mode: "full", pid: args.pid, windowId: args.windowId, elements: [{ element_token: "t1" }] });
  }
  if (typeof args.observationId === "string") {
    if (observations.get(surface(args)) !== args.observationId) {
      return failEnvelope(id, verb, { reason: "evidence-consumed" }, "stale-observation", "观察凭据已失效");
    }
    observations.delete(surface(args));
  }
  return okEnvelope(id, verb, { echo: args, nested: { values: [1, 2, 3] } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.method === "computer/cancel") {
    onCancel(msg.params.requestId);
    return send({ jsonrpc: "2.0", id: msg.id, result: { ok: true, verb: "cancel", content: { requestId: msg.params.requestId }, failureKind: "", message: "" } });
  }
  // 客户端 close() 先发 host/shutdown 再有界等待自退；不回帧会被强杀取非零码。
  if (msg.method === "host/shutdown") {
    send({ jsonrpc: "2.0", id: msg.id, result: { ok: true, verb: "shutdown", content: {}, failureKind: "", message: "" } });
    return process.exit(0);
  }
  if (msg.method !== "computer/invoke") return;
  try { dispatch(msg.id, msg.params.verb, msg.params.args); }
  catch (error) { failEnvelope(msg.id, msg.params?.verb ?? "", {}, "fixture-throw", String(error?.message ?? error)); }
});
// stdin 关闭即结算：正在跑的定时器不该阻止退出，否则调用方 close() 拿不到 0。
rl.on("close", () => process.exit(0));
