#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function currentPlatformBinary(expectedMap) {
  const key = `${process.platform}-${process.arch}`;
  return expectedMap[key] || null;
}

function verifyCurrentPlatformBinaryVersion(platformDir, expectedMap, expectedVersion) {
  const binary = currentPlatformBinary(expectedMap);
  if (!binary) {
    console.log(`skipping binary version check for unsupported host platform ${process.platform}-${process.arch}`);
    return;
  }

  const binaryPath = path.join(platformDir, binary);
  if (!fs.existsSync(binaryPath)) {
    fail(`current platform binary is missing: ${binaryPath}`);
  }

  let output;
  try {
    output = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(`failed to execute ${binary} --version: ${error.message}`);
  }

  const match = output.match(/sacode\s+([^\s]+)/i);
  if (!match) {
    fail(`could not parse version from ${binary} --version output: ${output}`);
  }

  if (match[1] !== expectedVersion) {
    fail(`binary version ${match[1]} does not match package version ${expectedVersion} for ${binary}`);
  }
}

function verifyPackedNpmContents(npmDir, filesToVerify) {
  let packOutput;
  try {
    packOutput = execFileSync('npm', ['pack', '--json'], {
      cwd: npmDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    fail(`failed to pack npm package: ${error.message}`);
  }

  let packed;
  try {
    packed = JSON.parse(packOutput);
  } catch (error) {
    fail(`failed to parse npm pack output: ${error.message}`);
  }

  const tarballName = packed?.[0]?.filename;
  if (!tarballName) {
    fail('npm pack did not return a tarball filename');
  }

  const tarballPath = path.join(npmDir, tarballName);
  let tarList;
  try {
    tarList = execFileSync('tar', ['-tf', tarballPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    fail(`failed to inspect packed tarball ${tarballName}: ${error.message}`);
  }

  const tarEntries = tarList.split('\n').filter(Boolean);
  for (const file of filesToVerify) {
    const packagedPath = `package/platforms/${file}`;
    if (!tarEntries.includes(packagedPath)) {
      fail(`packed npm tarball is missing ${packagedPath}`);
    }
  }

  fs.unlinkSync(tarballPath);
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
  'darwin-x64': 'sacode-darwin-x64',
  'darwin-arm64': 'sacode-darwin-arm64',
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

if (!readme.includes('- Linux x64') || !readme.includes('- Windows x64') || !readme.includes('- macOS x64') || !readme.includes('- macOS arm64')) {
  fail('npm README supported platform list is incomplete');
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
const manifestFiles = Array.isArray(manifest.files) ? [...manifest.files].sort() : [];

if (manifest.version !== cargoVersion) {
  fail(`platform manifest version ${manifest.version} does not match Cargo version ${cargoVersion}`);
}

if (manifestFiles.length === 0) {
  fail('platform manifest files must not be empty');
}

for (const file of manifestFiles) {
  if (!expectedFiles.includes(file)) {
    fail(`platform manifest contains unsupported file: ${file}`);
  }
}

verifyCurrentPlatformBinaryVersion(platformDir, expectedMap, cargoVersion);
verifyPackedNpmContents(npmDir, manifestFiles);

if (strict) {
  if (JSON.stringify(manifestFiles) !== JSON.stringify(expectedFiles)) {
    fail(`platform manifest files do not match expected set: ${manifestFiles.join(', ')}`);
  }
  const strictFiles = [...expectedFiles, 'manifest.json'].sort();
  if (JSON.stringify(platformFiles) !== JSON.stringify(strictFiles)) {
    fail(`platform files do not match expected set: ${platformFiles.join(', ')}`);
  }
}

console.log(`release check passed for version ${cargoVersion}`);
