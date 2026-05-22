#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const npmDir = path.join(rootDir, 'npm-package');
const platformDir = path.join(npmDir, 'platforms');
const manifestPath = path.join(platformDir, 'manifest.json');

const version = process.argv[2];

if (!version) {
  console.error('usage: node scripts/write-platform-manifest.js <version>');
  process.exit(1);
}

const files = fs.existsSync(platformDir)
  ? fs.readdirSync(platformDir)
      .filter((file) => file !== 'manifest.json')
      .sort()
  : [];

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  files,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote platform manifest for ${version}`);
