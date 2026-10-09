// 对话面纯派生层的验收。msgfold.js 是经典脚本（挂 window.SaCodeMsgFold），
// 所以这里用一个空 window 求值，再把返回的引用交给断言——纯函数没有别的依赖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer", "msgfold.js");
// msgfold.js 是渲染层用的经典脚本（挂 window.SaCodeMsgFold）。这里在全新上下文里跑它，
// 只递一个 window 进去——不用 new Function/eval，也就不会把测试模块的闭包泄漏给被测代码。
const sandbox = { window: {} };
runInNewContext(readFileSync(FILE, "utf8"), sandbox);
const F = sandbox.window.SaCodeMsgFold;

test('附件与事件身份来自对应投影行，重复正文和尾部裁切不混用',()=>{
 const attachment={attachmentId:'sha256:a',kind:'file',name:'说明.txt',bytes:3};
 const rows=[{id:'event-4',attachments:[attachment]},{id:'event-8',attachments:[]}];
 const bubbles=F.toBubbleMessages(['user/message: 同文','user/message: 同文'],rows);
 assert.equal(bubbles[0].id,'event-4');assert.equal(bubbles[1].id,'event-8');
 assert.equal(bubbles[0].attachments[0],attachment);assert.equal(bubbles[1].attachments.length,0);
 assert.equal(F.toBubbleMessages(['user/message: 同文'],rows.slice(1))[0].id,'event-8');
 assert.equal(F.latestReadPreview(['tool/result: ok-read:a.txt:1\nx'],[{id:'event-9'}]).messageId,'event-9');
});

test("读取快照从最新成功记录恢复并保留 Windows 路径与正文", () => {
  const preview = F.latestReadPreview([
    "tool/result: ok-read:old.txt:1\nx",
    "tool/result: ok-read:C:\\项目\\a:b.txt:32\n中文\n<script>原文</script>",
    "tool/result: not-found:missing.txt",
  ]);
  assert.equal(preview.path, "C:\\项目\\a:b.txt");
  assert.equal(preview.text, "中文\n<script>原文</script>");
  assert.equal(preview.bytes, 32);
  assert.equal(preview.messageId, "m1");
});

test("没有成功读取或损坏头部不产生伪造快照", () => {
  assert.equal(F.latestReadPreview(["user/message: ok-read:a:0\n", "tool/result: ok-read:a:bad\nx", "tool/result: ok-read:a:999999999999999999999\nx"]), null);
  assert.equal(F.latestReadPreview([]), null);
});

test("空文件也是有效读取快照", () => {
  const preview = F.latestReadPreview(["tool/result: ok-read:empty.txt:0\n"]);
  assert.equal(preview.text, "");
  assert.equal(preview.bytes, 0);
});

test("toBubbleMessages 按映射表把投影行翻成气泡消息", () => {
  const ms = F.toBubbleMessages(["user/message: 你好", "assistant/message: 世界", "tool/result ok: x", "system/message: s"]);
  assert.equal(ms[0].role, "user");
  assert.equal(ms[0].content, "你好");
  assert.equal(ms[0].sourceRole, "user/message");
  assert.equal(ms[1].role, "assistant");
  assert.equal(ms[2].role, "tool");
  assert.equal(ms[2].sourceRole, "tool/result ok");
  assert.equal(ms[3].role, "system");
});

test("每条消息带按投影位次的稳定 id", () => {
  const ms = F.toBubbleMessages(["user/message: a", "user/message: b"]);
  assert.equal(ms[0].id, "m0");
  assert.equal(ms[1].id, "m1");
});

test("未命中映射表回落 system，且不会造出第二个角色", () => {
  const ms = F.toBubbleMessages(["unknown/thing: x"]);
  assert.equal(ms[0].role, "system");
  assert.equal(ms[0].sourceRole, "unknown/thing");
});

// developer/message 是不变量 7 里第五类进模型历史的事件，界面不许把它悄悄标成 system：
// 核心认它、投影带它，气泡就得按自己的角色显示，sourceRole 保留原始前缀以便回日志追问。
test("developer/message 有自己的角色映射，不被并入 system", () => {
  const ms = F.toBubbleMessages(["system/message: s", "developer/message: d", "user/message: u"]);
  assert.equal(ms[0].role, "system");
  assert.equal(ms[1].role, "developer");
  assert.equal(ms[1].sourceRole, "developer/message");
  assert.equal(ms[1].content, "d");
  const rc = F.roleConfigs();
  assert.equal(rc.developer.placement, "start");
  assert.equal(rc.developer.shape, "none");
});

test("正文里的冒号原样保留（只按第一个冒号切一次）", () => {
  const ms = F.toBubbleMessages(["tool/result ok: path: with: colons"]);
  assert.equal(ms[0].content, "path: with: colons");
});

