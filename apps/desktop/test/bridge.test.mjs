import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as jj, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
const require = createRequire(import.meta.url);
const { HostBridge } = require("../host-bridge.cjs");

const REPO = jj(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// 自包含 host（exe + 全部依赖 DLL 同目录，由 scripts/pack-host.mjs 生成），
// 因此测试不再拼 PATH，也不出现任何字面 Windows 路径。
const HOST = resolve(process.env.SACODE_HOST || jj(REPO, "apps", "desktop", "dist", "host", "bin", "sacode-host.exe"));
const SEED = "0\tturn/start\tt\n1\tsystem\tx\n2\tuser/message\tfrom desktop\n3\tassistant/message\thello desktop\n";

test('持久任务预加载仅暴露六个固定动作并保留精确提案',()=>{
  let exposed; const calls=[]; const vm=require('node:vm');
  vm.runInNewContext(readFileSync(jj(REPO,'apps/desktop/preload.cjs'),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{exposed=value}},ipcRenderer:{invoke:(...args)=>calls.push(args),on:()=>{},removeListener:()=>{}}}),
  });
  exposed.executionPropose('current','task-1','request-1','{"argv":["中文"]}');
  exposed.executionAuthorize('current','execution-1',2,'a'.repeat(64),8);
  exposed.executionStart('current','execution-1',3);
  exposed.executionDescribe('current','execution-1');
  exposed.executionOutput('current','execution-1',-1,16);
  exposed.executionStop('current','execution-1',4);
  assert.deepEqual(calls.map(c=>c[0]),['Propose','Authorize','Start','Describe','Output','Stop'].map(s=>'sacode:execution'+s));
  assert.equal(calls[0][1].proposal,'{"argv":["中文"]}');
  assert.equal(calls[1][1].approvalId,8); assert.equal(calls[4][1].cursor,-1);
  assert.equal(exposed.executionRequest,undefined);
});

test('预加载审批接口保留原始参数并兼容旧调用',()=>{
  let exposed;const calls=[];const vm=require('node:vm');
  vm.runInNewContext(readFileSync(jj(REPO,'apps/desktop/preload.cjs'),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{exposed=value}},ipcRenderer:{invoke:(...args)=>{calls.push(args)},on:()=>{},removeListener:()=>{}}}),
  });
  exposed.approvalAsk('write','{"path":"a","content":"中文"}');
  exposed.approvalAsk('write');
  assert.equal(calls[0][0],'sacode:approvalAsk');
  assert.equal(calls[0][1].args,'{"path":"a","content":"中文"}');
  assert.equal(Object.hasOwn(calls[1][1],'args'),false);
});

test('真实 Host 精确审批拒绝换正文，原票仅允许原调用一次',async()=>{
  const {b,dir}=await boot();
  try{
    await b.request('workspace/set-directory',{directory:dir});
    const path='exact-approval.txt';writeFileSync(join(dir,path),'baseline');
    await b.request('extension/call',{name:'read',args:JSON.stringify({path})});
    const args=JSON.stringify({path,content:'approved 中文\n'});
    const ticket=await b.request('approval/ask',{name:'write',args});
    assert.equal((await b.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'})).accepted,true);
    await assert.rejects(()=>b.request('extension/call',{name:'write',args:JSON.stringify({path,content:'replaced'}),approvalId:ticket.approvalId}),/approval-arguments-mismatch/);
    assert.equal(readFileSync(join(dir,path),'utf8'),'baseline');
    await assert.rejects(()=>b.request('approval/ask',{name:'write',args:{path}}),/bad-approval-arguments/);
    const saved=await b.request('extension/call',{name:'write',args,approvalId:ticket.approvalId});
    assert.match(saved.result,/^ok:/);assert.equal(readFileSync(join(dir,path),'utf8'),'approved 中文\n');
    await assert.rejects(()=>b.request('extension/call',{name:'write',args,approvalId:ticket.approvalId}),/approval-not-granted:used/);
  }finally{await b.stop();}
});

async function boot() {
  // 不依赖仓库里预先存在某个临时目录：自己把它建出来
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, "dst-"));
  writeFileSync(join(dir, "session.log"), SEED);
  if (!existsSync(HOST)) {
    throw new Error(`缺少自包含 host：${HOST}，请先跑 node scripts/pack-host.mjs`);
  }
  const b = new HostBridge(HOST, fixtureHostEnv(dir));
  await b.start(dir);
  return { b, dir };
}

test("握手声明协议与能力", async () => {
  const { b } = await boot();
  const r = await b.request("initialize");
  assert.equal(r.protocolVersion, "0.1");
  assert.ok(r.capabilities.includes("session/projection"));
  assert.ok(r.capabilities.includes("session/terminal-output"));
  assert.ok(r.capabilities.includes("attachment/image-read"));
  for (const action of ['describe', 'create', 'edit', 'pause', 'resume', 'clear']) assert.ok(r.capabilities.includes('goal/' + action));
  assert.ok(r.capabilities.includes("session/catalog"));
  assert.ok(r.capabilities.includes("session/create"));
  assert.ok(r.capabilities.includes("session/select"));
  assert.ok(r.capabilities.includes("workspace/get"));
  assert.ok(r.capabilities.includes('workspace/git-status'));
  assert.ok(r.capabilities.includes('workspace/git-diff'));
  assert.ok(r.capabilities.includes("workspace/set-directory"));
  assert.ok(r.capabilities.includes("global/appearance/get"));
  assert.ok(r.capabilities.includes("global/appearance/set-font-size"));
  assert.ok(r.capabilities.includes("global/appearance/set-busy-send"));
  // 供应商单列写：sort/set-enabled 必须在能力表里声明，否则客户端无从判断能否走这两列。
  assert.ok(r.capabilities.includes("model/registry/sort"), "能力表缺 model/registry/sort");
  assert.ok(r.capabilities.includes("model/registry/set-enabled"), "能力表缺 model/registry/set-enabled");
  await b.stop();
});

test("workspace/files 按 path 列子目录且拒绝越界", async () => {
  // 自建会话目录：session.log 只放一条已结算记录，不带未完成 turn——
  // 否则宿主启动时会把未完成 turn 续跑进后台，workspace/files 的首帧就追不上。
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, "wf-"));
  writeFileSync(join(dir, "session.log"), "1\tsystem\tready\n");
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "sub", "inner.txt"), "hello");
  if (!existsSync(HOST)) throw new Error(`缺少自包含 host：${HOST}，请先跑 node scripts/pack-host.mjs`);
  const b = new HostBridge(HOST, fixtureHostEnv(dir));
  await b.start(dir);
  try {
    await b.request("initialize"); // 真实桌面总是先握手，测试也照此契约
    const top = await b.request("workspace/files", { path: "" });
    assert.ok(Array.isArray(top.files), "根目录应返回文件数组");
    assert.ok(top.files.some((f) => f.name === "sub" && f.isDir), "根目录应含 sub 目录");
    const sub = await b.request("workspace/files", { path: "sub" });
    assert.ok(sub.files.some((f) => f.name === "inner.txt" && !f.isDir), "path=sub 应列出 inner.txt");
    // 越界路径必须被拒：宿主侧 canonicalize 边界复核，不把文件系统交给协议面猜。
    await assert.rejects(() => b.request("workspace/files", { path: ".." }), /bad-workspace-path/);
  } finally {
    await b.stop();
  }
});

test("投影与 CLI 同源", async () => {
  const { b } = await boot();
  const p = await b.request("session/projection");
  assert.equal(p.events, 4);
  assert.equal(p.projection, 2);
  await b.stop();
});

test("经协议写入后可见且落盘", async () => {
  const { b, dir } = await boot();
  const a = await b.request("session/append", { eventType: "user/message", data: "desktop write" });
  assert.equal(a.events, 5);
  const p = await b.request("session/projection");
  assert.equal(p.projection, 3);
  assert.ok(existsSync(join(dir, "session.log")));
  await b.stop();
});

test("租约冲突以 JSON-RPC 错误传播", async () => {
  const { b, dir } = await boot();
  writeFileSync(join(dir, "session.log.lease"), "held");
  await assert.rejects(() => b.request("session/append", { eventType: "user/message", data: "blocked" }), /already-owned/);
  await b.stop();
});

test("未知方法返回 -32601", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("no/such"), /-32601|method not found/);
  await b.stop();
});

