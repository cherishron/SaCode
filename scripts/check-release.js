#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const npmDir = path.join(rootDir, 'npm-package');
const strict = process.argv.includes('--strict-platforms');

function fail(message) {
  console.error(`release check failed: ${message}`);
  process.exit(1);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function getCargoVersion() {
  const cargoToml = read(path.join(rootDir, 'Cargo.toml'));
  const workspacePackageMarker = '[workspace.package]';
  const workspacePackageIndex = cargoToml.indexOf(workspacePackageMarker);

  if (workspacePackageIndex === -1) {
    fail('workspace package section not found in Cargo.toml');
  }

  const afterWorkspacePackage = cargoToml.slice(workspacePackageIndex + workspacePackageMarker.length);
  const match = afterWorkspacePackage.match(/\nversion\s*=\s*"([^"]+)"/);
  if (!match) {
    fail('workspace version not found in Cargo.toml');
  }
  return match[1];
}

function getBinaryMap(filePath) {
  const content = read(filePath);
  const map = {};
  for (const match of content.matchAll(/'([^']+)':\s*'([^']+)'/g)) {
    map[match[1]] = match[2];
  }
  return map;
}

const cargoVersion = getCargoVersion();
const packageJsonPath = path.join(npmDir, 'package.json');
const packageJson = JSON.parse(read(packageJsonPath));
const readme = read(path.join(npmDir, 'README.md'));
const launcherMap = getBinaryMap(path.join(npmDir, 'bin', 'sacode.js'));
const installMap = getBinaryMap(path.join(npmDir, 'bin', 'install.js'));
const platformDir = path.join(npmDir, 'platforms');
const platformFiles = fs.existsSync(platformDir) ? fs.readdirSync(platformDir).sort() : [];
const manifestPath = path.join(platformDir, 'manifest.json');
const expectedMap = {
  'linux-x64': 'sacode-linux-x64',
  'win32-x64': 'sacode-win32-x64.exe',
};

if (packageJson.name !== '@cherishron/sacode') {
  fail(`unexpected npm package name: ${packageJson.name}`);
}

if (packageJson.version !== cargoVersion) {
  fail(`npm version ${packageJson.version} does not match Cargo version ${cargoVersion}`);
}

if (packageJson.bin?.sacode !== './bin/sacode.js') {
  fail('npm bin.sacode must point to ./bin/sacode.js');
}

if (packageJson.scripts?.install !== 'node bin/install.js') {
  fail('npm install script must be node bin/install.js');
}

if (!readme.includes('npm install -g @cherishron/sacode')) {
  fail('npm README install command is out of date');
}

if (!readme.includes('- Linux x64') || !readme.includes('- Windows x64')) {
  fail('npm README supported platform list is incomplete');
}

if (readme.includes('- macOS x64') || readme.includes('- macOS arm64')) {
  fail('npm README still advertises macOS binaries');
}

if (JSON.stringify(launcherMap) !== JSON.stringify(expectedMap)) {
  fail(`launcher binary map does not match expected platforms: ${JSON.stringify(launcherMap)}`);
}

if (JSON.stringify(installMap) !== JSON.stringify(expectedMap)) {
  fail(`install binary map does not match expected platforms: ${JSON.stringify(installMap)}`);
}

if (!fs.existsSync(manifestPath)) {
  fail('platform manifest is missing: npm-package/platforms/manifest.json');
}

const manifest = JSON.parse(read(manifestPath));
const expectedFiles = Object.values(expectedMap).sort();

if (manifest.version !== cargoVersion) {
  fail(`platform manifest version ${manifest.version} does not match Cargo version ${cargoVersion}`);
}

if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) {
  fail(`platform manifest files do not match expected set: ${manifest.files.join(', ')}`);
}

if (strict) {
  const strictFiles = [...expectedFiles, 'manifest.json'].sort();
  if (JSON.stringify(platformFiles) !== JSON.stringify(strictFiles)) {
    fail(`platform files do not match expected set: ${platformFiles.join(', ')}`);
  }
}

console.log(`release check passed for version ${cargoVersion}`);
