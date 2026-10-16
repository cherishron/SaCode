import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildTestReport,parseTestSummary} from '../renderer/pages/build-test-report.mjs';

const cangjieProposal=JSON.stringify({cwd:'D:/workspace',workspaceRevision:1,executable:'cjpm.exe',argv:['test','--no-color'],timeoutMs:30000,outputLimit:8192});
const nodeProposal=JSON.stringify({cwd:'D:/workspace',workspaceRevision:1,executable:'node',argv:['--test','test/example.test.mjs'],timeoutMs:30000,outputLimit:8192});
const buildProposal=JSON.stringify({cwd:'D:/workspace',workspaceRevision:1,executable:'cjpm.exe',argv:['build'],timeoutMs:30000,outputLimit:8192});
const snapshot = (overrides = {}) => ({
  sessionId: 'session-1', executionId: 'execution-2', taskId: 'task-2', requestId: 'request-2',
  revision: 3, phase: 'exited', proposal:cangjieProposal,
  result: JSON.stringify({exitObserved:true,exitCode:0,timedOut:false,cancelObserved:false,outputComplete:true,processSucceeded:true,stdoutTruncated:false,stderrTruncated:false}),
  ...overrides,
});
const output = (stdout, overrides = {}) => ({
  stdout, stderr: '', more: false,
  capture: {
    stdout: {end:true,eof:true,truncated:false},
    stderr: {end:true,eof:true,truncated:false},
    ...(overrides.capture || {}),
  },
  ...overrides,
});

const cjSummary='TOTAL: 8 / PASSED: 6 / SKIPPED: 2 / ERROR: 0 / FAILED: 0';
const cjpmRunnerSummary='Summary: TOTAL: 4\n    PASSED: 3, SKIPPED: 1, ERROR: 0\n    FAILED: 0';
const tapSummary='# tests 3\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0';

test('仓颉测试命令摘要绑定执行修订；有通过用例和跳过用例仍如实通过', () => {
  const result=buildTestReport(snapshot(),output(cjSummary));
  assert.equal(result.status,'passed');
  assert.equal(result.reason,'passed-with-skips');
  assert.deepEqual([result.sessionId,result.executionId,result.taskId,result.revision],['session-1','execution-2','task-2',3]);
  assert.deepEqual([result.summary.total,result.summary.passed,result.summary.skipped],[8,6,2]);
});

test('解析本机仓颉 1.1.3 的多行最终摘要；忽略 ANSI 进度控制并采用最后一份摘要', () => {
  const noisy='\u001b[0J\u001b7\u001b[9999E\u001b8'+
    'TP: core, time elapsed: 5046000 ns, RESULT:\n'+
    'Summary: TOTAL: 2\n    PASSED: 2, SKIPPED: 0, ERROR: 0\n    FAILED: 0\n'+
    cjpmRunnerSummary+'\n--------------------------------------------------------------------------------------------------';
  assert.deepEqual(parseTestSummary(noisy),{format:'cangjie',total:4,passed:3,skipped:1,errors:0,failed:0,cancelled:0});
  const report=buildTestReport(snapshot(),output(noisy));
  assert.equal(report.status,'passed');
  assert.equal(report.reason,'passed-with-skips');
  assert.equal(report.summary.total,4);
  assert.equal(parseTestSummary(noisy+'\nSummary: TOTAL: 4\n    PASSED: 4'),null);
  const failed=buildTestReport(snapshot(),output('Summary: TOTAL: 3\n    PASSED: 2, SKIPPED: 0, ERROR: 0\n    FAILED: 1'));
  assert.equal(failed.status,'failed');
  assert.equal(failed.reason,'test-summary-has-failures');
});

test('cjpm build 用退出事实和完整双流报告构建结果，不冒充测试摘要', () => {
  const result=buildTestReport(snapshot({proposal:buildProposal}),output('编译完成'));
  assert.equal(result.status,'passed');
  assert.equal(result.kind,'build');
  assert.equal(result.reason,'build-succeeded');
  assert.equal(result.summary,null);
  const incomplete=buildTestReport(snapshot({proposal:buildProposal}),output('编译完成',{capture:{stdout:{end:true,eof:false,truncated:false}}}));
  assert.equal(incomplete.status,'incomplete');
  assert.equal(incomplete.kind,'build');
});

test('仓颉报告有失败时，即使进程退出码为零也不能报告通过', () => {
  const result=buildTestReport(snapshot(),output('TOTAL: 6 / PASSED: 3 / SKIPPED: 1 / ERROR: 0 / FAILED: 2'));
  assert.equal(result.status,'failed');
  assert.equal(result.reason,'test-summary-has-failures');
});

