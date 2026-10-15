function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseCangjie(text) {
  const pattern = /^\s*TOTAL:\s*(\d+)\s*\/\s*PASSED:\s*(\d+)\s*\/\s*SKIPPED:\s*(\d+)\s*\/\s*ERROR:\s*(\d+)\s*\/\s*FAILED:\s*(\d+)\s*$/gm;
  const matches = Array.from(text.matchAll(pattern));
  if (matches.length !== 1) return null;
  const values = matches[0].slice(1).map(Number);
  const [total, passed, skipped, errors, failed] = values;
  if (!values.every(count) || total !== passed + skipped + errors + failed) return null;
  return {format: 'cangjie', total, passed, skipped, errors, failed, cancelled: 0};
}

function parseNodeTap(text) {
  const headers = Array.from(text.matchAll(/^# tests\s+(\d+)\s*$/gm));
  if (headers.length !== 1) return null;
  const tail = text.slice(headers[0].index);
  const metric = name => {
    const matches = Array.from(tail.matchAll(new RegExp('^# ' + name + '\\s+(\\d+)\\s*$', 'gm')));
    return matches.length ? Number(matches[matches.length - 1][1]) : null;
  };
  const total = Number(headers[0][1]);
  const passed = metric('pass');
  const failed = metric('fail');
  const cancelled = metric('cancelled') ?? 0;
  const skipped = metric('skipped') ?? 0;
  const todo = metric('todo') ?? 0;
  const values = [total, passed, failed, cancelled, skipped, todo];
  if (!values.every(count) || passed === null || failed === null ||
      total !== passed + failed + cancelled + skipped + todo) return null;
  return {format: 'node-tap', total, passed, skipped, errors: 0, failed, cancelled, todo};
}

export function parseTestSummary(text) {
  if (typeof text !== 'string') return null;
  const candidates = [parseCangjie(text), parseNodeTap(text)].filter(Boolean);
  return candidates.length === 1 ? candidates[0] : null;
}

function binding(execution) {
  return {
    sessionId: typeof execution?.sessionId === 'string' ? execution.sessionId : '',
    executionId: typeof execution?.executionId === 'string' ? execution.executionId : '',
    taskId: typeof execution?.taskId === 'string' ? execution.taskId : '',
    revision: Number.isSafeInteger(execution?.revision) ? execution.revision : 0,
  };
}

function executionKind(execution) {
  if (typeof execution?.proposal !== 'string') return null;
  try {
    const proposal = JSON.parse(execution.proposal);
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) ||
        typeof proposal.executable !== 'string' || !Array.isArray(proposal.argv) ||
        proposal.argv.some(value => typeof value !== 'string')) return null;
    const executable = proposal.executable.trim().toLowerCase();
    if ((executable === 'cjpm' || executable === 'cjpm.exe') && proposal.argv[0] === 'build') return 'cangjie-build';
    if ((executable === 'cjpm' || executable === 'cjpm.exe') && proposal.argv[0] === 'test') return 'cangjie-test';
    if ((executable === 'node' || executable === 'node.exe') && proposal.argv[0] === '--test') return 'node-tap';
  } catch (_) {
    return null;
  }
  return null;
}

function report(status, reason, execution, summary, integrity, exitCode) {
  const kind=executionKind(execution);
  return {status, reason, kind:kind==='cangjie-build'?'build':kind?'test':null, ...binding(execution), summary, integrity, exitCode};
}

