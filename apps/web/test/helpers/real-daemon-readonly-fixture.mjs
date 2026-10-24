import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repo = resolve(import.meta.dirname, '../../../..');
const methods = ['initialize', 'session/catalog', 'session/events'];

function check(ok, label) {
  if (!ok) throw new Error(label);
}

function fingerprint(path) {
  const st = statSync(path);
  return {
    path,
    bytes: st.size,
    modifiedUtc: st.mtime.toISOString(),
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}

function track(proc) {
  let stdout = '',
    stderr = '',
    spawnError = '';
  proc.stdout.on('data', (data) => {
    stdout += data;
  });
  proc.stderr.on('data', (data) => {
    stderr += data;
  });
  proc.on('error', (error) => {
    spawnError = error.code || 'spawn-error';
  });
  const closed = new Promise((resolveClose) =>
    proc.once('close', (code, signal) => resolveClose({ code, signal })),
  );
  return { proc, closed, stdout: () => stdout, stderr: () => stderr, error: () => spawnError };
}

async function seed(host, cwd, env) {
  const child = track(spawn(host, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }));
  let id = 0;
  let consumed = 0;
  async function request(method, params = {}) {
    const current = ++id;
    child.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      const text = child.stdout();
      let next;
      while ((next = text.indexOf('\n', consumed)) !== -1) {
        const line = text.slice(consumed, next).trim();
        consumed = next + 1;
        if (!line) continue;
        let body;
        try {
          body = JSON.parse(line);
        } catch {
          continue;
        }
        if (body.id === current) {
          check(!body.error, `host-seed-${method}-rpc-error`);
          return body.result;
        }
      }
      check(child.proc.exitCode === null && !child.error(), `host-seed-${method}-process-exited`);
      await delay(20);
    }
    throw new Error(`host-seed-${method}-timeout`);
  }
  try {
    await request('initialize');
    const made = await request('session/create', { title: '隔离合成只读会话' });
    check(typeof made.id === 'string', 'host-seed-session-id-missing');
    await request('session/select', { sessionId: made.id });
    for (let i = 0; i < 2; i++) {
      await request('session/submit', {
        sessionId: made.id,
        eventType: 'user/message',
        data: `synthetic-readonly-message-${i}`,
      });
    }
    await request('session/flush', { sessionId: made.id });
    return made.id;
  } finally {
    child.proc.stdin.end();
    const result = await Promise.race([child.closed, delay(5000).then(() => null)]);
    if (!result) {
      child.proc.kill();
      await child.closed;
    }
    check(result?.code === 0, 'host-seed-clean-exit-failed');
  }
}

