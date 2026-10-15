import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPackageManifestFiles } from '../../../scripts/package-manifest.mjs';

const tempBase = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

test('平台包清单递归覆盖 bin 与 extjs，并为嵌套 TZif 文件生成稳定摘要', () => {
  mkdirSync(tempBase, { recursive: true });
  const root = mkdtempSync(join(tempBase, 'package-manifest-'));
  try {
    mkdirSync(join(root, 'bin', 'zoneinfo', 'Asia'), { recursive: true });
    mkdirSync(join(root, 'extjs'), { recursive: true });
    writeFileSync(join(root, 'bin', 'sacode.exe'), 'exe');
    writeFileSync(join(root, 'bin', 'zoneinfo', 'Asia', 'Shanghai'), 'TZif fixture');
    writeFileSync(join(root, 'extjs', 'server.cjs'), 'module.exports = {};');
    writeFileSync(join(root, 'ignored.txt'), 'outside package payload roots');

    const files = collectPackageManifestFiles(root);
    assert.deepEqual(files.map(file => file.path), [
      'bin/sacode.exe',
      'bin/zoneinfo/Asia/Shanghai',
      'extjs/server.cjs',
    ]);
    const zone = files.find(file => file.path === 'bin/zoneinfo/Asia/Shanghai');
    const bytes = Buffer.from('TZif fixture');
    assert.equal(zone.bytes, bytes.byteLength);
    assert.equal(zone.sha256, createHash('sha256').update(bytes).digest('hex'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
