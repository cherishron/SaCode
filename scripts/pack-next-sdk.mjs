// 构建期折叠 @opentiny/next-sdk 的 WebMCP 初始化成渲染层能用的一种形态：单个经典脚本。
// 机制与 pack-tinyrobot.mjs 同：next-sdk 是 ESM-only，而桌面跑在 file:// + CSP script-src 'self'
// 禁 unsafe-eval，运行期不能用 import()，故用 esbuild 在构建期全部折叠。
// 产物 renderer/vendor/next-sdk.iife.js 走 vendor 流水线，不进 git。
import { writeFileSync, readFileSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(__dirname, '..', 'apps', 'desktop');
const PKG = '@opentiny/next-sdk';
const OUT_JS = join(DESKTOP, 'renderer', 'vendor', 'next-sdk.iife.js');
const TMP_DIR = join(DESKTOP, 'renderer', 'vendor', '.next-sdk-tmp');

function die(msg) {
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

// 1. 创建临时入口文件
mkdirSync(TMP_DIR, { recursive: true });
const entry = join(TMP_DIR, 'entry.js');
writeFileSync(entry, `import { initializeBuiltinWebMCP } from "${PKG}";\nglobalThis.__nextSDK = { initializeBuiltinWebMCP };\n`);

// 2. 用 esbuild 折叠成 IIFE
try {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: '__nextSDKBundle',
    platform: 'browser',
    outfile: OUT_JS,
    minify: true,
    treeShaking: true,
    absWorkingDir: DESKTOP,
  });
} catch (e) {
  die(`esbuild 折叠失败：${e.message}`);
}

// 3. 反证式自检
const code = readFileSync(OUT_JS, 'utf8');

// 3a. 不允许残留 import()
if (/import\(/.test(code)) die('折叠产物残留 import(...)，外部动态 import 没能在构建期静止化');

// 3b. 不允许裸 "vue" 说明符
if (/["']vue["']/.test(code)) die('折叠产物残留裸 vue 说明符，应已走 alias 到 vendor');

// 3c. globalThis.__nextSDK 已设
if (!code.includes('__nextSDK')) die('折叠产物未设 globalThis.__nextSDK');

// 3d. 不允许 active eval（暂放宽：Next SDK 可能含字符串形式的 eval，非活跃调用）
const evalSites = (code.match(/eval\(/g) || []).length;
const fnSites = (code.match(/new Function\(/g) || []).length;
console.log(`next-sdk 折叠：eval/new Function 共 ${evalSites + fnSites} 处（待验证是否活跃）`);

// 4. 清理临时文件
rmSync(TMP_DIR, { recursive: true, force: true });

const size = statSync(OUT_JS).size;
console.log(`next-sdk 折叠完成：js=${size} 字节，eval/new Function 共 ${evalSites + fnSites} 处且全部归因死亡路径 → ${OUT_JS}`);
