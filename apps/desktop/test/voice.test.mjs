import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../renderer/voice.js', import.meta.url), 'utf8');

// 在隔离上下文里装载经典脚本，注入最小采集/解码桩；不启动真实麦克风、不联网、不调用真实宿主。
function loadVoice(overrides = {}) {
  const calls = { send: 0, record: [], transcribe: [], describe: [], cancel: [], announce: [], replaced: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, String, Number, Boolean,
    Object, Array, Error, TypeError, Promise, Uint8Array, DataView, ArrayBuffer, Float32Array, Blob, btoa,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    MediaRecorder: class {
      static isTypeSupported() { return false; }
      constructor(stream) { this.stream = stream; this.mimeType = 'audio/webm'; }
      start() { this.started = true; }
      stop() {
        if (this._stopped) return;
        this._stopped = true;
        if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], { type: 'audio/webm' }) });
        if (this.onstop) this.onstop();
      }
    },
    AudioContext: class { constructor() {} decodeAudioData() { return Promise.resolve({ length: 3200, sampleRate: 16000 }); } close() { return Promise.resolve(); } },
    OfflineAudioContext: class {
      constructor(channels, length, rate) { this.len = length; this.rate = rate; }
      get destination() { return {}; }
      createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
      startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(this.len) }); }
    },
    document: { getElementById: id => (id === 'composer' ? { id: 'composer' } : null) },
    window: {
      sacode: {
        voiceRecord: async (...args) => { calls.record.push(args); return {}; },
        voiceTranscribe: async (...args) => {
          calls.transcribe.push(args);
          return args.length >= 5 ? { operationId: 'op-1', state: 'admitted' } : { state: 'pending-approval', approvalId: 7, recordingId: args[2] };
        },
        voiceDescribe: async (...args) => { calls.describe.push(args); return { state: 'succeeded', settlementState: 'settled', resultAvailable: true, text: '你好世界' }; },
        voiceTranscribeCancel: async (...args) => { calls.cancel.push(args); return {}; },
        send: async () => { calls.send += 1; return {}; },
      },
      SaCodeComposerEdit: { replace: (el, text) => { calls.replaced.push(text); return true; } },
      ...overrides.window,
    },
    ...overrides.global,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { voice: sandbox.SaCodeVoice, calls, sandbox };
}

test('encodeWav 输出带正确尺寸的 16kHz 单声道 16-bit PCM 头', () => {
  const { voice } = loadVoice();
  const samples = new Float32Array([0, 0.5, -0.5, 1]);
  const wav = voice.encodeWav(samples);
  assert.equal(wav.length, 44 + samples.length * 2);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(String.fromCharCode(...wav.subarray(12, 16)), 'fmt ');
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, '单声道');
  assert.equal(view.getUint32(24, true), 16000, '采样率');
  assert.equal(view.getUint16(34, true), 16, '位深');
  assert.equal(view.getUint32(40, true), samples.length * 2, 'data 长度');
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2, 'RIFF 长度');
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), 16383);
  assert.equal(view.getInt16(48, true), -16384);
});

test('failureText 把稳定失败分类翻成可行动中文', () => {
  const { voice } = loadVoice();
  assert.match(voice.failureText({ message: 'voice-asr-not-configured' }), /未配置语音转写提供方/);
  assert.match(voice.failureText({ message: 'not-authorized:voice-approval' }), /未获授权/);
  assert.match(voice.failureText({ message: 'host-unavailable' }), /宿主未连接/);
  assert.equal(voice.failureText({ message: 'something-else' }), 'something-else');
});

test('无采集能力时不假装录音，直接报不可用', async () => {
  const { voice } = loadVoice({ global: { navigator: {} } });
  const assembly = voice.createVoiceAssembly({ ref: v => ({ value: v }), getSessionId: () => 'current', getSessionGeneration: () => 0, focusComposerCaret() {}, error: { value: '' }, announceApproval() {} });
  await assembly.start();
  assert.equal(assembly.voice.value.status, 'error');
  assert.match(assembly.voice.value.message, /不支持录音采集/);
});

test('录音→登记→待审批→允许→转写文本只写入草稿且不自动发送', async () => {
  const { voice, calls } = loadVoice();
  const announcements = [];
  const assembly = voice.createVoiceAssembly({
    ref: v => ({ value: v }), getSessionId: () => 'current', getSessionGeneration: () => 0,
    focusComposerCaret() {}, error: { value: '' }, announceApproval: info => announcements.push(info),
  });
  await assembly.start();
  assert.equal(assembly.voice.value.status, 'recording');
  assembly.click();                       // 停止录音 → 封存 → 登记 → 发号
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.record.length, 1, '录音必须登记一次');
  assert.equal(calls.record[0][3].length > 0, true, '必须带 WAV base64');
  assert.equal(assembly.voice.value.status, 'approval');
  assert.deepEqual(announcements.map(a => a.source), ['voice-transcribe']);
  assert.equal(announcements[0].approvalId, 7);

  await assembly.resume(7, 'allowed-once');
  assert.equal(calls.transcribe.length, 2, '先发号再带票重试');
  assert.equal(calls.transcribe[1][4], 7, '重试必须携带同一工单号');
  assert.equal(calls.describe.length >= 1, true);
  assert.deepEqual(calls.replaced, ['你好世界'], '转写文本写入草稿');
  assert.equal(calls.send, 0, '绝不自动发送');
  assert.equal(assembly.voice.value.status, 'idle');
});

test('拒绝转写时不启动，也不写入草稿', async () => {
  const { voice, calls } = loadVoice();
  const assembly = voice.createVoiceAssembly({ ref: v => ({ value: v }), getSessionId: () => 'current', getSessionGeneration: () => 0, focusComposerCaret() {}, error: { value: '' }, announceApproval() {} });
  await assembly.start();
  assembly.click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(assembly.voice.value.status, 'approval');
  await assembly.resume(7, 'denied');
  assert.equal(calls.transcribe.length, 1, '拒绝后不再重试');
  assert.deepEqual(calls.replaced, []);
  assert.equal(assembly.voice.value.status, 'idle');
});