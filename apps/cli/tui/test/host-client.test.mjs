import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HostClient } from "../src/host-client.mjs";

const fakeHost = fileURLToPath(new URL("./support/fake-host.mjs", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("HostClient：起轮、流式帧、审批与结算都走协议", async () => {
  const client = new HostClient(process.execPath, { args: [fakeHost], cwd: process.cwd() });
  await client.start();
  try {
    const init = await client.request("initialize");
    assert.equal(init.protocolVersion, "0.1");

    const projection = await client.request("session/projection");
    assert.equal(projection.sessionId, "s1");
    assert.equal(projection.messageRows.length, 2);
    assert.equal(projection.toolCalls[0].name, "read");

    await client.request("session/append", { eventType: "user/message", data: "把 a.txt 改掉" });
    const started = await client.request("task/start", {});
    assert.equal(started.started, true);

    const approvals = [];
    client.onNotification((message) => {
      if (message.method === "approval/asked") approvals.push(message.params);
    });

    let cursor = 0;
    let turnId = null;
    let settled = null;
    let answered = false;
    const text = [];
    for (let i = 0; i < 60; i += 1) {
      const poll = await client.request("turn/poll", turnId === null ? { cursor } : { cursor, turnId });
      cursor = poll.nextCursor;
      if (poll.turnId > 0) turnId = poll.turnId;
      for (const frame of poll.frames) {
        if (frame.startsWith("text:")) text.push(frame.slice("text:".length));
      }
      if (!answered && approvals.length > 0) {
        const result = await client.request("approval/answer", {
          approvalId: approvals[0].approvalId,
          decision: "allowed-once",
        });
        assert.equal(result.accepted, true);
        assert.equal(result.state, "allowed-once");
        answered = true;
      }
      if (poll.settled) {
        settled = poll;
        break;
      }
      await sleep(20);
    }

    assert.equal(approvals.length, 1, "必须收到一次审批通知");
    assert.equal(approvals[0].tool, "write");
    assert.equal(approvals[0].sessionId, "s1");
    assert.equal(text.join(""), "你好，世界");
    assert.ok(settled, "必须结算");
    assert.equal(settled.used, 12);
    assert.equal(settled.budget, 100);
    assert.equal(settled.text, "你好，世界");
  } finally {
    const stopped = await client.stop();
    assert.equal(stopped.forced, false, "关闭 stdin 后宿主应自行退出");
  }
});

test("HostClient：取消后由 poll 交出 cancelled 终态", async () => {
  const client = new HostClient(process.execPath, { args: [fakeHost], cwd: process.cwd() });
  await client.start();
  try {
    await client.request("initialize");
    await client.request("session/append", { eventType: "user/message", data: "长任务" });
    await client.request("task/start", {});
    const first = await client.request("turn/poll", { cursor: 0 });
    assert.equal(first.settled, false);
    const cancelled = await client.request("turn/cancel");
    assert.equal(cancelled.cancelRequested, true);
    let settled = null;
    let cursor = first.nextCursor;
    for (let i = 0; i < 20; i += 1) {
      const poll = await client.request("turn/poll", { cursor, turnId: first.turnId });
      cursor = poll.nextCursor;
      if (poll.settled) {
        settled = poll;
        break;
      }
      await sleep(20);
    }
    assert.ok(settled, "取消后仍要拿到终态");
    assert.equal(settled.cancelled, true);
    assert.equal(settled.finishReason, "cancelled");
  } finally {
    await client.stop();
  }
});

test("HostClient：跨数据块的中文协议与诊断保持完整", async () => {
  // 强制在每个非 ASCII 字节后暂停，让 UTF-8 字符跨越多次 data 回调。
  const fixture = `
    const send = async (stream, text) => {
      for (const byte of Buffer.from(text)) {
        stream.write(Buffer.from([byte]));
        if (byte > 127) await new Promise(done => setTimeout(done, 15));
      }
    };
    process.stdin.once('data', async data => {
      const request = JSON.parse(data.toString());
      await send(process.stderr, '诊断：中文完整\\n');
      await send(process.stdout, JSON.stringify({ jsonrpc: '2.0', id: request.id,
        result: { text: '你好，世界🌍' } }) + '\\n');
    });
    process.stdin.on('end', () => process.exit(0));
  `;
  const client = new HostClient(process.execPath, { args: ["--eval", fixture] });
  await client.start();
  try {
    const result = await client.request("initialize");
    assert.equal(result.text, "你好，世界🌍");
    assert.equal(client.stderrText.replace(/\n/g, ""), "诊断：中文完整");
  } finally {
    await client.stop();
  }
});
