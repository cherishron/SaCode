#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const extensionDir = path.join(root, 'interfaces', 'vscode');
const packagePath = path.join(extensionDir, 'package.json');
const lockPath = path.join(extensionDir, 'package-lock.json');
const clientPath = path.join(extensionDir, 'src', 'SseClient.ts');
const packageJson = readJson(packagePath);
const cargoToml = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
const cargoVersion = cargoToml.match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
const expectedCliVersion = process.argv[2] || cargoVersion;
const expectedExtensionVersion = process.argv[3] || packageJson.version;
const releaseNotesPath = path.join(root, 'docs', 'release', `${expectedCliVersion}.md`);
const compatibilityPath = path.join(root, 'docs', 'release', 'compatibility.json');
const compatibilityDocPath = path.join(root, 'docs', 'release', 'compatibility.md');

function fail(message) {
  console.error(`VSCode release check failed: ${message}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

function runPython(code, args, vsixPath, encoding = 'utf8') {
  try {
    return execFileSync(pythonCommand, ['-c', code, ...args], { encoding });
  } catch (error) {
    fail(`cannot inspect ${path.basename(vsixPath)}: ${error.message}`);
  }
}

function compareVersions(actual, minimum) {
  const parse = (version) => {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return {
      core: match.slice(1, 4).map(Number),
      prerelease: match[4] ? match[4].split('.') : null,
    };
  };
  const actualVersion = parse(actual);
  const minimumVersion = parse(minimum);
  if (!actualVersion || !minimumVersion) return null;
  for (let index = 0; index < 3; index += 1) {
    if (actualVersion.core[index] !== minimumVersion.core[index]) {
      return actualVersion.core[index] - minimumVersion.core[index];
    }
  }
  if (!actualVersion.prerelease) return minimumVersion.prerelease ? 1 : 0;
  if (!minimumVersion.prerelease) return -1;
  const length = Math.max(actualVersion.prerelease.length, minimumVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const actualPart = actualVersion.prerelease[index];
    const minimumPart = minimumVersion.prerelease[index];
    if (actualPart === undefined) return -1;
    if (minimumPart === undefined) return 1;
    if (actualPart === minimumPart) continue;
    const actualNumber = /^\d+$/.test(actualPart) ? Number(actualPart) : null;
    const minimumNumber = /^\d+$/.test(minimumPart) ? Number(minimumPart) : null;
    if (actualNumber !== null && minimumNumber !== null) return actualNumber - minimumNumber;
    if (actualNumber !== null) return -1;
    if (minimumNumber !== null) return 1;
    return actualPart < minimumPart ? -1 : 1;
  }
  return 0;
}

function listVsix(vsixPath) {
  const code = [
    'import sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    "    print('\\n'.join(info.filename for info in archive.infolist() if not info.is_dir()))",
  ].join('\n');
  return runPython(code, [vsixPath], vsixPath)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readVsixJson(vsixPath, entry) {
  const code = [
    'import sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    '    sys.stdout.buffer.write(archive.read(sys.argv[2]))',
  ].join('\n');
  const content = runPython(code, [vsixPath, entry], vsixPath);
  try {
    return JSON.parse(content);
  } catch (error) {
    fail(`invalid JSON in VSIX ${entry}: ${error.message}`);
  }
}

if (!expectedCliVersion || !expectedExtensionVersion) {
  fail('expected CLI and extension versions must be available');
}
if (cargoVersion !== expectedCliVersion) {
  fail(`Cargo version ${cargoVersion || '<missing>'} does not match ${expectedCliVersion}`);
}

const pkg = packageJson;
const lock = readJson(lockPath);
if (pkg.version !== expectedExtensionVersion) {
  fail(`extension version ${pkg.version} does not match ${expectedExtensionVersion}`);
}
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  fail('package-lock version does not match extension package version');
}
const minimumDaemonVersion = pkg.sacode?.minimumDaemonVersion;
const daemonCompatibility = typeof minimumDaemonVersion === 'string'
  ? compareVersions(expectedCliVersion, minimumDaemonVersion)
  : null;
if (daemonCompatibility === null || daemonCompatibility < 0) {
  fail(`minimumDaemonVersion ${minimumDaemonVersion || '<missing>'} cannot exceed CLI ${expectedCliVersion}`);
}
if (pkg.devDependencies?.['@vscode/vsce'] !== '3.9.2') {
  fail('@vscode/vsce must be pinned to 3.9.2');
}

const expectedVsixName = `sacode-vscode-${expectedExtensionVersion}.vsix`;
if (pkg.scripts?.['package:vsix'] !== `vsce package --no-dependencies --out ${expectedVsixName} && python ../../scripts/normalize-vsix.py ${expectedVsixName}`) {
  fail('package:vsix script does not match extension version');
}

const client = fs.readFileSync(clientPath, 'utf8');
if (!client.includes(`MINIMUM_DAEMON_VERSION = '${minimumDaemonVersion}'`)) {
  fail('runtime minimum daemon version constant is out of sync');
}

if (!fs.existsSync(compatibilityPath)) fail('missing docs/release/compatibility.json');
const compatibility = readJson(compatibilityPath);
if (compatibility.current?.cli !== expectedCliVersion) {
  fail(`compatibility.json current.cli ${compatibility.current?.cli || '<missing>'} does not match ${expectedCliVersion}`);
}
if (compatibility.current?.extension !== expectedExtensionVersion) {
  fail(`compatibility.json current.extension does not match ${expectedExtensionVersion}`);
}
if (compatibility.current?.minimumDaemonVersion !== minimumDaemonVersion) {
  fail('compatibility.json current.minimumDaemonVersion is out of sync');
}
const currentRelease = (compatibility.releases || []).find((item) => item.extension === expectedExtensionVersion);
if (!currentRelease || currentRelease.cli !== expectedCliVersion || currentRelease.minimumDaemonVersion !== minimumDaemonVersion) {
  fail('compatibility.json releases[] missing current CLI/extension/min daemon tuple');
}
if (compatibility.distribution?.vscodeMarketplace !== false || compatibility.distribution?.openVsx !== false) {
  fail('compatibility.json must keep Marketplace/Open VSX auto-publish disabled');
}
if (!fs.existsSync(compatibilityDocPath)) fail('missing docs/release/compatibility.md');
const compatibilityDoc = fs.readFileSync(compatibilityDocPath, 'utf8');
if (!compatibilityDoc.includes(expectedExtensionVersion) || !compatibilityDoc.includes(expectedCliVersion)) {
  fail('compatibility.md does not mention current CLI and extension versions');
}

if (!fs.existsSync(releaseNotesPath)) fail(`missing release notes ${path.basename(releaseNotesPath)}`);
const notes = fs.readFileSync(releaseNotesPath, 'utf8');
for (const heading of ['## 升级', '## 回滚', '## 已知限制']) {
  if (!notes.includes(heading)) fail(`release notes missing ${heading}`);
}
if (!notes.includes(`CLI / daemon ${expectedCliVersion}`) || !notes.includes(`VSCode 扩展 ${expectedExtensionVersion}`)) {
  fail('release notes do not identify both release versions');
}

const vsixPath = path.join(extensionDir, expectedVsixName);
if (!fs.existsSync(vsixPath)) fail(`missing VSIX ${expectedVsixName}`);
const entries = listVsix(vsixPath);
for (const required of [
  'extension/package.json',
  'extension/readme.md',
  'extension/dist/extension.js',
  'extension/dist/SseClient.js',
  'extension/dist/DaemonManager.js',
  'extension/LICENSE.txt',
]) {
  if (!entries.includes(required)) fail(`VSIX is missing ${required}`);
}
for (const forbiddenPrefix of ['extension/src/', 'extension/test/', 'extension/node_modules/', 'extension/dist-test/']) {
  if (entries.some((entry) => entry.startsWith(forbiddenPrefix))) {
    fail(`VSIX contains forbidden path ${forbiddenPrefix}`);
  }
}

const packedPackage = readVsixJson(vsixPath, 'extension/package.json');
if (packedPackage.version !== expectedExtensionVersion) {
  fail(`VSIX extension version ${packedPackage.version} does not match ${expectedExtensionVersion}`);
}
if (packedPackage.sacode?.minimumDaemonVersion !== minimumDaemonVersion) {
  fail(`VSIX minimumDaemonVersion does not match ${minimumDaemonVersion}`);
}

const hash = crypto.createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex');
const checksumPath = `${vsixPath}.sha256`;
fs.writeFileSync(checksumPath, `${hash}  ${expectedVsixName}\n`);

console.log(`VSCode release check passed for CLI ${expectedCliVersion} / extension ${expectedExtensionVersion}`);
console.log(`VSIX SHA-256: ${hash}`);
