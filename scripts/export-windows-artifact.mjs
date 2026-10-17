import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Export bytes into ordinary delivery storage, without inheriting the build
// workspace's security metadata. No installation, elevation or ACL mutation.
const args = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('Windows artifact export is only supported on Windows');
const checkOnly = args[0] === '--check-destination';
const [sourceArg, destinationArg] = checkOnly ? [null, args[1]] : args;
if (!destinationArg || (!checkOnly && !sourceArg)) {
  throw new Error('usage: node scripts/export-windows-artifact.mjs <source file|directory> <new destination file|directory> | --check-destination <new destination>');
}

const destination = resolve(destinationArg);
const sourcePath = checkOnly ? null : resolve(sourceArg);
if (sourcePath && lstatSync(sourcePath).isSymbolicLink()) throw new Error('source root cannot be a link or reparse point');
const source = sourcePath ? realpathSync(sourcePath) : null;
const sourceInfo = source ? statSync(source) : null;
const sourceIsDirectory = sourceInfo?.isDirectory() ?? false;
if (sourceInfo && !sourceIsDirectory && !sourceInfo.isFile()) throw new Error('source must be a regular file or directory');
if (existsSync(destination)) throw new Error('destination exists; refusing overwrite');
const manifestPath = `${destination}.manifest.json`;
if (existsSync(manifestPath)) throw new Error('manifest destination exists; refusing overwrite');

const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
function isInside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
function requireMedium(label, role) {
  if (label !== 'implicit-medium' && label !== 'S-1-16-8192') {
    throw new Error(`${role} must have ordinary medium integrity: ${label}`);
  }
}

const helper = readFileSync(new URL('./windows-file-integrity.cs', import.meta.url), 'utf8');
function labels(paths) {
  const all = [];
  for (let start = 0; start < paths.length; start += 128) {
    const batch = paths.slice(start, start + 128);
    const command = '$request=[Console]::In.ReadToEnd() | ConvertFrom-Json; Add-Type -TypeDefinition $request.code; $labels=@(); foreach($path in $request.paths){ $labels += [SaCodeDeliverySecurity]::ReadLabel([string]$path) }; ConvertTo-Json -InputObject @($labels) -Compress';
    const run = spawnSync(
      join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { input: JSON.stringify({ code: helper, paths: batch }), encoding: 'utf8', windowsHide: true },
    );
    if (run.error || run.status !== 0) throw run.error || new Error(`cannot query integrity: ${run.stderr}`);
    const result = JSON.parse(run.stdout.trim());
    all.push(...(Array.isArray(result) ? result : [result]));
  }
  return all;
}
function label(path) {
  return labels([path])[0];
}

// Validate the nearest existing parent before creating any destination path.
let nearest = dirname(destination);
while (!existsSync(nearest)) {
  const parent = dirname(nearest);
  if (parent === nearest) throw new Error('destination parent does not exist');
  nearest = parent;
}
const nearestReal = realpathSync(nearest);
if (isInside(repo, nearestReal)) throw new Error('delivery must be outside the build workspace');
requireMedium(label(nearestReal), 'existing delivery parent');
const projectedDestination = resolve(nearestReal, relative(nearest, dirname(destination)), basename(destination));
if (source && sourceIsDirectory && isInside(source, projectedDestination)) {
  throw new Error('destination cannot be inside the source directory');
}

if (checkOnly) {
  console.log(JSON.stringify({ destination, nearestExistingParent: nearestReal, parentLabel: label(nearestReal), scope: 'destination preflight only; no files written' }));
  process.exit(0);
}

mkdirSync(dirname(destination), { recursive: true });
const parent = realpathSync(dirname(destination));
if (isInside(repo, parent)) throw new Error('delivery must be outside the build workspace');
const parentLabel = label(parent);
requireMedium(parentLabel, 'delivery directory');
const sourceLabel = label(source);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

let destinationLabel;
let sha256;
let bytes = 0;
let files;
let directories = [];

if (!sourceIsDirectory) {
  const payload = readFileSync(source);
  sha256 = hash(payload);
  bytes = payload.length;
  writeFileSync(destination, payload, { flag: 'wx' });
  if (hash(readFileSync(destination)) !== sha256) throw new Error('export hash mismatch');
  destinationLabel = label(destination);
  requireMedium(destinationLabel, 'exported file');
  files = [{ path: basename(destination), bytes, sha256 }];
} else {
  mkdirSync(destination);
  destinationLabel = label(destination);
  requireMedium(destinationLabel, 'exported directory');
  files = [];
  const treeHash = createHash('sha256');

  function copyTree(sourceDir, destinationDir, prefix = '') {
    const entries = readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      const from = join(sourceDir, entry.name);
      const to = join(destinationDir, entry.name);
      const info = lstatSync(from);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) throw new Error(`source contains a link or reparse point: ${rel}`);
      if (info.isDirectory()) {
        mkdirSync(to);
        directories.push(rel);
        copyTree(from, to, rel);
      } else if (info.isFile()) {
        const payload = readFileSync(from);
        const digest = hash(payload);
        writeFileSync(to, payload, { flag: 'wx' });
        if (hash(readFileSync(to)) !== digest) throw new Error(`export hash mismatch: ${rel}`);
        bytes += payload.length;
        files.push({ path: rel, bytes: payload.length, sha256: digest });
        treeHash.update(`${rel.replaceAll('\\', '/') }\0${digest}\n`);
      } else {
        throw new Error(`source contains an unsupported filesystem entry: ${rel}`);
      }
    }
  }

  copyTree(source, destination);
  sha256 = treeHash.digest('hex');
  const pathsToCheck = [destination, ...directories.map((dir) => join(destination, dir)),
    ...files.map((file) => join(destination, file.path))];
  const integrity = labels(pathsToCheck);
  for (let index = 0; index < integrity.length; index++) requireMedium(integrity[index], `exported item ${pathsToCheck[index]}`);
  destinationLabel = integrity[0];
}

const manifest = {
  source,
  destination,
  sourceLabel,
  parentLabel,
  destinationLabel,
  sha256,
  bytes,
  ...(sourceIsDirectory ? { directories: directories.length, files } : { files }),
  createdAt: new Date().toISOString(),
  scope: 'Content-only export, no installation or security policy changes',
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
requireMedium(label(manifestPath), 'export manifest');
console.log(JSON.stringify({
  source: manifest.source,
  destination: manifest.destination,
  sourceLabel: manifest.sourceLabel,
  destinationLabel: manifest.destinationLabel,
  sha256: manifest.sha256,
  bytes: manifest.bytes,
  directories: manifest.directories ?? null,
  files: manifest.files.length,
  manifestPath,
  scope: manifest.scope,
}));
