#!/usr/bin/env node
// 第一批修复的协议层验收：只用 Host RPC 判「所有修复合在一起，协议面是否干净」，
// 不替代各实现方自己的 bug 复现测试，也不启动 Electron 窗口。
//
// 判据分级（不用「大概通过」）：
//   PASS    断言在真实宿主上成立
//   FAIL    断言不成立，协议面仍是旧形状
//   SKIP    本轮没有触发到该断言要判的路径（例如沙箱后端不可用，真实退出码那几类根本没走到）
//   BLOCKED 前提不具备，结论不成立（宿主缺失／产物早于源码／方法不在该产物里／正控不成立）
//   DIAG    仅在 --allow-stale 下出现：判在早于源码的产物上，只是诊断定位，不是当前修复的结论
//
// 口径：Host 回 turn-in-flight / session-revision-conflict **本身不算缺陷**——那是守卫在干活。
// 本脚本判的是两件事：守卫有没有真的挡住，以及状态有没有被错误改动（拒了还改、或回了 ok 却没改）。
// 友好提示文案、冲突后自动重读与最多一次重试属于前端职责，列在 FRONTEND_ONLY 里单独验收，
// 本脚本只把观察到的错误帧形状记进 evidence.frontendObservation 供前端参照，不拿它当协议面判决。
//
// 每一项都带「宿主产物身份 + 该项依赖的源码 mtime」，产物重打后旧读数自动降级为 BLOCKED，
// 不会拿旧二进制的红灯去冤枉已经改好的源码。
//
// 用法：
//   node scripts/verify-first-batch-protocol.mjs              # 跑全部
//   node scripts/verify-first-batch-protocol.mjs --only=2,5   # 跑子集
//   node scripts/verify-first-batch-protocol.mjs --self-test  # 反证：给每个检测器注入已知违规，看它是否真会判红
//   node scripts/verify-first-batch-protocol.mjs --allow-stale
//       宿主产物早于本项源码时照常跑，但判决一律降级成 DIAG、原判决退到 observedVerdict，
//       只用于诊断定位，不生成「当前修复通过/失败」的结论。默认不开：产物过旧直接判 BLOCKED，
//       不拿旧二进制冤枉已改好的源码。
//   node scripts/verify-first-batch-protocol.mjs --supersedes=<旧轮次目录>::<原因>
//       取代旧轮次时用：保留旧目录、只往里追加一份 SUPERSEDED.md（指向本轮报告 + 撤回原因），
//       绝不重写旧目录的 raw.log / report.json，也绝不删目录。可重复。
//
// 证据纪律：
//   - 旧轮次即使判据有缺陷也保留追溯价值：标记 superseded，不删除替换。
//   - 已删除、无法直接追溯的轮次登记在 EVIDENCE_LEDGER 里；后来重跑的输出不冒充当时的原始日志。
//   - 运行前后各取样一次哈希：一致只说明两个取样点相同，不严格证明期间从未被替换。
//     正式验收须用独立、固定的候选副本，不直接用其他会话可能覆盖的构建输出。
//   - 报告里同时记：脚本自身 sha256、宿主 exe sha256、宿主同目录产物清单摘要、
//     已声明依赖范围内每个文件的内容 sha256、运行期另行加载的原生 DLL 与其构建清单的核对结果。
// 环境变量：
//   SACODE_HOST   本轮宿主可执行文件（缺省用 apps/desktop/dist/host/bin/sacode-host.exe）
// 退出码：0 全 PASS/SKIP，1 有 FAIL，2 有 BLOCKED 或框架自身跑不起来

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { HostBridge } = require('../apps/desktop/host-bridge.cjs');
const { defaultUserSettingsDir } = require('../apps/desktop/data-paths.cjs');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 真实用户 home 在改任何环境变量之前先抓住：只用来断言「合成目录确实在它之外」，绝不读写其内容。
const realUserHome = process.env.USERPROFILE || process.env.HOME || '';
const argv = process.argv.slice(2);
const selfTestOnly = argv.includes('--self-test');
const allowStale = argv.includes('--allow-stale');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;
// --supersedes=<旧轮次目录>::<撤回或取代原因>，可重复。
// 取代旧轮次的固定动作：保留原目录、就地写 SUPERSEDED.md 指向新报告、写明原因——不删了当没发生过，
// 也绝不重写旧目录里的 raw.log / report.json（那是当时的原始证据）。
const supersedes = argv.filter((a) => a.startsWith('--supersedes=')).map((a) => {
  const spec = a.slice('--supersedes='.length);
  const split = spec.indexOf('::');
  return split < 0 ? { dir: spec, reason: '' } : { dir: spec.slice(0, split), reason: spec.slice(split + 2) };
});

// ---------------------------------------------------------------------------
// 原始日志：所有 RPC 往返、宿主 stderr、判决依据都落一个文件，交付时给出绝对路径。
// ---------------------------------------------------------------------------
const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const logDir = join(repoRoot, 'target', 'tmp', `first-batch-protocol-${stamp}-${Math.random().toString(36).slice(2, 8)}`);
const rawLogPath = join(logDir, 'raw.log');
const reportPath = join(logDir, 'report.json');
// 反证模式只跑纯函数，不该在 target/tmp 里留一个只有几行的空壳目录。
let logDirReady = false;
function ensureLogDir() {
  if (logDirReady) return;
  mkdirSync(logDir, { recursive: true });
  writeFileSync(rawLogPath, '');
  logDirReady = true;
}

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(text);
  if (logDirReady) appendFileSync(rawLogPath, text);
}
// 宿主 stderr 由 HostBridge 直接写 process.stderr；这里tee一份进原始日志，
// 否则失败时只剩判决、丢掉宿主的诊断正文。
const stderrOriginal = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  if (logDirReady) { try { appendFileSync(rawLogPath, String(chunk)); } catch { /* 日志写不进不该中断验收 */ } }
  return stderrOriginal(chunk, ...rest);
};

// ---------------------------------------------------------------------------
// 判定原语
// ---------------------------------------------------------------------------
// 机器令牌：全小写字母数字加连接符，例如 turn-in-flight / session-revision-conflict。
// 人类可读消息一定不满足这个形状（含空格、标点或中文）。
const MACHINE_TOKEN = /^[a-z0-9][a-z0-9._:+/-]*$/;
function isHumanText(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.length > 0 && !MACHINE_TOKEN.test(text);
}

// 从 error.data 里递归收人类可读串：修复方可能把友好文案放在 message，也可能放在 data 的某个字段。
function collectHumanStrings(value, out = [], depth = 0) {
  if (depth > 4 || value === null || value === undefined) return out;
  if (typeof value === 'string') { if (isHumanText(value)) out.push(value); return out; }
  if (Array.isArray(value)) { for (const item of value) collectHumanStrings(item, out, depth + 1); return out; }
  if (typeof value === 'object') { for (const item of Object.values(value)) collectHumanStrings(item, out, depth + 1); }
  return out;
}

function describeFrame(frame) {
  if (!frame) return '(无错误帧：调用成功)';
  const parts = [`code=${frame.code}`, `message=${JSON.stringify(frame.message)}`];
  if (frame.data !== undefined) parts.push(`data=${JSON.stringify(frame.data)}`);
  if (frame.transportError) parts.push('transport-error');
  return parts.join(' ');
}

// 检查项 1 / 3 共用的「不返回裸错误码」判据。
// 允许两种合格形状：调用被真实受理（自动重读／在途放行），或错误帧带人类可读消息。
function gradeFriendlyError(frame, { allowSuccess = true } = {}) {
  if (!frame) {
    return allowSuccess
      ? { verdict: 'PASS', detail: '调用被真实受理（未回错误帧），符合「自动重读／在途放行」这一支' }
      : { verdict: 'FAIL', detail: '期望取得错误帧，调用却成功了' };
  }
  if (frame.transportError) {
    return { verdict: 'BLOCKED', detail: `没拿到 JSON-RPC 错误帧，是传输层失败：${describeFrame(frame)}` };
  }
  const human = [];
  if (isHumanText(frame.message)) human.push(`message: ${frame.message}`);
  for (const text of collectHumanStrings(frame.data)) human.push(`data: ${text}`);
  if (human.length > 0) {
    return { verdict: 'PASS', detail: `错误帧带人类可读消息 → ${human.join(' | ')}` };
  }
  const structured = frame.data !== undefined ? `带结构化 data=${JSON.stringify(frame.data)}，但无人类可读文案` : '连 data 都没有';
  return {
    verdict: 'FAIL',
    detail: `仍是裸错误码：${describeFrame(frame)}；${structured}`,
  };
}

// 检查项 2：shell 诊断不吞异常。裸形状是 io-error:shell-<tool> 后面直接断掉；
// 修好的形状是 io-error:shell-<tool>:<真实原因>（固定枚举串，如 SANDBOX_UNAVAILABLE）。
const BARE_SHELL = /io-error:shell-(pwsh|bash)(?![\w:-])/g;
const REASONED_SHELL = /io-error:shell-(pwsh|bash):([A-Za-z0-9_:+.-]+)/g;

function gradeShellDiagnostics(transcript, tools) {
  const bare = [...transcript.matchAll(BARE_SHELL)].map((m) => m[1]);
  const reasoned = [...transcript.matchAll(REASONED_SHELL)].map((m) => ({ tool: m[1], reason: m[2] }));
  const bareCount = bare.length;
  const evidence = {
    bareCount,
    bareTools: [...new Set(bare)],
    reasoned: reasoned.map((r) => `${r.tool}=${r.reason}`),
    reasonedTools: [...new Set(reasoned.map((r) => r.tool))],
  };
  if (bareCount > 0) {
    return { verdict: 'FAIL', evidence, detail: `仍有裸 io-error 吞掉真实原因：${[...new Set(bare)].map((t) => `io-error:shell-${t}`).join(', ')}（${bareCount} 处）` };
  }
  if (reasoned.length === 0) {
    // 没有任何 io-error，说明命令真的跑起来了：这条断言本轮没被判到，不能算通过。
    return { verdict: 'SKIP', evidence, detail: `本轮 ${tools.join('/')} 均未走到 io-error 路径（命令真实执行或未被调用），诊断透传未被证明` };
  }
  return {
    verdict: 'PASS',
    evidence,
    detail: `io-error 均带真实原因：${[...new Set(reasoned.map((r) => `${r.tool} → ${r.reason}`))].join('; ')}`,
  };
}

// shell 结局分类：五种互斥形态。协议面只能看到工具结果正文（recordResult 写进日志的
// ok-shell:/failed-shell: 标记不在 session/projection 里），所以分类只依赖正文形状：
//   启动失败   io-error:shell-<tool>[:原因]
//   真跑过     [shell-exit-code:N;timed-out:B;cancelled:B]（仅在执行未 verified 时追加）
//   正常退出   既无 io-error 也无标记（verified 才不追加标记）
// exitObserved 是 core 的字段、协议面不直接暴露；它在协议面的等价物就是
// 「标记里带着真实退出码」——退出码在，就说明进程真的起来并退出过。
const SHELL_EXIT_MARKER = /\[shell-exit-code:(-?\d+);timed-out:(true|false);cancelled:(true|false)\]/;
const SANDBOX_REASON_ENUM = ['SANDBOX_UNAVAILABLE', 'SANDBOX_MODE_NOT_CONFINED', 'SANDBOX_UNSAFE_WORKSPACE', 'sandbox-confine-failed'];
const SHELL_BUCKETS = ['exit-zero', 'exit-nonzero', 'launch-failure', 'timeout', 'cancelled'];

function isKnownSandboxReason(reason) {
  return typeof reason === 'string' && SANDBOX_REASON_ENUM.some((known) => reason === known || reason.startsWith(`${known}:`));
}

function classifyShellOutcome({ tool, content = '', recorded = '' }) {
  const bare = new RegExp(`io-error:shell-${tool}(?![\\w:-])`).test(content);
  const reasoned = new RegExp(`io-error:shell-${tool}:([A-Za-z0-9_:+.-]+)`).exec(content);
  const marker = SHELL_EXIT_MARKER.exec(content);
  const base = { tool, bare, reason: reasoned ? reasoned[1] : null, recorded, exitCode: null, timedOut: false, cancelled: false };
  // 启动失败与「真的退出过」互斥：两者同时出现说明有一头在说谎，交给 contradictory 判红。
  if ((bare || reasoned) && marker) return { ...base, bucket: 'contradictory' };
  if (reasoned) return { ...base, bucket: 'launch-failure' };
  if (bare) return { ...base, bucket: 'launch-failure' };
  if (marker) {
    const exitCode = Number(marker[1]);
    const timedOut = marker[2] === 'true';
    const cancelled = marker[3] === 'true';
    if (cancelled) return { ...base, bucket: 'cancelled', exitCode, timedOut, cancelled };
    if (timedOut) return { ...base, bucket: 'timeout', exitCode, timedOut, cancelled };
    return { ...base, bucket: exitCode === 0 ? 'exit-zero-marked' : 'exit-nonzero', exitCode, timedOut, cancelled };
  }
  return { ...base, bucket: 'exit-zero' };
}