test('Node TAP 仅与 node --test 提案匹配，计数完整时才可通过', () => {
  assert.deepEqual(parseTestSummary(tapSummary),{format:'node-tap',total:3,passed:2,skipped:1,errors:0,failed:0,cancelled:0,todo:0});
  assert.equal(buildTestReport(snapshot({proposal:nodeProposal}),output(tapSummary)).status,'passed');
  assert.equal(parseTestSummary('# tests 3\n# pass 2\n# fail 0\n# skipped 0'),null);
});

test('普通命令打印看似通过的摘要不能伪装成测试成功', () => {
  const fake=JSON.stringify({cwd:'D:/workspace',workspaceRevision:1,executable:'cmd.exe',argv:['/c','echo',cjSummary],timeoutMs:30000,outputLimit:8192});
  const result=buildTestReport(snapshot({proposal:fake}),output(cjSummary));
  assert.equal(result.status,'unknown');
  assert.equal(result.reason,'unsupported-test-command');
});

test('绝对路径下同名可执行文件不作为已识别测试工具', () => {
  const fake=JSON.stringify({cwd:'D:/workspace',workspaceRevision:1,executable:'D:/custom/cjpm.exe',argv:['test'],timeoutMs:30000,outputLimit:8192});
  const result=buildTestReport(snapshot({proposal:fake}),output(cjSummary));
  assert.equal(result.status,'unknown');
  assert.equal(result.reason,'unsupported-test-command');
});

test('摘要格式必须与提案中的测试入口一致', () => {
  const result=buildTestReport(snapshot(),output(tapSummary));
  assert.equal(result.status,'unknown');
  assert.equal(result.reason,'test-summary-command-mismatch');
});

test('退出码非零时，即使摘要全绿也报告失败', () => {
  const facts={exitObserved:true,exitCode:1,timedOut:false,cancelObserved:false,outputComplete:true,processSucceeded:false};
  const result=buildTestReport(snapshot({result:JSON.stringify(facts)}),output('TOTAL: 2 / PASSED: 2 / SKIPPED: 0 / ERROR: 0 / FAILED: 0'));
  assert.equal(result.status,'failed');
  assert.equal(result.reason,'nonzero-exit-code');
});

test('零用例或全部跳过不能作为通过', () => {
  const empty=buildTestReport(snapshot(),output('TOTAL: 0 / PASSED: 0 / SKIPPED: 0 / ERROR: 0 / FAILED: 0'));
  const skipped=buildTestReport(snapshot(),output('TOTAL: 2 / PASSED: 0 / SKIPPED: 2 / ERROR: 0 / FAILED: 0'));
  assert.equal(empty.status,'unknown');
  assert.equal(empty.reason,'no-tests-executed');
  assert.equal(skipped.status,'unknown');
  assert.equal(skipped.reason,'no-tests-executed');
});

test('stdout/stderr 未观察 EOF 或截断时不能报告通过', () => {
  const missingEof=buildTestReport(snapshot(),output(cjSummary,{capture:{stdout:{end:true,eof:false,truncated:false}}}));
  const truncated=buildTestReport(snapshot({result:JSON.stringify({exitObserved:true,exitCode:0,timedOut:false,cancelObserved:false,outputComplete:true,processSucceeded:true,stdoutTruncated:true,stderrTruncated:false})}),output(cjSummary));
  assert.equal(missingEof.status,'incomplete');
  assert.equal(missingEof.reason,'output-not-complete');
  assert.equal(truncated.status,'incomplete');
  assert.equal(truncated.reason,'output-truncated');
});

test('在途、取消、超时和未知退出事实不会被伪装成通过', () => {
  assert.equal(buildTestReport(snapshot({phase:'running',result:''}),{}).status,'running');
  assert.equal(buildTestReport(snapshot({phase:'cancelled-before-start',result:''}),{}).status,'cancelled');
  const timeout=buildTestReport(snapshot({result:JSON.stringify({exitObserved:true,exitCode:124,timedOut:true,cancelObserved:false,outputComplete:false,processSucceeded:false})}),output(''));
  assert.equal(timeout.status,'failed');
  assert.equal(timeout.reason,'execution-timed-out');
  assert.equal(buildTestReport(snapshot({result:'bad-json'}),{}).status,'unknown');
});

test('仍有输出分页时报告保持不完整', () => {
  const result=buildTestReport(snapshot(),output(cjSummary,{more:true}));
  assert.equal(result.status,'incomplete');
  assert.equal(result.reason,'output-pages-remaining');
  assert.equal(result.integrity.more,true);
});

test('分页状态缺失时不能报告完整', () => {
  const partial=output(cjSummary);
  delete partial.more;
  const result=buildTestReport(snapshot(),partial);
  assert.equal(result.status,'incomplete');
  assert.equal(result.reason,'output-pagination-unknown');
});

test('摘要计数不一致时不作通过判定', () => {
  assert.equal(parseTestSummary('TOTAL: 4 / PASSED: 3 / SKIPPED: 0 / ERROR: 0 / FAILED: 0'),null);
});