// C2 追加：durability 屏障 —— append/submit 只在实例内可见，flush 才跨进程可见
test("submit 未 flush 时订阅者看不到，flush 后跨进程可见", async () => {
  const { b, dir } = await boot();
  const s1 = await b.request("session/submit", { eventType: "user/message", data: "pending a" });
  assert.equal(s1.events, 5);
  assert.equal(s1.durable, 4);
  const p = await b.request("session/projection");
  assert.equal(p.events, 5, "实例内可见");
  assert.equal(p.pending, 1);
  assert.equal(p.durable, 4);
  const before = await b.request("session/subscribe", { cursor: 0 });
  assert.equal(before.events.length, 4, "未 flush 不得进入持久回放");
  const f = await b.request("session/flush");
  assert.equal(f.durable, 5);
  const after = await b.request("session/subscribe", { cursor: 4 });
  assert.deepEqual(after.events, [{ seq: 4, type: "user/message" }]);
  assert.equal(after.more, false);
  assert.ok(existsSync(join(dir, "session.log")));
  await b.stop();
});

test("无待写事件时 flush 明确拒绝", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("session/flush"), /-32004|no-pending-writes/);
  await b.stop();
});

test("订阅按 cursor/limit 分页并给出 more", async () => {
  const { b } = await boot();
  const p1 = await b.request("session/subscribe", { cursor: 0, limit: 2 });
  assert.equal(p1.events.length, 2);
  assert.equal(p1.nextCursor, 2);
  assert.equal(p1.more, true);
  const p2 = await b.request("session/subscribe", { cursor: p1.nextCursor, limit: 2 });
  assert.equal(p2.events.length, 2);
  assert.equal(p2.nextCursor, 4);
  assert.equal(p2.more, false);
  const p3 = await b.request("session/subscribe", { cursor: 4 });
  assert.equal(p3.events.length, 0);
  assert.equal(p3.more, false);
  await b.stop();
});

// C5/C2：宿主退出时未 flush 的写入必须被结算（落盘 + 归还租约），不得静默丢失
test("宿主退出前结算未 flush 的写入并归还租约", async () => {
  const { b, dir } = await boot();
  const s = await b.request("session/submit", { eventType: "assistant/message", data: "settled on exit" });
  assert.equal(s.durable, 4);
  const r = await b.stop();
  assert.equal(r.forced, false, "必须走优雅退出而不是强杀");
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "退出后不得留下写租约");
  assert.ok(readFileSync(join(dir, "session.log"), "utf8").includes("4\tassistant/message\tsettled on exit"));
  const b2 = new HostBridge(HOST, fixtureHostEnv(dir));
  await b2.start(dir);
  const sub = await b2.request("session/subscribe", { cursor: 4 });
  assert.deepEqual(sub.events, [{ seq: 4, type: "assistant/message" }]);
  const a = await b2.request("session/append", { eventType: "user/message", data: "next writer" });
  assert.equal(a.events, 6, "结算后下一个写者能拿到租约");
  await b2.stop();
});

// C5：扩展注册表是 CLI 与桌面共用的唯一真源 —— 桌面入口必须看到同一内置工具集
test("桌面入口的 extension/list 与 CLI 内置注册表一致", async () => {
  const { b } = await boot();
  const l = await b.request("extension/list", {});
  assert.deepEqual(l.tools.map((t) => t.name), ["write", "read"]);
  assert.equal(l.tools[0].needsApproval, true, "内置写文件工具必须默认要审批");
  // 读不改盘，所以它不带审批要求；这条断言同时钉住「内置工具集」这两个入口一致
  assert.equal(l.tools[1].needsApproval, false, "只读工具不应要求审批");
  await b.stop();
});

// 读侧与版本过期同样要能从桌面入口走通：两个入口共用同一个 core，
// 只在 core 里测过不等于入口这条路真的能走。
test("桌面入口的 read 交回盘上正文，等长外部改动后写被拒为版本过期", async () => {
  const { b, dir } = await boot();
  try {
    const asked = await b.request("approval/ask", { name: "write" });
    await b.request("approval/answer", { approvalId: asked.approvalId, decision: "allowed-once" });
    const w = await b.request("extension/call", { name: "write", args: "fs-entry.txt hello", approvalId: asked.approvalId });
    assert.equal(w.result, "ok:fs-entry.txt");
    const r = await b.request("extension/call", { name: "read", args: "fs-entry.txt" });
    assert.equal(r.result, "hello", "读侧必须走同一条管线，交回盘上真实读到的字节");
    // 第三方改成等长的另一串：只比 size 的实现在这里看不出来
    writeFileSync(join(dir, "fs-entry.txt"), "HELLP");
    const asked2 = await b.request("approval/ask", { name: "write" });
    await b.request("approval/answer", { approvalId: asked2.approvalId, decision: "allowed-once" });
    await assert.rejects(
      () => b.request("extension/call", { name: "write", args: "fs-entry.txt world", approvalId: asked2.approvalId }),
      /fs-stale-version:fs-entry.txt/,
      "旧认知过期后不得覆盖第三方改动"
    );
    assert.equal(readFileSync(join(dir, "fs-entry.txt"), "utf8"), "HELLP", "拒绝必须发生在写之前");
    // 正文含引号时协议帧不能被自己撕开（回执不过一遍转义就会在这里断）
    const asked3 = await b.request("approval/ask", { name: "write" });
    await b.request("approval/answer", { approvalId: asked3.approvalId, decision: "allowed-once" });
    await b.request("extension/call", { name: "write", args: 'fs-quote.txt 他说"好"', approvalId: asked3.approvalId });
    assert.equal((await b.request("extension/call", { name: "read", args: 'fs-quote.txt' })).result, '他说"好"');
  } finally {
    await b.stop();
  }
});

test("桌面文件工具拒绝未观察覆盖和路径别名绕过，解码失败后宿主仍可用", async () => {
  const { b, dir } = await boot();
  const write = async (args) => {
    const a = await b.request("approval/ask", { name: "write" });
    await b.request("approval/answer", { approvalId: a.approvalId, decision: "allowed-once" });
    return b.request("extension/call", { name: "write", args, approvalId: a.approvalId });
  };
  try {
    writeFileSync(join(dir, "protected.txt"), "original");
    await assert.rejects(() => write("protected.txt overwrite"), /fs-not-observed/);
    assert.equal(readFileSync(join(dir, "protected.txt"), "utf8"), "original");
    await b.request("extension/call", { name: "read", args: "protected.txt" });
    writeFileSync(join(dir, "protected.txt"), "external");
    await assert.rejects(() => write("./protected.txt overwrite"), /fs-stale-version/);
    assert.equal(readFileSync(join(dir, "protected.txt"), "utf8"), "external");
    writeFileSync(join(dir, "binary.dat"), Buffer.from([255]));
    await assert.rejects(() => b.request("extension/call", { name: "read", args: "binary.dat" }), /invalid-encoding/);
    assert.equal((await b.request("initialize")).core, "cangjie", "解码失败不能结束宿主");
    const controls = 'A\0B\fC\b\x1f\n\t"\\';
    writeFileSync(join(dir, "controls.txt"), controls);
    const result = await b.request("extension/call", { name: "read", args: "controls.txt" });
    assert.equal(result.result, controls, "所有控制字符都须逐字符往返");
  } finally {
    await b.stop();
  }
});

// 反向：未登记工具必须走 JSON-RPC 错误；自报的审批字符串在协议面上完全不起作用
test("extension/call 未登记工具被拒且自报审批不放行", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("extension/call", { name: "no.such", args: "a b", approval: "allowed-once" }), /unregistered-tool:no.such/);
  // 关键反向用例：带着「我已经批过了」的自述来调用，没有工单就是不放行
  await assert.rejects(() => b.request("extension/call", { name: "write", args: "probe.txt hi", approval: "allowed-once" }), /approval-not-granted:unknown/);
  await assert.rejects(() => b.request("extension/call", { name: "write", args: "probe.txt hi" }), /approval-not-granted:unknown/);
  const asked = await b.request("approval/ask", { name: "write" });
  await b.request("approval/answer", { approvalId: asked.approvalId, decision: "allowed-once" });
  const ok = await b.request("extension/call", { name: "write", args: "probe.txt hi", approvalId: asked.approvalId });
  assert.equal(ok.result, "ok:probe.txt");
  const l = await b.request("extension/list", {});
  assert.equal(l.misses, 1, "未登记拒绝必须计数（审批被拒不计入注册表 miss）");
  await b.stop();
});

