// 统一验收的临时目录隔离。
// 为什么要有这一份：Windows 上共享 %LOCALAPPDATA%\Temp 条目堆积到几千个时，
// 真宿主用例的 mkdir 会成批报 `return -13: Permission denied`（连带 -32001
// already-owned 与 host-gone），仓颉 std.unittest 起 worker 更直接抛
// "Too many attempts to create a temporary file" 且整份输出零 Summary。
// 2026-10-06 提交级实测：桌面 58 条红里 52 条由这个形态造成，换成独占临时目录后
// 同一批用例 30/30 全绿。所以整轮验收跑在自己独占的一份目录里。
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

export function createPrivateTmpDir(root) {
  const base = join(root, "target");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "sacode-verify-tmp-"));
  // TMP/TEMP/TMPDIR 三个都给：仓颉运行时与 libuv 各看不同的键，少一个就还有步骤落在共享目录里。
  return { dir, env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } };
}

export function disposePrivateTmpDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}
