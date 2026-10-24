// 宿主定位与运行环境：TUI 不自己实现业务，只负责把 sacode-host 拉起来。
// 打包态由平台包把 sacode-host 放在 bin/ 里并通过 SACODE_HOST 告知；
// 开发态回退到桌面端已打好的宿主目录（与 desktop/paths.cjs 的 dev 布局一致）。
import { existsSync } from "node:fs";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = process.platform === "win32" ? "sacode-host.exe" : "sacode-host";

function candidates(env) {
  const list = [];
  if (typeof env.SACODE_HOST === "string" && env.SACODE_HOST.length > 0) list.push(env.SACODE_HOST);
  // 本文件会被打进两个位置：
  //   npm/sacode-cli/tui/index.mjs      → 仓库根在上三级
  //   apps/cli/tui/dist/index.mjs       → 仓库根在上四级
  const here = dirname(fileURLToPath(import.meta.url));
  for (const up of ["../../..", "../../../.."]) {
    list.push(resolve(here, up, "apps/desktop/dist/host/bin", HOST_NAME));
  }
  return list;
}

export function resolveHostPath({ env = process.env, exists = existsSync } = {}) {
  for (const candidate of candidates(env)) {
    if (exists(candidate)) return candidate;
  }
  throw new Error(
    `找不到宿主 ${HOST_NAME}。已尝试：\n  ${candidates(env).join("\n  ")}\n`
    + "请先构建宿主（apps/host）并放到 apps/desktop/dist/host/bin，或设置 SACODE_HOST。",
  );
}

// 只给宿主子进程补加载路径，不改系统环境。与 apps/desktop/paths.cjs 同口径：
// 非 Windows 需要把宿主目录加进动态库搜索路径；Windows 靠 exe 同目录搜索。
export function hostRuntimeEnv(env, hostExe, platform = process.platform, exists = existsSync) {
  const runtime = { ...env };
  if (platform === "win32") {
    const zoneinfo = join(dirname(hostExe), "zoneinfo");
    if (exists(join(zoneinfo, "Asia", "Shanghai"))) {
      const existing = typeof env.CJ_TZPATH === "string" ? env.CJ_TZPATH.split(";").filter(Boolean) : [];
      const normalize = (value) => win32.resolve(value).toLowerCase();
      if (!existing.some((value) => normalize(value) === normalize(zoneinfo))) {
        runtime.CJ_TZPATH = [...existing, zoneinfo].join(";");
      }
    }
    return runtime;
  }
  const key = platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  runtime[key] = [dirname(hostExe), env[key]].filter(Boolean).join(":");
  return runtime;
}

// 随包的信任锚：存在才设置，不替宿主猜。
export function withCaBundle(env, hostExe, exists = existsSync) {
  if (env.SACODE_CA_BUNDLE) return { ...env };
  const sidecar = join(dirname(hostExe), "ca-bundle.pem");
  return exists(sidecar) ? { ...env, SACODE_CA_BUNDLE: sidecar } : { ...env };
}

export function hostSpawnEnv(env, hostExe, platform = process.platform, exists = existsSync) {
  return withCaBundle(hostRuntimeEnv(env, hostExe, platform, exists), hostExe, exists);
}