test("extension/dispose 逐个卸载后注册表清空且二次卸载失败", async () => {
  const { b, dir } = await boot();
  try {
    const d = await b.request("extension/dispose", { name: "write" });
    assert.equal(d.disposed, true);
    // 内置集里还剩只读的 read：逐个卸，不许把「没卸完」当成已清空
    assert.deepEqual((await b.request("extension/list", {})).tools.map((t) => t.name), ["read"]);
    const again = await b.request("extension/dispose", { name: "write" });
    assert.equal(again.disposed, false, "句柄一次性，不得重复撤销凑数");
    await assert.rejects(() => b.request("extension/call", { name: "write", args: "x.txt y", approval: "allowed-once" }), /unregistered-tool:write/);
    assert.equal((await b.request("extension/dispose", { name: "read" })).disposed, true);
    assert.deepEqual((await b.request("extension/list", {})).tools, []);
  } finally {
    await b.stop();
  }
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "工具事件写入后退出仍须归还租约");
});

// 全新会话（还没有 session.log 文件）是桌面的第一条黄金路径：
// 第一次写入与第一个 turn 都必须能进去，不能被当成损坏回放。
async function bootFresh() {
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, "fresh-"));
  const b = new HostBridge(HOST, fixtureHostEnv(dir));
  await b.start(dir);
  return { b, dir };
}

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// poll 是「一次取空全部」的：等某一条 callId 时顺手拿到的别的帧必须先存起来，
// 否则那些帧就被丢在地板上，后面的等待方永远等不到（本文件第一版就是这么挂的）。
const frameCache = new Map();

async function pollCall(b, callId, tries = 120) {
  if (frameCache.has(callId)) return { callId, frame: frameCache.get(callId) };
  for (let i = 0; i < tries; i++) {
    const p = await b.request("extension/host/poll", {});
    for (const r of p.results) {
      if (r.callId !== callId) frameCache.set(r.callId, r.frame);
    }
    const hit = p.results.find((r) => r.callId === callId);
    if (hit) return hit;
    await nap(10);
  }
  assert.fail(`callId=${callId} 在 ${tries} 次轮询后没有结果帧`);
}

async function pollUntilSettled(b, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const p = await b.request("turn/poll", {});
    if (p.settled) return p;
    await nap(10);
  }
  assert.fail(`turn 在 ${tries} 次轮询后仍未结算`);
}

test("turn 控制方法在握手能力里声明", async () => {
  const { b } = await boot();
  const r = await b.request("initialize");
  for (const m of ["turn/start", "turn/cancel", "turn/poll", "extension/host/poll", "extension/host/cancel"]) {
    assert.ok(r.capabilities.includes(m), `能力表缺 ${m}`);
  }
  await b.stop();
});

test("全新会话第一个 turn 能在流中被取消并结算", async () => {
  const { b, dir } = await bootFresh();
  const s = await b.request("turn/start", { limit: 2 });
  assert.equal(s.started, true);
  let p = { frames: [] };
  for (let i = 0; i < 40 && p.frames.length < 2; i++) {
    p = await b.request("turn/poll", {});
    if (p.frames.length < 2) await nap(10);
  }
  assert.deepEqual(p.frames, ["text:你好，", "text:world"], "帧必须来自独立线程的投递");
  assert.equal(p.running, true);
  await assert.rejects(
    () => b.request("session/submit", { eventType: "user/message", data: "during turn" }),
    /turn-in-flight/,
    "turn 在途时不得出现第二个写者"
  );
  const c = await b.request("turn/cancel", {});
  assert.equal(c.cancelRequested, true);
  assert.equal(c.wasRunning, true);
  const done = await pollUntilSettled(b);
  assert.equal(done.cancelled, true);
  assert.equal(done.delivered, 2);
  assert.equal(done.text, "你好，world", "已产出的部分文本不得丢");
  assert.equal(done.finishReason, "", "被取消的 turn 没有终态原因");
  assert.equal(done.interrupted, true);
  assert.equal(done.pendingToolCalls, 0, "不留悬挂 tool call");
  assert.equal(done.dropped, 0, "背压只报信号，不丢帧");
  const proj = await b.request("session/projection");
  assert.equal(proj.events, 4, "turn/start + 2 帧 + turn/cancelled");
  assert.equal(proj.durable, 4);
  assert.equal(proj.pending, 0);
  await b.stop();
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "结算后必须归还写租约");
  assert.ok(readFileSync(join(dir, "session.log"), "utf8").includes("turn/cancelled"));
});

test("没有在途 turn 时取消与轮询都不得编造终态", async () => {
  const { b } = await boot();
  const c = await b.request("turn/cancel", {});
  assert.equal(c.cancelRequested, false);
  assert.equal(c.wasRunning, false, "不得假装取消了一个不存在的 turn");
  const p = await b.request("turn/poll", {});
  assert.equal(p.turn, false);
  assert.equal(p.running, false);
  assert.equal(p.settled, false);
  assert.deepEqual(p.frames, []);
  await b.stop();
});

test("宿主退出前取消并结算在途 turn，不丢日志不留租约", async () => {
  const { b, dir } = await bootFresh();
  const s = await b.request("turn/start", { limit: 2 });
  assert.equal(s.started, true);
  await nap(60);
  // 直接关 stdin：在途 turn 必须被取消并 join，然后落盘、归还租约
  await b.stop();
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "退出后不得留下写租约");
  const text = readFileSync(join(dir, "session.log"), "utf8");
  assert.ok(text.includes("turn/start"), "turn/start 必须已落盘");
  assert.ok(text.includes("turn/cancelled"), "退出结算必须写下取消终态");
});

// 流式期读侧不再被一律串行挡掉：桌面要能边流式边看状态。
// 依据是 core 的 SessionLog 访问已全部加锁（loglock_test 钉住），读的是自洽快照。
test("turn 在途时读投影与订阅不再被拒，写侧仍串行", async () => {
  const { b } = await bootFresh();
  const s = await b.request("turn/start", { limit: 2 });
  assert.equal(s.started, true);
  await nap(150);
  const p = await b.request("session/projection", {});
  assert.ok(p.events >= 3, `流式期读不到状态：${JSON.stringify(p)}`);
  assert.equal(p.durable, 0, "turn 在途尚未 flush，跨进程不可见");
  assert.equal(p.pending, p.events, "内存态与已落盘的差额必须如实报 pending");
  const sub = await b.request("session/subscribe", { cursor: 0 });
  assert.deepEqual(sub.events, [], "订阅只回放已落盘事件");
  await assert.rejects(
    () => b.request("session/submit", { eventType: "user/message", data: "mid-turn" }),
    /turn-in-flight/,
    "写侧仍是单一写者"
  );
  // 读侧验完再收：provider 停在帧间等取消，不发起取消就永远结算不了
  const c = await b.request("turn/cancel", {});
  assert.equal(c.cancelRequested, true);
  const done = await pollUntilSettled(b);
  assert.equal(done.settled, true);
  const after = await b.request("session/projection", {});
  assert.equal(after.durable, after.events, "结算后应全部落盘");
  assert.ok(after.events >= p.events, "结算后读数不得回退");
  await b.stop();
});

// C5 桌面入口：JS 动态扩展必须由仓颉核心驱动的子进程提供，桌面看到的应答只能来自子进程。
// 注：宿主侧 jsonStr 不做反斜杠解转义，所以路径参数一律用正斜杠形式。
const fwd = (p) => p.replace(/\\/g, "/");
const NODE_CMD = fwd(process.execPath);
const EXTJS_DIR = fwd(jj(REPO, "extjs"));

