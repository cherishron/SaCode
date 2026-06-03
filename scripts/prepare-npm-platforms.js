#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const npmDir = path.join(rootDir, 'npm-package');
const platformsDir = path.join(npmDir, 'platforms');
const cargoTargetDir = path.join(rootDir, 'target');

const args = process.argv.slice(2);
const versionArg = args.find((arg) => !arg.startsWith('--'));
const clean = args.includes('--clean');
const sourceDirIndex = args.indexOf('--source-dir');
const sourceDir = sourceDirIndex === -1 ? null : args[sourceDirIndex + 1];
const requestedPlatforms = [];
const sourceFileOverrides = {};

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--platform' && args[index + 1]) {
    requestedPlatforms.push(args[index + 1]);
  }
  if (args[index] === '--source-file' && args[index + 2]) {
    sourceFileOverrides[args[index + 1]] = args[index + 2];
  }
}

if (!versionArg) {
  console.error('usage: node scripts/prepare-npm-platforms.js <version> [--clean] [--platform <key>] [--source-dir <dir>] [--source-file <platform> <path>]');
  process.exit(1);
}

const artifacts = [
  {
    key: 'linux-x64',
    source: path.join(cargoTargetDir, 'release', 'sacode'),
    output: 'sacode-linux-x64',
    chmod: true,
  },
  {
    key: 'win32-x64',
    source: path.join(cargoTargetDir, 'x86_64-pc-windows-msvc', 'release', 'sacode.exe'),
    output: 'sacode-win32-x64.exe',
    chmod: false,
  },
];

const selectedArtifacts = requestedPlatforms.length === 0
  ? artifacts
  : artifacts.filter((artifact) => requestedPlatforms.includes(artifact.key));

if (selectedArtifacts.length === 0) {
  console.error('no matching platforms selected');
  process.exit(1);
}

fs.mkdirSync(platformsDir, { recursive: true });

if (clean) {
  for (const entry of fs.readdirSync(platformsDir)) {
    fs.rmSync(path.join(platformsDir, entry), { force: true });
  }
}

const copiedFiles = [];
for (const artifact of selectedArtifacts) {
    const resolvedSource = sourceFileOverrides[artifact.key]
      ? path.resolve(rootDir, sourceFileOverrides[artifact.key])
      : sourceDir
        ? path.resolve(rootDir, sourceDir, artifact.output)
        : artifact.source;

    if (!fs.existsSync(resolvedSource)) {
      console.error(`missing build artifact: ${resolvedSource}`);
      process.exit(1);
    }

    const outputPath = path.join(platformsDir, artifact.output);
    fs.copyFileSync(resolvedSource, outputPath);
    if (artifact.chmod) {
      fs.chmodSync(outputPath, 0o755);
    }
    copiedFiles.push(artifact.output);
}

const manifestPath = path.join(platformsDir, 'manifest.json');
const manifest = {
  version: versionArg,
  generatedAt: new Date().toISOString(),
  files: copiedFiles.sort(),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`prepared npm platforms for ${versionArg}`);
