import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function collectPackageManifestFiles(packageRoot, roots = ['bin', 'extjs']) {
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const content = readFileSync(absolute);
        files.push({
          path: relative(packageRoot, absolute).split(sep).join('/'),
          sha256: createHash('sha256').update(content).digest('hex'),
          bytes: content.byteLength,
        });
      }
    }
  };
  for (const root of roots) {
    const directory = join(packageRoot, root);
    if (existsSync(directory)) walk(directory);
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
