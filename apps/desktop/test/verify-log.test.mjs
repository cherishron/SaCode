import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { persistFailureBundle } from "../../../scripts/verify-log.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..");
const tmpRoot = join(root, "apps", "desktop", ".tmp-test");

test("验收失败保留完整原始日志和摘要，目录唯一且位于忽略的临时根", () => {
  const raw = `首段诊断\nERROR: test-a\n${"警告尾部\n".repeat(80)}`;
  const bundle = persistFailureBundle(tmpRoot, {
    key: "core",
    code: 1,
    summary: "TOTAL 3 / PASSED 1 / SKIPPED 0 / ERROR 1 / FAILED 1",
    raw,
  });
  let second;
  try {
    second = persistFailureBundle(tmpRoot, { key: "core", code: 1, summary: "second run", raw });
    assert.equal(readFileSync(bundle.logPath, "utf8"), raw);
    assert.deepEqual(JSON.parse(readFileSync(join(bundle.dir, "summary.json"), "utf8")), {
      step: "core",
      exitCode: 1,
      summary: "TOTAL 3 / PASSED 1 / SKIPPED 0 / ERROR 1 / FAILED 1",
    });
    assert.ok(bundle.dir.startsWith(tmpRoot));
    assert.notEqual(bundle.dir, second.dir);
  } finally {
    rmSync(bundle.dir, { recursive: true, force: true });
    if (second) rmSync(second.dir, { recursive: true, force: true });
  }
});

test("验收失败日志拒绝无效步骤名和退出码", () => {
  assert.throws(() => persistFailureBundle(tmpRoot, { key: "../bad", code: 1, summary: "bad", raw: "" }));
  assert.throws(() => persistFailureBundle(tmpRoot, { key: "core", code: NaN, summary: "bad", raw: "" }));
});
