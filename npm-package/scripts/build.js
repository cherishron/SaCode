#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

const targets = [
  'x86_64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc'
];

const outputMap = {
  'x86_64-unknown-linux-gnu': 'sacode-linux-x64',
  'x86_64-pc-windows-msvc': 'sacode-win32-x64.exe'
};

const platformsDir = path.join(__dirname, '..', 'platforms');
if (!fs.existsSync(platformsDir)) {
  fs.mkdirSync(platformsDir, { recursive: true });
}

console.log('Building sacode for multiple platforms...\n');

for (const target of targets) {
  const outputName = outputMap[target];
  const outputPath = path.join(platformsDir, outputName);

  console.log(`Building for ${target}...`);

  try {
    execSync(`rustup target add ${target}`, { stdio: 'inherit' });
    execSync(`cargo build --release --target ${target}`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..')
    });

    const binaryName = target.includes('windows') ? 'sacode.exe' : 'sacode';
    const sourcePath = path.join(
      __dirname, '..', '..',
      'target', target, 'release', binaryName
    );

    fs.copyFileSync(sourcePath, outputPath);
    console.log(`  ✓ Created ${outputName}`);
  } catch (err) {
    console.error(`  ✗ Failed to build ${target}: ${err.message}`);
  }
}

const manifestPath = path.join(platformsDir, 'manifest.json');
const files = Object.values(outputMap).sort();
fs.writeFileSync(manifestPath, `${JSON.stringify({
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  files,
}, null, 2)}\n`);

console.log('\nBuild complete!');
console.log(`Binaries are in ${platformsDir}`);