test("roleConfigs 与映射表同源，user 在右其余在左", () => {
  const rc = F.roleConfigs();
  assert.equal(rc.user.placement, "end");
  assert.equal(rc.assistant.placement, "start");
  assert.equal(rc.tool.placement, "start");
  assert.equal(rc.system.placement, "start");
});

test("foldPlan：恰好等于阈值不折叠", () => {
  const t = "a".repeat(F.FOLD_THRESHOLD);
  const p = F.foldPlan(t, F.FOLD_THRESHOLD);
  assert.equal(p.folded, false);
  assert.equal(p.shown, t);
});

test("foldPlan：超阈值截到阈值长度并附省略号", () => {
  const t = "a".repeat(F.FOLD_THRESHOLD + 10);
  const p = F.foldPlan(t, F.FOLD_THRESHOLD);
  assert.equal(p.folded, true);
  assert.equal(p.shown.length, F.FOLD_THRESHOLD + 1);
  assert.ok(p.shown.endsWith("…"));
});

test("foldPlan：空串与短串都不折叠，shown 原文返回", () => {
  assert.equal(F.foldPlan("", F.FOLD_THRESHOLD).folded, false);
  assert.equal(F.foldPlan("短正文", F.FOLD_THRESHOLD).shown, "短正文");
});

// ── 会话内历史对话导航（轮次大纲）──
// 条目只能是日志投影里真实存在的用户提问，锚点 id 必须与气泡消息同一个来源，
// 否则侧栏点进去会跳到一个界面临时造出来的位置。
// 被测模块在 vm 上下文里求值，它返回的数组带着另一个 realm 的原型，
// 所以这里一律整串比对，不用 deepEqual 比对象。
const asJson = (v) => JSON.stringify(v);

test("turnOutline：每条用户提问成一个轮次，锚点取自对应投影行", () => {
  const lines = ["user/message: 第一问", "assistant/message: 第一答", "user/message: 第二问"];
  const rows = [{ id: "event-2" }, { id: "event-5" }, { id: "event-8" }];
  const outline = F.turnOutline(lines, rows);
  assert.equal(outline.length, 2);
  assert.equal(asJson(outline.map((e) => e.id)), asJson(["event-2", "event-8"]));
  assert.equal(asJson(outline.map((e) => e.title)), asJson(["第一问", "第二问"]));
  assert.equal(asJson(outline[0].replies.map((r) => [r.id, r.role])), asJson([["event-5", "assistant"]]));
  assert.equal(asJson(outline[1].replies), asJson([]));
});

test("turnOutline：首条提问之前的系统与开发者消息不造锚点", () => {
  const outline = F.turnOutline(["system/message: s", "developer/message: d", "tool/result ok: t"], [{ id: "event-1" }, { id: "event-2" }, { id: "event-3" }]);
  assert.equal(asJson(outline), asJson([]));
});

test("turnOutline：标题取提问首行并按 60 字符截断，正文与回复各自成摘要", () => {
  const long = "头行" + "字".repeat(80) + "\n次行不该进标题";
  const outline = F.turnOutline([`user/message: ${long}`, "assistant/message: 答" + "话".repeat(200)], []);
  assert.equal(outline[0].title, "头行" + "字".repeat(57) + "…");
  assert.ok(!outline[0].title.includes("\n"));
  assert.ok(outline[0].content.includes("次行不该进标题"));
  assert.equal(outline[0].replies[0].role, "assistant");
  assert.equal(outline[0].replies[0].text.length, 120);
  assert.ok(outline[0].replies[0].text.endsWith("…"));
  const single = F.turnOutline([`user/message: ${"问".repeat(200)}`], []);
  assert.equal(single[0].content.length, 120);
  assert.ok(single[0].content.endsWith("…"));
  // 没有投影行时锚点回落到按位次的稳定 id，与 toBubbleMessages 同一套。
  assert.equal(F.turnOutline([`user/message: ${long}`], [])[0].id, "m0");
});

test("turnOutline：同一轮内的工具结果归到该轮回复，多行提问保留原始换行", () => {
  const outline = F.turnOutline(
    ["user/message: 第一行\n第二行", "tool/result: ok", "assistant/message: 完成", "user/message: 追问"],
    [{ id: "event-1" }, { id: "event-2" }, { id: "event-3" }, { id: "event-4" }]
  );
  assert.equal(asJson(outline.map((e) => e.id)), asJson(["event-1", "event-4"]));
  assert.ok(outline[0].content.includes("\n第二行"));
  assert.equal(asJson(outline[0].replies.map((r) => r.role)), asJson(["tool", "assistant"]));
});

test("turnOutline：空提问与纯空白提问给出确定标题，不留空条目", () => {
  assert.equal(F.turnOutline(["user/message:"], [{ id: "event-1" }])[0].title, "（空消息）");
  assert.equal(F.turnOutline(["user/message:    "], [{ id: "event-1" }])[0].title, "（空消息）");
  assert.equal(asJson(F.turnOutline([], [])), asJson([]));
});
