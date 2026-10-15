const stripAnsi = value => String(value || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

function integerField(text, key) {
  const match = text.match(new RegExp(`(?:^|\\s)${key}:\\s*(\\d+)(?=[,\\s]|$)`, "m"));
  return match ? Number(match[1]) : undefined;
}

export function parseCjpm(out) {
  const text = stripAnsi(out);
  const starts = [...text.matchAll(/^Summary:\s*TOTAL:\s*\d+\s*$/gm)];
  if (!starts.length) {
    return { ok: false, summary: "未解析到 cjpm Summary，按未验完处理" };
  }
  const start = starts[starts.length - 1].index;
  const block = text.slice(start).split(/\r?\n\s*\r?\n/, 1)[0].slice(0, 1200);
  const total = integerField(block, "TOTAL");
  const passed = integerField(block, "PASSED");
  const skipped = integerField(block, "SKIPPED");
  const errors = integerField(block, "ERROR");
  const failed = integerField(block, "FAILED");
  const values = [total, passed, skipped, errors, failed];
  if (values.some(value => !Number.isSafeInteger(value))) {
    return { ok: false, summary: "cjpm Summary 计数不完整，按未验完处理" };
  }
  const sum = passed + skipped + errors + failed;
  const closed = sum === total;
  const ok = total > 0 && passed > 0 && errors === 0 && failed === 0 && closed;
  const summary = `TOTAL ${total} / PASSED ${passed} / SKIPPED ${skipped} / ERROR ${errors} / FAILED ${failed}`;
  return {
    ok,
    total,
    passed,
    skipped,
    errors,
    failed,
    summary: ok ? summary : `${summary}（${!closed ? `计数合计 ${sum} 不等于 TOTAL` : total === 0 ? "空测试集" : passed === 0 ? "没有通过的已执行用例" : "存在 ERROR/FAILED"}）`,
  };
}

export function parseNodeTest(out) {
  const text = stripAnsi(out);
  const summaries = [...text.matchAll(/^# tests \d+\s*$/gm)];
  if (!summaries.length) {
    return { ok: false, summary: "未解析到完整的 node --test 汇总，按未验完处理" };
  }
  // 多次测试输出可能拼接。所有计数必须来自最后一条汇总，不能拿前一轮缺失的字段补齐新读数。
  const block = text.slice(summaries[summaries.length - 1].index);
  const count = key => {
    const hits = [...block.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, "gm"))];
    return hits.length ? Number(hits[hits.length - 1][1]) : undefined;
  };
  const tests = count("tests");
  const passed = count("pass");
  const failed = count("fail");
  const cancelled = count("cancelled");
  const skipped = count("skipped");
  const todo = count("todo");
  const values = [tests, passed, failed, cancelled, skipped, todo];
  if (values.some(value => !Number.isSafeInteger(value))) {
    return { ok: false, summary: "未解析到完整的 node --test 汇总，按未验完处理" };
  }
  const sum = passed + failed + cancelled + skipped + todo;
  const closed = sum === tests;
  const allSkipped = tests > 0 && passed === 0 && skipped === tests;
  const ok = tests > 0 && passed > 0 && failed === 0 && cancelled === 0 && todo === 0 && closed;
  const summary = `tests ${tests} / pass ${passed} / fail ${failed} / cancelled ${cancelled} / skipped ${skipped} / todo ${todo}`;
  return {
    ok,
    tests,
    passed,
    failed,
    cancelled,
    skipped,
    todo,
    summary: ok ? summary : `${summary}（${!closed ? `计数合计 ${sum} 不等于 tests` : allSkipped ? "全部跳过，未实际执行" : tests === 0 ? "空测试集" : "存在失败、取消、TODO 或没有通过的用例"}）`,
  };
}
