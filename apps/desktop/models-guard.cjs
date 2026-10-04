// 模型配置草稿的字段守卫：白名单之外的字段一律丢弃（凭据名由核心按 ID 派生，渲染层
// 没有覆盖通路），能承载明文的键位不是「忽略」而是拒收——静默丢弃会让页面以为密钥已存进去。
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const SECRET_SLOTS = ['apiKey', 'api_key', 'key', 'token', 'secret', 'value'];
const isStr = (v) => typeof v === 'string';

function bad(why) {
  throw new Error(why);
}

function sanitizeDraft(d) {
  if (!d || typeof d !== 'object') bad('bad-model-draft');
  for (const slot of SECRET_SLOTS) {
    if (d[slot] !== undefined && d[slot] !== null) bad('bad-model-draft');
  }
  if (!isStr(d.id) || d.id.length === 0 || d.id.length > 64) bad('bad-model-draft');
  if (!isStr(d.name) || d.name.length > 100) bad('bad-model-draft');
  if (!isStr(d.baseUrl) || d.baseUrl.length === 0 || d.baseUrl.length > 512) bad('bad-model-draft');
  if (!PROTOCOLS.includes(d.protocol)) bad('bad-model-draft');
  if (!Array.isArray(d.models) || d.models.length === 0 || d.models.length > 128) bad('bad-model-draft');
  const models = d.models.map((m) => {
    if (!m || typeof m !== 'object' || !isStr(m.id) || m.id.length === 0 || m.id.length > 200
      || !isStr(m.name) || m.name.length > 100 || !isStr(m.contextWindow) || !isStr(m.maxTokens)
      || typeof m.image !== 'boolean') bad('bad-model-draft');
    return { id: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens, image: m.image };
  });
  return { id: d.id, name: d.name, baseUrl: d.baseUrl, protocol: d.protocol, models };
}

// 版本号是乐观并发的凭据：非整数与负数在主进程就拒收，不拿去让核心猜。
function sanitizeRevision(rev) {
  if (!Number.isInteger(rev) || rev < 0) bad('bad-model-revision');
  return rev;
}

// 密钥只在这一次调用里存在：控制字符直接拒收，长度封顶，绝不回写、绝不落日志。
function sanitizeKey(key) {
  if (key === undefined || key === null || key === '') return '';
  if (!isStr(key) || key.length > 4096 || /[\x00-\x20\x7f]/.test(key)) bad('bad-model-key');
  return key;
}

function sanitizeListRequest(args) {
  const baseUrl = args && args.baseUrl;
  if (!isStr(baseUrl) || baseUrl.length === 0 || baseUrl.length > 512) bad('bad-model-list');
  return { baseUrl, apiKey: sanitizeKey(args ? args.apiKey : undefined) };
}

module.exports = { sanitizeDraft, sanitizeRevision, sanitizeKey, sanitizeListRequest, PROTOCOLS };
