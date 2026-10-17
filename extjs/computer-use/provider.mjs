import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

export const MAX_FRAME_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_PENDING = 256;
const METHODS = Object.freeze({
  'windows.list': 'listWindows', 'windows.get': 'getWindow', 'window.observe': 'observeWindow',
  click: 'click', double_click: 'doubleClick', right_click: 'rightClick', drag: 'drag',
  scroll: 'scroll', type: 'typeText', press_key: 'pressKey', hotkey: 'hotkey',
  set_value: 'setValue', verify_state: 'verifyState',
});
const READS = new Set(['windows.list', 'windows.get', 'window.observe', 'verify_state']);
const POINTS = new Set(['click', 'double_click', 'right_click', 'scroll']);
const FORBIDDEN = /^(?:__proto__|prototype|constructor|.*path.*|.*file.*|shell|command|script|javascript|js|eval|signal)$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const idValid = id => Number.isSafeInteger(id) && id > 0;
const surface = args => `${args.pid}:${args.windowId}`;
class Failure extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
function invalid(message) { throw new Failure('invalid-params', message); }
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${name} 超出整数范围 ${min}..${max}`);
}
function string(value, name, max = 256, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) invalid(`${name} 字符串不合法或过长`);
}
function fields(value, allowed, name) {
  if (!object(value)) invalid(`${name} 必须是 JSON 对象`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${name} 不允许字段 ${key}`);
}
function jsonPredicate(value, depth = 0) {
  if (depth > 8) invalid('expect 嵌套过深');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') { string(value, 'expect 值', 4096, true); return; }
  if (Array.isArray(value)) {
    if (value.length > 64) invalid('expect 数组过长');
    for (const item of value) jsonPredicate(item, depth + 1);
    return;
  }
  if (!object(value) || Object.keys(value).length > 32) invalid('expect 必须是有界 JSON');
  for (const [key, item] of Object.entries(value)) {
    string(key, 'expect 字段', 128);
    if (FORBIDDEN.test(key)) invalid(`expect 不允许字段 ${key}`);
    jsonPredicate(item, depth + 1);
  }
}
function validate(verb, args) {
  if (!Object.hasOwn(METHODS, verb)) throw new Failure('unknown-verb', '未支持的 computer verb');
  const common = ['pid', 'windowId'];
  const input = [...common, 'observationId'];
  const exact = [...input, 'elementToken'];
  const point = [...exact, 'x', 'y'];
  const delivery = ['deliveryMode'];
  const schemas = {
    'windows.list': ['pid', 'onScreenOnly'], 'windows.get': common,
    'window.observe': [...common, 'disableDiff', 'includeScreenshot', 'maxElements', 'maxDepth', 'maxTextChars'],
    click: [...point, ...delivery, 'button', 'count'], double_click: [...point, ...delivery],
    right_click: [...point, ...delivery, 'modifier'],
    drag: [...input, ...delivery, 'fromX', 'fromY', 'toX', 'toY', 'durationMs', 'steps', 'button', 'modifier'],
    scroll: [...point, ...delivery, 'direction', 'by', 'amount'],
    type: [...exact, ...delivery, 'text', 'delayMs'], press_key: [...exact, ...delivery, 'key', 'modifiers'],
    hotkey: [...exact, ...delivery, 'keys'], set_value: [...exact, 'value'],
    verify_state: [...common, 'expect', 'timeoutMs', 'stableSamples', 'includeScreenshot'],
  };
  fields(args, schemas[verb], 'args');
  if (verb !== 'windows.list' || Object.hasOwn(args, 'pid')) integer(args.pid, 1, 0xffffffff, 'pid');
  if (verb !== 'windows.list') integer(args.windowId, 1, Number.MAX_SAFE_INTEGER, 'windowId');
  const writing = !READS.has(verb);
  if (writing) {
    string(args.observationId, 'observationId', 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.observationId)) invalid('observationId 必须是 UUID');
  }
  if (Object.hasOwn(args, 'elementToken')) string(args.elementToken, 'elementToken', 4096);
  if (POINTS.has(verb)) {
    if (Object.hasOwn(args, 'elementToken')) {
      if (Object.hasOwn(args, 'x') || Object.hasOwn(args, 'y')) invalid('token 与坐标互斥');
    } else if (!Object.hasOwn(args, 'x') || !Object.hasOwn(args, 'y')) invalid('需要 token 或完整坐标');
  }
  if (verb === 'set_value' && !Object.hasOwn(args, 'elementToken')) invalid('set_value 必须提供 token');
  const ranges = { count: [1, 3], durationMs: [0, 10000], steps: [1, 200], amount: [1, 50], delayMs: [0, 10000], timeoutMs: [0, 10000], stableSamples: [1, 5], maxElements: [1, 100000], maxDepth: [1, 256], maxTextChars: [512, 262144] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (Object.hasOwn(args, key)) integer(args[key], min, max, key);
  const enums = { button: ['left', 'right', 'middle'], deliveryMode: ['background', 'foreground'], direction: ['up', 'down', 'left', 'right'], by: ['line', 'page'] };
  for (const [key, values] of Object.entries(enums)) if (Object.hasOwn(args, key) && !values.includes(args[key])) invalid(`${key} 值不合法`);
  if (verb === 'scroll' && !Object.hasOwn(args, 'direction')) invalid('scroll 缺少 direction');
  for (const key of ['includeScreenshot', 'onScreenOnly']) if (Object.hasOwn(args, key) && typeof args[key] !== 'boolean') invalid(`${key} 必须是布尔值`);
  if (Object.hasOwn(args, 'disableDiff') && args.disableDiff !== true) invalid('禁止增量观察');
  for (const key of ['modifier', 'modifiers', 'keys']) if (Object.hasOwn(args, key)) {
    const value = args[key];
    if (!Array.isArray(value) || value.length > 8 || value.length < (key === 'keys' ? 2 : 0)) invalid(`${key} 数组不合法`);
    for (const entry of value) string(entry, key, 64);
  }
  if (verb === 'hotkey' && !Object.hasOwn(args, 'keys')) invalid('hotkey 缺少 keys');
  if (verb === 'press_key') string(args.key, 'key', 64);
  if (verb === 'type') string(args.text, 'text', 65536, true);
  if (verb === 'set_value') string(args.value, 'value', 65536, true);
  if (verb === 'verify_state') {
    if (!Array.isArray(args.expect) || args.expect.length < 1 || args.expect.length > 64) invalid('expect 需要 1..64 条谓词');
    for (const predicate of args.expect) {
      if (!object(predicate)) invalid('谓词必须是 JSON 对象');
      // SDK 公共契约为 JsonObject[]；只传声明式有界 JSON，不推测原生谓词语法。
      jsonPredicate(predicate);
    }
  }
  if (Buffer.byteLength(JSON.stringify(args)) > MAX_FRAME_BYTES / 2) invalid('args 超出大小上限');
}
function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry));
}
function result(ok, verb, content = {}, failureKind = '', message = '') { return { ok, verb, content, failureKind: failureKind ?? '', message }; }

