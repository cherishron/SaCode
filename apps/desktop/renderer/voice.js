// 语音输入：桌面采集层用 MediaRecorder 录音，解码后重采样为 16kHz 单声道 PCM WAV，
// 交给主进程写进本会话隔离目录 voice/v1/，再由宿主 voice/record 按固定命名「导入登记」，
// 随后由宿主按规范参数发转写工单，用户「允许一次」后启动异步转写（voice/transcribe），
// 结果文本只写入草稿（可 Ctrl+Z 撤销），永不自动发送——替用户说话的是发送，不是转写。
// ASR 未配置时宿主 fail-closed，界面如实提示，不假装录到了文字。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  const TARGET_RATE = 16000;
  const MAX_RECORD_MS = 60000;

  // 单声道 Float32 采样 → 16-bit PCM WAV（44 字节 RIFF 头）。纯确定性编码。
  function encodeWav(samples) {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const put = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    put(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); put(8, 'WAVE');
    put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0, p = 44; i < samples.length; i++, p += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return bytes;
  }

  // 有界 base64（分批 fromCharCode，避免超长参数导致调用栈溢出）。
  function toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return root.btoa(binary);
  }

  // 解码录到的音轨并重采样到 16kHz 单声道；任一步失败返回 null（不写盘、不假装成功）。
  async function toPcm(blob) {
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!AudioCtx || !Offline) return null;
    const array = await blob.arrayBuffer();
    const decodeCtx = new AudioCtx();
    let decoded = null;
    try { decoded = await decodeCtx.decodeAudioData(array); } catch (_) { decoded = null; }
    try { if (decodeCtx.close) await decodeCtx.close(); } catch (_) {}
    if (!decoded || !decoded.length) return null;
    const frames = Math.max(1, Math.round(decoded.length * TARGET_RATE / decoded.sampleRate));
    const offline = new Offline(1, frames, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  }

  // 把宿主/主进程的稳定失败分类翻成可行动的中文；未知错误只回显一句话，不外泄路径。
  function failureText(e) {
    const raw = String((e && e.message) || e || '');
    const known = [
      ['voice-asr-not-configured', '未配置语音转写提供方，录音已保留但无法转写。'],
      ['voice-model-not-configured', '未配置语音模型，无法增强。'],
      ['voice-credential-unavailable', '语音提供方凭据不可用。'],
      ['not-authorized:voice-approval', '转写未获授权，录音已保留。'],
      ['voice-recording-not-found', '录音登记失败，文件未就绪。'],
      ['voice-record-not-available', '当前宿主不支持语音录制。'],
      ['voice-bad-recording', '录音格式或长度不被接受，未写盘。'],
      ['voice-session-changed', '会话已切换，本次语音操作作废。'],
      ['host-unavailable', '宿主未连接，无法转写。'],
      ['ipc-invalid-arguments', '语音参数未通过校验。'],
    ];
    return known.find(([key]) => raw.includes(key))?.[1] || (raw || '语音操作失败，请重试。');
  }

  function createVoiceAssembly({ ref, getSessionId, getSessionGeneration, focusComposerCaret, error, announceApproval }) {
    // status: idle | requesting | recording | processing | approval | running | error
    const voice = ref({ status: 'idle', message: '', seconds: 0 });
    let recorder = null, stream = null, chunks = [], startedAt = 0, ticker = null, epoch = 0;
    let pending = null; // { requestId, recordingId, language, approvalId, generation }

    const current = value => value === epoch;
    const alive = generation => generation === getSessionGeneration();

    function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }
    function releaseStream() { if (stream) { try { stream.getTracks().forEach(t => t.stop()); } catch (_) {} stream = null; } }
    function setStage(status, message) { voice.value = { status, message: message || '', seconds: voice.value.seconds }; }
    function setIdle() { voice.value = { status: 'idle', message: '', seconds: 0 }; }
    function recorderSupported() {
      return !!(root.navigator && root.navigator.mediaDevices && root.navigator.mediaDevices.getUserMedia) &&
        !!(root.MediaRecorder || root.webkitMediaRecorder);
    }
    function token(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`; }

    function dispose() {
      epoch += 1; stopTicker(); releaseStream();
      if (recorder) { try { recorder.onstop = null; recorder.stop(); } catch (_) {} recorder = null; }
    }

    function cancel() {
      const hadWork = voice.value.status !== 'idle';
      epoch += 1; stopTicker();
      if (recorder) { try { recorder.onstop = null; recorder.stop(); } catch (_) {} recorder = null; }
      releaseStream();
      const held = pending; pending = null;
      if (held && held.operationId) { void window.sacode.voiceTranscribeCancel(String(held.sessionId), held.operationId).catch(() => {}); }
      if (hadWork) { setIdle(); }
    }

    async function start() {
      if (voice.value.status !== 'idle' && voice.value.status !== 'error') return;
      if (!recorderSupported()) { setStage('error', '当前环境不支持录音采集。'); return; }
      const gen = getSessionGeneration();
      const mine = ++epoch;
      const Recorder = root.MediaRecorder || root.webkitMediaRecorder;
      setStage('requesting', '请在系统弹窗中允许使用麦克风…');
      let got;
      try { got = await root.navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (_) { if (current(mine)) setStage('error', '无法访问麦克风：未获得权限或没有可用设备。'); return; }
      if (!current(mine) || !alive(gen)) { try { got.getTracks().forEach(t => t.stop()); } catch (_) {} return; }
      stream = got; chunks = []; recorder = null;
      try { recorder = new Recorder(stream); }
      catch (_) { releaseStream(); setStage('error', '无法开始录音。'); return; }
      if (typeof Recorder.isTypeSupported === 'function') {
        for (const type of ['audio/webm;codecs=opus', 'audio/webm']) {
          if (Recorder.isTypeSupported(type)) { try { recorder = new Recorder(stream, { mimeType: type }); } catch (_) {} break; }
        }
      }
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => { void finalize(mine); };
      try { recorder.start(); }
      catch (_) { releaseStream(); recorder = null; setStage('error', '无法开始录音。'); return; }
      startedAt = Date.now();
      voice.value = { status: 'recording', message: '', seconds: 0 };
      ticker = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        voice.value = { status: 'recording', message: '', seconds };
        if (Date.now() - startedAt >= MAX_RECORD_MS) { stopRecording(); }
      }, 250);
    }

    function stopRecording() {
      if (voice.value.status !== 'recording') return;
      stopTicker();
      setStage('processing', '正在处理录音…');
      const rec = recorder;
      if (!rec) { void finalize(epoch); return; }
      try { rec.stop(); } catch (_) { void finalize(epoch); }
    }

    async function finalize(mine) {
      releaseStream();
      if (!current(mine)) return;
      stopTicker();
      const type = (recorder && recorder.mimeType) || 'audio/webm';
      const blob = new Blob(chunks, { type });
      chunks = []; recorder = null;
      if (!blob.size) { setStage('error', '没有录到音频，请重试。'); return; }
      const gen = getSessionGeneration();
      const sessionId = getSessionId();
      let pcm = null;
      try { pcm = await toPcm(blob); } catch (_) { pcm = null; }
      if (!current(mine)) return;
      if (!pcm || !pcm.length) { setStage('error', '录音解码失败；本次录音未保存。'); return; }
      const wav = encodeWav(pcm);
      const recordingId = token('vr');
      const durationMs = Math.max(1, Math.round(pcm.length * 1000 / TARGET_RATE));
      setStage('processing', '正在保存录音…');
      try { await window.sacode.voiceRecord(sessionId, recordingId, recordingId, toBase64(wav), durationMs); }
      catch (e) { if (current(mine) && alive(gen)) setStage('error', failureText(e)); return; }
      if (!current(mine) || !alive(gen)) return;
      await requestApproval(mine, gen, sessionId, recordingId);
    }

    async function requestApproval(mine, gen, sessionId, recordingId) {
      const requestId = token('vt');
      setStage('processing', '正在申请转写授权…');
      let ticket;
      try { ticket = await window.sacode.voiceTranscribe(sessionId, requestId, recordingId, 'zh'); }
      catch (e) { if (current(mine) && alive(gen)) setStage('error', failureText(e)); return; }
      if (!current(mine) || !alive(gen)) return;
      if (!ticket || ticket.state !== 'pending-approval' || !Number.isSafeInteger(ticket.approvalId) || ticket.approvalId < 1) {
        setStage('error', '宿主未返回转写工单，请重试。'); return;
      }
      pending = { sessionId, requestId, recordingId, language: 'zh', approvalId: ticket.approvalId, generation: gen, epoch: mine, operationId: '' };
      setStage('approval', '等待转写授权：请在工具审批中允许一次或拒绝。');
      if (typeof announceApproval === 'function') {
        announceApproval({ source: 'voice-transcribe', name: 'voice/transcribe', args: '', approvalId: ticket.approvalId });
      }
    }

    // 审批应答后由 tool-approval-state 调回：允许一次则启动转写并轮询，否则作废本次录音。
    async function resume(approvalId, decision) {
      const held = pending;
      pending = null;
      if (!held || held.approvalId !== approvalId) return;
      if (!alive(held.generation) || !current(held.epoch)) return;
      if (decision !== 'allowed-once') { setIdle(); if (error) error.value = ''; return; }
      setStage('running', '正在转写…');
      let op;
      try { op = await window.sacode.voiceTranscribe(held.sessionId, held.requestId, held.recordingId, held.language, approvalId); }
      catch (e) { if (alive(held.generation) && current(held.epoch)) setStage('error', failureText(e)); return; }
      if (!alive(held.generation) || !current(held.epoch)) return;
      const operationId = op && typeof op.operationId === 'string' ? op.operationId : '';
      if (!operationId) { setStage('error', '宿主未返回转写身份，请重试。'); return; }
      held.operationId = operationId;
      await poll(held, operationId, Date.now());
    }

    async function poll(held, operationId, startedAtMs) {
      if (Date.now() - startedAtMs > 130000) { setStage('error', '转写超时，录音已保留。'); return; }
      let state;
      try { state = await window.sacode.voiceDescribe(held.sessionId, operationId); }
      catch (e) { if (alive(held.generation) && current(held.epoch)) setStage('error', failureText(e)); return; }
      if (!alive(held.generation) || !current(held.epoch)) return;
      if (!state || typeof state.state !== 'string') { setStage('error', '转写状态响应无效。'); return; }
      const terminal = state.state === 'succeeded' || state.state === 'failed' || state.state === 'cancelled';
      if (!terminal || state.settlementState !== 'settled') {
        setTimeout(() => { void poll(held, operationId, startedAtMs); }, 150);
        return;
      }
      if (state.state !== 'succeeded' || state.resultAvailable !== true || typeof state.text !== 'string' || !state.text.trim()) {
        setStage('error', state.failureKind
          ? failureText({ message: `voice-${state.failureKind}` })
          : '转写没有返回可用文本，录音已保留。');
        return;
      }
      // 只写入草稿并建立撤销记录，绝不自动发送；此前的增强回退随之作废。
      const composer = document.getElementById('composer');
      if (!composer || !window.SaCodeComposerEdit || !window.SaCodeComposerEdit.replace(composer, state.text)) {
        setStage('error', '输入框无法建立撤销记录，转写文本未写入。'); return;
      }
      setIdle();
      if (error) error.value = '';
      if (typeof focusComposerCaret === 'function') focusComposerCaret();
    }

    function click() {
      switch (voice.value.status) {
        case 'idle': void start(); break;
        case 'error': void start(); break;
        case 'recording': stopRecording(); break;
        default: cancel(); break;
      }
    }

    return { voice, click, cancel, dispose, resume, start };
  }

  root.SaCodeVoice = { createVoiceAssembly, encodeWav, toBase64, failureText };
})(globalThis);