test("桌面入口经 core 拉起 JS 宿主并完成 load/list/call/dispose", async () => {
  const { b } = await boot();
  const sp = await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  assert.equal(sp.spawned, true);
  assert.ok(sp.handshake.result.capabilities.includes("host/shutdown"), "能力表必须来自子进程真实应答");
  const pid = sp.handshake.result.process.pid;
  const ld = await b.request("extension/host/load", { path: "example/echo.cjs" });
  assert.equal(ld.forwarded.result.ok, true);
  const ls = await b.request("extension/host/list", {});
  assert.deepEqual(ls.forwarded.result.names, ["example.echo"]);
  const cl = await b.request("extension/host/call", { name: "example.echo", text: "from-desktop", callId: 1 });
  assert.equal(cl.accepted, true, "工具调用须立刻回执，结果另走 poll");
  const cl2 = await pollCall(b, 1);
  assert.deepEqual(cl2.frame.result, { echoed: "from-desktop" });
  const dp = await b.request("extension/host/dispose", { name: "example.echo" });
  assert.equal(dp.forwarded.result.disposed, true);
  const after = await b.request("extension/host/list", {});
  assert.deepEqual(after.forwarded.result.names, [], "卸载残留必须为 0");
  const cs = await b.request("extension/host/close", {});
  assert.equal(cs.exit, 0, "JS 宿主须自己结算退出");
  assert.equal(cs.forced, false, "不得靠强杀收场");
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    alive = false;
  }
  assert.equal(alive, false, "close 后子进程不得存活");
  await b.stop();
});

test("未 spawn 时转调与结算都明确失败，不得静默返回空表", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("extension/host/list", {}), /js-host-not-spawned/);
  await assert.rejects(() => b.request("extension/host/call", { name: "example.echo", text: "x" }), /js-host-not-spawned/);
  await assert.rejects(() => b.request("extension/host/close", {}), /js-host-not-spawned/);
  await b.stop();
});

test("重复 spawn 被拒且不得把已运行的宿主弄丢", async () => {
  const { b } = await boot();
  const sp = await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  assert.equal(sp.spawned, true);
  await assert.rejects(() => b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR }), /js-host-already-running/);
  const ls = await b.request("extension/host/list", {});
  assert.ok(Array.isArray(ls.forwarded.result.names), "第二次 spawn 失败后原宿主必须还可用");
  const cs = await b.request("extension/host/close", {});
  assert.equal(cs.forced, false);
  await b.stop();
});

test("桌面宿主退出前结算 JS 子进程，不留孤儿", async () => {
  const { b } = await boot();
  const sp = await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  const pid = sp.handshake.result.process.pid;
  await b.stop();
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    alive = false;
  }
  assert.equal(alive, false, "父宿主退出后 JS 子进程不得存活");
});


// 取消要能在「调用还在途」时落到桌面上，前提是 Host 的读侧不能因为一次转调就整条排队。
test("extension/host/call 立刻回执，在途调用不挡读侧", async () => {
  const { b } = await boot();
  await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  await b.request("extension/host/load", { path: "example/delayed.cjs" });
  const t0 = Date.now();
  const cl = await b.request("extension/host/call", { name: "example.delayed", text: "slow-one", callId: 11 });
  assert.equal(cl.accepted, true);
  assert.equal(cl.callId, 11);
  assert.ok(Date.now() - t0 < 250, "300ms 的 handler 不该吊住回执");
  // 在途期间读侧照常应答：这条是「边转调边能收到 stop」的前提
  const pr = await b.request("session/projection", {});
  assert.ok(pr.events >= 4, "投影须答得出来");
  const hit = await pollCall(b, 11);
  assert.deepEqual(hit.frame.result, { echoed: "slow-one" });
  const after = await b.request("extension/host/poll", {});
  assert.equal(after.inflight, 0);
  assert.equal(after.results.length, 0, "结算过的调用不得再冒第二帧");
  await b.stop();
});

test("extension/host/cancel 取消在途调用，只按 callId 结算一帧", async () => {
  const { b } = await boot();
  await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  await b.request("extension/host/load", { path: "example/delayed.cjs" });
  const cl = await b.request("extension/host/call", { name: "example.delayed", text: "never", callId: 12 });
  assert.equal(cl.accepted, true);
  const cancel = await b.request("extension/host/cancel", { callId: 12 });
  assert.equal(cancel.cancelled, true, "在途调用必须真被结算，不能回 false 就算完");
  const hit = await pollCall(b, 12);
  assert.equal(hit.frame.error.code, -32021);
  // handler 300ms 之后才 resolve：那之后不该再有帧冒出来
  await nap(500);
  const later = await b.request("extension/host/poll", {});
  assert.equal(later.results.length, 0, "取消后迟到的 handler 结果不得补帧");
  assert.equal(later.inflight, 0);
  const cs = await b.request("extension/host/close", {});
  assert.equal(cs.forced, false, "取消不该把子进程逼成强杀退出");
  await b.stop();
});

test("turn/cancel 联动取消在途的 extension/call", async () => {
  const { b } = await bootFresh();
  await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  await b.request("extension/host/load", { path: "example/delayed.cjs" });
  const st = await b.request("turn/start", { limit: 2 });
  assert.equal(st.started, true);
  let p = { frames: [] };
  for (let i = 0; i < 40 && p.frames.length < 2; i++) {
    p = await b.request("turn/poll", {});
    if (p.frames.length < 2) await nap(10);
  }
  assert.equal(p.running, true, "turn 得还在途，才有东西可联动取消");
  const cl = await b.request("extension/host/call", { name: "example.delayed", text: "x", callId: 13 });
  assert.equal(cl.accepted, true, "turn 在途期间工具调用必须进得去，否则取消无从联动");
  const cx = await b.request("turn/cancel", {});
  assert.equal(cx.cancelRequested, true);
  assert.equal(cx.extensionCallsCancelled, 1, "取消 turn 要顺带结算它发起的在途调用");
  const hit = await pollCall(b, 13);
  assert.equal(hit.frame.error.code, -32021);
  const t = await pollUntilSettled(b);
  assert.equal(t.cancelled, true);
  await b.stop();
});

// 在途调用没被 poll 走就退出，也不能留一个「没人收的在途请求」：退出帧要把账交清。
test("宿主退出前收束在途 extension/call 并交账", async () => {
  const { b } = await bootFresh();
  await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  await b.request("extension/host/load", { path: "example/delayed.cjs" });
  const cl = await b.request("extension/host/call", { name: "example.delayed", text: "x", callId: 14 });
  assert.equal(cl.accepted, true);
  const st = await b.stop();
  assert.equal(st.forced, false, "退出须走 EOF 结算，不能被强杀");
  const s = b.notifications.find((n) => n.method === "host/settled");
  assert.ok(s, "退出前必须交一份结算账");
  assert.equal(s.params.extensionCalls, 1);
  assert.equal(s.params.extensionFrames, 1, "在途调用要真拿到结果帧，不是被丢掉");
  assert.equal(s.params.extensionCancelled, 1, "终态须是「本端取消」(-32021)，不能混成子进程 shutdown 的兜底结算");
  assert.equal(s.params.jsChildForced, false);
});

// 渲染层的消息流只能来自核心投影，不能由前端自己拼一份第二真源：
// 所以投影帧必须把逐条消息一起交出来，且只含 surface 事件。
test("session/projection 交出逐条消息且只含 surface 事件", async () => {
  const { b } = await boot();
  const r = await b.request("session/projection", {});
  assert.ok(Array.isArray(r.messages), "投影须带 messages 数组");
  assert.ok(r.messages.length > 0);
  assert.ok(r.messages.every((m) => /^(system|user|assistant)\/message:|tool\/result:/.test(m)), `混入了非 surface 消息: ${r.messages.filter((m) => !/^(system|user|assistant)\/message:|tool\/result:/.test(m)).join(" | ")}`);
  assert.ok(!r.messages.some((m) => m.startsWith("turn/start:")), "turn/start 持久但不进模型可见历史");
  assert.equal(r.messages.length, r.projection, "消息条数须等于投影计数");
  // 用 charCode 拼，避免夹具自身的转义把断言带偏（本文件第一版就是这么假绿过一次）
  const tricky = '带"引号"和' + String.fromCharCode(92) + '反斜杠' + String.fromCharCode(10) + '第二行';
  const evBefore = (await b.request("session/projection", {})).events;
  await b.request("session/append", { eventType: "user/message", data: tricky });
  const m2 = await b.request("session/projection", {});
  assert.equal(m2.messages[m2.messages.length - 1], "user/message: " + tricky, "入口 JSON 转义与落盘转义须逐字符往返");
  assert.equal(m2.events, evBefore + 1, "多行正文仍须是一行事件，不能被裸换行劈成两行");
  assert.equal(m2.truncatedTail, false);
  await b.stop();
});