export class ComputerUseProvider {
  #client;
  #createClient;
  #initialization;
  #tail = Promise.resolve();
  #pending = new Map();
  #observations = new Map();
  #closed = false;
  #closing;
  #maxResponseBytes;
  #closeTimeoutMs;
  constructor({ client, createClient, maxResponseBytes = MAX_RESPONSE_BYTES, closeTimeoutMs = 2000 } = {}) {
    integer(maxResponseBytes, 1024, 64 * 1024 * 1024, 'maxResponseBytes');
    integer(closeTimeoutMs, 1, 10000, 'closeTimeoutMs');
    this.#closeTimeoutMs = closeTimeoutMs;
    this.#client = client;
    this.#createClient = createClient ?? (async signal => {
      const { ComputerUse } = await import('@qwen-code/cua-sdk/computer-use');
      return ComputerUse.create({ signal });
    });
    this.#maxResponseBytes = maxResponseBytes;
  }
  async #ready(signal) {
    if (this.#client) return this.#client;
    this.#initialization ??= Promise.resolve().then(() => this.#createClient(signal)).then(client => {
      if (!client || typeof client.close !== 'function') throw new Error('SDK client 初始化结果不合法');
      this.#client = client; return client;
    });
    try { return await this.#initialization; }
    catch { throw new Failure('provider-unavailable', 'CUA SDK 缺失或初始化失败'); }
  }
  #consume(args) {
    const key = surface(args);
    if (this.#observations.get(key)?.id === args.observationId) this.#observations.delete(key);
  }
  #binding(args, verb, client) {
    const observation = this.#observations.get(surface(args));
    if (!observation || observation.id !== args.observationId || observation.generation !== client.connectionGeneration) {
      throw new Failure('stale-observation', '观察已过期、已消费或不属于该窗口');
    }
    if (args.elementToken !== undefined && !observation.tokens.has(args.elementToken)) throw new Failure('stale-observation', 'token 不在当前完整观察内');
    const check = (x, y) => {
      const { width, height } = observation;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) invalid('坐标超出观察截图范围或截图尺寸未知');
    };
    if (POINTS.has(verb) && args.elementToken === undefined) check(args.x, args.y);
    if (verb === 'drag') { check(args.fromX, args.fromY); check(args.toX, args.toY); }
  }
  invoke(requestId, params) {
    const verb = typeof params?.verb === 'string' ? params.verb : '';
    if (this.#closed) return Promise.resolve(result(false, verb, {}, 'provider-closed', 'provider 已停止准入'));
    try {
      if (!idValid(requestId) || this.#pending.has(requestId)) invalid('请求 id 必须唯一且为正安全整数');
      if (this.#pending.size >= MAX_PENDING) throw new Failure('provider-busy', '请求队列已满');
      fields(params, ['verb', 'args'], 'params'); string(params.verb, 'verb', 64);
      validate(params.verb, params.args);
      params = jsonCopy(params);
    } catch (error) { return Promise.resolve(result(false, verb, {}, error.kind ?? 'invalid-params', error.message)); }
    const controller = new AbortController();
    const record = { controller, verb, args: params.args };
    this.#pending.set(requestId, record);
    const task = this.#tail.then(async () => {
      const { args } = record;
      const writing = !READS.has(verb);
      try {
        if (controller.signal.aborted) { if (writing) this.#consume(args); throw new Failure('cancelled', '投递前已取消'); }
        const client = await this.#ready(controller.signal);
        if (controller.signal.aborted) { if (writing) this.#consume(args); throw new Failure('cancelled', '投递前已取消'); }
        const method = METHODS[verb];
        if (typeof client[method] !== 'function') throw new Failure('provider-unavailable', 'SDK 缺少所需方法');
        if (writing) this.#binding(args, verb, client);
        const options = { ...args, signal: controller.signal }; delete options.observationId;
        if (verb === 'window.observe') {
          this.#observations.delete(surface(args));
          options.disableDiff = true;
          options.includeScreenshot ??= true;
        }
        // 输入投递之前不可逆消费；取消后仍等待 SDK 真实结算，不自行宣称回滚。
        if (writing) {
          const observation = this.#observations.get(surface(args));
          this.#consume(args);
          // 公共 SDK 没有窗口 epoch；不能用 pid/windowId 或标题证明身份未替换。
          // 重取完整 token 集作为保守连续性证明，无 token 时拒绝写入；原生仍须最终校验 token。
          const current = await client.observeWindow({ pid: args.pid, windowId: args.windowId, disableDiff: true, includeScreenshot: false, signal: controller.signal });
          const tokens = new Set(current?.elements?.map(element => element.element_token).filter(token => typeof token === 'string' && token.length > 0));
          if (client.connectionGeneration !== observation.generation || current?.mode !== 'full' || current.pid !== args.pid || current.windowId !== args.windowId || !tokens.size || tokens.size !== observation.tokens.size || [...tokens].some(token => !observation.tokens.has(token))) {
            throw new Failure('stale-observation', '窗口 epoch 连续性无法确认，需重新观察');
          }
          if (controller.signal.aborted) throw new Failure('cancelled', '投递前已取消');
        }
        let value = await client[method](options);
        if (verb === 'windows.list') value = { windows: value };
        if (!object(value)) throw new Failure('sdk-error', 'SDK 返回的结构不是对象');
        if (verb === 'window.observe') {
          if (value.mode !== 'full' || value.pid !== args.pid || value.windowId !== args.windowId || !Array.isArray(value.elements)) throw new Failure('invalid-observation', 'SDK 未返回匹配窗口的完整观察');
          value = { ...value, observationId: randomUUID() };
        }
        // 动作只认 confirmed；验证结果是独立的 status/stable 契约。
        const ok = writing ? value.effect === 'confirmed' : verb === 'verify_state' ? value.status === 'satisfied' && value.stable === true : true;
        const failureKind = ok ? null : writing && value.effect === 'refused' && value.operation?.dispatched !== true ? 'action-refused' : 'action-unverified';
        const response = this.#bounded(result(ok, verb, value, failureKind));
        if (verb === 'window.observe' && response.ok && !controller.signal.aborted) {
          this.#observations.set(surface(args), {
            id: value.observationId, generation: client.connectionGeneration,
            tokens: new Set(value.elements.map(element => element.element_token).filter(token => typeof token === 'string' && token.length > 0)),
            width: value.screenshot?.width, height: value.screenshot?.height,
          });
        }
        return response;
      } catch (error) {
        let content = {};
        if (object(error.details)) content = error.details;
        try { return this.#bounded(result(false, verb, content, error.kind ?? (error.code === 'call_cancelled' ? 'cancelled' : 'sdk-error'), String(error.message ?? 'SDK 调用失败').slice(0, 2048))); }
        catch { return result(false, verb, {}, 'response-too-large', '响应不可序列化或超过大小上限'); }
      } finally { this.#pending.delete(requestId); }
    });
    this.#tail = task.then(() => undefined, () => undefined);
    return task;
  }
  #bounded(response) {
    try {
      const copy = jsonCopy(response);
      if (Buffer.byteLength(JSON.stringify(copy)) + 128 <= this.#maxResponseBytes) return copy;
    } catch { /* 不可序列化正文也不能抹掉可读取的终局证据。 */ }
    const content = {};
    const source = response.content;
    const pick = (from, keys) => {
      const picked = {};
      if (!object(from)) return picked;
      for (const key of keys) {
        const value = from[key];
        if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && Buffer.byteLength(value) <= 64)) picked[key] = value;
      }
      return picked;
    };
    if (object(source)) {
      Object.assign(content, pick(source, ['effect', 'route']));
      if (object(source.operation)) content.operation = pick(source.operation, ['id', 'state', 'dispatched', 'committed', 'cancellationRequested']);
      if (object(source.delivery)) content.delivery = pick(source.delivery, ['mode', 'delivered_count']);
    }
    // 超限只表示正文传输失败，不表示取消、未提交或回滚。
    return result(false, response.verb, content, 'response-too-large', '响应正文不可序列化或超限；保留有界终局证据，不代表回滚');
  }
  cancel(requestId) {
    if (!idValid(requestId)) return result(false, 'cancel', {}, 'invalid-params', 'requestId 必须是正安全整数');
    const record = this.#pending.get(requestId);
    if (record) {
      record.controller.abort();
      if (!READS.has(record.verb)) this.#consume(record.args);
    }
    return result(true, 'cancel', { requestId, cancellationRequested: Boolean(record) });
  }
  close() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const record of this.#pending.values()) record.controller.abort();
    this.#observations.clear();
    let timer;
    const settled = this.#tail.then(async () => { if (this.#client) await this.#client.close(); });
    this.#closing = Promise.race([
      settled,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Failure('outcome-unknown', '关闭超时，不能确认原生副作用停止；不能宣称取消回滚')), this.#closeTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    return this.#closing;
  }
}

