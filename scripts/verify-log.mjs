import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEY = /^[a-z][a-z0-9-]{0,31}$/;

export function persistFailureBundle(baseDir, { key, code, summary, raw }) {
  if (!KEY.test(key)) throw new TypeError("验收项名称无效");
  if (!Number.isInteger(code)) throw new TypeError("验收退出码无效");
  if (typeof summary !== "string") throw new TypeError("验收摘要无效");

  mkdirSync(baseDir, { recursive: true });
  const dir = mkdtempSync(join(baseDir, `verify-all-${key}-`));
  const logPath = join(dir, "output.log");
  writeFileSync(logPath, String(raw ?? ""), { encoding: "utf8", flag: "wx" });
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify({ step: key, exitCode: code, summary }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { dir, logPath };
}