// 仅使用显式指定的现有候选、新建本轮身份及CLI设备；不读取用户凭据，也不授予额外scope。
// read/write在当前授权器中无独立scope，因此只读能力由有限方法policy保证。
export async function createRealReadonlyFixture({ allowReplay = true } = {}) {
  const daemon = process.env.SACODE_DAEMON;
  const host = process.env.SACODE_HOST;
  check(daemon && existsSync(daemon), 'explicit-SACODE_DAEMON-required');
  check(host && existsSync(host), 'explicit-SACODE_HOST-required');
  const base = join(repo, 'target/tmp');
  check(existsSync(base), 'target-tmp-parent-required');
  const cwd = mkdtempSync(join(base, 'web-real-readonly-20261024-'));
  const workspaceId = `ws-readonly-${randomBytes(4).toString('hex')}`;
  const policy = JSON.parse(
    readFileSync(join(repo, 'docs/plans/remote-capability-contract.json'), 'utf8'),
  ).filter((row) => methods.includes(row.method) && (allowReplay || row.method !== 'session/events'));
  check(
    policy.every((row) => row.permission === 'read' && row.requiredScope === null && !row.durable),
    'readonly-policy-required',
  );
  const policyPath = join(cwd, 'policy.json');
  writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (['systemroot', 'windir'].includes(key.toLowerCase())) env[key] = value;
  }
  // DLL必须由候选自身提供；该设置只作用于本轮子进程，不修改系统PATH。
  env.PATH = process.platform === 'win32' ? 'C:/Windows;C:/Windows/System32' : process.env.PATH;
  Object.assign(env, {
    TMP: cwd,
    TEMP: cwd,
    HOME: cwd,
    USERPROFILE: cwd,
    APPDATA: join(cwd, 'appdata'),
    LOCALAPPDATA: join(cwd, 'localappdata'),
    SACODE_USER_SETTINGS_DIR: join(cwd, 'settings'),
  });
  for (const name of ['appdata', 'localappdata', 'settings']) mkdirSync(join(cwd, name));
  const report = {
    artifactDir: cwd,
    candidateType: 'existing-binaries-not-same-source-certified',
    candidates: { daemon: fingerprint(daemon), host: fingerprint(host) },
    bindingEnabled: true,
    runtimeDeviceKind: 'cli',
    representsWebRuntimeEnrollment: false,
    policyMethods: policy.map((row) => row.method),
    policyReadOnly: true,
    grantedScopes: [],
    checks: {},
  };
  const reportPath = join(cwd, 'summary.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  let sessionId;
  try {
    sessionId = await seed(resolve(host), cwd, env);
  } catch (error) {
    report.failure = error.message;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    throw error;
  }
  const identity = join(cwd, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const child = track(
    spawn(resolve(daemon), ['--port', '0'], {
      cwd,
      env: {
        ...env,
        SACODE_REMOTE_ACCESS: '1',
        SACODE_REMOTE_BIND: '127.0.0.1',
        SACODE_REMOTE_IDENTITY: identity,
        SACODE_REMOTE_POLICY: policyPath,
        SACODE_WORKSPACE_ID: workspaceId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const controllers = [];
  let endpoint = '',
    token = '',
    deviceId = '',
    closed = false;
  const persist = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
  async function close() {
    if (closed) return;
    closed = true;
    for (const controller of controllers) controller.abort();
    // 未授管理权限，也不把shutdown降格为read；只终止本夹具仍存活的daemon及其子进程。
    let treeTerminationStatus = null;
    if (child.proc.exitCode === null && child.proc.signalCode === null && child.proc.pid) {
      if (process.platform === 'win32') {
        const stopped = spawnSync(
          join(env.SystemRoot || env.SYSTEMROOT || 'C:/Windows', 'System32/taskkill.exe'),
          ['/PID', String(child.proc.pid), '/T', '/F'],
          { env, encoding: 'utf8', timeout: 5000 },
        );
        treeTerminationStatus = stopped.status;
        check(stopped.status === 0 || child.proc.exitCode !== null, 'owned-daemon-tree-cleanup-failed');
      } else child.proc.kill();
    }
    const result = await Promise.race([child.closed, delay(5000).then(() => null)]);
    report.cleanup = {
      daemonExited: !!result,
      daemonCode: result?.code ?? null,
      daemonSignal: result?.signal ?? null,
      termination: 'owned-process-tree-only',
      treeTerminationStatus,
      hostSeedExited: true,
    };
    persist();
    check(result, 'owned-daemon-cleanup-timeout');
  }
  function manage(verb, operand) {
    const result = spawnSync(resolve(daemon), ['--manage', verb, snapshot, ...(operand ? [operand] : [])], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    check(result.status === 0, `management-${verb}-failed-status-${result.status}`);
    return result.stdout;
  }
  async function post(route, body, bearer = '') {
    const response = await fetch(endpoint + route, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  }
  let rpcId = 0;
  const rpc = (method, params = {}, bearer = token) =>
    post('/rpc', { jsonrpc: '2.0', id: ++rpcId, method, params }, bearer);
  async function stream(bearer = token, resume = `${sessionId}|0`) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(endpoint + '/sse', {
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(resume ? { 'Last-Event-ID': resume } : {}),
      },
      signal: controller.signal,
    });
    const state = { status: response.status, text: '', ended: false, abort: () => controller.abort() };
    state.finished = (async () => {
      try {
        const reader = response.body.getReader();
        for (;;) {
          const value = await reader.read();
          if (value.done) break;
          state.text += Buffer.from(value.value).toString('utf8');
        }
      } catch (error) {
        if (error.name !== 'AbortError') state.readFailed = true;
      } finally {
        state.ended = true;
      }
    })();
    return state;
  }
  try {
    const deadline = Date.now() + 12000;
    while (
      !/127\.0\.0\.1:(\d+)/.test(child.stdout()) &&
      child.proc.exitCode === null &&
      !child.error() &&
      Date.now() < deadline
    )
      await delay(20);
    const matched = child.stdout().match(/127\.0\.0\.1:(\d+)/);
    check(matched, `daemon-listen-failed-status-${child.proc.exitCode}`);
    endpoint = `http://127.0.0.1:${matched[1]}`;
    const ticket = manage('enroll-ticket', 'synthetic-readonly-principal').trim().split(/\r?\n/)[1];
    check(/^[a-f0-9]{32}$/.test(ticket), 'management-ticket-shape-invalid');
    const enrolled = await post('/auth/enroll', {
      enrollmentSecret: ticket,
      deviceName: 'synthetic-readonly',
      kind: 'cli',
    });
    check(
      enrolled.status === 200 && typeof enrolled.body.credential === 'string',
      'temporary-device-enrollment-failed',
    );
    deviceId = enrolled.body.deviceId;
    const issued = await post('/auth/token', { deviceId, credential: enrolled.body.credential });
    check(
      issued.status === 200 && typeof issued.body.accessToken === 'string',
      'temporary-token-issue-failed',
    );
    token = issued.body.accessToken;
    const listed = manage('list-devices');
    check(listed.includes('\tcli\tactive\t-'), 'temporary-device-must-have-no-explicit-scopes');
    report.checks.startup = true;
    report.checks.isolatedIdentityEnrolled = true;
    persist();
    return {
      endpoint,
      token,
      workspaceId,
      sessionId,
      cwd,
      report,
      reportPath,
      rpc,
      stream,
      close,
      persist,
      revoke() {
        manage('revoke-device', deviceId);
        report.checks.managementRevoke = true;
        persist();
      },
    };
  } catch (error) {
    report.failure = error.message;
    await close();
    throw error;
  }
}

export async function verifyRealReadonlyFixture(f, { allowReplay = true } = {}) {
  const checks = f.report.checks;
  const noAuth = await f.rpc('initialize', { workspaceId: f.workspaceId }, '');
  check(noAuth.body.error?.message === 'authz-denied:missing-bearer', 'missing-token-not-rejected');
  checks.noTokenRejected = true;
  const wrongToken = await f.rpc('initialize', { workspaceId: f.workspaceId }, 'synthetic-invalid-token');
  check(wrongToken.body.error?.message === 'authz-denied:invalid-token', 'invalid-token-not-rejected');
  checks.invalidTokenRejected = true;
  const wrongWorkspace = await f.rpc('session/catalog', { workspaceId: 'wrong-workspace' });
  check(
    wrongWorkspace.body.error?.message === 'authz-denied:workspace-not-bound',
    'wrong-workspace-not-rejected',
  );
  checks.wrongWorkspaceRejected = true;
  const init = await f.rpc('initialize', { workspaceId: f.workspaceId });
  check(!!init.body.result?.protocolVersion, 'authenticated-initialize-failed');
  checks.authenticatedInitialize = true;
  const catalog = await f.rpc('session/catalog', { workspaceId: f.workspaceId });
  check(
    catalog.body.result?.entries?.some((item) => item.id === f.sessionId),
    'seed-session-not-in-catalog',
  );
  checks.authenticatedCatalog = true;
  const events = await f.rpc('session/events', {
    workspaceId: f.workspaceId,
    sessionId: f.sessionId,
    afterSeq: '0',
    limit: '200',
  });
  if (allowReplay) {
    check(
      events.body.result?.events?.some((item) => item.data === 'synthetic-readonly-message-1'),
      'authenticated-event-page-failed',
    );
    checks.authenticatedEvents = true;
    checks.eventCount = events.body.result.events.length;
  } else {
    check(
      events.body.error?.message === 'authz-denied:method-not-registered',
      'missing-events-policy-not-rejected',
    );
    checks.unregisteredEventsRejected = true;
  }
  const anonymousStream = await f.stream('');
  await anonymousStream.finished;
  check(
    anonymousStream.status === 401 && !anonymousStream.text.includes('synthetic-readonly-message'),
    'anonymous-sse-not-rejected',
  );
  checks.anonymousSseRejected = true;
  const stream = await f.stream();
  check(stream.status === 200, 'authorized-sse-not-opened');
  const until = Date.now() + 2500;
  while (Date.now() < until && !stream.text.includes('synthetic-readonly-message-1')) await delay(25);
  check(stream.text.includes('connected'), 'authorized-sse-connected-frame-missing');
  if (allowReplay)
    check(stream.text.includes('synthetic-readonly-message-1'), 'authorized-sse-history-missing');
  else
    check(
      !stream.text.includes('synthetic-readonly-message') && !stream.text.includes('event: durable'),
      'sse-policy-history-leak',
    );
  checks.authorizedSseOpened = true;
  checks.sseReplayPolicyEnforced = true;
  f.revoke();
  const after = await f.rpc('initialize', { workspaceId: f.workspaceId });
  check(after.body.error?.message === 'authz-denied:invalid-token', 'revoked-token-rpc-not-rejected');
  checks.revokedRpcRejected = true;
  const ended = await Promise.race([stream.finished.then(() => true), delay(6000).then(() => false)]);
  check(ended && stream.text.includes('revoked'), 'revoked-sse-did-not-close');
  checks.revokedExistingSseClosed = true;
  const terminalOffset = stream.text.lastIndexOf('revoked');
  check(
    !stream.text.slice(terminalOffset).includes('synthetic-readonly-message'),
    'data-after-sse-revocation',
  );
  checks.noBusinessDataAfterRevokeFrame = true;
  const reopened = await f.stream();
  await reopened.finished;
  check(
    reopened.status === 401 && !reopened.text.includes('synthetic-readonly-message'),
    'revoked-sse-reopen-not-rejected',
  );
  checks.revokedSseReopenRejected = true;
  f.persist();
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let failures = 0;
  for (const allowReplay of [true, false]) {
    let fixture;
    try {
      fixture = await createRealReadonlyFixture({ allowReplay });
      await verifyRealReadonlyFixture(fixture, { allowReplay });
      console.log(
        JSON.stringify({
          allowReplay,
          passed: true,
          reportPath: fixture.reportPath,
          checks: fixture.report.checks,
        }),
      );
    } catch (error) {
      failures++;
      if (fixture) {
        fixture.report.failure = error.message;
        fixture.persist();
      }
      console.log(
        JSON.stringify({
          allowReplay,
          passed: false,
          reason: error.message,
          reportPath: fixture?.reportPath,
        }),
      );
    } finally {
      if (fixture) await fixture.close();
    }
  }
  process.exitCode = failures ? 1 : 0;
}
