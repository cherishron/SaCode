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
    file: "check_contract_anchor_audit.cjs",
    reason:
      "审计 119 条契约实现锚点的探针，落在 c7b3781 但一直没登记。2026-10-11 实测：`node scripts/check_contract_anchor_audit.cjs` 回 rc=0，" +
      "但全文 0 条 `GATE:`/`SELFTEST:` 标记（对照已接线的 check_p0_ownership.cjs 有 3 条），" +
      "而判绿四条件要求「退出码 0 + GATE: PASS + SELFTEST: PASS + 无 FAIL」缺一不可——接进 verify-all 只会把它读成「没验完」，" +
      "既不是真绿也不能靠 rc 蒙。接线动作：先给它补上 GATE:/SELFTEST: 输出与一条能抓红的自证探针，再进 GATE_SCRIPTS。",
  },
  {
    file: "check_verb_checklist_cover.cjs",
    reason: "对账 dsh-capability-matrix 的 ◐ 清单与 verb 清单，归属矩阵/能力面那条线（2026-10-06 工作区读数 RESULT: FAIL、rc=1，漏 core/extensions/system-prompt，且矩阵文件当时有未落库改动）。接线要先由该主责把矩阵与清单对上，A 不在别人的红态上按接线键。",
  },
  {
    file: "check_artifact_placement.cjs",
    reason:
      "2026-10-16 随统一临时根迁移（旧桌面临时根收敛为 target/tmp）同批上线，已自证且当前基线为绿。" +
      "暂不进 GATE_SCRIPTS：接线要动 verify-all.mjs 的步骤表，而本批工作树里还有多份未提交在途改动，" +
      "避免在别人的在途窗口上按接线键；下一批验收把它作为独立小步接入，跑通一轮全绿读数后移出本表。",
  },
  {
    file: "check-release-manifest.cjs",
    reason:
      "2026-10-17 随 modelPull 超时诊断（target/tmp/modelpull-probe-20261016/）同批上线：分发载荷闭包检查" +
      "（ca-bundle.pem / 启动必需 DLL 五颗 / zoneinfo / computer-use 双件 / app.asar），自证 6 探针 PASS，" +
      "对 neutral 验证包实测抓到 3 个真实缺件。不进 GATE_SCRIPTS 的原因与放置守卫不同：它是**按需守卫**——" +
      "verify-all 默认轮没有 unpacked 产物，SKIP 语义（`MANIFEST: SKIP` rc=0，无 GATE 行）会被 verdict() 如实读成「没验完」，" +
      "这是防呆而非缺陷。接线形态：pack-host/electron-builder 重打后、中性导出前显式跑一次" +
      "（`node scripts/check-release-manifest.cjs --dir=<unpacked>`），判绿要求 `MANIFEST: PASS (N checks, fail=0)` + rc=0；" +
      "若将来要进 verify-all，需先给它加「无候选即显式豁免」的登记通道，避免 SKIP 与 FAIL 不可区分。",
  },
];

export function verdict(code, out) {
  const text = out || "";
  const gate = /^GATE: PASS \((\d+) checks, fail=0(?:, warn=0)?\)$/m.exec(text);
  const selftest = /^SELFTEST: PASS \(probes=(\d+), missed=0, baseline=green\)$/m.exec(text);
  const anyFail = /^GATE: FAIL/m.test(text) || /^SELFTEST: FAIL/m.test(text);
  const ok = code === 0 && !!gate && Number(gate?.[1]) > 0 && !!selftest && Number(selftest?.[1]) > 0 && !anyFail;
  if (code !== 0) return { ok: false, summary: `门禁进程退出码 ${code}` };
  if (anyFail) return { ok: false, summary: "门禁或自证有 FAIL 段" };
  if (!gate) return { ok: false, summary: "未见到零失败且计数有效的 GATE: PASS 行" };
  if (Number(gate[1]) === 0) return { ok: false, summary: "GATE 检查数为零" };
  if (!selftest) return { ok: false, summary: "未见到零漏检且基线为绿的 SELFTEST: PASS 行" };
  if (Number(selftest[1]) === 0) return { ok: false, summary: "SELFTEST 探针数为零" };
  return { ok: true, summary: `GATE PASS (${gate[1]} checks, fail=0) + SELFTEST PASS (probes=${selftest[1]}, missed=0, baseline=green)` };
}