// 取消一轮不该波及别的轮次（或不属于任何轮次）手动发起的调用：
// 误伤会把一个已经没人在等的在途调用标成 cancelled，界面上看不出是谁干的。
test("turn/cancel 只结算它自己那一轮发起的在途调用", async () => {
  const { b } = await bootFresh();
  await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  await b.request("extension/host/load", { path: "example/delayed.cjs" });

  const a = await b.request("turn/start", { limit: 5 });
  assert.equal(a.started, true);
  const ca = await b.request("extension/host/call", { name: "example.delayed", text: "属于A", callId: 21 });
  assert.equal(ca.accepted, true);
  assert.equal(ca.epoch, a.epoch, "A 轮在途期间的调用须记在 A 的轮次上");
  await pollUntilSettled(b);

  const bb = await b.request("turn/start", { limit: 2 });
  assert.notEqual(bb.epoch, a.epoch, "每一轮须有新的归属号");
  const cb = await b.request("extension/host/call", { name: "example.delayed", text: "属于B", callId: 22 });
  assert.equal(cb.epoch, bb.epoch);
  const cx = await b.request("turn/cancel", {});
  assert.equal(cx.extensionCallsCancelled, 1, "只该结算 B 自己发起的那一条");

  const hitA = await pollCall(b, 21);
  assert.deepEqual(hitA.frame.result, { echoed: "属于A" }, "A 的调用不得被 B 的取消误伤");
  const hitB = await pollCall(b, 22);
  assert.equal(hitB.frame.error.code, -32021);

  // 不在任何 turn 里手动发起的调用（epoch 0），也不该被下一轮的 stop 带走。
  // 注意：取消只是发请求，turn 要等 poll 结算后 turnBusy 才落下——没结算就发调用，
  // 归属仍是上一轮的，这是产品语义不是缺陷。
  await pollUntilSettled(b);
  const cc = await b.request("extension/host/call", { name: "example.delayed", text: "手动", callId: 23 });
  assert.equal(cc.epoch, 0, "turn 之外发起的调用记 epoch 0");
  const c3 = await b.request("turn/start", { limit: 2 });
  assert.equal(c3.started, true);
  await b.request("turn/cancel", {});
  const hitC = await pollCall(b, 23);
  assert.deepEqual(hitC.frame.result, { echoed: "手动" }, "epoch 0 的调用不受后续 turn 取消影响");
  await pollUntilSettled(b);
  await b.stop();
});

async function bootWithLeaseFile(token) {
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, "lease-"));
  writeFileSync(join(dir, "session.log"), SEED);
  writeFileSync(join(dir, "session.log.lease"), token);
  const b = new HostBridge(HOST, fixtureHostEnv(dir));
  await b.start(dir);
  return { b, dir };
}

// 桌面最常见的死锁：上一次宿主崩了，留下一个没人还的租约，之后每次写入都被拒。
// 持有者确认已死 → 自动接管；持有者还活着 → 仍须明确拒绝，一个字都不动别人的凭据。
test("残留租按持有者死活分别接管与拒绝", async () => {
  {
    const { b } = await bootWithLeaseFile("writer=4294967000-stale");
    try {
      const r = await b.request("session/append", { eventType: "user/message", data: "接管后写入" });
      // SEED 本身 4 条事件，接管后这条写入进去才是 5
      assert.equal(r.events, 5, "死者留下的租约不该永久挡住写入");
      assert.equal(r.durable, 5, "接管来的写入同样要过落盘屏障");
    } finally {
      await b.stop();
    }
  }
  {
    const { b, dir } = await bootWithLeaseFile(`writer=${process.pid}-live`);
    try {
      await assert.rejects(
        () => b.request("session/append", { eventType: "user/message", data: "不该进来" }),
        /already-owned/,
        "活着的持有者的租约不得被抢走"
      );
      const raw = readFileSync(join(dir, "session.log.lease"), "utf8");
      assert.equal(raw, `writer=${process.pid}-live`, "拒绝接管时盘上凭据须原样不动");
    } finally {
      await b.stop();
    }
  }
});

// 审批的协议面：调用方自带 approval:"allowed-once" 只是「声称批过了」，
// 真正可追问的审批要走 发号 → 应答 → 一次性消费，且 asked/decided 落进同一份日志。
// 工单句柄在协议里一律叫 approvalId，不叫 id：本宿主按整帧字节扫描取值，
// "id" 会先撞上 JSON-RPC 信封自己的 id，参数被静默读成 -1（本批实测踩到）。
test("审批工单 ask→answer(allowed-once)→call 只放行一次", async () => {
  const { b, dir } = await boot();
  try {
    const asked = await b.request("approval/ask", { name: "write" });
    assert.equal(asked.state, "pending");
    assert.ok(asked.approvalId > 0, "必须先发号，不允许调用方自己挑一个 ID");

    const answered = await b.request("approval/answer", { approvalId: asked.approvalId, decision: "allowed-once" });
    assert.equal(answered.accepted, true);
    assert.equal(answered.state, "allowed-once");

    const ok = await b.request("extension/call", { name: "write", args: "ticket.txt hi", approvalId: asked.approvalId });
    assert.equal(ok.result, "ok:ticket.txt");

    // 一次性就是字面意思的一次：同一张工单不得再放行第二次调用
    await assert.rejects(
      () => b.request("extension/call", { name: "write", args: "ticket.txt again", approvalId: asked.approvalId }),
      /approval-not-granted:used/,
      "已消费的工单必须拒绝"
    );
    // 旧审批 ID 不可重用：结算过的工单也不再接受第二次应答
    const reAnswer = await b.request("approval/answer", { approvalId: asked.approvalId, decision: "denied" });
    assert.equal(reAnswer.accepted, false, "已结算工单不得被改判");
    assert.equal(reAnswer.state, "used");

    await b.request("session/flush", {});
    const raw = readFileSync(join(dir, "session.log"), "utf8");
    assert.ok(raw.includes(`approval/asked\t${asked.approvalId}:write`), "asked 须落盘，否则答不出谁批的");
    assert.ok(raw.includes(`approval/decided\t${asked.approvalId}:allowed-once`), "decided 须落盘");
  } finally {
    await b.stop();
  }
});

test("审批过期由真实单调钟决定，且只结算一次", async () => {
  const { b, dir } = await boot();
  try {
    // ttl=1 秒：协议面只允许把窗口缩短，所以这条能等到真过期而不用等默认 30 秒
    const asked = await b.request("approval/ask", { name: "write", ttl: 1 });
    assert.equal((await b.request("approval/status", { approvalId: asked.approvalId })).state, "pending");
    // 有界轮询等时钟跨过 deadline：没有任何通道能「推进」时间，只有经过的时间能
    let state = "pending";
    for (let i = 0; i < 60 && state === "pending"; i++) {
      await sleep(100);
      state = (await b.request("approval/status", { approvalId: asked.approvalId })).state;
    }
    assert.equal(state, "expired", "真实钟走过 1 秒窗口后必须自动过期");
    await assert.rejects(
      () => b.request("extension/call", { name: "write", args: "late.txt hi", approvalId: asked.approvalId }),
      /approval-not-granted:expired/,
      "过期的工单不得再放行"
    );
    // 再碰一次不得产生第二条 expired 事件（结算幂等，同一张工单只落一次账）
    await b.request("approval/status", { approvalId: asked.approvalId });
    await b.request("session/flush", {});
    const raw = readFileSync(join(dir, "session.log"), "utf8");
    const expiredLines = raw.split("\n").filter((l) => l.includes("approval/expired")).length;
    assert.equal(expiredLines, 1, `expired 事件须恰好一条，实得 ${expiredLines} 条`);
  } finally {
    await b.stop();
  }
});

// 过期只能是 fail-closed 的方向：协议面上不得存在「推进时钟」的动作，也不得让调用方
// 把窗口延长——ttl 越界一律回落到桌面默认值（若被当成 0 会立刻过期，也是错的）。
test("审批没有可推进的时钟通道，ttl 只可缩短不可延长", async () => {
  const { b } = await boot();
  try {
    await assert.rejects(
      () => b.request("approval/tick", { ticks: 999 }),
      /-32601|method not found/,
      "协议面不应暴露推进过期时钟的动作"
    );
    const long = await b.request("approval/ask", { name: "write", ttl: 99999 });
    assert.equal((await b.request("approval/status", { approvalId: long.approvalId })).state, "pending");
  } finally {
    await b.stop();
  }
});

