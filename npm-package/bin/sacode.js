#!/usr/bin/env node

const { execFileSync } = require('child_process');
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
  console.error(`Unsupported platform: ${platform}-${arch}`);
  process.exit(1);
}

const binaryPath = path.join(__dirname, '..', 'platforms', binary);

const args = process.argv.slice(2);
execFileSync(binaryPath, args, { stdio: 'inherit' });