// 每类结局各自的不变量。关键反例：合法程序无输出、退出码 1，
// 必须保住真实退出码（等价于 exitObserved=true），绝不能仅凭「没输出」就判成初始化失败。
function gradeShellOutcome(observation) {
  const c = classifyShellOutcome(observation);
  const evidence = { ...c };
  const problems = [];
  switch (c.bucket) {
    case 'exit-zero':
      if (/io-error:shell-/.test(c.recorded)) problems.push(`正文看着是正常退出，日志标记却是 ${c.recorded}`);
      break;
    case 'exit-zero-marked':
      // verified 时不追加标记；出现「退出码 0 且未超时未取消」的标记说明 verified 判定与标记不一致。
      problems.push(`退出码 0、未超时未取消却仍带标记，verified 判定与正文不一致：${c.recorded || '(无标记)'}`);
      break;
    case 'exit-nonzero':
      if (!Number.isInteger(c.exitCode)) problems.push('命令非零退出但真实退出码丢失');
      if (c.exitCode === 0) problems.push('归到非零退出却读到退出码 0');
      if (/io-error/.test(observation.content || '')) problems.push('命令非零退出被误判成启动失败');
      break;
    case 'launch-failure':
      if (c.bare) problems.push(`启动失败被吞成裸 io-error:shell-${c.tool}，真实原因丢失`);
      if (!c.bare && !isKnownSandboxReason(c.reason)) problems.push(`启动失败原因不在固定枚举内（可能泄漏路径或底层细节）：${c.reason}`);
      break;
    case 'timeout':
      if (!c.timedOut) problems.push('超时形态却没带 timed-out:true');
      if (/io-error/.test(observation.content || '')) problems.push('超时被误报成启动失败');
      break;
    case 'cancelled':
      if (!c.cancelled) problems.push('取消形态却没带 cancelled:true');
      if (/io-error/.test(observation.content || '')) problems.push('取消被误报成启动失败');
      break;
    case 'contradictory':
      problems.push(`同一份正文同时出现「启动失败」与「真实退出码」两种互斥形态，无法归类：原因=${c.reason || '(裸)'} 标记退出码=${c.exitCode}`);
      break;
    default:
      problems.push(`分类器盲区：无法把这份正文归入 ${SHELL_BUCKETS.join('/')} 任一类`);
  }
  if (problems.length > 0) {
    return { verdict: 'FAIL', bucket: c.bucket, detail: `${c.tool} 归为 ${c.bucket}，但不变量失守：${problems.join('；')}`, evidence };
  }
  const note = {
    'exit-zero': '正常退出，未追加失败标记',
    'exit-nonzero': `命令非零退出，真实退出码 ${c.exitCode} 被保留（协议面等价于 exitObserved=true），未塌成启动失败`,
    'launch-failure': `可靠启动失败，带固定枚举原因 ${c.reason}`,
    timeout: `超时（timed-out=true，退出码 ${c.exitCode}），未与启动失败混淆`,
    cancelled: `取消（cancelled=true），未记成启动失败或模型故障`,
  }[c.bucket];
  return { verdict: 'PASS', bucket: c.bucket, detail: `${c.tool} 归为 ${c.bucket}：${note}`, evidence };
}

// 保护型变更（在途改权限模式、陈旧修订改名）的验收口径：
// 不看错误文案友不友好——那是前端验收；只看两件事：守卫有没有真的挡住、状态有没有被错误改动。
//   被拒 → 状态必须一字未动（拒了还改，比不改更糟）
//   被受理 → 状态必须真的变成请求值（回了 ok 却没变，是假成功）
// requireRefusal=true 用于「屏障本身就是被验对象」的场合（陈旧 expectedRevision）：
// 那种情况下被受理就等于屏障没了，不能算「另一种合格设计」。
function gradeGuardedMutation({ label, frame, stateBefore, stateAfter, requested, requireRefusal = false }) {
  const evidence = { label, stateBefore, stateAfter, requested, requireRefusal, frame: frame ?? null };
  if (frame === null || frame === undefined) return { verdict: 'BLOCKED', detail: `${label}：没拿到调用结果，守卫有效性无从判起`, evidence };
  if (!frame.ok && frame.transportError) return { verdict: 'BLOCKED', detail: `${label}：传输层失败而非协议错误，结论不成立（${describeFrame(frame)}）`, evidence };
  const unchanged = JSON.stringify(stateBefore) === JSON.stringify(stateAfter);
  if (!frame.ok) {
    if (!unchanged) {
      return { verdict: 'FAIL', detail: `${label}：回了错误 ${frame.code} ${frame.message}，状态却从 ${JSON.stringify(stateBefore)} 变成 ${JSON.stringify(stateAfter)}——拒绝与副作用不一致`, evidence };
    }
    if (requireRefusal) {
      return { verdict: 'PASS', detail: `${label}：屏障生效（${frame.code} ${frame.message}），状态保持 ${JSON.stringify(stateBefore)} 未被改动`, evidence };
    }
    return { verdict: 'PASS', detail: `${label}：守卫生效（${frame.code} ${frame.message}），状态保持 ${JSON.stringify(stateBefore)} 未被改动`, evidence };
  }
  if (requireRefusal) {
    return { verdict: 'FAIL', detail: `${label}：屏障没有生效——陈旧 expectedRevision 被受理并返回 ${JSON.stringify(frame.result)}，状态 ${JSON.stringify(stateBefore)} → ${JSON.stringify(stateAfter)}`, evidence };
  }
  if (JSON.stringify(stateAfter) === JSON.stringify(requested)) {
    return { verdict: 'PASS', detail: `${label}：被受理且状态一致地变成 ${JSON.stringify(requested)}（在途放行这一支）`, evidence };
  }
  return { verdict: 'FAIL', detail: `${label}：返回成功 ${JSON.stringify(frame.result)}，状态却没变成请求值（before=${JSON.stringify(stateBefore)} after=${JSON.stringify(stateAfter)} requested=${JSON.stringify(requested)}）——假成功`, evidence };
}

// 正控：守卫类断言必须先证明「该放行时真的放行」，否则一个「什么都拒」的宿主也能全绿。
function gradePositiveControl({ label, frame, stateBefore, stateAfter, expected }) {
  const evidence = { label, stateBefore, stateAfter, expected, frame: frame ?? null };
  if (frame === null || frame === undefined) return { verdict: 'BLOCKED', detail: `${label}：没拿到调用结果`, evidence };
  if (!frame.ok) return { verdict: 'BLOCKED', detail: `${label}：正控调用本身失败（${describeFrame(frame)}），守卫类断言失去分母`, evidence };
  if (JSON.stringify(stateAfter) !== JSON.stringify(expected)) {
    return { verdict: 'FAIL', detail: `${label}：无冲突/非在途时调用成功，状态却没变成期望值（${JSON.stringify(stateBefore)} → ${JSON.stringify(stateAfter)}，期望 ${JSON.stringify(expected)}）`, evidence };
  }
  return { verdict: 'PASS', detail: `${label}：正控成立，状态如期变成 ${JSON.stringify(expected)}`, evidence };
}

// 检查项 4：泛化失败 request-provider-failed 不算「明确原因」。
const GENERIC_PROVIDER_FAILURE = 'request-provider-failed';
// 合格形状是 request-provider-failed:provider-error:client:403 这种复合串——泛化前缀仍在，
// 但后面跟着已脱敏的具体类目。所以判据是「有没有拼上类目」，不是「有没有出现泛化串」；
// 用后者会把修好的复合串误杀成泛化失败。只到 provider-error（无类目）仍算不明确。
const CONCRETE_CAUSE = /provider-error:[a-z-]+(?::\d+)?/;

function gradeProviderFailure({ finishReason, traceReasons, traceEndCount = null, expectFailure = false, interrupted = null }) {
  const top = typeof finishReason === 'string' ? finishReason : '';
  const topCause = CONCRETE_CAUSE.exec(top)?.[0] ?? null;
  const traceCauses = [...new Set((traceReasons || []).map((r) => CONCRETE_CAUSE.exec(r)?.[0]).filter(Boolean))];
  const evidence = { finishReason: top, traceReasons: [...new Set(traceReasons || [])], traceEndCount, topCause, traceCauses, interrupted };
  const generic = top.includes(GENERIC_PROVIDER_FAILURE);
  // 空过防线：上游明确失败时，回合绝不能结算成正常完成——那比泛化错误更糟（失败被吞成成功）。
  if (expectFailure && interrupted !== true && !generic && !/^error:/.test(top)) {
    return { verdict: 'FAIL', evidence, detail: `上游明确失败，回合却结算成正常完成（finishReason=${top || '空'}，interrupted=${interrupted}）——失败被吞成成功` };
  }
  if (topCause) {
    return { verdict: 'PASS', evidence, detail: `结算面自带具体原因 ${topCause}（finishReason=${top}）` };
  }
  // 分母为空要单独说：trace 里一条 request/end 都没有，那是取证没取到，不是产品给出了泛化失败。
  const emptyTrace = traceEndCount === 0 ? '（request-trace 里没有任何 request/end 记录，该面分母为空）' : '';
  if (generic && traceCauses.length === 0) {
    return { verdict: 'FAIL', evidence, detail: `协议面只有泛化失败：finishReason=${top}，request-trace 也没给出更具体的原因（trace=${[...new Set(traceReasons || [])].join(', ') || '空'}）${emptyTrace}` };
  }
  if (generic) {
    // 请求链路里记到了具体类目，但结算面仍把泛化串交给界面：调用方拿到的还是「failed」。
    return { verdict: 'FAIL', evidence, detail: `结算面仍是泛化 finishReason=${top}；具体原因 ${traceCauses.join(', ')} 只在 request-trace 里，回合结算的调用方读不到` };
  }
  if (!generic && !/^error:/.test(top)) {
    return { verdict: 'PASS', evidence, detail: `结算面不是失败形态（finishReason=${top}），无泛化失败可判` };
  }
  return { verdict: 'FAIL', evidence, detail: `失败形态里找不到具体类目，无法归因：finishReason=${top || '空'}，trace=${[...new Set(traceReasons || [])].join(', ') || '空'}${emptyTrace}` };
}

// 检查项 5：配置共享。判据必须同时含「共享成立」与「没污染真实用户配置」两侧，
// 只看前者会把「两个宿主都写进了真实 ~/.sacode」也判成通过。
function gradeSettingsSharing(e) {
  const problems = [];
  if (!e.distinctDataDirs) problems.push('两个 SACODE_DATA_DIR 相同，前提不成立');
  if (!e.distinctHostProcesses) problems.push(`两个宿主进程 PID 相同（${e.hostPidA}），没有真的起两个进程`);
  if (!e.providerReadBack) problems.push('B（另一个 SACODE_DATA_DIR）读不到 A 写的提供方，配置没有共享');
  if (e.providerReadBack && e.keyConfigured !== true) problems.push('提供方读到了但凭据配置状态没共享（keyConfigured!=true）');
  if (!e.providersLogExists) problems.push(`配置根下没有 providers.log：${e.expectedSettingsRoot}`);
  if (e.settingsCapturedByDataDir.length > 0) problems.push(`SACODE_DATA_DIR 把配置吃进去了：${e.settingsCapturedByDataDir.join(', ')}`);
  if (!e.realProvidersLogUntouched) problems.push(`验收过程改动了真实用户配置：${e.realProvidersLog}`);
  if (problems.length > 0) return { verdict: 'FAIL', detail: problems.join('；'), evidence: e };
  return {
    verdict: 'PASS',
    detail: `【被测组件 A：Host 配置共享（host-binary）】两个不同 SACODE_DATA_DIR 的真实宿主（PID ${e.hostPidA} / ${e.hostPidB}）解析到同一配置根 ${e.expectedSettingsRoot}，提供方与凭据状态互相可见，数据目录未截走配置，真实用户配置未被改动。【被测组件 B：桌面 data-paths 解析（desktop-node，本脚本进程内解释执行）】defaultUserSettingsDir() 与 core 侧口径一致（${e.desktopResolverRoot}）。注意：Host 产物的新鲜度只覆盖组件 A，证明不了组件 B；组件 B 的身份按其自身内容哈希记录。`,
    evidence: e,
  };
}

// ---------------------------------------------------------------------------
// 合成提供方：只决定模型说什么，文件读写与命令执行一律交给真实宿主，不代跑。
// ---------------------------------------------------------------------------
async function startProvider(handler) {
  const requests = [];
  const held = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = JSON.parse(raw); } catch { body = { parseError: raw.slice(0, 512) }; }
    requests.push(body);
    try {
      await handler({ body, index: requests.length, res, requests, held });
    } catch (error) {
      log(`合成提供方处理失败：${error?.stack || error}`);
      res.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    held,
    close: async () => { server.closeAllConnections(); await once(server.close(), 'close').catch(() => {}); },
  };
}

const sse = (res, value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
const sseText = (res, text) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  sse(res, { choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] });
  res.end('data: [DONE]\n\n');
};
const sseToolCalls = (res, calls) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  calls.forEach((call, index) => sse(res, {
    choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } }],
  }));
  sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  res.end('data: [DONE]\n\n');
};

// 挂住的提供方：先写一段增量再把响应留在手里，用来制造「turn 进行中」这个前提。
async function holdProvider() {
  let release = null;
  const provider = await startProvider(({ res, held }) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
    sse(res, { choices: [{ index: 0, delta: { content: '处理中' } }] });
    held.push(res);
  });
  release = () => {
    for (const res of provider.held.splice(0)) {
      try {
        sse(res, { choices: [{ index: 0, delta: { content: '合成收尾' }, finish_reason: 'stop' }] });
        res.end('data: [DONE]\n\n');
      } catch { /* 连接可能已被取消关闭 */ }
    }
  };
  return { ...provider, release };
}

