import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReadyInfo, ReadyFileError, waitForHealthy } from '../src/sidecar.ts';

test('parseReadyInfo accepts valid payload', () => {
  const info = parseReadyInfo(
    JSON.stringify({
      schema_version: 1,
      host: '127.0.0.1',
      port: 37423,
      pid: 1,
      base_url: 'http://127.0.0.1:37423',
      nonce: 'abc',
      auth_required: true,
    }),
    'abc',
  );
  assert.equal(info.port, 37423);
  assert.equal(info.base_url, 'http://127.0.0.1:37423');
  assert.equal(info.auth_required, true);
});

test('parseReadyInfo rejects bad JSON, missing port, nonce mismatch, token field', () => {
  assert.throws(() => parseReadyInfo('not-json'), ReadyFileError);
  assert.throws(() => parseReadyInfo(JSON.stringify({ schema_version: 1, host: 'h' })), ReadyFileError);
  assert.throws(
    () =>
      parseReadyInfo(
        JSON.stringify({ schema_version: 1, host: 'h', port: 1, nonce: 'x' }),
        'y',
      ),
    /nonce/,
  );
  assert.throws(
    () =>
      parseReadyInfo(
        JSON.stringify({
          schema_version: 1,
          host: 'h',
          port: 2,
          token: 'secret-should-not-be-here',
        }),
      ),
    /token/,
  );
});

test('waitForHealthy succeeds on healthy mock', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ status: 'healthy', version: '1.1.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = await waitForHealthy('http://127.0.0.1:1', undefined, 2000, 10, fetchImpl);
  assert.equal(res.ok, true);
  assert.ok(calls >= 1);
});