// 反向：非法决定不得「顺手放行」，也不得把 pending 打成别的状态
test("非法审批决定被拒且不改判", async () => {
  const { b } = await boot();
  try {
    const asked = await b.request("approval/ask", { name: "write" });
    for (const bad of ["allowed-always", "", "ALLOWED-ONCE"]) {
      const r = await b.request("approval/answer", { approvalId: asked.approvalId, decision: bad });
      assert.equal(r.accepted, false, `决定 [${bad}] 不属于认得的集合，须拒`);
    }
    assert.equal((await b.request("approval/status", { approvalId: asked.approvalId })).state, "pending");
    // 不存在的工单同样拒，且不产生新工单
    const unknown = await b.request("approval/answer", { approvalId: 9999, decision: "allowed-once" });
    assert.equal(unknown.accepted, false);
    assert.equal((await b.request("approval/status", { approvalId: 9999 })).state, "unknown");
    await assert.rejects(
      () => b.request("extension/call", { name: "write", args: "x.txt y", approvalId: 9999 }),
      /approval-not-granted/,
      "拿不存在的工单来调用必须被拒"
    );
  } finally {
    await b.stop();
  }
});

test("未应答的工单不放行（pending 不等于批准）", async () => {
  const { b } = await boot();
  try {
    const asked = await b.request("approval/ask", { name: "write" });
    await assert.rejects(
      () => b.request("extension/call", { name: "write", args: "never.txt hi", approvalId: asked.approvalId }),
      /approval-not-granted:pending/
    );
    // 显式拒绝的工单同样不放行，且状态是 denied 而不是掉回 pending
    const d = await b.request("approval/answer", { approvalId: asked.approvalId, decision: "denied" });
    assert.equal(d.accepted, true);
    await assert.rejects(
      () => b.request("extension/call", { name: "write", args: "never.txt hi", approvalId: asked.approvalId }),
      /approval-not-granted:denied/
    );
  } finally {
    await b.stop();
  }
});

test("握手能力表登记审批三个方法且不含时钟通道", async () => {
  const { b } = await boot();
  try {
    const r = await b.request("initialize");
    for (const m of ["approval/ask", "approval/answer", "approval/status"]) {
      assert.ok(r.capabilities.includes(m), `能力表缺 ${m}，客户端无法据此决定能不能走工单流程`);
    }
    // 反向：过期不再可由调用方推进，能力表里也不该再有这个动作
    assert.ok(!r.capabilities.includes("approval/tick"), "能力表不应再登记 approval/tick");
  } finally {
    await b.stop();
  }
});

// —— token 计量与预算（矩阵 53 token-meter）——
// 桌面入口的读数必须与 CLI 同源：两个入口都只问同一个 core 的 TokenMeter，
// 界面不许自己算一份账。
test("跑完的一轮把 usage 记进日志，turn/poll 交出计量读数", async () => {
  const { b, dir } = await bootFresh();
  try {
    const st = await b.request("turn/start", { limit: 5 });
    assert.equal(st.started, true);
    const t = await pollUntilSettled(b);
    assert.equal(t.finishReason, "stop");
    assert.equal(t.usage, "12");
    assert.equal(t.usageVerdict, "recorded", "跑完的一轮必须真的记上账");
    assert.equal(t.used, 12);
    assert.equal(t.budget, 200000);
    assert.equal(t.over, false);
    const s = await b.request("usage/status", {});
    assert.equal(s.used, 12);
    assert.equal(s.badUsage, 0);
    // 事件形状只由核心产生：这一笔与当时的累计都可在盘上追问
    assert.match(readFileSync(join(dir, "session.log"), "utf8"), /turn\/usage\t12:12/);
  } finally {
    await b.stop();
  }
});

test("预算只可收紧：调大、持平、缺参数都被拒且停在原档", async () => {
  const { b } = await bootFresh();
  try {
    const up = await b.request("usage/set-budget", { budget: 999999 });
    assert.equal(up.applied, false, "调大预算就是放宽防额，必须拒");
    assert.equal(up.budget, 200000);
    const same = await b.request("usage/set-budget", { budget: 200000 });
    assert.equal(same.applied, false, "持平不算收紧");
    const missing = await b.request("usage/set-budget", {});
    // 缺参数既不能当成「收紧到 0」把会话打死，也不能默认放行
    assert.equal(missing.applied, false);
    assert.equal(missing.budget, 200000);
    const down = await b.request("usage/set-budget", { budget: 20 });
    assert.equal(down.applied, true);
    assert.equal(down.budget, 20);
    const widen = await b.request("usage/set-budget", { budget: 30 });
    assert.equal(widen.applied, false);
    assert.equal(widen.budget, 20, "已收紧的档位不能被后来的宽松请求抬回去");
  } finally {
    await b.stop();
  }
});

test("超档的一轮不计入，之后不再开新轮", async () => {
  const { b } = await bootFresh();
  try {
    const d = await b.request("usage/set-budget", { budget: 5 });
    assert.equal(d.applied, true);
    // 在途期间也要拦得住：读侧与收紧预算都归 allowedDuringTurn
    await b.request("turn/start", { limit: 5 });
    const t = await pollUntilSettled(b);
    assert.equal(t.usageVerdict, "over-budget");
    assert.equal(t.used, 0, "超预算的那一笔不许先记了再红字提醒");
    assert.equal(t.over, true);
    // 超档之后开新轮必须被协议面拒绝，而不是自动换个小轮次继续花
    await assert.rejects(
      () => b.request("turn/start", { limit: 5 }),
      /-32014|over-budget/,
      "拦过一次就说明越了人工档位，下一步是停下来问人"
    );
  } finally {
    await b.stop();
  }
});

test("换个进程只靠会话日志重算：用量、超档与预算档位都不丢", async () => {
  const { b, dir } = await bootFresh();
  await b.request("usage/set-budget", { budget: 5 });
  await b.request("turn/start", { limit: 5 });
  const t = await pollUntilSettled(b);
  assert.equal(t.usageVerdict, "over-budget");
  await b.stop();
  // 全新宿主进程、同一会话目录：账与档位必须从盘上长回来，否则重启就是放宽的后门
  const b2 = new HostBridge(HOST, fixtureHostEnv(dir));
  await b2.start(dir);
  try {
    const s = await b2.request("usage/status", {});
    assert.equal(s.used, 0, "被拒的那笔不该在重启后被算成已花掉");
    assert.equal(s.over, true, "重启后必须仍记得被拦过");
    assert.equal(s.budget, 5, "重启不得把收紧过的档位洗回默认宽档");
    await assert.rejects(() => b2.request("turn/start", { limit: 5 }), /-32014|over-budget/);
  } finally {
    await b2.stop();
  }
});

// ---------- L1：LSP 语义工具的 IPC 面与 Host 面 ----------

const LSP_ACTIONS = {
  lspDefine: ['lsp/define', { path: 'sample.ts', line: 0, character: 9 }],
  lspLookup: ['lsp/lookup', { path: 'sample.ts', line: 0, character: 9 }],
  lspReferences: ['lsp/references', { path: 'sample.ts', line: 0, character: 9, includeDeclaration: false }],
  lspImplementation: ['lsp/implementation', { path: 'sample.ts', line: 0, character: 9 }],
  lspCallHierarchy: ['lsp/call-hierarchy', { path: 'sample.ts', line: 0, character: 9, direction: 'incoming' }],
  lspDiagnostics: ['lsp/diagnostics', { path: 'sample.ts', documentVersion: 3 }],
  lspRename: ['lsp/rename', { path: 'sample.ts', line: 0, character: 9, newName: 'gamma', documentVersion: 3 }],
};

function lspPreloadApi() {
  let api;
  const calls = [];
  const vm = require('node:vm');
  vm.runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); }, on: () => {}, removeListener: () => {} },
    }),
  });
  return { api, calls };
}

