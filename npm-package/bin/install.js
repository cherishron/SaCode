#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = os.platform();
const arch = os.arch();

const binaryMap = {
  'linux-x64': 'sacode-linux-x64',
  'win32-x64': 'sacode-win32-x64.exe',
  'darwin-x64': 'sacode-darwin-x64',
  'darwin-arm64': 'sacode-darwin-arm64'
};

const key = `${platform}-${arch}`;
const binary = binaryMap[key];

if (!binary) {
  console.warn(`Warning: Unsupported platform ${platform}-${arch}`);
  console.warn(`You may need to build sacode manually: https://github.com/your-org/sacode`);
  process.exit(0);
}

const platformsDir = path.join(__dirname, '..', 'platforms');
const binaryPath = path.join(platformsDir, binary);

if (!fs.existsSync(binaryPath)) {
  console.warn(`Warning: Binary not found at ${binaryPath}`);
  console.warn(`Pre-built binaries may not be available for this version`);
  process.exit(0);
}

console.log(`sacode installed successfully for ${platform}-${arch}`);
