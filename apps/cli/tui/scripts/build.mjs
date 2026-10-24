// 把 Ink/React 折叠成单文件 .mjs：npm 主包运行时不需要 node_modules。
// 用 Rollup 而不是 esbuild：本机沙箱里原生 esbuild 服务进程读不到 D: 盘的项目文件，
// 纯 JS 的 Rollup 直接跑在 Node 进程里，文件访问与构建环境一致。
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..", "..", "..");
const version = JSON.parse(readFileSync(resolve(repoRoot, "npm/sacode-cli/package.json"), "utf8")).version;
const outfile = resolve(appRoot, "dist/index.mjs");

const bundle = await rollup({
  input: resolve(appRoot, "src/index.mjs"),
  // Ink 的 DevTools 分支只在 DEV=true 时走动态 import；产物里不能留运行时模块加载，
  // 因此把 DEV 常量折叠掉，连同 ws/react-devtools-core 一起树摇出包。
  treeshake: { moduleSideEffects: "no-external" },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        "process.env.DEV": JSON.stringify("false"),
        "process.env['DEV']": JSON.stringify("false"),
        'process.env["DEV"]': JSON.stringify("false"),
        "process.env.NODE_ENV": JSON.stringify("production"),
        "process.env['NODE_ENV']": JSON.stringify("production"),
        'process.env["NODE_ENV"]': JSON.stringify("production"),
      },
    }),
    nodeResolve({ exportConditions: ["node"], preferBuiltins: true }),
    commonjs({ transformMixedEsModules: true }),
    json(),
  ],
  external: ["bufferutil", "utf-8-validate", "react-devtools-core"],
  onwarn(warning, warn) {
    if (warning.code === "CIRCULAR_DEPENDENCY") return;
    warn(warning);
  },
});

const generated = await bundle.write({
  file: outfile,
  format: "esm",
  inlineDynamicImports: true,
  banner: `// SaCode TUI bundle（由 apps/cli/tui/scripts/build.mjs 生成，勿手改）\nconst __SACODE_VERSION__ = ${JSON.stringify(version)};`,
});

// Rollup 实际内联的包逐一携带许可，不能只保留仓内源码里的版权头。
const noticesDir = resolve(appRoot, "dist/third-party");
rmSync(noticesDir, { recursive: true, force: true });
mkdirSync(noticesDir, { recursive: true });
mkdirSync(join(noticesDir, "gemini-cli"), { recursive: true });
for (const file of ["README.md", "Apache-2.0.txt"]) cpSync(resolve(appRoot, "third-party", file), join(noticesDir, "gemini-cli", file));
const packages = new Map();
const includedModules = generated.output.flatMap((output) => output.type === 'chunk'
  ? Object.entries(output.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id)
  : []);
for (const id of includedModules) {
  const normalized = id.replaceAll("\\", "/");
  const match = normalized.match(/^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)/);
  if (!match) continue;
  let directory = dirname(id.replace(/^\0/, "").split("?")[0]);
  while (directory.startsWith(appRoot) && !existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (!existsSync(join(directory, "package.json"))) continue;
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (!pkg.name || !pkg.version) continue;
  const key = `${pkg.name}@${pkg.version}`;
  if (packages.has(key)) continue;
  let licenseDirectory = directory;
  let files = readdirSync(directory).filter((name) => /^(?:licen[sc]e|notice|copying)(?:[._-].*)?$/i.test(name));
  if (files.length === 0 && key === 'yoga-layout@3.2.1') {
    // npm 3.2.1 tarball 漏许可文件；固定上游同版本 LICENSE，不能套任意 MIT 模板。
    licenseDirectory = resolve(appRoot, 'third-party/yoga-layout-3.2.1');
    files = ['LICENSE.txt'];
  }
  if (files.length === 0 && key === '@alcalzone/ansi-tokenize@0.1.3') {
    // 0.1.3 包与固定源码只声明 MIT，补带同作者后续发布的 MIT 全文及来源说明。
    licenseDirectory = resolve(appRoot, 'third-party/ansi-tokenize-0.1.3');
    files = ['LICENSE.txt'];
  }
  if (files.length === 0) throw new Error(`内联依赖缺许可证文件：${key}`);
  const destination = join(noticesDir, key.replaceAll("/", "__"));
  mkdirSync(destination, { recursive: true });
  for (const file of files) cpSync(join(licenseDirectory, file), join(destination, file));
  packages.set(key, { name: pkg.name, version: pkg.version, license: pkg.license, files });
}
writeFileSync(join(noticesDir, "bundled-packages.json"), JSON.stringify([...packages.values()], null, 2) + "\n");

await bundle.close();
process.stdout.write(`TUI 已打包：${outfile}\n`);