export async function runStdio({ input = process.stdin, output = process.stdout, provider = new ComputerUseProvider(), maxFrameBytes = MAX_FRAME_BYTES } = {}) {
  integer(maxFrameBytes, 128, MAX_FRAME_BYTES, 'maxFrameBytes');
  let buffer = Buffer.alloc(0); let dropping = false; let stopped = false;
  const pending = new Set(); const activeIds = new Set();
  let writes = Promise.resolve(); let closing;
  const send = frame => {
    writes = writes.then(() => new Promise((resolve, reject) => {
      output.write(JSON.stringify(frame) + '\n', error => error ? reject(error) : resolve());
    }));
    // 保留链上的错误交由入口结算，不让事件回调产生未处理拒绝。
    writes.catch(() => {});
  };
  const rpcError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const processLine = bytes => {
    let frame;
    try { frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { rpcError(null, -32700, '非法 JSON 或 UTF-8 帧'); return; }
    if (!object(frame) || frame.jsonrpc !== '2.0' || typeof frame.method !== 'string' || Object.keys(frame).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key)) || (Object.hasOwn(frame, 'id') && !idValid(frame.id))) {
      rpcError(null, -32600, '非法 JSON-RPC 请求'); return;
    }
    const notification = !Object.hasOwn(frame, 'id');
    const error = (code, message) => { if (!notification) rpcError(frame.id, code, message); };
    if (!['computer/invoke', 'computer/cancel'].includes(frame.method)) { error(-32601, '未知方法'); return; }
    if (!notification && activeIds.has(frame.id)) { error(-32600, '请求 id 已在途'); return; }
    try {
      if (frame.method === 'computer/cancel') {
        fields(frame.params, ['requestId'], 'params');
        if (!idValid(frame.params.requestId)) invalid('requestId 不合法');
        const response = provider.cancel(frame.params.requestId);
        if (!notification) send({ jsonrpc: '2.0', id: frame.id, result: response });
        return;
      }
      // 输入操作只接受有 id 的请求，避免无法追踪/取消的写入通知。
      if (notification) return;
      fields(frame.params, ['verb', 'args'], 'params');
      string(frame.params.verb, 'verb', 64);
      if (!object(frame.params.args)) invalid('args 必须是对象');
      if (Object.hasOwn(METHODS, frame.params.verb)) validate(frame.params.verb, frame.params.args);
    } catch (failure) { error(-32602, failure.message); return; }
    activeIds.add(frame.id);
    const work = provider.invoke(frame.id, frame.params).then(response => send({ jsonrpc: '2.0', id: frame.id, result: response })).finally(() => { pending.delete(work); activeIds.delete(frame.id); });
    pending.add(work);
  };
  const onData = data => {
    if (stopped) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const piece = chunk.subarray(start, end);
      if (!dropping) {
        if (buffer.length + piece.length > maxFrameBytes) {
          buffer = Buffer.alloc(0); dropping = true; rpcError(null, -32600, '帧超过大小上限');
        } else buffer = Buffer.concat([buffer, piece]);
      }
      if (newline !== -1) {
        if (!dropping) processLine(buffer);
        buffer = Buffer.alloc(0); dropping = false;
      }
      start = end + 1;
    }
  };
  await new Promise(resolve => {
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (buffer.length && !dropping) rpcError(null, -32700, 'NDJSON 尾帧缺少换行');
      closing = provider.close(); closing.catch(() => {});
      resolve();
    };
    input.on('data', onData);
    input.once('end', stop); input.once('close', stop); input.once('error', stop);
    if (input.destroyed || input.readableEnded) stop();
  });
  input.removeListener('data', onData);
  // 先等待有界关闭，不能先等永不结算的 SDK 请求。
  await closing;
  await Promise.allSettled([...pending]);
  await writes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // SDK 的控制台诊断只允许走 stderr；stdout 保留给协议帧。
  console.log = console.info = console.debug = (...args) => console.error(...args);
  runStdio().catch(error => {
    console.error('CUA provider 关闭失败：', error.kind ?? 'sdk-error', error.message);
    // 只退出协议宿主；不将退出解释为原生副作用已停止。
    if (error.kind === 'outcome-unknown') process.exit(1);
    process.exitCode = 1;
  });
}
