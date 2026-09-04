#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const extensionDir = path.join(root, 'interfaces', 'vscode');
const packageJson = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
const matrix = JSON.parse(
  fs.readFileSync(path.join(root, 'docs', 'release', 'compatibility.json'), 'utf8'),
);
const requireInstall = process.argv.includes('--require-install');

function fail(message) {
  console.error(`VSCode install smoke failed: ${message}`);
  process.exit(1);
}

function compareVersions(actual, minimum) {
  const parse = (version) => {
    const match = String(version)
      .trim()
      .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
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

function isCompatible(daemonVersion, minimumDaemonVersion) {
  const result = compareVersions(daemonVersion, minimumDaemonVersion);
  return result !== null && result >= 0;
}

if (matrix.current.extension !== packageJson.version) {
  fail(`compatibility.json current.extension ${matrix.current.extension} != ${packageJson.version}`);
}
if (matrix.current.minimumDaemonVersion !== packageJson.sacode?.minimumDaemonVersion) {
  fail('compatibility.json minimumDaemonVersion does not match package.json');
}

for (const release of matrix.releases) {
  if (!isCompatible(release.cli, release.minimumDaemonVersion)) {
    fail(`release ${release.extension} pairs CLI ${release.cli} below min daemon ${release.minimumDaemonVersion}`);
  }
}

const current = matrix.releases.find((item) => item.extension === matrix.current.extension);
if (!current) fail('compatibility.json releases missing current extension');
if (!isCompatible(current.cli, current.minimumDaemonVersion)) {
  fail(`current matrix should accept daemon ${current.cli}`);
}

for (const caseItem of matrix.incompatible || []) {
  const release = matrix.releases.find((item) => item.extension === caseItem.extension);
  if (!release) fail(`incompatible case references unknown extension ${caseItem.extension}`);
  if (isCompatible(caseItem.daemon, release.minimumDaemonVersion)) {
    fail(`expected ${caseItem.extension} + daemon ${caseItem.daemon} to be incompatible`);
  }
}

if (matrix.distribution?.vscodeMarketplace !== false || matrix.distribution?.openVsx !== false) {
  fail('compatibility.json must keep Marketplace/Open VSX auto-publish disabled');
}

const vsixName = `sacode-vscode-${packageJson.version}.vsix`;
const vsixPath = path.join(extensionDir, vsixName);
if (!fs.existsSync(vsixPath)) fail(`missing ${vsixName}; run npm run package:vsix first`);

const hash = crypto.createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex');
const checksumPath = `${vsixPath}.sha256`;
if (fs.existsSync(checksumPath)) {
  const recorded = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  if (recorded !== hash) fail(`VSIX SHA-256 ${hash} does not match ${recorded}`);
}

const previous = matrix.releases.find((item) => item.extension !== matrix.current.extension);
if (previous) {
  if (!isCompatible(current.cli, previous.minimumDaemonVersion)) {
    fail(`upgrade path broken: new CLI ${current.cli} should still satisfy old extension ${previous.extension}`);
  }
  if (isCompatible(previous.cli, current.minimumDaemonVersion)) {
    fail(`downgrade path broken: old CLI ${previous.cli} must not satisfy new extension ${current.extension}`);
  }
}

function resolveCode() {
  const candidates = process.platform === 'win32' ? ['code.cmd', 'code'] : ['code'];
  for (const command of candidates) {
    try {
      execFileSync(command, ['--version'], { stdio: 'pipe' });
      return command;
    } catch {
      // try next
    }
  }
  return null;
}

const code = resolveCode();
if (!code) {
  if (requireInstall) fail('code CLI is required by --require-install but was not found');
  console.log(`VSCode install smoke passed (metadata/matrix only) for ${vsixName}`);
  console.log(`VSIX SHA-256: ${hash}`);
  process.exit(0);
}

try {
  execFileSync(code, ['--install-extension', vsixPath, '--force'], { stdio: 'pipe' });
} catch (error) {
  fail(`code --install-extension failed: ${error.message}`);
}

let listing = '';
try {
  listing = execFileSync(code, ['--list-extensions', '--show-versions'], { encoding: 'utf8' });
} catch (error) {
  fail(`code --list-extensions failed: ${error.message}`);
}

const expectedId = `${packageJson.publisher}.${packageJson.name}@${packageJson.version}`;
if (!listing.split(/\r?\n/).some((line) => line.trim() === expectedId || line.trim().endsWith(`.${packageJson.name}@${packageJson.version}`))) {
  fail(`installed extensions did not include ${expectedId}`);
}

console.log(`VSCode install smoke passed with live install of ${expectedId}`);
console.log(`VSIX SHA-256: ${hash}`);
