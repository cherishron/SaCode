import { test } from "node:test";
import assert from "node:assert/strict";
import { TargetBridge } from "../target-bridge.mjs";

// 每个 fake transport 记录自己的 sendRequest / subscribeNotifications 调用，
// 并允许测试手动 resolve/reject 或推送帧。
function makeFakeTransport(id) {
  const sent = [];
  const subs = [];
  let closeCalls = 0;
  let bumpCalls = 0;
  return {
    id,
    sent,
    subs,
    get closeCalls() { return closeCalls; },
    get bumpCalls() { return bumpCalls; },
    _pendingResolvers: [],
    async sendRequest(method, params) {
      const rec = { method, params, resolve: null, reject: null };
      sent.push(rec);
      return new Promise((resolve, reject) => {
        rec.resolve = resolve;
        rec.reject = reject;
      });
    },
    async subscribeNotifications(onFrame) {
      const rec = { onFrame, unsubscribed: false };
      subs.push(rec);
      return () => { rec.unsubscribed = true; };
    },
    bumpEpoch() { bumpCalls += 1; },
    close() { closeCalls += 1; },
  };
}

function desc(targetId, kind = "remote") {
  return { targetId, kind, baseUrl: kind === "remote" ? "https://x.example" : null };
}

test("register：首个 target 自动成为 default", () => {
  const b = new TargetBridge();
  b.register(desc("t1"), makeFakeTransport("t1"));
  assert.equal(b.getDefault().targetId, "t1");
});

test("register：重复 targetId 抛 target-duplicate", () => {
  const b = new TargetBridge();
  b.register(desc("t1"), makeFakeTransport("t1"));
  assert.throws(() => b.register(desc("t1"), makeFakeTransport("t1b")), /target-duplicate: t1/);
});

test("register：缺 transport 或形状不对抛 transport-required", () => {
  const b = new TargetBridge();
  assert.throws(() => b.register(desc("t1"), null), /transport-required/);
  assert.throws(() => b.register(desc("t2"), {}), /transport-required/);
});

test("setDefault：未知 targetId 抛 target-not-found", () => {
  const b = new TargetBridge();
  b.register(desc("t1"), makeFakeTransport("t1"));
  assert.throws(() => b.setDefault("nope"), /target-not-found: nope/);
});

test("request：未知 targetId 抛错，绝不 fallback 本机", async () => {
  const b = new TargetBridge();
  const localT = makeFakeTransport("local");
  b.register(desc("local", "local"), localT);
  b.setDefault("local");
  await assert.rejects(() => b.request("ghost", "m", {}), /target-not-found: ghost/);
  assert.equal(localT.sent.length, 0, "本机 transport 不该被兜底调用");
});

test("request：命中正确 transport，不跨 target 串", async () => {
  const b = new TargetBridge();
  const ta = makeFakeTransport("a");
  const tb = makeFakeTransport("b");
  b.register(desc("a"), ta);
  b.register(desc("b"), tb);
  const p = b.request("b", "list_sessions", { x: 1 });
  assert.equal(ta.sent.length, 0);
  assert.equal(tb.sent.length, 1);
  assert.equal(tb.sent[0].method, "list_sessions");
  tb.sent[0].resolve({ ok: 1 });
  assert.deepEqual(await p, { ok: 1 });
});

test("request：在途 resetConnection 后回包判 stale 丢弃", async () => {
  const b = new TargetBridge();
  const t = makeFakeTransport("a");
  b.register(desc("a"), t);
  const p = b.request("a", "m", {});
  await new Promise((r) => setImmediate(r));
  b.resetConnection("a");
  t.sent[0].resolve({ late: true });
  await assert.rejects(() => p, /target-switched-during-request: a/);
});

test("subscribe：帧按 targetId 隔离，不会串到其他 target", async () => {
  const b = new TargetBridge();
  const ta = makeFakeTransport("a");
  const tb = makeFakeTransport("b");
  b.register(desc("a"), ta);
  b.register(desc("b"), tb);
  const aFrames = [];
  const bFrames = [];
  await b.subscribe("a", (f) => aFrames.push(f));
  await b.subscribe("b", (f) => bFrames.push(f));
  // 只让 a 的 transport 推帧，看 b 是否被污染
  ta.subs[0].onFrame({ seq: 1, from: "a" });
  assert.deepEqual(aFrames, [{ seq: 1, from: "a" }]);
  assert.deepEqual(bFrames, []);
});

