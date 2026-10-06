// 门禁读数与登记表：把「退出码 0」和「门禁真的验过且真的自证过」分开判。
//
// 为什么单独成文件：verify-all.mjs 一 import 就会跑起来，没法在测试里调它的步骤函数。
// 这里只放纯函数与登记表，步骤本身留在 verify-all.mjs，测试可以直判读逻辑注入假输出。
//
// 判绿要同时满足四件事，缺一条即「没验完」而不是「通过」：
// 1) 退出码 0；2) 出现 `GATE: PASS`（`PASS_WITH_WARN` 与 `PASSED` 都不算，别挑有利的读数）；
// 3) 出现 `SELFTEST: PASS`——门禁的基线绿可能是它自己没在执行，自证探针才证明它抓得住违规；
// 4) 全文没有 `GATE: FAIL` 或 `SELFTEST: FAIL`（多段拼接输出时一段红不能被另一段绿盖过去）。
export const GATE_SCRIPTS = [
  "check_p0_ownership.cjs",
  "check_path_ownership.cjs",
  "check_ipc_surface_parity.cjs",
  "check_host_method_surface.cjs",
];

// 磁盘上存在但本批没接进 verify-all 的门禁，必须带理由登记（测试会钉这条）。
// 这条不是豁免通道：它让「多一个门禁却没人负责」变成红灯，而不是静默漏项。
export const UNWIRED_GATES = [
  {
    file: "check_verb_checklist_cover.cjs",
    reason: "对账 dsh-capability-matrix 的 ◐ 清单与 verb 清单，归属矩阵/能力面那条线（2026-10-06 工作区读数 RESULT: FAIL、rc=1，漏 core/extensions/system-prompt，且矩阵文件当时有未落库改动）。接线要先由该主责把矩阵与清单对上，A 不在别人的红态上按接线键。",
  },
];

const lineOf = (out, re) => {
  const m = re.exec(out);
  return m ? m[0].trim() : null;
};

export function verdict(code, out) {
  const text = out || "";
  const gate = lineOf(text, /^GATE: PASS\s*\([^\n]*\)/m);
  const selftest = lineOf(text, /^SELFTEST: PASS\s*\([^\n]*\)/m);
  const anyFail = /^GATE: FAIL/m.test(text) || /^SELFTEST: FAIL/m.test(text);
  const ok = code === 0 && !!gate && !!selftest && !anyFail;
  if (anyFail) return { ok: false, summary: "门禁或自证有 FAIL 段" };
  if (!gate) return { ok: false, summary: `退出码 ${code}，未见到 GATE: PASS 行` };
  if (!selftest) return { ok: false, summary: `退出码 ${code}，GATE 绿但没有 SELFTEST: PASS（门禁未自证）` };
  return { ok: true, summary: `${gate} + ${selftest}` };
}