// ---------------------------------------------------------------------------
// 宿主驱动
// ---------------------------------------------------------------------------
const hostPath = process.env.SACODE_HOST || join(repoRoot, 'apps/desktop/dist/host/bin/sacode-host.exe');

function fileIdentity(path) {
  if (!existsSync(path)) return null;
  const info = statSync(path);
  return { path, bytes: info.size, mtimeMs: info.mtimeMs, mtime: info.mtime.toISOString(), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

const hostIdentity = fileIdentity(hostPath);
const scriptPath = fileURLToPath(import.meta.url);
const scriptIdentity = fileIdentity(scriptPath);

// 产物清单：宿主必须与全部依赖 DLL 同目录，所以只哈希 exe 会漏掉
// 「同一颗 exe 配了不同 DLL」这种情况。清单摘要覆盖目录下每个文件的 name:bytes:sha256。
function artifactManifest(dirPath) {
  if (!existsSync(dirPath)) return { dir: dirPath, present: false };
  const names = readdirSync(dirPath, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  const files = [];
  let totalBytes = 0;
  for (const name of names) {
    const identity = fileIdentity(join(dirPath, name));
    if (!identity) continue;
    totalBytes += identity.bytes;
    files.push({ name, bytes: identity.bytes, sha256: identity.sha256 });
  }
  const digest = createHash('sha256').update(files.map((f) => `${f.name}:${f.bytes}:${f.sha256}`).join('\n')).digest('hex');
  return { dir: dirPath, present: true, fileCount: files.length, totalBytes, digest, files };
}

// 已声明依赖范围（**手工表，不是完整传递闭包**，也不做自动依赖分析）。
// 每条带组件身份，因为「新鲜度」必须跟**对应的产物**比：
// 拿 Host 二进制的时间去判桌面 Node 文件或运行期另行加载的 DLL 是错的——
// 前者由本脚本进程 require 后解释执行，后者由 SACODE_WINDOWS_PROCESS_DLL 在运行时按路径加载，
// 两者都不在 Host 二进制里，Host 再新也证明不了它们已验证。
const COMPONENTS = {
  'host-binary': { label: '编进 Host 二进制', freshnessAgainst: 'host', note: '按 Host mtime 与内容哈希判新鲜度' },
  'native-dll': { label: '运行期另行加载的原生薄层 DLL', freshnessAgainst: 'own-manifest', note: '由 SACODE_WINDOWS_PROCESS_DLL 指定路径、运行时加载；不链接进 Host，Host 时间戳对它无意义。新鲜度只能按它自己的 build-manifest.json 源码哈希判' },
  'desktop-node': { label: '桌面 Node 侧', freshnessAgainst: 'none', note: '由本验收脚本进程 require 后解释执行，无编译产物；记录内容哈希即可，不与 Host 比时间' },
  'build-config': { label: '构建配置', freshnessAgainst: 'none', note: '影响面按文件另注，不直接对应某一个产物' },
};

const DECLARED_DEPENDENCIES = {
  1: [
    { file: 'apps/host/src/main.cj', component: 'host-binary' },
    { file: 'apps/host/src/approval_mode_rpc.cj', component: 'host-binary' },
    { file: 'core/src/mode_controller.cj', component: 'host-binary' },
    { file: 'core/src/permission_policy.cj', component: 'host-binary' },
  ],
  2: [
    { file: 'core/src/shlex.cj', component: 'host-binary' },
    { file: 'core/src/agent.cj', component: 'host-binary' },
    { file: 'core/src/platform_sandbox.cj', component: 'host-binary' },
    { file: 'core/src/sandbox.cj', component: 'host-binary' },
    { file: 'core/src/appcontainer_win.cj', component: 'host-binary' },
    { file: 'core/src/procwin.cj', component: 'host-binary' },
    { file: 'core/src/model_tool_runtime.cj', component: 'host-binary' },
    // Windows 强制隔离通路：仓颉适配层进 Host，原生薄层是运行期另行加载的 DLL。
    { file: 'core/src/windows_process_adapter.cj', component: 'host-binary', note: 'windowsExecutionEnforcingAvailable / windowsEnforcingExecute / windowsProcessLibraryPath 所在' },
    { file: 'core/native/windows_process.c', component: 'native-dll', note: 'DLL 源码；编进 sacode-windows-process.dll，不进 Host' },
    { file: 'core/native/windows_process.h', component: 'native-dll' },
    { file: 'core/native/windows_tree.c', component: 'native-dll' },
    { file: 'core/native/windows_tree.h', component: 'native-dll' },
    { file: 'core/native/windows_workspace.c', component: 'native-dll' },
    { file: 'core/native/windows_workspace.h', component: 'native-dll' },
    { file: '.deps/native/win32-x64/sacode-windows-process.dll', component: 'native-dll', note: '缺失或 SACODE_WINDOWS_PROCESS_DLL 未设 → windowsEnforcingProcessProvider 返回 None → 退回普通 shell 兜底 → 本机观察到的 SANDBOX_UNAVAILABLE 即此路径' },
    { file: '.deps/native/win32-x64/build-manifest.json', component: 'native-dll', note: 'DLL 自己的构建清单，含各源码与 DLL 的 sha256' },
    { file: 'scripts/build-native.mjs', component: 'build-config', note: 'win32-x64 直接早退（「Windows 使用现有系统 FFI，无 POSIX 薄层」），不产 libsacode_platform.a；影响的是那颗 DLL 的构建路径，不影响 Windows 下 Host 的链接' },
    { file: 'core/cjpm.toml', component: 'build-config', note: '-lsacode_platform 只在 linux/darwin/ohos target 下生效，影响那些平台 Host 的链接；Windows 下不参与' },
  ],
  3: [
    { file: 'apps/host/src/main.cj', component: 'host-binary' },
    { file: 'core/src/catalog.cj', component: 'host-binary', note: 'session-revision-conflict 抛出点' },
    { file: 'core/src/title.cj', component: 'host-binary' },
  ],
  4: [
    { file: 'core/src/request_trace.cj', component: 'host-binary' },
    { file: 'core/src/sse.cj', component: 'host-binary' },
    { file: 'core/src/agent.cj', component: 'host-binary' },
    { file: 'apps/host/src/main.cj', component: 'host-binary' },
  ],
  // 检查项 5 覆盖两个**不同被测组件**，新鲜度与身份必须分开记：
  // 「Host 配置共享」是 core 侧编进二进制的行为，「桌面 data-paths 解析」是 Node 侧解释执行的行为。
  5: [
    { file: 'core/src/global_appearance.cj', component: 'host-binary', subject: 'Host 配置共享' },
    { file: 'core/src/provider_registry.cj', component: 'host-binary', subject: 'Host 配置共享' },
    { file: 'core/src/credential.cj', component: 'host-binary', subject: 'Host 配置共享' },
    { file: 'apps/desktop/data-paths.cjs', component: 'desktop-node', subject: '桌面 data-paths 解析', note: 'defaultUserSettingsDir() 由本脚本进程 require 执行；Host 时间戳证明不了它' },
  ],
};

// 纯函数：把「已声明依赖范围」按组件身份分诊。stat 可注入，便于反证。
// 只有 host-binary 才跟 Host mtime 比；其余组件如实记身份，不冒充「已被 Host 覆盖」。
function evaluateDeclaredScope(entries, { hostMtimeMs, stat }) {
  const missing = [];
  const staleHost = [];
  const otherComponents = [];
  for (const dep of entries) {
    const info = stat(dep.file);
    if (!info) { missing.push({ ...dep }); continue; }
    const row = { ...dep, ...info };
    if (dep.component === 'host-binary' && Number.isFinite(hostMtimeMs) && info.mtimeMs > hostMtimeMs) staleHost.push(row);
    else otherComponents.push(row);
  }
  return { missing, staleHost, otherComponents };
}

// 原生薄层 DLL 的新鲜度只能按它自己的清单判：清单里存了各源码与 DLL 的 sha256。
const NATIVE_DLL_MANIFEST = '.deps/native/win32-x64/build-manifest.json';
const NATIVE_DLL_SOURCES = {
  sourceSha256: 'core/native/windows_process.c',
  headerSha256: 'core/native/windows_process.h',
  workspaceSourceSha256: 'core/native/windows_workspace.c',
  workspaceHeaderSha256: 'core/native/windows_workspace.h',
  treeSourceSha256: 'core/native/windows_tree.c',
  treeHeaderSha256: 'core/native/windows_tree.h',
  dllSha256: '.deps/native/win32-x64/sacode-windows-process.dll',
};

function inspectNativeDll() {
  const manifestPath = join(repoRoot, NATIVE_DLL_MANIFEST);
  if (!existsSync(manifestPath)) return { present: false, reason: `没有 ${NATIVE_DLL_MANIFEST}` };
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (error) { return { present: false, reason: `清单解析失败：${error.message}` }; }
  const drifted = [];
  const matched = [];
  const absent = [];
  for (const [key, relative] of Object.entries(NATIVE_DLL_SOURCES)) {
    const expected = manifest[key];
    const identity = fileIdentity(join(repoRoot, relative));
    if (!identity) { absent.push({ key, file: relative }); continue; }
    if (typeof expected !== 'string') { absent.push({ key, file: relative, reason: '清单里没有这一项' }); continue; }
    (identity.sha256 === expected ? matched : drifted).push({ key, file: relative, manifest: expected, current: identity.sha256 });
  }
  return {
    present: true, manifestPath, target: manifest.target ?? null, compiler: manifest.compiler ?? null,
    matched, drifted, absent,
    // DLL 与自己源码不一致 → 即便打开强制隔离，跑到的也是旧薄层。
    staleAgainstOwnSources: drifted.filter((d) => d.key !== 'dllSha256').length > 0,
    dllMatchesManifest: drifted.every((d) => d.key !== 'dllSha256'),
  };
}

// 验收一律跑在合成用户目录下：绝不读写真实 ~/.sacode，也就绝不触碰真实凭据。
let syntheticHome = null;
function baseEnv(extra = {}) {
  const env = { ...process.env, USERPROFILE: syntheticHome, HOME: syntheticHome };
  for (const name of ['SACODE_USER_SETTINGS_DIR', 'SACODE_PROVIDER_BASE_URL', 'SACODE_PROVIDER_MODEL', 'SACODE_PROVIDER_KEY', 'STEPFUN_API_KEY', 'SACODE_DATA_DIR', 'SSL_CERT_FILE']) delete env[name];
  return { ...env, ...extra };
}

async function callRaw(bridge, method, params = {}, timeoutMs = 10000) {
  log(`→ ${method} ${JSON.stringify(params).slice(0, 400)}`);
  try {
    const result = await bridge.request(method, params, timeoutMs);
    log(`← ${method} ok ${JSON.stringify(result).slice(0, 600)}`);
    return { ok: true, result };
  } catch (error) {
    const parsed = /^(-?\d+)\s([\s\S]*)$/.exec(String(error?.message || ''));
    const frame = parsed
      ? { ok: false, code: Number(parsed[1]), message: parsed[2], data: error.data }
      : { ok: false, code: null, message: String(error?.message || error), transportError: true };
    log(`← ${method} error ${describeFrame(frame)}`);
    return frame;
  }
}

async function bootHost({ dataDir, providerUrl, workdir }) {
  const dir = workdir || mkdtempSync(join(logDir, 'host-'));
  // cwd 不存在时 spawn 报的是 ENOENT + 可执行文件路径，看着像宿主没了，实际是目录没建。
  mkdirSync(dir, { recursive: true });
  const env = baseEnv({
    ...(dataDir ? { SACODE_DATA_DIR: dataDir } : {}),
    ...(providerUrl ? { SACODE_PROVIDER_BASE_URL: providerUrl, SACODE_PROVIDER_MODEL: 'acceptance-fixture', SACODE_PROVIDER_KEY: 'fixture-only' } : {}),
  });
  const bridge = new HostBridge(hostPath, env);
  await bridge.start(dir);
  const init = await callRaw(bridge, 'initialize');
  if (!init.ok) throw new Error(`initialize 失败：${describeFrame(init)}`);
  return { bridge, dir, capabilities: init.result?.capabilities || [] };
}

async function stopHost(bridge) {
  if (!bridge) return { code: null, signal: null, forced: false };
  try {
    return await bridge.stop();
  } catch (error) {
    bridge.killNow();
    return { code: null, signal: null, forced: true, error: String(error?.message || error) };
  }
}

// 轮询到回合结算；有界，超时就把当时的读数交出去，不无限等。
async function pollUntilSettled(bridge, { attempts = 400, intervalMs = 25, onNotification = null } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    if (onNotification) await onNotification();
    last = await callRaw(bridge, 'turn/poll', {}, 10000);
    if (last.ok && last.result?.settled) return last.result;
    if (!last.ok) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (onNotification) await onNotification();
  return last?.ok ? last.result : last;
}

async function waitUntilRunning(bridge, { attempts = 400, intervalMs = 25 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const frame = await callRaw(bridge, 'turn/poll', {}, 10000);
    if (frame.ok && frame.result?.running) return frame.result;
    if (frame.ok && frame.result?.settled) return frame.result;
    if (!frame.ok) return frame;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// 模型侧工具审批：逐张工单应答，凭据只能是宿主发的 approvalId。
function makeApprover(bridge, { decision = 'allowed-once', seen = new Set() } = {}) {
  return async () => {
    for (const note of bridge.notifications) {
      if (note.method !== 'approval/asked') continue;
      const ticket = note.params || {};
      if (!ticket.approvalId || seen.has(ticket.approvalId)) continue;
      seen.add(ticket.approvalId);
      log(`审批工单 ${ticket.approvalId} source=${ticket.source} → ${decision}`);
      await callRaw(bridge, 'approval/answer', { approvalId: ticket.approvalId, decision });
    }
  };
}

async function startTurn(bridge, { project, prompt }) {
  if (project) {
    const frame = await callRaw(bridge, 'workspace/set-directory', { directory: project });
    if (!frame.ok) throw new Error(`workspace/set-directory 失败：${describeFrame(frame)}`);
  }
  const submit = await callRaw(bridge, 'session/submit', { eventType: 'user/message', data: prompt });
  if (!submit.ok) throw new Error(`session/submit 失败：${describeFrame(submit)}`);
  const start = await callRaw(bridge, 'task/start', {}, 15000);
  if (!start.ok) throw new Error(`task/start 失败：${describeFrame(start)}`);
}

// 产物里根本没有这个方法（-32601）＝前提不具备，不是修复没做到。
function methodMissing(frame) {
  return !!frame && frame.ok === false && frame.code === -32601;
}

// ---------------------------------------------------------------------------
// 检查项
// ---------------------------------------------------------------------------
const CHECKS = [];
function check(id, title, run) { CHECKS.push({ id, title, run }); }

const APPROVAL_MODES = ['plan', 'build', 'auto', 'yolo'];
const otherMode = (current) => APPROVAL_MODES.find((m) => m !== current) || 'plan';

check('1', '权限模式在途变更：保护有效且状态未被错误修改', async (ctx) => {
  const provider = await holdProvider();
  let bridge = null;
  try {
    const boot = await bootHost({ providerUrl: provider.url, workdir: ctx.dir });
    bridge = boot.bridge;
    // 正控先走：非在途时改档必须真的生效，否则「在途拒绝且状态未变」这条断言没有分母。
    const mode0 = await callRaw(bridge, 'approval/get-mode');
    if (!mode0.ok) return { verdict: 'BLOCKED', detail: `读不到当前权限档位：${describeFrame(mode0)}`, evidence: { frame: mode0 } };
    const controlTarget = otherMode(mode0.result?.mode);
    const controlSet = await callRaw(bridge, 'approval/set-mode', { mode: controlTarget });
    const afterControl = await callRaw(bridge, 'approval/get-mode');
    const control = gradePositiveControl({
      label: '正控（非在途改档）', frame: controlSet,
      stateBefore: mode0.result?.mode, stateAfter: afterControl.result?.mode, expected: controlTarget,
    });
    if (control.verdict !== 'PASS') return { ...control, detail: `${control.detail}；正控不成立时在途那一支的读数没有意义`, evidence: { control } };

    await startTurn(bridge, { project: ctx.project, prompt: '合成验收：等待在途回合。' });
    const running = await waitUntilRunning(bridge);
    if (!running || !running.running) {
      return { verdict: 'BLOCKED', detail: `没制造出「turn 进行中」这个前提：${JSON.stringify(running)?.slice(0, 300)}`, evidence: { control } };
    }
    const before = await callRaw(bridge, 'approval/get-mode');
    const target = otherMode(before.result?.mode);
    const frame = await callRaw(bridge, 'approval/set-mode', { mode: target });
    const after = await callRaw(bridge, 'approval/get-mode');
    const grade = gradeGuardedMutation({
      label: '在途改权限档位', frame, stateBefore: before.result?.mode, stateAfter: after.result?.mode, requested: target,
    });
    // 友好文案属于前端验收，这里只作观察项记录，不参与判决。
    const frontendObservation = frame.ok ? { note: '在途被受理，前端无需提示' } : gradeFriendlyError(frame);
    provider.release();
    const settled = await pollUntilSettled(bridge);
    return {
      verdict: grade.verdict,
      detail: `${grade.detail}；在途前提已成立（turn/poll running=true），回合最终结算 finishReason=${settled?.finishReason ?? JSON.stringify(settled)?.slice(0, 120)}`,
      evidence: { control, inFlight: true, getModeBefore: before.ok ? before.result : before, setMode: frame.ok ? { ok: true, result: frame.result } : frame, getModeAfter: after.ok ? after.result : after, requestedMode: target, settled, frontendObservation },
    };
  } finally {
    ctx.stopped = await stopHost(bridge);
    await provider.close();
  }
});

check('2', 'shell 执行诊断不吞异常（五类结局分类）', async (ctx) => {
  // pwsh 那条故意是「合法程序、无输出、退出码 1」：这是最容易被误判成初始化失败的形态，
  // 必须保住真实退出码（协议面等价于 exitObserved=true），不许塌成 io-error。
  const cases = [
    { id: 'accept-pwsh', name: 'pwsh', arguments: { command: 'exit 1' }, want: 'exit-nonzero' },
    { id: 'accept-bash', name: 'bash', arguments: { command: 'exit 0' }, want: 'exit-zero' },
  ];
  const provider = await startProvider(({ body, index, res }) => {
    if (index === 1) { sseToolCalls(res, cases.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))); return; }
    const results = (body?.messages || []).filter((m) => m.role === 'tool').map((m) => `${m.tool_call_id}=${String(m.content).slice(0, 160)}`);
    log(`工具回执 ${JSON.stringify(results)}`);
    sseText(res, `合成收尾：已收到 ${results.length} 条工具回执。`);
  });
  let bridge = null;
  try {
    const boot = await bootHost({ providerUrl: provider.url, workdir: ctx.dir });
    bridge = boot.bridge;
    const approve = makeApprover(bridge);
    await startTurn(bridge, { project: ctx.project, prompt: '合成验收：执行 shell 命令并如实报告。' });
    const settled = await pollUntilSettled(bridge, { attempts: 600, onNotification: approve });
    if (!settled || settled.settled !== true) {
      return { verdict: 'BLOCKED', detail: `回合未结算，取不到工具回执：${JSON.stringify(settled)?.slice(0, 300)}` };
    }
    const second = provider.requests[1]?.messages || [];
    const observed = cases.map((c) => {
      const message = second.find((m) => m.tool_call_id === c.id);
      return { tool: c.name, callId: c.id, want: c.want, content: message === undefined ? null : String(message.content) };
    });
    if (observed.some((o) => o.content === null)) {
      return { verdict: 'BLOCKED', detail: `有工具调用没有回执，分母不全：${JSON.stringify(observed.map((o) => ({ tool: o.tool, got: o.content !== null })))}`, evidence: { observed } };
    }
    // 第一层：逐条按五类结局判不变量。
    const perTool = observed.map((o) => ({ ...gradeShellOutcome({ tool: o.tool, content: o.content }), want: o.want, content: o.content }));
    // 第二层：整份投影正文里不许出现裸 io-error（保留原有断言，不因换了分类器而放宽）。
    const projection = await callRaw(bridge, 'session/projection');
    if (!projection.ok) return { verdict: 'BLOCKED', detail: `session/projection 失败：${describeFrame(projection)}`, evidence: { perTool } };
    const messages = Array.isArray(projection.result?.messages) ? projection.result.messages : [];
    if (messages.length === 0) return { verdict: 'BLOCKED', detail: '投影里没有任何消息，判据没有分母（不是「没有裸 io-error」）', evidence: { perTool } };
    const transcript = gradeShellDiagnostics(messages.join('\n'), cases.map((c) => c.name));
    // 覆盖度：本机沙箱后端不可用时只会走到 launch-failure，其余四类必须如实报未覆盖，不冒充通过。
    const covered = [...new Set(perTool.map((r) => r.bucket))];
    const uncovered = SHELL_BUCKETS.filter((b) => !covered.includes(b));
    const mismatched = perTool.filter((r) => r.verdict === 'PASS' && covered.includes('launch-failure') && r.want !== 'launch-failure');
    const grades = [transcript.verdict, ...perTool.map((r) => r.verdict)];
    const verdict = grades.includes('BLOCKED') ? 'BLOCKED' : grades.includes('FAIL') ? 'FAIL' : uncovered.length > 0 ? 'SKIP' : 'PASS';
    const coverageNote = uncovered.length > 0
      ? `；真实宿主本轮只走到 ${covered.join('/')}，未覆盖 ${uncovered.join('/')}（沙箱后端不可用，命令没有真的起来，就没有真实退出码可判）——这四类只由 --self-test 的合成样例覆盖，不算真实宿主验收`
      : `；五类结局在真实宿主上均已走到（${covered.join('/')}）`;
    return {
      verdict,
      detail: `${perTool.map((r) => `${r.bucket}=${r.verdict}`).join(', ')}；正文层裸 io-error=${transcript.evidence.bareCount} 处${coverageNote}`,
      evidence: {
        perTool: perTool.map((r) => ({ tool: r.evidence.tool, bucket: r.bucket, want: r.want, verdict: r.verdict, detail: r.detail, reason: r.evidence.reason, exitCode: r.evidence.exitCode, content: r.content.slice(0, 400) })),
        transcript, coveredBuckets: covered, uncoveredBuckets: uncovered, mismatched, providerRequests: provider.requests.length,
      },
    };
  } finally {
    ctx.stopped = await stopHost(bridge);
    await provider.close();
  }
});

check('3', '重命名保护有效且标题未被错误修改（陈旧修订 + 在途）', async (ctx) => {
  const provider = await holdProvider();
  let bridge = null;
  const surfaces = {};
  try {
    const boot = await bootHost({ providerUrl: provider.url, workdir: ctx.dir });
    bridge = boot.bridge;
    const created = await callRaw(bridge, 'session/create', { title: '验收会话' });
    if (!created.ok) {
      if (methodMissing(created)) return { verdict: 'BLOCKED', detail: `该宿主产物不含 session/create：${describeFrame(created)}` };
      return { verdict: 'BLOCKED', detail: `session/create 失败：${describeFrame(created)}` };
    }
    const sessionId = created.result?.id || created.result?.sessionId;
    const entry = async () => {
      const catalog = await callRaw(bridge, 'session/catalog');
      return (catalog.result?.entries || []).find((e) => e.id === sessionId) || null;
    };
    const row0 = await entry();
    if (!row0) return { verdict: 'BLOCKED', detail: `session/catalog 里没有新建的会话 ${sessionId}`, evidence: { surfaces } };

    // 正控：修订号正确时改名必须真的生效，否则「冲突时标题未变」这条断言没有分母。
    const control = await callRaw(bridge, 'session/rename', { sessionId, title: '正控改名', expectedRevision: row0.durable });
    if (methodMissing(control)) {
      return { verdict: 'BLOCKED', detail: `该宿主产物不含 session/rename：${describeFrame(control)}（需重打宿主后再判）`, evidence: { surfaces } };
    }
    const rowControl = await entry();
    const controlGrade = gradePositiveControl({
      label: '正控（修订号正确时改名）', frame: control,
      stateBefore: row0.title, stateAfter: rowControl?.title, expected: '正控改名',
    });
    surfaces.control = { frame: control.ok ? { ok: true, result: control.result } : control, titleAfter: rowControl?.title, durableAfter: rowControl?.durable };
    if (controlGrade.verdict !== 'PASS') {
      return { ...controlGrade, detail: `${controlGrade.detail}；正控不成立时冲突与在途两支的读数没有意义`, evidence: { sessionId, surfaces } };
    }

    // 3a：陈旧修订号。屏障本身就是被验对象，必须拒；拒了标题还必须一字未动。
    const stale = await callRaw(bridge, 'session/rename', { sessionId, title: '迟到的改名', expectedRevision: row0.durable });
    const rowStale = await entry();
    surfaces.revisionConflict = { frame: stale.ok ? { ok: true, result: stale.result } : stale, titleAfter: rowStale?.title, durableAfter: rowStale?.durable };
    const conflictGrade = gradeGuardedMutation({
      label: '陈旧修订改名', frame: stale, stateBefore: rowControl?.title, stateAfter: rowStale?.title,
      requested: '迟到的改名', requireRefusal: true,
    });

    // 3b：turn 进行中改名。这一支「拒」与「放行」都可能是合格设计，只看状态是否自洽。
    await startTurn(bridge, { project: ctx.project, prompt: '合成验收：等待在途回合。' });
    const running = await waitUntilRunning(bridge);
    const rowInFlight = await entry();
    const inFlight = await callRaw(bridge, 'session/rename', { sessionId, title: '在途改名', expectedRevision: rowInFlight?.durable ?? 0 });
    const rowAfterInFlight = await entry();
    surfaces.inFlight = { frame: inFlight.ok ? { ok: true, result: inFlight.result } : inFlight, titleAfter: rowAfterInFlight?.title, durableAfter: rowAfterInFlight?.durable, running: running?.running === true };
    const inFlightGrade = gradeGuardedMutation({
      label: '在途改名', frame: inFlight, stateBefore: rowInFlight?.title, stateAfter: rowAfterInFlight?.title, requested: '在途改名',
    });
    const frontendObservation = {
      revisionConflict: stale.ok ? { note: '被受理，前端无需冲突提示' } : gradeFriendlyError(stale),
      inFlight: inFlight.ok ? { note: '被受理，前端无需在途提示' } : gradeFriendlyError(inFlight),
    };
    provider.release();
    const settled = await pollUntilSettled(bridge);
    surfaces.settled = settled;

    const grades = [conflictGrade, inFlightGrade];
    const verdicts = grades.map((g) => g.verdict);
    const verdict = verdicts.includes('BLOCKED') ? 'BLOCKED' : verdicts.includes('FAIL') ? 'FAIL' : 'PASS';
    return {
      verdict,
      detail: `${controlGrade.detail}；陈旧修订支：${conflictGrade.detail}；在途支：${inFlightGrade.detail}（在途前提 running=${running?.running === true}）`,
      evidence: { sessionId, control: controlGrade, grades: { revisionConflict: conflictGrade, inFlight: inFlightGrade }, surfaces, frontendObservation },
    };
  } finally {
    ctx.stopped = await stopHost(bridge);
    await provider.close();
  }
});

check('4', '模型请求不返回泛化 request-provider-failed', async (ctx) => {
  const surfaces = {};
  // 4a：正常上游必须回真实正文。
  const good = await startProvider(({ res }) => sseText(res, '合成提供方的真实答复正文。'));
  let bridgeGood = null;
  let goodGrade;
  try {
    const boot = await bootHost({ providerUrl: good.url, workdir: ctx.dir });
    bridgeGood = boot.bridge;
    await startTurn(bridgeGood, { project: ctx.project, prompt: '合成验收：请回一句正文。' });
    const settled = await pollUntilSettled(bridgeGood, { attempts: 600 });
    surfaces.happy = settled;
    const finishReason = settled?.finishReason || '';
    const text = settled?.text || '';
    if (!settled || settled.settled !== true) {
      goodGrade = { verdict: 'BLOCKED', detail: `正常上游那一支回合未结算：${JSON.stringify(settled)?.slice(0, 300)}` };
    } else if (finishReason.includes(GENERIC_PROVIDER_FAILURE)) {
      goodGrade = { verdict: 'FAIL', detail: `正常上游也被判成泛化失败：finishReason=${finishReason}` };
    } else if (!text.includes('合成提供方的真实答复正文')) {
      goodGrade = { verdict: 'FAIL', detail: `回合结算了但正文不是上游真实响应：text=${JSON.stringify(text).slice(0, 300)}，finishReason=${finishReason}` };
    } else {
      goodGrade = { verdict: 'PASS', detail: `正常上游回到真实正文，finishReason=${finishReason || '(空)'}，上游收到 ${good.requests.length} 次请求` };
    }
  } finally {
    ctx.stoppedGood = await stopHost(bridgeGood);
    await good.close();
  }

  // 4b：上游明确 403，协议面必须说得出是 403，而不是「failed」。
  const bad = await startProvider(({ res }) => { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Forbidden'); });
  let bridgeBad = null;
  let badGrade;
  try {
    const boot = await bootHost({ providerUrl: bad.url, workdir: join(ctx.dir, 'reject') });
    bridgeBad = boot.bridge;
    await startTurn(bridgeBad, { project: ctx.project, prompt: '合成验收：上游会拒绝。' });
    const settled = await pollUntilSettled(bridgeBad, { attempts: 600 });
    surfaces.rejected = settled;
    const trace = await callRaw(bridgeBad, 'session/request-trace', { sessionId: 'current', beforeSeq: -1, limit: 50 });
    // request/end 记录里承载原因的那个字段叫 finishReason（不是 reason）；两个名字都收，字段改名不至于读出空分母。
    const ends = (trace.result?.requests || []).map((r) => r?.end).filter((v) => v && typeof v === 'object');
    const traceReasons = ends.flatMap((e) => [e.finishReason, e.reason]).filter((v) => typeof v === 'string' && v.length > 0);
    surfaces.trace = trace.ok ? { ends, traceReasons } : trace;
    badGrade = gradeProviderFailure({
      finishReason: settled?.finishReason || '', traceReasons, traceEndCount: trace.ok ? ends.length : null,
      expectFailure: true, interrupted: settled?.interrupted ?? null,
    });
  } finally {
    ctx.stoppedBad = await stopHost(bridgeBad);
    await bad.close();
  }

  const verdicts = [goodGrade.verdict, badGrade.verdict];
  const verdict = verdicts.includes('BLOCKED') ? 'BLOCKED' : verdicts.includes('FAIL') ? 'FAIL' : 'PASS';
  return { verdict, detail: `正常上游支：${goodGrade.detail}；明确 403 支：${badGrade.detail}`, evidence: { surfaces, grades: { happy: goodGrade, rejected: badGrade } } };
});

check('5', '配置共享生效（不同 SACODE_DATA_DIR 同一配置根）', async (ctx) => {
  // 配置根必须从合成 home 推，绝不能读 process.env 里的真实 home——
  // 否则断言会瞄到用户真实 ~/.sacode，既验错目录又白读一次私人配置。
  const home = syntheticHome;
  const realHome = realUserHome ? resolve(realUserHome) : '';
  const dataA = join(logDir, 'data-a');
  const dataB = join(logDir, 'data-b');
  mkdirSync(dataA, { recursive: true }); mkdirSync(dataB, { recursive: true });
  const expectedRoot = resolve(join(home, '.sacode', 'user'));
  // 交叉核对：桌面那份生产解析器在同一个合成 home 下必须落到同一根，不各算一套。
  const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, SACODE_USER_SETTINGS_DIR: process.env.SACODE_USER_SETTINGS_DIR };
  process.env.USERPROFILE = home; process.env.HOME = home; delete process.env.SACODE_USER_SETTINGS_DIR;
  let desktopRoot = null;
  try { desktopRoot = resolve(defaultUserSettingsDir() || ''); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  const evidence = { syntheticHome: home, realUserHome: realUserHome, expectedSettingsRoot: expectedRoot, desktopResolverRoot: desktopRoot, dataDirA: dataA, dataDirB: dataB };
  // 本项覆盖两个**不同被测组件**，身份分开记：Host 产物的时间戳/哈希证明不了桌面 Node 侧已验证，反之亦然。
  const dataPathsIdentity = fileIdentity(join(repoRoot, 'apps/desktop/data-paths.cjs'));
  evidence.subjects = {
    'Host 配置共享': {
      component: 'host-binary',
      artifact: { path: hostIdentity.path, sha256: hostIdentity.sha256, bytes: hostIdentity.bytes, mtime: hostIdentity.mtime },
      assertedBy: '两个真实宿主进程（不同 SACODE_DATA_DIR、不同 PID）经 model/registry/update → model/registry/describe 互见提供方与凭据状态',
    },
    '桌面 data-paths 解析': {
      component: 'desktop-node',
      artifact: dataPathsIdentity ? { path: dataPathsIdentity.path, sha256: dataPathsIdentity.sha256, bytes: dataPathsIdentity.bytes, mtime: dataPathsIdentity.mtime } : null,
      runtime: { executable: process.execPath, node: process.version, executedIn: '本验收脚本进程（require 后解释执行，不经 Host 二进制）' },
      assertedBy: 'defaultUserSettingsDir() 在同一合成 home 下解析出的根，与 core 侧 <home>/.sacode/user 口径一致',
      notCoveredByHostFreshness: true,
    },
  };
  // 真实用户配置的 providers.log 在验收前后必须逐字节不变：这是「没碰私人凭据」的正面证据，
  // 比只声明「我设了合成 home」强——设了变量也可能被别的解析路径绕过去。
  const realProvidersLog = realHome ? join(realHome, '.sacode', 'user', 'providers.log') : null;
  const realBefore = realProvidersLog && existsSync(realProvidersLog) ? statSync(realProvidersLog) : null;
  const guards = [];
  if (realHome && (expectedRoot === realHome || expectedRoot.startsWith(realHome + sep))) {
    guards.push(`合成配置根落在真实用户目录内（${expectedRoot} 在 ${realHome} 之下），隔离前提不成立`);
  }
  if (desktopRoot !== expectedRoot) guards.push(`桌面解析器算出的配置根（${desktopRoot}）与合成 home 推出的（${expectedRoot}）不一致`);
  if (guards.length > 0) return { verdict: 'BLOCKED', detail: guards.join('；'), evidence };
  let bridgeA = null; let bridgeB = null;
  try {
    const bootA = await bootHost({ dataDir: dataA, workdir: join(ctx.dir, 'a') });
    bridgeA = bootA.bridge;
    const hostPidA = bridgeA.proc?.pid;
    const describe0 = await callRaw(bridgeA, 'model/registry/describe');
    if (methodMissing(describe0)) {
      return { verdict: 'BLOCKED', detail: `该宿主产物不含 model/registry/describe：${describeFrame(describe0)}` };
    }
    const update = await callRaw(bridgeA, 'model/registry/update', {
      draft: {
        id: 'shared-probe', name: '共享探针', baseUrl: 'https://invalid.example/v1', protocol: 'openai-completions',
        models: [{ id: 'fixture-model', name: '合成模型', contextWindow: '', maxTokens: '', image: false }],
      },
      expectedRevision: describe0.result?.revision ?? 0,
    });
    if (!update.ok) return { verdict: 'BLOCKED', detail: `写入合成提供方失败：${describeFrame(update)}` };
    const described = await callRaw(bridgeA, 'model/registry/describe');
    const provider = (described.result?.providers || []).find((p) => p.id === 'shared-probe');
    if (!provider) return { verdict: 'FAIL', detail: `写进去的提供方在 A 里读不回来：${JSON.stringify(described.result).slice(0, 300)}` };
    const credential = await callRaw(bridgeA, 'credential/set', { ref: provider.credentialRef, value: 'fixture-only-not-a-real-key' });
    evidence.seed = { providerId: provider.id, credentialRef: provider.credentialRef, credentialSet: credential.ok ? credential.result : credential };
    ctx.stoppedA = await stopHost(bridgeA); evidence.stoppedA = ctx.stoppedA; bridgeA = null;
    evidence.hostPidA = hostPidA;

    const bootB = await bootHost({ dataDir: dataB, workdir: join(ctx.dir, 'b') });
    bridgeB = bootB.bridge;
    evidence.hostPidB = bridgeB.proc?.pid;
    const viewB = await callRaw(bridgeB, 'model/registry/describe');
    if (!viewB.ok) return { verdict: 'FAIL', detail: `B 读配置失败：${describeFrame(viewB)}` };
    const providerB = (viewB.result?.providers || []).find((p) => p.id === 'shared-probe');
    evidence.readBack = { providersCount: (viewB.result?.providers || []).length, providerId: providerB?.id ?? null, keyConfigured: providerB?.keyConfigured === true };
    const realAfter = realProvidersLog && existsSync(realProvidersLog) ? statSync(realProvidersLog) : null;
    return gradeSettingsSharing({
      ...evidence,
      providerReadBack: !!providerB,
      keyConfigured: providerB?.keyConfigured === true,
      providersLogExists: existsSync(join(expectedRoot, 'providers.log')),
      settingsCapturedByDataDir: [dataA, dataB].filter((d) => existsSync(join(d, '.sacode'))),
      distinctHostProcesses: evidence.hostPidA !== evidence.hostPidB,
      distinctDataDirs: resolve(dataA) !== resolve(dataB),
      realProvidersLog,
      realProvidersLogUntouched: !!realBefore === !!realAfter &&
        (!realBefore || (realBefore.mtimeMs === realAfter.mtimeMs && realBefore.size === realAfter.size)),
    });
  } finally {
    ctx.stoppedA = ctx.stoppedA || await stopHost(bridgeA);
    ctx.stoppedB = await stopHost(bridgeB);
  }
});

// 协议层覆盖不到、必须走前端/GUI 单独验收的项。本脚本只把观察到的错误帧形状记进
// evidence.frontendObservation 供前端验收参照，不拿它当协议面的判决。
const FRONTEND_ONLY = [
  { item: '权限模式在途被拒的友好提示', why: 'Host 只回错误码与机器令牌；文案、toast/内联位置、是否给出「等它结束或先取消」的下一步动作，都在渲染层', observedFrom: '检查项 1 → evidence.frontendObservation' },
  { item: '重命名冲突后自动重读 + 最多一次重试', why: '「读最新 revision 再改一次」是前端编排；Host 侧只保证屏障生效与状态自洽，不会替调用方重试', observedFrom: '检查项 3 → evidence.frontendObservation.revisionConflict' },
  { item: '在途改名被拒的友好提示', why: '同上，文案与禁用态属于渲染层', observedFrom: '检查项 3 → evidence.frontendObservation.inFlight' },
  { item: '模型请求失败原因的用户可读呈现', why: '协议面即便给出 provider-error:client:403，翻成「上游拒绝（403），请检查凭据」仍是前端职责', observedFrom: '检查项 4 → evidence.surfaces.trace' },
  { item: 'shell 启动失败与命令非零退出的界面区分', why: '两者在正文里形状不同（io-error vs shell-exit-code 标记），但卡片配色/图标/是否可重试由渲染层决定', observedFrom: '检查项 2 → evidence.perTool[].bucket' },
  { item: '权限菜单在展开时读到未知模式的重试', why: '纯渲染层状态机，协议面看不到', observedFrom: '（本脚本不覆盖）' },
];

// 已声明依赖范围的分诊自测：只有 host-binary 组件才跟 Host 产物比时间。
// 拿 Host 的时间戳去判桌面 Node 文件或运行期 DLL，会造出「Host 新 ⇒ 一切都验过了」的假绿。
const fakeStat = (mtimes) => (file) => (Object.prototype.hasOwnProperty.call(mtimes, file)
  ? { path: file, bytes: 1, mtimeMs: mtimes[file], mtime: new Date(mtimes[file]).toISOString(), sha256: `fake-${file}` }
  : null);
function scopeProbe(entries, mtimes, hostMtimeMs) {
  const result = evaluateDeclaredScope(entries, { hostMtimeMs, stat: fakeStat(mtimes) });
  return {
    stale: result.staleHost.map((r) => r.file).sort(),
    missing: result.missing.map((r) => r.file).sort(),
    others: result.otherComponents.length,
  };
}
const SCOPE_CASES = [
  {
    label: 'host-binary 源码晚于产物 → 必须判过时',
    observe: () => scopeProbe([{ file: 'h.cj', component: 'host-binary' }], { 'h.cj': 200 }, 100),
    expect: { stale: ['h.cj'], missing: [], others: 0 },
  },
  {
    label: 'host-binary 源码早于产物 → 不算过时',
    observe: () => scopeProbe([{ file: 'h.cj', component: 'host-binary' }], { 'h.cj': 50 }, 100),
    expect: { stale: [], missing: [], others: 1 },
  },
  {
    label: '桌面 Node 文件比 Host 新 → 不得判 Host 侧过时（组件不同，时间不可比）',
    observe: () => scopeProbe([{ file: 'd.cjs', component: 'desktop-node' }], { 'd.cjs': 999 }, 100),
    expect: { stale: [], missing: [], others: 1 },
  },
  {
    label: '运行期 DLL 比 Host 新 → 不得判 Host 侧过时',
    observe: () => scopeProbe([{ file: 'n.dll', component: 'native-dll' }], { 'n.dll': 999 }, 100),
    expect: { stale: [], missing: [], others: 1 },
  },
  {
    label: '构建配置比 Host 新 → 不得判 Host 侧过时（影响面另注）',
    observe: () => scopeProbe([{ file: 'b.toml', component: 'build-config' }], { 'b.toml': 999 }, 100),
    expect: { stale: [], missing: [], others: 1 },
  },
  {
    label: '混合声明时只挑出 host-binary 那一条过时',
    observe: () => scopeProbe([
      { file: 'h.cj', component: 'host-binary' }, { file: 'd.cjs', component: 'desktop-node' },
      { file: 'n.dll', component: 'native-dll' }, { file: 'b.toml', component: 'build-config' },
    ], { 'h.cj': 200, 'd.cjs': 999, 'n.dll': 999, 'b.toml': 999 }, 100),
    expect: { stale: ['h.cj'], missing: [], others: 3 },
  },
  {
    label: '声明的文件不存在 → 必须报 missing，不许静默当成「没有过时的」',
    observe: () => scopeProbe([{ file: 'gone.cj', component: 'host-binary' }, { file: 'h.cj', component: 'host-binary' }], { 'h.cj': 50 }, 100),
    expect: { stale: [], missing: ['gone.cj'], others: 1 },
  },
];

// 证据台账：被取代的历史轮次一律登记，不「删了当没发生过」。
// 已删除、无法直接追溯的轮次也如实记在这里；后来重跑的输出**不冒充**当时的原始日志。
// 后续取代旧轮次的固定动作：保留原目录 → 写入 SUPERSEDED.md 标记 → 指向新报告 → 写明撤回原因。
const EVIDENCE_LEDGER = [
  {
    runId: 'first-batch-protocol-20261019-0h80u1',
    kind: 'strict',
    hostSha256: '1df59baf599076a8ee437175d9028093bfd9d70c4d63769df06c8738a311ff27',
    scriptSha256: null,
    status: 'untraceable-deleted',
    preservedAt: null,
    supersededBy: null,
    reportedAtTheTime: 'PASS=4 FAIL=0 SKIP=1（1=PASS 2=SKIP 3/4/5=PASS）—— 已撤回',
    retractedBecause: '当时已声明依赖范围过窄（检查项 1 只列 apps/host/src/main.cj；检查项 2 只列 shlex.cj+agent.cj），漏掉 approval_mode_rpc.cj / mode_controller.cj / windows_process_adapter.cj 与原生 DLL 通路，把本应 BLOCKED 的检查项 1 报成 PASS、检查项 2 报成 SKIP；且日志只记了运行前一次哈希。目录已被我删除，无法直接追溯。',
  },
  {
    runId: 'first-batch-protocol-20261019-a0o5s9',
    kind: 'allow-stale-diagnostic',
    hostSha256: 'a01957e0e68d6185a6a082e76161b62dd14b0c657f674a7a65e0d5e825e74f1f',
    scriptSha256: null,
    status: 'untraceable-deleted',
    preservedAt: null,
    supersededBy: null,
    reportedAtTheTime: 'DIAG=4 BLOCKED=1（旧产物 A/B 诊断）',
    retractedBecause: '同上：旧版脚本产出，依赖范围过窄、无运行后取样。目录已被我删除，无法直接追溯；后来的同类诊断不冒充这份原始日志。',
  },
  {
    runId: 'first-batch-protocol-20261019-2lwvsg',
    kind: 'strict',
    hostSha256: '1df59baf599076a8ee437175d9028093bfd9d70c4d63769df06c8738a311ff27',
    scriptSha256: null,
    status: 'superseded-preserved',
    preservedAt: 'target/tmp/first-batch-protocol-20261019-2lwvsg/',
    supersededMarker: 'target/tmp/first-batch-protocol-20261019-2lwvsg/SUPERSEDED.md',
    // 取代者脚本的 sha256 不能内嵌在它自己里面（自指），权威值取每轮 report.json 的 script.sha256。
    supersededByScriptSha256: '见取代者那一轮 report.json 的 script.sha256（脚本无法记录自身哈希）',
    supersededBy: '脚本新版（补 windows_process_adapter.cj、原生 DLL 通路与构建配置、检查项 5 双组件身份、脚本自身哈希、产物清单摘要、DLL 清单核对、依赖分诊自测）；本轮按要求暂停真实 Host 复跑，尚无新轮次可指向',
    reportedAtTheTime: 'PASS=3 FAIL=0 SKIP=0 BLOCKED=2（1/2=BLOCKED，3/4/5=PASS）',
    retractedBecause: '未撤回判决：按新版已声明依赖范围重算，检查项 1 仍 BLOCKED（approval_mode_rpc.cj / mode_controller.cj 晚于产物）、检查项 2 仍 BLOCKED（shlex.cj 晚于产物，且新声明的 windows_process_adapter.cj 更晚）、3/4/5 的声明文件集合未变，判决不变。被取代的是**报告完整性**：该轮 report.json 缺脚本自身哈希、产物清单摘要、原生 DLL 清单核对与逐项已声明依赖范围。三项 PASS 只作为「该旧二进制在指定场景下」的结果保留，不升级为最新工作区通过。',
  },
  {
    runId: 'first-batch-protocol-20261019-eaqjyp',
    kind: 'allow-stale-diagnostic',
    hostSha256: 'a01957e0e68d6185a6a082e76161b62dd14b0c657f674a7a65e0d5e825e74f1f',
    scriptSha256: null,
    status: 'superseded-preserved',
    preservedAt: 'target/tmp/first-batch-protocol-20261019-eaqjyp/',
    supersededMarker: 'target/tmp/first-batch-protocol-20261019-eaqjyp/SUPERSEDED.md',
    supersededByScriptSha256: '见取代者那一轮 report.json 的 script.sha256（脚本无法记录自身哈希）',
    supersededBy: '同 2lwvsg',
    reportedAtTheTime: 'DIAG=4 BLOCKED=1（旧产物 A/B 诊断：检查项 2 裸 io-error=2 处、检查项 4 只有泛化失败）',
    retractedBecause: '未撤回判决：A/B 诊断结论（同一脚本在旧产物上判红、在新产物上判绿）仍成立。被取代的同样只是报告完整性。',
  },
];

// ---------------------------------------------------------------------------
// 反证：给每个检测器喂已知违规，确认它自己会判红（门禁绿灯不是假设）
// ---------------------------------------------------------------------------
// 检查项 5 的合格基线：反证时只改一个字段，确认对应那一条判据真的会红。
const SHARING_OK = {
  distinctDataDirs: true, distinctHostProcesses: true, hostPidA: 1111, hostPidB: 2222,
  providerReadBack: true, keyConfigured: true, providersLogExists: true,
  settingsCapturedByDataDir: [], realProvidersLogUntouched: true,
  realProvidersLog: 'C:/Users/real/.sacode/user/providers.log',
  expectedSettingsRoot: 'C:/tmp/acceptance/home/.sacode/user',
};

const SELF_TEST_CASES = [
  {
    label: '裸 -32001 turn-in-flight 必须判红',
    grade: () => gradeFriendlyError({ ok: false, code: -32001, message: 'turn-in-flight' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeFriendlyError({ ok: false, code: -32001, message: 'turn-in-flight', data: { hint: '当前回合正在流式返回，请等它结束或先取消再切换权限模式' } }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '裸 -32004 session-revision-conflict 必须判红',
    grade: () => gradeFriendlyError({ ok: false, code: -32004, message: 'session-revision-conflict' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeFriendlyError(null).verdict,
    expectGood: 'PASS',
  },
  {
    label: '结构化 data 但无人类文案仍判红',
    grade: () => gradeFriendlyError({ ok: false, code: -32001, message: 'already-owned', data: { reason: 'busy', retryable: true } }).verdict,
    expectBad: 'FAIL',
    good: () => gradeFriendlyError({ ok: false, code: -32001, message: 'already-owned', data: { reason: 'busy', retryable: true, message: '会话被另一个窗口占用' } }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '裸 io-error:shell-pwsh 必须判红',
    grade: () => gradeShellDiagnostics('工具失败：io-error:shell-pwsh', ['pwsh']).verdict,
    expectBad: 'FAIL',
    good: () => gradeShellDiagnostics('工具失败：io-error:shell-pwsh:SANDBOX_UNAVAILABLE', ['pwsh']).verdict,
    expectGood: 'PASS',
  },
  {
    label: 'io-error 路径没走到时不许冒充通过',
    grade: () => gradeShellDiagnostics('ok-shell:pwsh:0:12', ['pwsh']).verdict,
    expectBad: 'SKIP',
    good: () => gradeShellDiagnostics('io-error:shell-bash:SANDBOX_MODE_NOT_CONFINED', ['bash']).verdict,
    expectGood: 'PASS',
  },
  {
    label: '泛化 request-provider-failed 必须判红',
    grade: () => gradeProviderFailure({ finishReason: 'error:request-provider-failed', traceReasons: [] }).verdict,
    expectBad: 'FAIL',
    good: () => gradeProviderFailure({ finishReason: 'error:provider-error:client:403', traceReasons: ['provider-error:client:403'] }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '真实原因只在 trace、结算面仍泛化时判红',
    grade: () => gradeProviderFailure({ finishReason: 'error:request-provider-failed', traceReasons: ['provider-error:client:403'] }).verdict,
    expectBad: 'FAIL',
    good: () => gradeProviderFailure({ finishReason: 'completed', traceReasons: ['provider-error:client:403'] }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '复合串（泛化前缀 + 具体类目）是修好的形状，必须判绿',
    grade: () => gradeProviderFailure({ finishReason: 'error:request-provider-failed:provider-error', traceReasons: ['provider-error'], expectFailure: true, interrupted: true }).verdict,
    expectBad: 'FAIL',
    good: () => gradeProviderFailure({ finishReason: 'error:request-provider-failed:provider-error:client:403', traceReasons: ['provider-error:client:403'], expectFailure: true, interrupted: true }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '上游明确失败却结算成正常完成（失败被吞成成功）必须判红',
    grade: () => gradeProviderFailure({ finishReason: 'stop', traceReasons: [], expectFailure: true, interrupted: false }).verdict,
    expectBad: 'FAIL',
    good: () => gradeProviderFailure({ finishReason: 'error:request-provider-failed:provider-error:server:503', traceReasons: ['provider-error:server:503'], expectFailure: true, interrupted: true }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '配置没共享必须判红',
    grade: () => gradeSettingsSharing({ ...SHARING_OK, providerReadBack: false }).verdict,
    expectBad: 'FAIL',
    good: () => gradeSettingsSharing(SHARING_OK).verdict,
    expectGood: 'PASS',
  },
  {
    label: '共享成立但动了真实用户配置，仍必须判红',
    grade: () => gradeSettingsSharing({ ...SHARING_OK, realProvidersLogUntouched: false }).verdict,
    expectBad: 'FAIL',
    good: () => gradeSettingsSharing(SHARING_OK).verdict,
    expectGood: 'PASS',
  },
  {
    label: 'SACODE_DATA_DIR 截走配置必须判红',
    grade: () => gradeSettingsSharing({ ...SHARING_OK, settingsCapturedByDataDir: ['D:/data-a/.sacode'] }).verdict,
    expectBad: 'FAIL',
    good: () => gradeSettingsSharing(SHARING_OK).verdict,
    expectGood: 'PASS',
  },
  {
    label: '没真起两个宿主进程必须判红',
    grade: () => gradeSettingsSharing({ ...SHARING_OK, distinctHostProcesses: false }).verdict,
    expectBad: 'FAIL',
    good: () => gradeSettingsSharing(SHARING_OK).verdict,
    expectGood: 'PASS',
  },
  {
    label: '守卫拒了却改了状态必须判红',
    grade: () => gradeGuardedMutation({ label: 'x', frame: { ok: false, code: -32001, message: 'turn-in-flight' }, stateBefore: 'build', stateAfter: 'plan', requested: 'plan' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeGuardedMutation({ label: 'x', frame: { ok: false, code: -32001, message: 'turn-in-flight' }, stateBefore: 'build', stateAfter: 'build', requested: 'plan' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '回 ok 却没改状态（假成功）必须判红',
    grade: () => gradeGuardedMutation({ label: 'x', frame: { ok: true, result: { ok: true, result: 'committed' } }, stateBefore: 'build', stateAfter: 'build', requested: 'plan' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeGuardedMutation({ label: 'x', frame: { ok: true, result: { ok: true, result: 'committed' } }, stateBefore: 'build', stateAfter: 'plan', requested: 'plan' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '屏障被验对象却放行了陈旧修订，必须判红',
    grade: () => gradeGuardedMutation({ label: 'x', frame: { ok: true, result: { saved: true } }, stateBefore: '正控改名', stateAfter: '迟到的改名', requested: '迟到的改名', requireRefusal: true }).verdict,
    expectBad: 'FAIL',
    good: () => gradeGuardedMutation({ label: 'x', frame: { ok: false, code: -32004, message: 'session-revision-conflict' }, stateBefore: '正控改名', stateAfter: '正控改名', requested: '迟到的改名', requireRefusal: true }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '传输层失败不许当成守卫结论',
    grade: () => gradeGuardedMutation({ label: 'x', frame: { ok: false, code: null, message: 'host-gone: exit code 1', transportError: true }, stateBefore: 'a', stateAfter: 'a', requested: 'b' }).verdict,
    expectBad: 'BLOCKED',
    good: () => gradeGuardedMutation({ label: 'x', frame: { ok: false, code: -32001, message: 'turn-in-flight' }, stateBefore: 'a', stateAfter: 'a', requested: 'b' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '正控成功却没生效必须判红（否则「全拒」宿主也能全绿）',
    grade: () => gradePositiveControl({ label: 'x', frame: { ok: true, result: { saved: true } }, stateBefore: '旧标题', stateAfter: '旧标题', expected: '新标题' }).verdict,
    expectBad: 'FAIL',
    good: () => gradePositiveControl({ label: 'x', frame: { ok: true, result: { saved: true } }, stateBefore: '旧标题', stateAfter: '新标题', expected: '新标题' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '正控调用本身失败必须判 BLOCKED，不许让守卫断言失去分母',
    grade: () => gradePositiveControl({ label: 'x', frame: { ok: false, code: -32601, message: 'method-not-found' }, stateBefore: 'a', stateAfter: 'a', expected: 'b' }).verdict,
    expectBad: 'BLOCKED',
    good: () => gradePositiveControl({ label: 'x', frame: { ok: true, result: {} }, stateBefore: 'a', stateAfter: 'b', expected: 'b' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '启动失败与真实退出码同时出现（互斥形态）必须判红',
    grade: () => gradeShellOutcome({ tool: 'bash', content: '{"error":"io-error:shell-bash:SANDBOX_UNAVAILABLE"}\n[shell-exit-code:1;timed-out:false;cancelled:false]' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeShellOutcome({ tool: 'bash', content: '{"error":"io-error:shell-bash:SANDBOX_UNAVAILABLE"}' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '启动失败原因是裸 io-error 必须判红',
    grade: () => gradeShellOutcome({ tool: 'pwsh', content: '{"error":"io-error:shell-pwsh"}' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeShellOutcome({ tool: 'pwsh', content: '{"error":"io-error:shell-pwsh:SANDBOX_UNAVAILABLE"}' }).verdict,
    expectGood: 'PASS',
  },
  {
    label: '启动失败原因不在固定枚举内（可能泄漏路径）必须判红',
    grade: () => gradeShellOutcome({ tool: 'pwsh', content: 'io-error:shell-pwsh:CreateProcess-failed-2' }).verdict,
    expectBad: 'FAIL',
    good: () => gradeShellOutcome({ tool: 'pwsh', content: 'io-error:shell-pwsh:SANDBOX_MODE_NOT_CONFINED' }).verdict,
    expectGood: 'PASS',
  },
];

// 五类 shell 结局的归类表：每条断言「这个形状必须归到这一桶」，
// 重点是那条最容易被误判的反例——合法程序、无输出、退出码 1。
const CLASSIFIER_CASES = [
  { label: '正常退出（有输出、无失败标记）', observe: () => gradeShellOutcome({ tool: 'bash', content: 'hello\n' }), expect: { verdict: 'PASS', bucket: 'exit-zero' } },
  { label: '反例：合法程序无输出且退出码 1 → 必须保住真实退出码，不得判成启动失败', observe: () => gradeShellOutcome({ tool: 'pwsh', content: '\n[shell-exit-code:1;timed-out:false;cancelled:false]' }), expect: { verdict: 'PASS', bucket: 'exit-nonzero' } },
  { label: '命令非零退出且有输出', observe: () => gradeShellOutcome({ tool: 'bash', content: 'boom\n[shell-exit-code:3;timed-out:false;cancelled:false]' }), expect: { verdict: 'PASS', bucket: 'exit-nonzero' } },
  { label: '可靠启动失败（沙箱后端不可用）', observe: () => gradeShellOutcome({ tool: 'pwsh', content: '{"error":"io-error:shell-pwsh:SANDBOX_UNAVAILABLE"}' }), expect: { verdict: 'PASS', bucket: 'launch-failure' } },
  { label: '可靠启动失败（模式未受限）', observe: () => gradeShellOutcome({ tool: 'bash', content: 'io-error:shell-bash:SANDBOX_MODE_NOT_CONFINED' }), expect: { verdict: 'PASS', bucket: 'launch-failure' } },
  { label: '超时', observe: () => gradeShellOutcome({ tool: 'pwsh', content: '部分输出\n[shell-exit-code:-1;timed-out:true;cancelled:false]' }), expect: { verdict: 'PASS', bucket: 'timeout' } },
  { label: '取消', observe: () => gradeShellOutcome({ tool: 'bash', content: '\n[shell-exit-code:-1;timed-out:false;cancelled:true]' }), expect: { verdict: 'PASS', bucket: 'cancelled' } },
  { label: '退出码 0 却带失败标记（verified 判定与正文不一致）', observe: () => gradeShellOutcome({ tool: 'bash', content: '\n[shell-exit-code:0;timed-out:false;cancelled:false]' }), expect: { verdict: 'FAIL', bucket: 'exit-zero-marked' } },
  { label: '互斥形态同时出现', observe: () => gradeShellOutcome({ tool: 'pwsh', content: 'io-error:shell-pwsh:SANDBOX_UNAVAILABLE\n[shell-exit-code:1;timed-out:false;cancelled:false]' }), expect: { verdict: 'FAIL', bucket: 'contradictory' } },
];

function runSelfTest() {
  log('== 反证模式：给每个检测器注入已知违规，看它是否真会判红 ==');
  let missed = 0;
  for (const item of SELF_TEST_CASES) {
    let bad = 'ERROR'; let good = 'ERROR'; let note = '';
    try { bad = item.grade(); } catch (error) { note = `违规侧抛异常 ${error?.message}`; }
    try { good = item.good(); } catch (error) { note = `${note} 合格侧抛异常 ${error?.message}`; }
    const caught = bad === item.expectBad && good === item.expectGood;
    if (!caught) missed += 1;
    log(`${caught ? 'CAUGHT ' : 'MISSED '} ${item.label} — 违规侧=${bad}（期望 ${item.expectBad}），合格侧=${good}（期望 ${item.expectGood}）${note ? ` ${note}` : ''}`);
  }
  log('\n== 归类表：每种 shell 结局形状必须归到自己那一桶 ==');
  for (const item of CLASSIFIER_CASES) {
    let actual = { verdict: 'ERROR' }; let note = '';
    try { actual = item.observe(); } catch (error) { note = `抛异常 ${error?.message}`; }
    const caught = actual.verdict === item.expect.verdict && actual.bucket === item.expect.bucket;
    if (!caught) missed += 1;
    log(`${caught ? 'CAUGHT ' : 'MISSED '} ${item.label} — 实得 ${actual.verdict}/${actual.bucket}（期望 ${item.expect.verdict}/${item.expect.bucket}）${note ? ` ${note}` : ''}`);
  }
  log('\n== 已声明依赖范围分诊：只有 host-binary 组件才跟 Host 产物比时间 ==');
  for (const item of SCOPE_CASES) {
    let actual = { stale: ['ERROR'], missing: ['ERROR'], others: -1 }; let note = '';
    try { actual = item.observe(); } catch (error) { note = `抛异常 ${error?.message}`; }
    const caught = JSON.stringify(actual) === JSON.stringify(item.expect);
    if (!caught) missed += 1;
    log(`${caught ? 'CAUGHT ' : 'MISSED '} ${item.label} — 实得 ${JSON.stringify(actual)}（期望 ${JSON.stringify(item.expect)}）${note ? ` ${note}` : ''}`);
  }
  log(missed === 0 ? '反证通过：每个检测器都对已知违规判红、对合格形状判绿，每种结局形状都归到自己那一桶，依赖范围分诊只让 host-binary 参与宿主新鲜度判定' : `反证失败：${missed} 条没抓住注入的违规、归错桶或分诊错组件`);
  return missed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const runStartedAtMs = Date.now();
  ensureLogDir();
  log(`== 第一批修复协议层验收 ==`);
  log(`仓库根：${repoRoot}`);
  // 取代旧轮次：只往旧目录**新增**一份 SUPERSEDED.md，绝不动它的 raw.log / report.json。
  for (const entry of supersedes) {
    const target = resolve(entry.dir);
    if (!existsSync(target)) { log(`警告：--supersedes 指向的目录不存在，无法标记：${target}`); continue; }
    let previous = null;
    try { previous = JSON.parse(readFileSync(join(target, 'report.json'), 'utf8')); } catch { /* 旧轮次可能没有报告 */ }
    const lines = [
      '# SUPERSEDED — 本轮次已被取代',
      '',
      `- 原轮次目录：${target}`,
      `- 原轮次生成时间：${previous?.generatedAt ?? '(未记录)'}`,
      `- 原宿主产物：${previous?.host?.path ?? '(未记录)'}`,
      `- 原宿主 sha256：${previous?.host?.sha256 ?? '(未记录)'}`,
      `- 原计数：${previous?.summary ? JSON.stringify(previous.summary) : '(未记录)'}`,
      `- 取代者报告：${reportPath}`,
      `- 取代者脚本：${scriptIdentity.path} sha256=${scriptIdentity.sha256}`,
      `- 取代／撤回原因：${entry.reason || '(未填写)'}`,
      '',
      '本目录的 raw.log 与 report.json 保持原样，是当时的原始证据，未被重写。',
      '本文件由后续轮次追加，仅用于标记与指向，不替代原报告。',
      '',
    ];
    writeFileSync(join(target, 'SUPERSEDED.md'), lines.join('\n'));
    log(`已标记旧轮次为 superseded：${join(target, 'SUPERSEDED.md')}（原 raw.log / report.json 未改动）`);
  }
  if (!hostIdentity) {
    log(`BLOCKED 宿主可执行文件不存在：${hostPath}`);
    log('解锁动作：设置 SACODE_HOST 指向本轮宿主，或先 cd apps/host && cjpm build 再 node scripts/pack-host.mjs');
    return 2;
  }
  log(`宿主产物：${hostIdentity.path}`);
  log(`宿主身份：sha256=${hostIdentity.sha256} bytes=${hostIdentity.bytes} mtime=${hostIdentity.mtime}`);
  const manifest = artifactManifest(dirname(hostPath));
  log(`产物清单：${manifest.dir} 共 ${manifest.fileCount} 个文件 ${manifest.totalBytes} 字节，清单摘要 sha256=${manifest.present ? manifest.digest : '(目录不存在)'}`);
  log(`验收脚本自身：${scriptIdentity.path} sha256=${scriptIdentity.sha256} bytes=${scriptIdentity.bytes} mtime=${scriptIdentity.mtime}`);
  const nativeDll = inspectNativeDll();
  if (nativeDll.present) {
    log(`原生薄层 DLL（运行期另行加载，不在 Host 二进制内）：DLL 与自身清单${nativeDll.dllMatchesManifest ? '一致' : '不一致'}；源码漂移 ${nativeDll.drifted.length} 条${nativeDll.staleAgainstOwnSources ? ' —— DLL 相对自己的源码已过时，即便打开强制隔离，跑到的也是旧薄层' : ''}`);
  } else {
    log(`原生薄层 DLL：${nativeDll.reason}`);
  }
  // 正式验收要求独立、固定的候选副本：共享构建输出随时可能被别的会话覆盖。
  const sharedBuildOutput = /[/\\](target|dist)[/\\]/.test(hostPath);
  const candidateIsolation = sharedBuildOutput ? 'shared-build-output' : 'independent-copy';
  if (sharedBuildOutput) {
    log('警告：SACODE_HOST 指向共享构建输出目录，其他会话可能随时覆盖它。正式验收须先把候选复制成独立固定副本、记下副本哈希再跑；本轮只能算「对该路径当时内容」的读数。');
  }
  log(`平台：${process.platform} node=${process.version} SACODE_WINDOWS_ENFORCING=${process.env.SACODE_WINDOWS_ENFORCING || '(未设)'} SACODE_WINDOWS_PROCESS_DLL=${process.env.SACODE_WINDOWS_PROCESS_DLL || '(未设)'}`);
  log(`原始日志：${rawLogPath}`);
  log(`产物新鲜度门禁：${allowStale ? '已放开（--allow-stale），过旧产物照跑但读数打标' : '严格（产物早于源码即判 BLOCKED）'}`);

  syntheticHome = join(logDir, 'home');
  mkdirSync(syntheticHome, { recursive: true });
  log(`合成用户目录：${syntheticHome}（不读写真实 ~/.sacode，不读取任何真实凭据）`);

  const results = [];
  for (const item of CHECKS) {
    if (only && !only.includes(item.id)) { log(`-- ${item.id} ${item.title} — 本轮按 --only 跳过`); continue; }
    log(`\n== 检查项 ${item.id}：${item.title} ==`);
    const declared = DECLARED_DEPENDENCIES[item.id] || [];
    const scope = evaluateDeclaredScope(declared, {
      hostMtimeMs: hostIdentity ? hostIdentity.mtimeMs : NaN,
      stat: (relative) => fileIdentity(join(repoRoot, relative)),
    });
    log('已声明依赖范围（手工表，非完整传递闭包）：');
    for (const dep of declared) {
      const identity = [...scope.staleHost, ...scope.otherComponents].find((row) => row.file === dep.file);
      log(`  [${dep.component}] ${dep.file}${dep.subject ? ` — 被测组件：${dep.subject}` : ''}${identity ? ` — sha256=${identity.sha256.slice(0, 12)} mtime=${identity.mtime}` : ' — (缺失)'}${dep.note ? `\n      注：${dep.note}` : ''}`);
    }
    const nonHost = scope.otherComponents.filter((row) => row.component !== 'host-binary');
    if (nonHost.length > 0) {
      log(`  提示：本项有 ${nonHost.length} 条依赖不属于 Host 二进制（${[...new Set(nonHost.map((r) => r.component))].join('、')}），Host 新鲜度门禁覆盖不到它们，其身份按内容哈希单独记录。`);
    }
    if (scope.missing.length > 0) {
      const names = scope.missing.map((d) => d.file).join('、');
      log(`BLOCKED 已声明依赖里有文件不存在，新鲜度门禁对本项失明：${names}`);
      results.push({ id: item.id, title: item.title, verdict: 'BLOCKED', detail: `已声明依赖里有文件不存在（${names}），无法判定产物是否过时，本项结论不成立`, evidence: { missingDependencies: scope.missing, declared } });
      continue;
    }
    const stale = scope.staleHost;
    if (stale.length > 0 && !allowStale) {
      const detail = stale.map((s) => `${s.file}（源码 ${s.mtime}）晚于宿主产物（${hostIdentity.mtime}）`).join('；');
      log(`BLOCKED host-binary 组件的源码晚于宿主产物：${detail}`);
      log('解锁动作：重打宿主后再判（cd apps/host && cjpm build → node scripts/pack-host.mjs <exe> <私有输出目录> <stdx-dll-dir> <runtime-dll-dir>），或设 SACODE_HOST 指向已含修复的产物。');
      results.push({ id: item.id, title: item.title, verdict: 'BLOCKED', detail: `宿主产物早于本项 host-binary 依赖源码，结论不成立：${detail}`, evidence: { staleHost: stale, declared, nonHostComponents: nonHost } });
      continue;
    }
    if (stale.length > 0) {
      log(`注意：--allow-stale 已开启。本项依赖的源码（${stale.map((s) => s.file).join('、')}）晚于宿主产物，读数只能用于定位，不是当前源码的验收结论。`);
    }
    const ctx = { dir: mkdtempSync(join(logDir, `check-${item.id}-`)), project: null };
    ctx.project = join(ctx.dir, 'project');
    mkdirSync(ctx.project, { recursive: true });
    writeFileSync(join(ctx.project, 'readme.txt'), '验收用合成项目\n');
    const startedAt = Date.now();
    let outcome;
    try {
      outcome = await item.run(ctx);
    } catch (error) {
      outcome = { verdict: 'BLOCKED', detail: `检查项自身抛异常，结论不成立：${error?.stack || error}`, evidence: {} };
      log(outcome.detail);
    }
    outcome.durationMs = Date.now() - startedAt;
    if (stale.length > 0) {
      // --allow-stale 只用于诊断：判决降级成 DIAG，原来的 PASS/FAIL/SKIP 退到 observedVerdict 里，
      // 汇总与报告都不许把它读成「当前修复通过/失败」。
      // BLOCKED 不降级：方法不在产物里、正控不成立这类是硬前提失败，与产物新旧无关。
      outcome.staleProduct = stale;
      outcome.observedVerdict = outcome.verdict;
      if (outcome.verdict !== 'BLOCKED') outcome.verdict = 'DIAG';
      outcome.detail = `【诊断读数，非当前修复结论：host-binary 依赖源码晚于宿主产物 —— ${stale.map((s) => s.file).join('、')}】观察到=${outcome.observedVerdict} — ${outcome.detail}`;
    }
    const shutdown = [ctx.stopped, ctx.stoppedGood, ctx.stoppedBad, ctx.stoppedA, ctx.stoppedB].filter(Boolean);
    outcome.evidence = {
      ...(outcome.evidence || {}),
      declaredScope: {
        note: '手工声明的依赖范围，非完整传递闭包；只有 host-binary 组件参与宿主新鲜度门禁',
        declared,
        staleHost: stale,
        nonHostComponents: nonHost.map((row) => ({ file: row.file, component: row.component, subject: row.subject ?? null, sha256: row.sha256, mtime: row.mtime })),
      },
      hostShutdown: shutdown,
    };
    const leaked = shutdown.filter((s) => s.forced === true || (s.code !== 0 && s.code !== null));
    if (leaked.length > 0) log(`注意：宿主未干净退出 ${JSON.stringify(leaked)}`);
    log(`${outcome.verdict} 检查项 ${item.id} — ${outcome.detail}`);
    results.push({ id: item.id, title: item.title, ...outcome });
  }

  // 运行后复取样：产物若在运行期间被并发会话换掉，本轮读数就混合了两个产物，
  // 不能作为任何固定候选的验收结果。注意这是**两次取样**，只能证明取样点上产物相同，
  // 不能严格证明运行期间从未被替换过（要那个保证只能用独立固定副本 + 运行期只读挂载）。
  const hostAfter = fileIdentity(hostPath);
  const manifestAfter = artifactManifest(dirname(hostPath));
  const hostChangedDuringRun = !hostAfter || hostAfter.sha256 !== hostIdentity.sha256;
  const manifestChangedDuringRun = manifestAfter.digest !== manifest.digest;
  const windowMs = Date.now() - runStartedAtMs;
  if (hostChangedDuringRun || manifestChangedDuringRun) {
    log(`警告：产物在运行期间改变了 —— exe 运行前 sha256=${hostIdentity.sha256}，运行后 sha256=${hostAfter ? hostAfter.sha256 : '(文件已消失)'}；清单摘要 ${manifest.digest} → ${manifestAfter.digest}；本轮读数不可作为固定候选的验收结果。`);
  } else {
    log(`运行前后两次取样一致：exe sha256=${hostAfter.sha256} bytes=${hostAfter.bytes}；清单摘要 ${manifestAfter.digest}（${manifestAfter.fileCount} 个文件）。运行窗口 ${windowMs}ms。`);
    log('说明：这只证明两个取样点上产物相同，不严格证明运行期间从未被替换；正式验收请用独立固定候选副本。');
  }

  const summary = { PASS: 0, FAIL: 0, SKIP: 0, BLOCKED: 0, DIAG: 0 };
  for (const row of results) summary[row.verdict] = (summary[row.verdict] || 0) + 1;
  const staleRows = results.filter((row) => row.staleProduct);
  const report = {
    generatedAt: new Date().toISOString(),
    scope: '第一批修复的协议层验收；只经 Host RPC，不启动 Electron 窗口，不算 GUI 验收',
    allowStale,
    // 被测组件身份：Host 二进制、它同目录的产物清单、本脚本自身、运行期另行加载的原生 DLL。
    host: hostIdentity,
    hostAfter,
    hostChangedDuringRun,
    artifactManifest: manifest,
    artifactManifestAfter: { dir: manifestAfter.dir, present: manifestAfter.present, fileCount: manifestAfter.fileCount, totalBytes: manifestAfter.totalBytes, digest: manifestAfter.digest },
    manifestChangedDuringRun,
    script: scriptIdentity,
    nativeThinLayerDll: nativeDll,
    candidateIsolation,
    candidateIsolationNote: candidateIsolation === 'shared-build-output'
      ? 'SACODE_HOST 指向共享构建输出，其他会话可能覆盖它；正式验收须用独立固定的候选副本'
      : 'SACODE_HOST 指向独立副本',
    // 两次取样一致只证明取样点相同，不严格证明运行期间从未被替换。
    hashSamplingCaveat: '运行前后各取样一次；一致只说明两个取样点上产物相同，不能严格证明运行期间从未被替换。要那个保证须用独立固定候选副本。',
    // 产物在运行期间变过＝本轮作废，不能当任何固定候选的验收结果。
    invalidated: hostChangedDuringRun || manifestChangedDuringRun,
    runWindowMs: windowMs,
    declaredDependencyScope: DECLARED_DEPENDENCIES,
    declaredDependencyScopeNote: '手工声明的依赖范围，不是完整传递闭包，也不做自动依赖分析；漏声明的文件门禁对它失明。只有 host-binary 组件参与宿主新鲜度门禁，其余组件按内容哈希单独记身份。',
    components: COMPONENTS,
    evidenceLedger: EVIDENCE_LEDGER,
    environment: {
      platform: process.platform, node: process.version, syntheticHome,
      privateCredentialsRead: false, realModelRequests: 0,
      windowsEnforcing: process.env.SACODE_WINDOWS_ENFORCING || null,
      windowsProcessDll: process.env.SACODE_WINDOWS_PROCESS_DLL || null,
    },
    checks: results,
    summary,
    staleProductChecks: staleRows.map((row) => ({ id: row.id, title: row.title, verdict: row.verdict, observedVerdict: row.observedVerdict ?? null, files: row.staleProduct.map((s) => s.file) })),
    frontendOnly: FRONTEND_ONLY,
    rawLog: rawLogPath,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('\n== 汇总 ==');
  for (const row of results) log(`${row.verdict.padEnd(7)} ${row.id} ${row.title}${row.staleProduct ? `（诊断读数，观察=${row.observedVerdict}）` : ''}`);
  log(`计数：PASS=${summary.PASS} FAIL=${summary.FAIL} SKIP=${summary.SKIP} BLOCKED=${summary.BLOCKED} DIAG=${summary.DIAG}`);
  log(`宿主产物取样：运行前 sha256=${hostIdentity.sha256}；运行后 sha256=${hostAfter ? hostAfter.sha256 : '(文件已消失)'}；清单摘要 ${manifest.digest} → ${manifestAfter.digest}；两次取样不一致=${hostChangedDuringRun || manifestChangedDuringRun}`);
  if (hostChangedDuringRun || manifestChangedDuringRun) log('本轮作废：读数混合了两个产物，不能作为固定候选的验收结果。');
  if (staleRows.length > 0) {
    log(`警告：${staleRows.length} 项（${staleRows.map((r) => r.id).join(',')}）判在早于源码的宿主产物上，判决一律记为 DIAG，只作诊断定位；不得读成「当前修复通过/失败」。重打宿主后复跑才出验收结论。`);
  }
  log('\n== 协议层覆盖不到、须走前端/GUI 单独验收 ==');
  for (const row of FRONTEND_ONLY) log(`- ${row.item} — ${row.why}（参照：${row.observedFrom}）`);
  log('\n== 证据台账（历史轮次；完整撤回原因见 report.json 的 evidenceLedger） ==');
  for (const row of EVIDENCE_LEDGER) log(`- ${row.runId} [${row.status}] ${row.kind} host=${(row.hostSha256 || '(未记录)').slice(0, 12)} 当轮计数：${row.reportedAtTheTime}`);
  log(`报告：${reportPath}`);
  log(`原始日志：${rawLogPath}`);
  if (hostChangedDuringRun || manifestChangedDuringRun || summary.BLOCKED > 0 || staleRows.length > 0) return 2;
  return summary.FAIL > 0 ? 1 : 0;
}

const exitCode = selfTestOnly ? runSelfTest() : await main();
process.stderr.write = stderrOriginal;
process.exit(exitCode);
