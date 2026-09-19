const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectAcceptanceErrors,
  collectModeErrors,
  collectStatusErrors,
  getCargoVersion,
  validateRepository,
} = require('./check-doc-consistency');

test('current repository documents are consistent', () => {
  assert.deepEqual(validateRepository(), []);
});

test('rejects an unsupported capability status', () => {
  const errors = collectStatusErrors({
    schema_version: 1,
    allowed_statuses: ['已验收', '部分验收', '未开始', '延后', '不在范围'],
    modes: { preferred: ['plan', 'build', 'auto'], input_aliases: { yolo: 'auto' } },
    platforms: [],
    capabilities: [{ id: 'sample', status: '已完成', evidence: 'sample' }],
  });
  assert.ok(errors.some((error) => error.includes('invalid status')));
});

test('rejects preferred yolo documentation', () => {
  const errors = collectModeErrors({
    'README.md': '### YOLO 模式\nrun with --mode yolo\n`plan` / `build` / `yolo`',
  });
  assert.equal(errors.length, 3);
});

test('rejects missing acceptance scenarios and sensitive values', () => {
  const errors = collectAcceptanceErrors({
    schema_version: 1,
    requirements: [{
      requirement_id: 'PN-DFX-SECURITY-001',
      priority: 'p0',
      blocking: 'release',
      scenario_ids: ['missing'],
      sample: 'api_key=sk-test-secret-value',
    }],
  }, { schema_version: 1, scenarios: [] });
  assert.ok(errors.some((error) => error.includes('security_absolute')));
  assert.ok(errors.some((error) => error.includes('references missing')));
  assert.ok(errors.some((error) => error.includes('sensitive value')));
});

test('reads only the workspace package version', () => {
  const cargo = '[package]\nversion = "9.9.9"\n[workspace.package]\nversion = "1.2.3"\n';
  assert.equal(getCargoVersion(cargo), '1.2.3');
});
