#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const cargoTomlPath = path.join(rootDir, 'Cargo.toml');
const npmPackagePath = path.join(rootDir, 'npm-package', 'package.json');
const apiDocPath = path.join(rootDir, 'docs', 'API.md');

const version = process.argv[2];

if (!version) {
  console.error('usage: node scripts/sync-version.js <version>');
  process.exit(1);
}

const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const workspacePackageMarker = '[workspace.package]';
const workspacePackageIndex = cargoToml.indexOf(workspacePackageMarker);

if (workspacePackageIndex === -1) {
  console.error('failed to find [workspace.package] in Cargo.toml');
  process.exit(1);
}

const beforeWorkspacePackage = cargoToml.slice(0, workspacePackageIndex + workspacePackageMarker.length);
const afterWorkspacePackage = cargoToml.slice(workspacePackageIndex + workspacePackageMarker.length);
const nextAfterWorkspacePackage = afterWorkspacePackage.replace(
  /(\nversion\s*=\s*")([^"]+)(")/,
  `$1${version}$3`
);
const nextCargoToml = `${beforeWorkspacePackage}${nextAfterWorkspacePackage}`;

if (cargoToml !== nextCargoToml) {
  fs.writeFileSync(cargoTomlPath, nextCargoToml);
}

const npmPackage = JSON.parse(fs.readFileSync(npmPackagePath, 'utf8'));
npmPackage.version = version;
fs.writeFileSync(npmPackagePath, `${JSON.stringify(npmPackage, null, 2)}\n`);

const apiDoc = fs.readFileSync(apiDocPath, 'utf8');
const nextApiDoc = apiDoc.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
fs.writeFileSync(apiDocPath, nextApiDoc);

console.log(`synced project version to ${version}`);
