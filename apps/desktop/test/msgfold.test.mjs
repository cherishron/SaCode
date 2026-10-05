// 对话面纯派生层的验收。msgfold.js 是经典脚本（挂 window.DshMsgFold），
// 所以这里用一个空 window 求值，再把返回的引用交给断言——纯函数没有别的依赖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer", "msgfold.js");
// msgfold.js 是渲染层用的经典脚本（挂 window.DshMsgFold）。这里在全新上下文里跑它，
// 只递一个 window 进去——不用 new Function/eval，也就不会把测试模块的闭包泄漏给被测代码。
const sandbox = { window: {} };
runInNewContext(readFileSync(FILE, "utf8"), sandbox);
const F = sandbox.window.DshMsgFold;

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
