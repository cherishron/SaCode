// 构建期折叠 @opentiny/next-sdk 的 WebMCP 初始化成渲染层能用的一种形态：单个经典脚本。
// 机制与 pack-tinyrobot.mjs 同：next-sdk 是 ESM-only，而桌面跑在 file:// + CSP script-src 'self'
// 禁 unsafe-eval，运行期不能用 import()，故用 esbuild 在构建期全部折叠。
// 产物 renderer/vendor/next-sdk.iife.js 走 vendor 流水线，不进 git。
import { writeFileSync, readFileSync, statSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertStaticRendererBundle } from './renderer-bundle-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(__dirname, '..', 'apps', 'desktop');
const PKG = '@opentiny/next-sdk/core';
const OUT_JS = join(DESKTOP, 'renderer', 'vendor', 'next-sdk.iife.js');
let TMP_DIR;

function die(msg) {
  if (TMP_DIR) rmSync(TMP_DIR, { recursive: true, force: true });
  console.error(`pack-next-sdk 失败：${msg}`);
  process.exit(2);
}

// 加载 esbuild
const requireFromDesktop = createRequire(join(DESKTOP, 'package.json'));
let esbuild;
try {
  esbuild = requireFromDesktop("esbuild");
} catch (e) {
  die(`esbuild 未安装（在 apps/desktop 跑 npm install）：${e.message}`);
}

// 1. 临时入口放在隔离目录，依赖仍按 desktop 解析；不在源码目录遗留夹具。
mkdirSync(join(DESKTOP, '.tmp-test'), { recursive: true });
TMP_DIR = mkdtempSync(join(DESKTOP, '.tmp-test', 'pack-next-sdk-'));
const shim = join(TMP_DIR, 'vue-global.cjs');
writeFileSync(shim, "module.exports = globalThis.Vue;\n");
const entry = join(TMP_DIR, 'entry.js');
writeFileSync(entry, `import { initializeBuiltinWebMCP } from "${PKG}";\nglobalThis.__nextSDK = { initializeBuiltinWebMCP };\n`);

// 2. 用 esbuild 折叠成 IIFE
// 注意：buildResult 必须在 try 外声明——块内 const 在块外不可见，
// 否则成功路径到第 72 行 assertStaticRendererBundle(code, buildResult.metafile) 会抛 ReferenceError。
let buildResult;
try {
  buildResult = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: '__nextSDKBundle',
    platform: 'browser',
    outfile: OUT_JS,
    minify: true,
    treeShaking: true,
    absWorkingDir: DESKTOP,
    alias: { vue: shim },
    metafile: true,
    plugins: [{
      name: 'unused-ajv-side-effects',
      setup(build) {
        // 仅初始化 WebMCP：这些未使用的导出不需执行模块顶层初始化。
        // 保留真实文件与实现；将来若使用校验器，活跃求值仍会被原守卫拒绝。
        build.onResolve({ filter: /^(?:ajv|ajv-formats)$|(?:^|\/)ajv-provider\.js$/ }, async args => {
          if (args.pluginData?.resolvedAjv) return;
          const result = await build.resolve(args.path, {
            importer: args.importer,
            resolveDir: args.resolveDir,
            kind: args.kind,
            pluginData: { resolvedAjv: true },
          });
          const path = result.path.replaceAll('\\', '/');
          if (/\/node_modules\/(?:ajv|ajv-formats)\//.test(path)
              || path.endsWith('/node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js')) {
            return { ...result, sideEffects: false };
          }
          return result;
        });
      },
    }],
  });
} catch (e) {
  die(`esbuild 折叠失败：${e.message}`);
}

// 3. 反证式自检
const code = readFileSync(OUT_JS, 'utf8');

// 3a. 不允许残留 import()
if (/import\(/.test(code)) die('折叠产物残留 import(...)，外部动态 import 没能在构建期静止化');

// 3b. 不允许裸 "vue" 说明符（覆盖双/单引号所有合法写法）
if (/require\(["']vue["']\)|from["']vue["']/.test(code)) die('折叠产物残留裸 vue 说明符，alias 没生效');

// 3c. 初始化路径不一定依赖 Vue；若确实引入，必须命中全局 shim，禁止第二份 Vue。
if (!code.includes('__nextSDK')) die('折叠产物未设 globalThis.__nextSDK');
try {
  const inputs = Object.keys(buildResult.metafile.inputs);
  if (inputs.some(input => /node_modules\/(?:vue|@vue)\//.test(input.replaceAll('\\', '/')))) {
    die('折叠产物引入第二份 Vue，alias 没生效');
  }
  if (inputs.some(input => input.endsWith('vue-global.cjs')) && !code.includes('globalThis.Vue')) {
    die('折叠产物没接上 globalThis.Vue，会出现第二份 Vue');
  }
} catch (e) { die(e.message); }

// 3d. 不允许运行时求值（new Function / eval）：用 metafile + 正则双重校验，
//     与其他折叠脚本（pack-tinyrobot）对齐——不再放宽，CSP 生死线不能留口子。
try { assertStaticRendererBundle(code, buildResult.metafile); } catch (e) { die(e.message); }

// 4. 清理临时文件
rmSync(TMP_DIR, { recursive: true, force: true });

const size = statSync(OUT_JS).size;
console.log(`next-sdk 折叠完成：js=${size} 字节 → ${OUT_JS}`);