function lspMainHandlers() {
  const vm = require('node:vm');
  const handlers = new Map();
  const requests = [];
  const electron = {
    app: {
      isPackaged: false,
      whenReady: () => new Promise(() => {}),
      getPath: (k) => (k === 'temp' ? '/tmp' : `/tmp/sacode-lsp-ipc-${k}`),
      setPath: () => {}, on: () => {}, quit: () => {},
    },
    BrowserWindow: class {
      static getAllWindows() { return []; }
      constructor() { this.webContents = { on: () => {}, send: () => {}, loadFile: () => Promise.resolve(), session: { on: () => {} } }; this.on = () => {}; this.loadFile = () => Promise.resolve(); this.show = () => {}; this.loadURL = () => Promise.resolve(); }
      static getFromFile() { return null; }
    },
    ipcMain: { handle: (name, fn) => { handlers.set(name, fn); }, on: () => {} },
    nativeTheme: { shouldUseDarkColors: false, on: () => {}, themeSource: 'system' },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => {} },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }), setApplicationMenu: () => {}, getApplicationMenu: () => null },
    Tray: class { constructor() {} on() {} setImage() {} setToolTip() {} destroy() {} },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
    screen: { on: () => {} },
  };
  const ctx = {
    require: (id) => {
      if (id === 'electron') return electron;
      if (id === './host-bridge.cjs') {
        return { HostBridge: class { constructor() {} async start() {} async request(method, params) { requests.push({ method, params }); return { ok: true }; } async stop() { return { code: 0 }; } killNow() {} } };
      }
      if (id === './paths.cjs') return { hostExePath: () => '/tmp/does-not-exist-sacode-host.exe' };
      if (id === './stdio-guard.cjs') return { installStdioGuard: () => {} };
      if (id === './frame-smoke.cjs') return { runFrameSmoke: async () => {} };
      if (id === 'node:module') return { createRequire: (p) => require };
      if (id === 'node:path') return require('node:path');
      if (id === 'node:fs') return { existsSync: () => false, writeFileSync: () => {}, mkdirSync: () => {}, readFileSync: () => '', rmSync: () => {}, readdirSync: () => [], statSync: () => ({ size: 0 }) };
      if (id === 'node:crypto') return require('node:crypto');
      if (id === 'node:os') return require('node:os');
      if (id === 'node:http' || id === 'node:https') return require(id);
      if (id === 'node:child_process') return { spawn: () => ({ on: () => {}, stdio: { write: () => {} }, kill: () => {} }), execFileSync: () => '' };
      return require(id.startsWith('.') ? jj(dirname(fileURLToPath(import.meta.url)), '..', id) : id);
    },
    __dirname: '/tmp',
    process: { argv: [], env: {}, pid: 1, platform: 'win32', on: () => {}, exit: () => {}, resourcesPath: '/tmp' },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval, URL,
  };
  vm.runInNewContext(readFileSync(new URL('../main.cjs', import.meta.url), 'utf8'), ctx, { filename: 'main.cjs' });
  return { handlers, requests };
}

test('LSP preload 只交 7 个动作与必要字段，不提供通用 method 转发', async () => {
  const { api, calls } = lspPreloadApi();
  for (const [action, [, good]] of Object.entries(LSP_ACTIONS)) {
    assert.equal(typeof api[action], 'function', `缺少通道 ${action}`);
  }
  await api.lspDefine('sample.ts', 0, 9);
  await api.lspReferences('sample.ts', 1, 2, false);
  await api.lspReferences('sample.ts', 1, 2);
  await api.lspDiagnostics('sample.ts');
  await api.lspDiagnostics('sample.ts', 7);
  await api.lspCallHierarchy('sample.ts', 0, 1, 'outgoing');
  await api.lspRename('sample.ts', 0, 1, 'gamma');
  assert.deepEqual(calls.map((row) => row[0]), [
    'sacode:lspDefine', 'sacode:lspReferences', 'sacode:lspReferences',
    'sacode:lspDiagnostics', 'sacode:lspDiagnostics', 'sacode:lspCallHierarchy', 'sacode:lspRename',
  ]);
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify({ path: 'sample.ts', line: 0, character: 9 }));
  // 省略可选字段时那一格根本不存在，而不是被填成 undefined 或 0
  assert.equal(Object.hasOwn(calls[2][1], 'includeDeclaration'), false);
  assert.equal(Object.hasOwn(calls[3][1], 'documentVersion'), false);
  assert.equal(calls[4][1].documentVersion, 7);
  assert.equal(calls[6][1].newName, 'gamma');
  // 万能通道不该存在：渲染层拿不到「发任意 method」的能力
  for (const forbidden of ['request', 'call', 'invoke', 'send', 'hostRequest', 'lsp', 'lspCall']) {
    assert.equal(forbidden in api, false, `预加载暴露了通用转发 ${forbidden}`);
  }
});

test('LSP 主进程逐字段守卫负载，拒掉的不会转发到宿主', async () => {
  const { handlers, requests } = lspMainHandlers();
  for (const [action, [method, good]] of Object.entries(LSP_ACTIONS)) {
    const handler = handlers.get(`sacode:${action}`);
    assert.equal(typeof handler, 'function', `主进程缺少 ${action} 通道`);
    const before = requests.length;
    await handler({}, good);
    assert.equal(requests.length, before + 1);
    // 负载是 vm 上下文里造的对象，原型与外层不同，deepStrictEqual 只会说「结构相同但非同一引用」，
    // 所以按 goal-ipc 的既有做法比 JSON 串。
    assert.equal(JSON.stringify(requests[requests.length - 1]), JSON.stringify({ method, params: good }));
    for (const bad of [
      null, undefined, {}, [], 'sample.ts',
      { ...good, path: '' },
      { ...good, path: 42 },
      { ...good, method: 'lsp/formatting' },
      { ...good, verb: 'define' },
      { ...good, extra: 1 },
      { ...good, line: -1 },
      { ...good, character: -1 },
      { ...good, line: 1.5 },
      { ...good, documentVersion: -2 },
    ]) {
      await assert.rejects(handler({}, bad), /bad arguments/, `${action} 没挡住 ${JSON.stringify(bad)}`);
    }
    if (Object.hasOwn(good, 'direction')) {
      for (const bad of ['sideways', '', 'INCOMING', 1]) {
        await assert.rejects(handler({}, { ...good, direction: bad }), /bad arguments/, '调用层次方向不是闭集');
      }
    }
    for (const key of ['line', 'character', 'direction', 'newName']) {
      if (!Object.hasOwn(good, key)) continue;
      const missing = { ...good };
      delete missing[key];
      await assert.rejects(handler({}, missing), /bad arguments/, `${action} 未拒绝缺少 ${key}`);
    }
    if (Object.hasOwn(good, 'newName')) {
      for (const bad of ['', 42, 'x'.repeat(501)]) {
        await assert.rejects(handler({}, { ...good, newName: bad }), /bad arguments/, 'rename 没挡住空 newName');
      }
    }
    assert.equal(requests.length, before + 1, `${action} 把被拒的负载也转给了宿主`);
  }
});

test('LSP 位置动作携带文档版本并拒绝不安全整数', async () => {
  const { api, calls } = lspPreloadApi();
  await api.lspDefine('sample.ts', 0, 1, 7);
  await api.lspLookup('sample.ts', 0, 1, 7);
  await api.lspImplementation('sample.ts', 0, 1, 7);
  await api.lspReferences('sample.ts', 0, 1, undefined, 7);
  await api.lspCallHierarchy('sample.ts', 0, 1, 'incoming', 7);
  for (const [, args] of calls) assert.equal(args.documentVersion, 7);
  const { handlers, requests } = lspMainHandlers();
  for (const [channel, args] of calls) {
    const handler = handlers.get(channel);
    await handler({}, args);
    assert.equal(requests.at(-1).params.documentVersion, 7);
    await assert.rejects(handler({}, { ...args, line: Number.MAX_SAFE_INTEGER + 1 }), /bad arguments/);
    await assert.rejects(handler({}, { ...args, documentVersion: Number.MAX_SAFE_INTEGER + 1 }), /bad arguments/);
  }
});

