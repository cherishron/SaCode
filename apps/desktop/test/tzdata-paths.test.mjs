import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withZoneinfoPath } = require('../../../npm/sacode-cli/bin/platform.js');

test('CLI 平台环境将 Windows 包内 TZif 追加到用户路径后', () => {
  const env = withZoneinfoPath({ CJ_TZPATH: 'D:/operator/zones' }, 'C:/pkg/bin', 'win32', () => true);
  assert.equal(env.CJ_TZPATH.replaceAll('\\', '/'), 'D:/operator/zones;C:/pkg/bin/zoneinfo');
});

test('CLI 环境保留已包含包内 TZif 的配置且不重复追加', () => {
  const env = withZoneinfoPath({ CJ_TZPATH: 'C:/pkg/bin/zoneinfo' }, 'C:/pkg/bin', 'win32', () => true);
  assert.equal(env.CJ_TZPATH, 'C:/pkg/bin/zoneinfo');
});

test('CLI 未检测到包内 TZif 时不设置 CJ_TZPATH', () => {
  const env = withZoneinfoPath({}, 'C:/pkg/bin', 'win32', () => false);
  assert.ok(!('CJ_TZPATH' in env));
});
