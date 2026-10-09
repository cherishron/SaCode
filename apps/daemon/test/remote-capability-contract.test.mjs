import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync('docs/plans/remote-capability-contract.json', 'utf8'));

assert.ok(rows.length > 0, 'capability contract must not be empty');

const methods = rows.map(x => x.method);
assert.equal(new Set(methods).size, methods.length, 'method names must be unique');

const validPermissions = new Set(['read', 'write', 'execute', 'approval', 'management']);
const validConsumers = new Set(['desktop', 'mobile', 'cli']);

for (const row of rows) {
  assert.ok(row.implementationAnchor, `${row.method}: implementationAnchor required`);
  assert.ok(row.permission, `${row.method}: permission required`);
  assert.ok(validPermissions.has(row.permission), `${row.method}: invalid permission "${row.permission}"`);
  assert.ok(Array.isArray(row.resourceKeys), `${row.method}: resourceKeys must be array`);
  assert.ok(typeof row.durable === 'boolean', `${row.method}: durable must be boolean`);
  if (row.permission !== 'read') {
    assert.equal(row.idempotent, true, `${row.method}: write/execute/approval/management must be idempotent`);
  }
  assert.ok(Array.isArray(row.clientConsumers) && row.clientConsumers.length > 0, `${row.method}: clientConsumers required`);
  for (const c of row.clientConsumers) {
    assert.ok(validConsumers.has(c), `${row.method}: invalid consumer "${c}"`);
  }
}

const mobileMethods = rows.filter(r => r.clientConsumers.includes('mobile'));
assert.ok(mobileMethods.length > 50, `mobile must have >50 methods, got ${mobileMethods.length}`);

const durableMethods = rows.filter(r => r.durable);
assert.ok(durableMethods.length > 0, 'must have durable methods');

const authMethods = rows.filter(r => r.method.startsWith('auth/'));
assert.equal(authMethods.length, 4, 'must have 4 auth methods');

console.log(`contract check PASS: ${rows.length} methods, ${mobileMethods.length} mobile, ${durableMethods.length} durable`);
