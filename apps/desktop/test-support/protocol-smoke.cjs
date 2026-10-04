// 宿主协议与持久化屏障验收；仅在显式冒烟模式加载。
const { existsSync } = require("node:fs");

module.exports = async function smoke({ app, HOST, SESSION_DIR, bridge, seedIfNeeded }) {
  if (!existsSync(HOST)) {
    console.log(`SMOKE FAIL 缺少自包含宿主: ${HOST}（先跑 scripts/pack-host.mjs）`);
    app.exit(2);
    return;
  }
  seedIfNeeded();
  await bridge.start(SESSION_DIR);
  const out = [];
  let bad = 0;
  for (const m of ["initialize", "session/projection", "session/subscribe"]) {
    try {
      out.push(`${m}=${JSON.stringify(await bridge.request(m))}`);
    } catch (e) {
      bad += 1;
      out.push(`${m} 失败: ${e.message}`);
    }
  }
  try {
    await bridge.request("no/such");
    bad += 1;
    out.push("未知方法竟然成功了（应当报错）");
  } catch (e) {
    out.push(`未知方法按预期报错: ${e.message}`);
  }
  // 未 flush 的写入不得被当作已提交：submit 后订阅读不到，flush 后才读到
  try {
    const s = await bridge.request("session/submit", { eventType: "assistant/message", data: "smoke pending" });
    const before = await bridge.request("session/subscribe", { cursor: s.durable });
    const f = await bridge.request("session/flush");
    const after = await bridge.request("session/subscribe", { cursor: s.durable });
    if (before.events.length !== 0 || after.events.length !== 1 || f.durable !== s.events) {
      bad += 1;
      out.push(`durability 屏障不符预期: before=${before.events.length} after=${after.events.length} durable=${f.durable}/${s.events}`);
    } else {
      out.push(`durability 屏障: submit(durable=${s.durable}) → flush(durable=${f.durable})`);
    }
  } catch (e) {
    bad += 1;
    out.push(`durability 屏障失败: ${e.message}`);
  }
  const st = await bridge.stop();
  if (st.forced) {
    bad += 1;
    out.push("宿主被强杀，没有走 EOF 结算路径");
  }
  out.push(`stop forced=${st.forced} code=${st.code} signal=${st.signal}`);
  out.forEach((l) => console.log("SMOKE", l));
  console.log(bad === 0 ? "SMOKE PASS" : "SMOKE FAIL");
  app.exit(bad === 0 ? 0 : 1);
};
