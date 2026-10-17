import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCjpm, parseNodeTest } from "../../../scripts/verify-output.mjs";

test("cjpm 只接受计数闭合且有实际通过项的汇总", () => {
  const green = "Summary: TOTAL: 8\n    PASSED: 6, SKIPPED: 2, ERROR: 0\n    FAILED: 0\n";
  assert.equal(parseCjpm(green).ok, true);
  assert.equal(parseCjpm(`\u001b[32m${green}\u001b[0m`).ok, true);
  assert.equal(parseCjpm("Summary: TOTAL: 8\nPASSED: 6, SKIPPED: 1, ERROR: 0\nFAILED: 1").ok, false);
  assert.equal(parseCjpm("Summary: TOTAL: 8\nPASSED: 6, SKIPPED: 2, ERROR: 1\nFAILED: 0").ok, false);
  assert.equal(parseCjpm("Summary: TOTAL: 8\nPASSED: 6, SKIPPED: 1, ERROR: 0\nFAILED: 0").ok, false,
    "计数不闭合不能通过");
  assert.equal(parseCjpm("Summary: TOTAL: 0\nPASSED: 0, SKIPPED: 0, ERROR: 0\nFAILED: 0").ok, false,
    "空测试集不能通过");
  assert.equal(parseCjpm("Summary: TOTAL: 8\nPASSED: 0, SKIPPED: 8, ERROR: 0\nFAILED: 0").ok, false,
    "全跳过不能冒充执行通过");
  assert.equal(parseCjpm("Summary: TOTAL: 8\nPASSED: 6").ok, false,
    "缺少任一结果计数都不能通过");
  assert.equal(parseCjpm(`${green}\nSummary: TOTAL: 8\nPASSED: 8, SKIPPED: 0, ERROR: 0`).ok, false,
    "新一轮汇总残缺时不能沿用上一轮的 FAILED 计数");
  assert.equal(parseCjpm(`${green}\nSummary: TOTAL: 8\nPASSED: 6, SKIPPED: 2, ERROR: 0\nFAILED: 1`).ok, false,
    "上一轮全绿不能盖住最后一轮失败");
});

test("node TAP 只接受计数闭合、无失败且确有通过项的汇总", () => {
  const green = "# tests 4\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n";
  assert.equal(parseNodeTest(green).ok, true);
  assert.equal(parseNodeTest("# tests 4\n# pass 2\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0").ok, false);
  assert.equal(parseNodeTest("# tests 4\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 4\n# todo 0").ok, false,
    "全跳过不能通过");
  assert.equal(parseNodeTest("# tests 4\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 1").ok, false,
    "TODO 测试不能算已验收");
  assert.equal(parseNodeTest("# tests 4\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0").ok, false,
    "计数不闭合不能通过");
  assert.equal(parseNodeTest("# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0").ok, false,
    "空测试集不能通过");
  assert.equal(parseNodeTest("# tests 1\n# pass 1").ok, false,
    "缺少失败/取消/跳过计数不能通过");
  assert.equal(parseNodeTest(`${green}\n# tests 1\n# pass 1`).ok, false,
    "新一轮汇总残缺时不能从上一轮补齐失败计数");
  assert.equal(parseNodeTest(`${green}\n# tests 2\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0`).ok, false,
    "上一轮全绿不能盖住最后一轮失败");
});