test("subscribe：目标 resetConnection 后旧订阅帧被丢弃", async () => {
  const b = new TargetBridge();
  const t = makeFakeTransport("a");
  b.register(desc("a"), t);
  const frames = [];
  const unsub = await b.subscribe("a", (f) => frames.push(f));
  // 记录旧 onFrame 引用（resetConnection 会清 subscribers 集合但 onFrame 仍可被外部调用）
  const oldOnFrame = t.subs[0].onFrame;
  unsub();
  b.resetConnection("a");
  // 即便有人拿旧引用调用，路由器层的 connectionEpoch 已递增，帧应被丢弃
  oldOnFrame({ seq: 2, after: "reset" });
  assert.deepEqual(frames, [], "reset 后旧帧必须丢");
});

test("remove：关闭 transport、abort 订阅、default 迁到剩余", async () => {
  const b = new TargetBridge();
  const ta = makeFakeTransport("a");
  const tb = makeFakeTransport("b");
  b.register(desc("a"), ta);
  b.register(desc("b"), tb);
  const unsub = await b.subscribe("a", () => {});
  assert.equal(unsub instanceof Function, true);
  b.remove("a");
  assert.equal(ta.closeCalls, 1);
  assert.equal(ta.subs[0].unsubscribed, true, "remove 时 transport 层的 unsub 要被调用");
  assert.equal(b.getDefault().targetId, "b");
  await assert.rejects(() => b.request("a", "m", {}), /target-not-found: a/);
});

test("resetConnection：递增 epoch 但不删 target，仍可发新请求", async () => {
  const b = new TargetBridge();
  const t = makeFakeTransport("a");
  b.register(desc("a"), t);
  assert.equal(b.currentEpoch("a"), 0);
  const e = b.resetConnection("a");
  assert.equal(e, 1);
  assert.equal(b.currentEpoch("a"), 1);
  assert.equal(t.bumpCalls, 1);
  // 新请求仍能命中
  const p = b.request("a", "m", {});
  await new Promise((r) => setImmediate(r));
  t.sent[0].resolve({ ok: 1 });
  assert.deepEqual(await p, { ok: 1 });
});

test("remove 最后一个 target：default 置 null，再 getDefault 抛 no-target-registered", () => {
  const b = new TargetBridge();
  b.register(desc("only"), makeFakeTransport("only"));
  b.remove("only");
  assert.throws(() => b.getDefault(), /no-target-registered/);
});

test("subscribe：transport 有 getLastEventId 时自动带 resumeEventId", async () => {
  const b = new TargetBridge();
  const calls = [];
  const t = {
    async sendRequest() { return {}; },
    async subscribeNotifications(onFrame, opts) { calls.push(opts ?? {}); return () => {}; },
    getLastEventId() { return "42"; },
  };
  b.register(desc("a"), t);
  await b.subscribe("a", () => {});
  assert.equal(calls[0].resumeEventId, "42");
});

test("subscribe：transport 游标为 null 时不带 resumeEventId", async () => {
  const b = new TargetBridge();
  const calls = [];
  const t = {
    async sendRequest() { return {}; },
    async subscribeNotifications(onFrame, opts) { calls.push(opts ?? {}); return () => {}; },
    getLastEventId() { return null; },
  };
  b.register(desc("a"), t);
  await b.subscribe("a", () => {});
  assert.ok(!("resumeEventId" in calls[0]));
});

test("subscribe：transport 无 getLastEventId（本机 HostBridge）时 opts 为空", async () => {
  const b = new TargetBridge();
  const calls = [];
  const t = {
    async sendRequest() { return {}; },
    async subscribeNotifications(onFrame, opts) { calls.push(opts ?? {}); return () => {}; },
  };
  b.register(desc("local", "local"), t);
  await b.subscribe("local", () => {});
  assert.deepEqual(calls[0], {});
});