export function buildTestReport(execution, output = {}) {
  const id = binding(execution);
  const integrity = {
    complete: false,
    truncated: false,
    stdoutEof: false,
    stderrEof: false,
    paginationKnown: typeof output?.more === 'boolean',
    more: output?.more === true,
  };
  if (!execution || !id.sessionId || !/^execution-\d+$/.test(id.executionId) ||
      !id.taskId || id.revision < 1 || typeof execution.result !== 'string') {
    return report('unknown', 'invalid-execution-identity-or-result', execution, null, integrity, null);
  }
  if (execution.phase !== 'exited') {
    if (execution.phase === 'unknown') return report('unknown', 'execution-result-unknown', execution, null, integrity, null);
    if (execution.phase === 'cancelled-before-start') return report('cancelled', 'cancelled-before-start', execution, null, integrity, null);
    return report('running', 'execution-not-terminal', execution, null, integrity, null);
  }

  let facts;
  try { facts = JSON.parse(execution.result); } catch (_) {
    return report('unknown', 'invalid-exit-facts', execution, null, integrity, null);
  }
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || facts.exitObserved !== true ||
      !Number.isSafeInteger(facts.exitCode) || typeof facts.timedOut !== 'boolean' ||
      typeof facts.cancelObserved !== 'boolean' || typeof facts.outputComplete !== 'boolean' ||
      typeof facts.processSucceeded !== 'boolean') {
    return report('unknown', 'incomplete-exit-facts', execution, null, integrity, null);
  }

  const stdoutCapture = output?.capture?.stdout;
  const stderrCapture = output?.capture?.stderr;
  integrity.stdoutEof = stdoutCapture?.end === true && stdoutCapture?.eof === true;
  integrity.stderrEof = stderrCapture?.end === true && stderrCapture?.eof === true;
  integrity.truncated = facts.stdoutTruncated === true || facts.stderrTruncated === true ||
    stdoutCapture?.truncated === true || stderrCapture?.truncated === true;
  integrity.complete = facts.outputComplete && integrity.paginationKnown && !integrity.more &&
    integrity.stdoutEof && integrity.stderrEof && !integrity.truncated;

  if (facts.cancelObserved) return report('cancelled', 'execution-cancelled', execution, null, integrity, facts.exitCode);
  if (facts.timedOut) return report('failed', 'execution-timed-out', execution, null, integrity, facts.exitCode);

  const expectedKind = executionKind(execution);
  const combined = (typeof output.stdout === 'string' ? output.stdout : '') +
    '\n' + (typeof output.stderr === 'string' ? output.stderr : '');
  const summary = parseTestSummary(combined);

  if (facts.exitCode !== 0) return report('failed', 'nonzero-exit-code', execution, summary, integrity, facts.exitCode);
  if (expectedKind !== 'cangjie-build' && summary && (summary.failed > 0 || summary.errors > 0 || summary.cancelled > 0)) {
    return report('failed', 'test-summary-has-failures', execution, summary, integrity, facts.exitCode);
  }
  if (!integrity.complete) {
    const reason = integrity.truncated ? 'output-truncated' :
      integrity.more ? 'output-pages-remaining' :
      !integrity.paginationKnown ? 'output-pagination-unknown' : 'output-not-complete';
    return report('incomplete', reason, execution, summary, integrity, facts.exitCode);
  }
  if (facts.processSucceeded !== true) return report('failed', 'process-not-successful', execution, summary, integrity, facts.exitCode);
  if (expectedKind === 'cangjie-build') return report('passed', 'build-succeeded', execution, null, integrity, facts.exitCode);
  if (!expectedKind) return report('unknown', 'unsupported-test-command', execution, summary, integrity, facts.exitCode);
  if (summary && summary.format !== (expectedKind === 'cangjie-test' ? 'cangjie' : expectedKind)) {
    return report('unknown', 'test-summary-command-mismatch', execution, summary, integrity, facts.exitCode);
  }
  if (!summary) return report('unknown', 'no-unambiguous-test-summary', execution, null, integrity, facts.exitCode);
  if (summary.total === 0 || summary.passed === 0) return report('unknown', 'no-tests-executed', execution, summary, integrity, facts.exitCode);
  return report('passed', summary.skipped > 0 ? 'passed-with-skips' : 'passed', execution, summary, integrity, facts.exitCode);
}