test('真实宿主 7 个 LSP 请求在无插件时如实失败并附非语义线索', async () => {
  const { b, dir } = await boot();
  try {
    writeFileSync(join(dir, 'sample.ts'), 'function alpha() {\n  return 1\n}\n');
    await b.request('workspace/set-directory', { directory: dir });
    const init = await b.request('initialize');
    for (const [, [method]] of Object.entries(LSP_ACTIONS)) {
      assert.ok(init.capabilities.includes(method), `能力表少了 ${method}`);
    }
    const cases = [
      ['lsp/define', { path: 'sample.ts', line: 0, character: 9 }],
      ['lsp/lookup', { path: 'sample.ts', line: 0, character: 9 }],
      ['lsp/references', { path: 'sample.ts', line: 0, character: 9, includeDeclaration: true }],
      ['lsp/implementation', { path: 'sample.ts', line: 0, character: 9 }],
      ['lsp/call-hierarchy', { path: 'sample.ts', line: 0, character: 9, direction: 'incoming' }],
      ['lsp/diagnostics', { path: 'sample.ts' }],
      ['lsp/rename', { path: 'sample.ts', line: 0, character: 9, newName: 'gamma' }],
    ];
    for (const [method, params] of cases) {
      const err = await b.request(method, params).then(() => null, (e) => e);
      assert.ok(err, `${method} 本该失败却返回了成功`);
      assert.match(String(err.message), /lsp-no-server/, `${method} 的失败原因不是 lsp-no-server`);
      assert.ok(err.data, `${method} 的错误帧没有 data`);
      assert.equal(err.data.reason, 'lsp-no-server');
      assert.equal(err.data.nonSemantic, true);
      assert.equal(err.data.ok, false);
      assert.equal(err.data.serverId, '', `${method} 不该凭空带出服务器身份`);
      // 文本线索是真的扫出来的，但仍标注为非语义结果
      assert.ok(err.data.clues.some((c) => String(c).includes('function:alpha')), `${method} 缺文本线索`);
      assert.equal(err.data.locations.length, 0, `${method} 把文本线索塞进了语义字段`);
      assert.equal(err.data.diagnostics.length, 0);
      assert.equal(err.data.editFiles.length, 0);
      assert.equal(err.data.diagnosticSnapshot, 'none');
    }
    // 参数错误不落到扫描：宿主自己就拒，data.reason 说的是 bad-args
    const bad = await b.request('lsp/call-hierarchy', { path: 'sample.ts', line: 0, character: 0, direction: 'sideways' }).then(() => null, (e) => e);
    assert.ok(bad);
    assert.equal(bad.data.reason, 'lsp-bad-args');
    assert.equal((bad.data.clues ?? []).length, 0);
    for (const [method, params] of cases) {
      if (method === 'lsp/diagnostics') continue;
      for (const key of ['line', 'character']) {
        const missing = { ...params };
        delete missing[key];
        const rejected = await b.request(method, missing).then(() => null, e => e);
        assert.ok(rejected, `${method} 缺少 ${key} 却成功`);
        assert.match(String(rejected.message), /bad-lsp-params/);
        assert.equal(rejected.data.reason, 'lsp-bad-args');
        assert.equal((rejected.data.clues ?? []).length, 0);
      }
    }
    // 未知 method 仍然走协议面的「找不到」，不会被 LSP 分派兜住
    await assert.rejects(() => b.request('lsp/formatting', { path: 'sample.ts' }), /-32601|method not found/);
  } finally {
    await b.stop();
  }
});

// IPC 面的唯一权威是 preload.cjs 里 contextBridge.exposeInMainWorld 的顶层 key（AGENTS.md）。
// 这份清单与计数是 2026-10-09 在工作区态实测的：105 条，本批新增会话级工作树进出面 4 条
// （worktreeDescribe / worktreeEnter / worktreeExit / worktreeCleanup）。
// 增删通道必须同时改 preload.cjs 与这里：整串比对，为的就是「悄悄多出一条发任意方法的口子」当场红。
test('预加载 IPC 面恰好 105 条按动作命名的通道，且没有发任意方法的口子', () => {
  const vm = require('node:vm');
  let exposed;
  vm.runInNewContext(readFileSync(jj(REPO, 'apps/desktop/preload.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
      ipcRenderer: { invoke: () => {}, on: () => {}, removeListener: () => {} },
    }),
  });
  assert.deepEqual(Object.keys(exposed).sort(), [
    'appearanceGet', 'appearanceSetTheme', 'approvalAnswer', 'approvalAsk', 'attachmentImageRead', 'attachmentUpload',
    'bindingRemove', 'bindingReorder', 'bindingUpsert', 'customImportInto', 'customImportNew', 'customsDescribe',
    'customsRemove', 'customsUpsert', 'executionAuthorize', 'executionDescribe', 'executionOutput', 'executionPropose',
    'executionStart', 'executionStop', 'globalAppearanceGet', 'globalAppearanceSetBusySend', 'globalAppearanceSetFontSize', 'globalAppearanceSetTheme',
    'globalSettingsGet', 'globalSettingsSet', 'goalClear', 'goalCreate', 'goalDescribe', 'goalEdit',
    'goalPause', 'goalResume', 'ledgerStats', 'lspCallHierarchy', 'lspDefine', 'lspDiagnostics',
    'lspImplementation', 'lspLookup', 'lspReferences', 'lspRename', 'modelPull', 'modelUpstreamUpsert',
    'modelsCatalog', 'modelsDescribe', 'modelsList', 'modelsRemove', 'modelsSave', 'modelsSetDefault',
    'modelsSetEnabled', 'modelsSort', 'pageToolCall', 'pageToolsList', 'pluginsDescribe', 'pluginsInspect',
    'pluginsInstall', 'pluginsInstallCancel', 'pluginsInstallPoll', 'pluginsRegistries', 'pluginsSetEnabled', 'pluginsSetRowEnabled',
    'pluginsUninstall', 'projection', 'promptCancel', 'promptEnhance', 'promptPoll', 'queueDescribe',
    'queueEnqueue', 'queueUpdate', 'sessionCatalog', 'sessionCreate', 'sessionEvents', 'sessionSelect',
    'taskStart', 'teamApprovalAnswer', 'teamDescribe', 'teamMemberCreate', 'teamMemberStop', 'teamMessageBroadcast',
    'teamMessageSend', 'teamTaskAssign', 'teamTaskClaim', 'teamTaskComplete', 'teamTaskCreate', 'terminalOutput',
    'tipsAfterReply', 'tipsGet', 'tipsSetHidden', 'tipsStartup', 'toolCall', 'toolsList',
    'turnCancel', 'turnPoll', 'turnStart', 'usageSetBudget', 'usageStatus', 'userSend',
    'workspaceChoose', 'workspaceFiles', 'workspaceGet', 'workspaceGitDiff', 'workspaceGitStatus', 'worktreeCleanup',
    'worktreeDescribe', 'worktreeEnter', 'worktreeExit',
  ]);
  assert.equal(Object.keys(exposed).length, 105, 'IPC 通道计数须与 AGENTS.md 与 preload.cjs 同步更新');
  // 万能通道不该存在：既没有「发任意 method」的口子，也没有把四个动作打包成一个转发口的余地。
  for (const forbidden of ['request', 'call', 'invoke', 'send', 'hostRequest', 'worktree', 'worktreeRequest', 'worktreeCall']) {
    assert.equal(forbidden in exposed, false, `预加载暴露了通用转发 ${forbidden}`);
  }
});

// 两条面必须一一对应：预加载每调出一个通道名，主进程就得有那么一个按动作命名的 handler；
// 主进程也不许多出预加载够不到的口子（那等于留了一条只能由别处触发的隐藏命令）。
// 这里不数行数、不 grep 字面量——把 main.cjs 装进 vm 真跑一遍模块作用域的注册序列。
test('预加载调用的通道集合与主进程注册的 handler 集合完全相等（含工作树四条）', () => {
  const vm = require('node:vm');
  const { handlers } = lspMainHandlers();
  let api;
  const invoked = [];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (channel) => { invoked.push(channel); return Promise.resolve({}); }, on: () => {}, removeListener: () => {} },
    }),
  });
  // 每个动作都以「满参数」调用一次：任一通道在 invoke 之前抛掉，集合就会短一截，当场红。
  for (const action of Object.values(api)) action('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
  assert.equal(invoked.length, Object.keys(api).length, '有一条通道没把 invoke 发出去');
  assert.deepEqual([...new Set(invoked)].sort(), [...handlers.keys()].sort());
  assert.equal(handlers.size, 105, 'IPC 面计数须与 preload.cjs 的顶层 key 同步（本批 +4：worktree 进出面）');
  for (const action of ['sacode:worktreeDescribe', 'sacode:worktreeEnter', 'sacode:worktreeExit', 'sacode:worktreeCleanup']) {
    assert.equal(typeof handlers.get(action), 'function', `主进程缺少 ${action}`);
  }
});
