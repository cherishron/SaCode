import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8'));
const normalize = value => posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');

test('打包清理仅撤掉输出目录里的Electron诊断日志和演示包', async () => {
  const root = mkdtempSync(resolve(desktop, '../..', 'target/tmp/package-hygiene-'));
  try {
    mkdirSync(resolve(root, 'resources'));
    for (const name of ['debug.log', 'resources/default_app.asar', 'resources/app.asar', 'resources.pak']) writeFileSync(resolve(root, name), name);
    assert.equal(typeof manifest.build.afterPack, 'string');
    const clean = createRequire(import.meta.url)(resolve(desktop, manifest.build.afterPack));
    await clean({ appOutDir: root });
    assert.equal(existsSync(resolve(root, 'debug.log')), false);
    assert.equal(existsSync(resolve(root, 'resources/default_app.asar')), false);
    assert.equal(readFileSync(resolve(root, 'resources/app.asar'), 'utf8'), 'resources/app.asar');
    assert.equal(readFileSync(resolve(root, 'resources.pak'), 'utf8'), 'resources.pak');
    await clean({ appOutDir: root });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Windows 新打包不附带降低沙箱防护的启动入口，默认程序不变', async () => {
  const root = mkdtempSync(resolve(desktop, '../..', 'target/tmp/no-sandbox-launcher-'));
  try {
    mkdirSync(resolve(root, 'resources'));
    writeFileSync(resolve(root, 'SaCode.exe'), '原始程序');
    const pack = createRequire(import.meta.url)(resolve(desktop, manifest.build.afterPack));
    await pack({ appOutDir: root, electronPlatformName: 'win32' });
    assert.equal(existsSync(resolve(root, 'start-sacode-no-sandbox.cmd')), false);
    assert.equal(existsSync(resolve(root, 'TEMPORARY-NO-SANDBOX.txt')), false);
    assert.equal(readFileSync(resolve(root, 'SaCode.exe'), 'utf8'), '原始程序');
    const main = readFileSync(resolve(desktop, manifest.main), 'utf8');
    assert.match(main, /sandbox:\s*true/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /nodeIntegration:\s*false/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('非 Windows 打包不生成 Windows 临时沙箱启动入口', async () => {
  const root = mkdtempSync(resolve(desktop, '../..', 'target/tmp/no-sandbox-nonwindows-'));
  try {
    mkdirSync(resolve(root, 'resources'));
    const pack = createRequire(import.meta.url)(resolve(desktop, manifest.build.afterPack));
    await pack({ appOutDir: root, electronPlatformName: 'linux' });
    assert.equal(existsSync(resolve(root, 'start-sacode-no-sandbox.cmd')), false);
    assert.equal(existsSync(resolve(root, 'TEMPORARY-NO-SANDBOX.txt')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// 只接受当前有限清单的明确文件或目录/**，未知模式直接拒绝，避免根通配假绿。
function covered(file, files) {
  return files.some(pattern => {
    assert.equal(typeof pattern, 'string', '打包清单必须为字符串');
    const entry = normalize(pattern);
    if (entry.endsWith('/**')) {
      const directory = entry.slice(0, -3);
      assert.ok(directory !== '.' && !/[*!?{}[\]]/.test(directory), '禁止根通配或未知模式');
      return file.startsWith(`${directory}/`);
    }
    assert.ok(!/[*!?{}[\]]/.test(entry), '仅支持明确文件或目录/**');
    return file === entry;
  });
}

// 跳过注释和普通字符串里的示例；不执行业务模块，也不加载 Electron。
function localRequires(source) {
  const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\brequire\s*\(\s*(['"])(\.{1,2}\/[^'"\n]+)\1\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  return [...source.matchAll(tokens)].filter(match => match[2]).map(match => match[2]);
}

function scan(entries, files, read) {
  const visited = new Set();
  const edges = [];
  function visit(file) {
    file = normalize(file);
    assert.ok(!file.startsWith('../') && !posix.isAbsolute(file), `依赖越出桌面目录：${file}`);
    if (visited.has(file)) return;
    visited.add(file);
    for (const request of localRequires(read(file))) {
      const target = normalize(posix.join(posix.dirname(file), request));
      edges.push({ from: file, to: target });
      // 即使缺少清单项也继续扫描其依赖，避免只检查一层。
      visit(target);
    }
  }
  entries.forEach(visit);
  return { visited, edges, missing: [...visited].filter(file => !covered(file, files)).sort() };
}

function cjsUnder(directory) {
  return readdirSync(resolve(desktop, directory), { withFileTypes: true }).flatMap(entry => {
    const file = normalize(`${directory}/${entry.name}`);
    if (entry.isDirectory()) return cjsUnder(file);
    return file.endsWith('.cjs') ? [file] : [];
  });
}

const files = manifest.build.files;
const entries = [...new Set([manifest.main, ...files.flatMap(entry => {
  if (entry.endsWith('/**')) return cjsUnder(entry.slice(0, -3));
  return entry.endsWith('.cjs') ? [entry] : [];
})])];
const read = file => {
  assert.ok(statSync(resolve(desktop, file)).isFile(), `本地依赖不存在：${file}`);
  return readFileSync(resolve(desktop, file), 'utf8');
};

function gate(selectedFiles) {
  const result = scan(entries, selectedFiles, read);
  assert.ok(result.edges.length > 0, '必须实际扫描到本地依赖');
  assert.deepEqual(result.missing, [], `未打包依赖：${JSON.stringify(result.missing)}`);
  return result;
}

test('打包清单覆盖全部入口及递归本地 CJS 依赖', t => {
  // 受控反证只改内存输入，生产清单及源码保持原样。
  const selected = files.filter(entry => entry !== process.env.PACKAGING_CONTRACT_OMIT);
  const result = gate(selected);
  t.diagnostic(`入口=${entries.length}，扫描文件=${result.visited.size}，本地依赖边=${result.edges.length}`);
});

test('扫描器处理单双引号、相对规范化、递归循环及目录覆盖', () => {
  const sources = new Map([
    ['main.cjs', `require("./lib/../lib/a.cjs"); // require('./fake.cjs')\nconst text = "require('./fake.cjs')"; require('node:fs');`],
    ['lib/a.cjs', `require('./nested/b.cjs');`],
    ['lib/nested/b.cjs', `require("../a.cjs");`]
  ]);
  const readFixture = file => {
    assert.ok(sources.has(file), `夹具依赖不存在：${file}`);
    return sources.get(file);
  };
  const result = scan(['main.cjs'], ['main.cjs', 'lib/**'], readFixture);
  assert.equal(result.visited.size, 3);
  assert.equal(result.edges.length, 3);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(scan(['main.cjs'], ['main.cjs', 'lib/a.cjs'], readFixture).missing, ['lib/nested/b.cjs']);
  assert.equal(covered('library/a.cjs', ['lib/**']), false);
  assert.throws(() => covered('main.cjs', ['**']), /仅支持/);
});

test('插件守卫必须随包，删项时门禁明确报告该依赖', () => {
  const result = scan(entries, files, read);
  assert.ok(result.edges.some(edge => edge.from === 'main.cjs' && edge.to === 'plugins-guard.cjs'));
  assert.ok(files.includes('plugins-guard.cjs'));
  const mutated = files.filter(entry => entry !== 'plugins-guard.cjs');
  assert.deepEqual(scan(entries, mutated, read).missing, ['plugins-guard.cjs']);
  assert.throws(() => gate(mutated), /plugins-guard\.cjs/);
});

test('真实清单删除被引用项时同一门禁必须拒绝', t => {
  const result = scan(entries, files, read);
  const victim = result.edges.find(edge => files.includes(edge.to));
  assert.ok(victim, '必须找到明确列入清单的真实依赖');
  const mutated = files.filter(entry => entry !== victim.to);
  assert.ok(scan(entries, mutated, read).missing.includes(victim.to));
  assert.throws(() => gate(mutated), /未打包依赖/);
  t.diagnostic(`删项反证：${victim.from} → ${victim.to}，门禁已拒绝`);
});
