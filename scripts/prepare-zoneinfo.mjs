// 为 Windows 仓颉运行时准备有固定版本和摘要的 IANA TZif 数据。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TZDATA_VERSION = '2026.5';
export const TZDATA_SHA256 = '8cc73c0a0bfca7dbfa59235d60b2eff82231dee33f53d206db1acd9173cfc0a7';
export const TZDATA_ARCHIVE = join(root, 'third_party', 'tzdata', `tzdata-${TZDATA_VERSION}.tar.gz`);

function tarExecutable() {
  if (process.env.TAR) return process.env.TAR;
  if (process.platform === 'win32') {
    const systemTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(systemTar)) return systemTar;
  }
  return 'tar';
}

function requireSafeDestination(destination) {
  const target = resolve(destination);
  if (target === root || !target.toLowerCase().endsWith(`${sep}zoneinfo`.toLowerCase()) ||
      !dirname(target).toLowerCase().endsWith(`${sep}bin`.toLowerCase())) {
    throw new Error('zoneinfo 输出必须是专用 bin/zoneinfo 目录');
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error('拒绝替换符号链接形式的 zoneinfo 输出');
  }
  return target;
}

export function prepareZoneinfo(destination, archive = TZDATA_ARCHIVE) {
  const target = requireSafeDestination(destination);
  const archivePath = resolve(archive);
  if (!existsSync(archivePath)) throw new Error(`缺少固定版本的 IANA 时区数据：${archivePath}`);
  const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  if (digest !== TZDATA_SHA256) throw new Error(`tzdata-${TZDATA_VERSION} SHA256 不匹配`);

  const scratchRoot = join(root, 'target', 'tmp');
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, `tzdata-${TZDATA_VERSION}-`));
  try {
    execFileSync(tarExecutable(), ['-xzf', archivePath, '-C', scratch,
      `tzdata-${TZDATA_VERSION}/src/tzdata/zoneinfo`,
      `tzdata-${TZDATA_VERSION}/LICENSE`,
      `tzdata-${TZDATA_VERSION}/licenses/LICENSE_APACHE`], { stdio: 'pipe' });
    const packageRoot = join(scratch, `tzdata-${TZDATA_VERSION}`);
    const source = join(packageRoot, 'src', 'tzdata', 'zoneinfo');
    const shanghai = join(source, 'Asia', 'Shanghai');
    const compiled = existsSync(shanghai) && readFileSync(shanghai).subarray(0, 4).toString('ascii') === 'TZif';
    if (!compiled || !existsSync(join(source, 'tzdata.zi'))) {
      throw new Error('固定版本 tzdata 缺少已编译 TZif 数据');
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
    cpSync(join(packageRoot, 'LICENSE'), join(target, 'THIRD-PARTY-LICENSE.txt'));
    cpSync(join(packageRoot, 'licenses', 'LICENSE_APACHE'), join(target, 'LICENSE_APACHE.txt'));
    writeFileSync(join(target, 'SA-CODE-TZDATA.txt'),
      `IANA time zone data from Python tzdata ${TZDATA_VERSION}\nSHA256 ${digest}\nLicense Apache-2.0\n`);
    return { version: TZDATA_VERSION, sha256: digest, destination: target };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error('用法: node scripts/prepare-zoneinfo.mjs <专用 bin/zoneinfo 目录>');
  const result = prepareZoneinfo(destination);
  console.log(`TZif ${result.version} 已准备：${result.destination} (${result.sha256})`);
}
