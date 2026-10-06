import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { GATE_SCRIPTS, UNWIRED_GATES, verdict } from "../../../scripts/gate-verdict.mjs";

const root = join(import.meta.dirname, "..", "..", "..");

// 这条断言钉的是「新写了门禁但没人知道」：磁盘上每一个 scripts/check_*.cjs 都必须落在
// 接线集或未接线登记表里，两边都不在即静默漏项；登记表里也不能有已经不在磁盘上的条目。
// 未接线不是Forbidden——但必须带理由，理由为空按漏项处理。
test("磁盘上的 check_*.cjs 要么接线、要么带理由登记", () => {
  const onDisk = readdirSync(join(root, "scripts"))
    .filter((f) => /^check_.*\.cjs$/.test(f))
    .sort();
  const unwired = UNWIRED_GATES.map((g) => g.file);
  const accounted = [...GATE_SCRIPTS, ...unwired];
  assert.deepEqual([...accounted].sort(), onDisk,
    `接线的门禁+未接线登记表与磁盘门禁集不等：登记 ${accounted.join(",")} / 磁盘 ${onDisk.join(",")}`);
  for (const g of UNWIRED_GATES) {
    assert.ok(onDisk.includes(g.file), `未接线登记表引用了磁盘上不存在的门禁：${g.file}`);
    assert.ok((g.reason || "").length >= 20, `${g.file} 的未接线理由太短，等于没写`);
  }
});

// 只有退出码不算绿：必须同时见到 GATE: PASS 与 SELFTEST: PASS，缺一项即「没验完」。
test("门禁读数要求 GATE 与 SELFTEST 两行同时出现", () => {
  const green = "OK x\nGATE: PASS (9 checks, fail=0)\nSELFTEST: PASS (probes=9, missed=0, baseline=green)";
  assert.equal(verdict(0, green).ok, true);
  assert.equal(verdict(0, "GATE: PASS (9 checks, fail=0)").ok, false, "门禁没自证不能算绿");
  assert.equal(verdict(0, "SELFTEST: PASS (probes=9, missed=0)").ok, false, "只有自证没有基线不能算绿");
  assert.equal(verdict(0, "").ok, false, "退出码 0 但零输出不是通过");
});

test("读数不被相邻形态喂绿", () => {
  assert.equal(verdict(1, "GATE: FAIL (9 checks, fail=1)\nSELFTEST: PASS (probes=9, missed=0)").ok, false);
  assert.equal(verdict(0, "GATE: PASS_WITH_WARN (7 checks, fail=0, warn=2)\nSELFTEST: PASS").ok, false,
    "带 WARN 不等于 PASS，不许挑一个有利的读数");
  assert.equal(verdict(0, "GATE: PASSED (9 checks)\nSELFTEST: PASSED").ok, false, "措辞变了要归入读不懂而不是通过");
  // 多项门禁拼在一起跑时，只要有一段报红就不许被另一段的绿盖过去
  assert.equal(verdict(0, "GATE: PASS (9 checks, fail=0)\nSELFTEST: PASS (probes=9, missed=0)\nGATE: FAIL (7 checks, fail=1)\nSELFTEST: PASS").ok, false);
  assert.equal(verdict(0, "GATE: PASS (9 checks, fail=0)\nSELFTEST: FAIL (probes=9, missed=1, baseline=green)").ok, false,
    "门禁自证有 MISSED 即门禁自己在造假绿");
});
