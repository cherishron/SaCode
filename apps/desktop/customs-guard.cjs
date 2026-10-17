// 自定义模型面的字段守卫：白名单之外的字段一律丢弃，能承载明文的键位拒收。
// 第 3 层文档不认识 baseUrl 与凭据——草稿里出现它们就是绕行，直接拒。
// 判据与核心 custom_model_registry.cj 的 parseRecordObject 一致：主进程先拦一遍，
// 核心是权威（两处都放行才落盘）；版本号是乐观并发的凭据，非整数与负数在主进程就拒收。
const MODES = ['round-robin', 'weighted'];
const CATEGORIES = ['coding', 'general', 'vision', 'embedding', 'other'];
const REQUIRES = ['tools', 'text-output', 'image-output', 'structured-output', 'stream'];
const SECRET_SLOTS = ['apiKey', 'api_key', 'key', 'token', 'secret', 'value', 'baseUrl', 'credentialRef'];
const isStr = (v) => typeof v === 'string';
const CURRENCY = /^[A-Z]{3}$/;

function bad(why) {
  throw new Error(why);
}

// 费率/预算列：-1 = 未登记（未设置），>= 0 = 已登记；其它一律拒
function microOrUnset(v, dflt) {
  if (v === undefined || v === null) return dflt;
  if (!Number.isInteger(v) || v < -1) bad('bad-custom-draft');
  return v;
}

function price(v) { return microOrUnset(v, -1); }

function sanitizeBinding(b) {
  if (!b || typeof b !== 'object') bad('bad-custom-draft');
  for (const slot of SECRET_SLOTS) {
    if (b[slot] !== undefined && b[slot] !== null) bad('bad-custom-draft');
  }
  if (!isStr(b.providerId) || b.providerId.length === 0 || b.providerId.length > 64) bad('bad-custom-draft');
  if (!isStr(b.modelId) || b.modelId.length === 0 || b.modelId.length > 200) bad('bad-custom-draft');
  if (b.order !== undefined && (!Number.isInteger(b.order) || b.order < 0)) bad('bad-custom-draft');
  if (b.weight !== undefined && (!Number.isInteger(b.weight) || b.weight < 1 || b.weight > 1000)) bad('bad-custom-draft');
  if (b.priceVersion !== undefined && (!Number.isInteger(b.priceVersion) || b.priceVersion < 0)) bad('bad-custom-draft');
  if (b.currency !== undefined && b.currency !== null && b.currency !== '' && !CURRENCY.test(b.currency)) bad('bad-custom-draft');
  return {
    providerId: b.providerId,
    modelId: b.modelId,
    enabled: b.enabled === undefined ? true : b.enabled === true,
    order: b.order === undefined ? 0 : b.order,
    weight: b.weight === undefined ? 1 : b.weight,
    priceInMicro: price(b.priceInMicro),
    priceOutMicro: price(b.priceOutMicro),
    priceCacheReadMicro: price(b.priceCacheReadMicro),
    priceCacheWriteMicro: price(b.priceCacheWriteMicro),
    priceVersion: b.priceVersion === undefined ? 0 : b.priceVersion,
    currency: b.currency === undefined || b.currency === null ? '' : b.currency,
  };
}

// 自由格式 JSON 原文：主进程只做「是字符串、能解析、键名不带明文槽位」的粗筛，
// 长度上限与逐字回读由核心管（核心是权威，落盘写的还是用户给的那串）。
function sanitizeFreeForm(v) {
  if (v === undefined || v === null || v === '') return '';
  if (!isStr(v) || v.length > 4000) bad('bad-custom-draft');
  let parsed;
  try { parsed = JSON.parse(v); } catch { bad('bad-custom-draft'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) bad('bad-custom-draft');
  for (const slot of SECRET_SLOTS) {
    if (parsed[slot] !== undefined && parsed[slot] !== null) bad('bad-custom-draft');
  }
  return v;
}

function sanitizeDraft(d) {
  if (!d || typeof d !== 'object') bad('bad-custom-draft');
  for (const slot of SECRET_SLOTS) {
    if (d[slot] !== undefined && d[slot] !== null) bad('bad-custom-draft');
  }
  if (!isStr(d.id) || d.id.length === 0 || d.id.length > 64) bad('bad-custom-draft');
  if (!/^[a-z][a-z0-9-]*$/.test(d.id)) bad('bad-custom-draft');
  if (!isStr(d.name) || d.name.length > 100) bad('bad-custom-draft');
  if (d.description !== undefined && (!isStr(d.description) || d.description.length > 500)) bad('bad-custom-draft');
  if (d.enabled !== undefined && typeof d.enabled !== 'boolean') bad('bad-custom-draft');
  if (!CATEGORIES.includes(d.category)) bad('bad-custom-draft');
  if (!Array.isArray(d.requires) || d.requires.length === 0 || d.requires.length > 8) bad('bad-custom-draft');
  if (!d.requires.every((r) => REQUIRES.includes(r))) bad('bad-custom-draft');
  if (new Set(d.requires).size !== d.requires.length) bad('bad-custom-draft');
  if (d.mode !== undefined && !MODES.includes(d.mode)) bad('bad-custom-draft');
  if (!Array.isArray(d.bindings) || d.bindings.length > 32) bad('bad-custom-draft');
  const bindings = d.bindings.map(sanitizeBinding);
  const keys = new Set(bindings.map((b) => b.providerId + '/' + b.modelId));
  if (keys.size !== bindings.length) bad('bad-custom-draft');
  for (const column of ['dailyTokens', 'monthlyTokens', 'dailyAmountMicro', 'monthlyAmountMicro', 'maxOutputTokens']) {
    if (d[column] !== undefined && (!Number.isInteger(d[column]) || d[column] < -1)) bad('bad-custom-draft');
  }
  if (d.probeMaxPerDay !== undefined && (!Number.isInteger(d.probeMaxPerDay) || d.probeMaxPerDay < 0 || d.probeMaxPerDay > 100)) bad('bad-custom-draft');
  return {
    id: d.id,
    name: d.name,
    description: d.description === undefined ? '' : d.description,
    enabled: d.enabled === undefined ? true : d.enabled,
    category: d.category,
    requires: d.requires,
    bindings,
    mode: d.mode === undefined ? 'weighted' : d.mode,
    params: sanitizeFreeForm(d.params),
    modalityBudget: sanitizeFreeForm(d.modalityBudget),
    dailyTokens: d.dailyTokens === undefined ? -1 : d.dailyTokens,
    monthlyTokens: d.monthlyTokens === undefined ? -1 : d.monthlyTokens,
    dailyAmountMicro: d.dailyAmountMicro === undefined ? -1 : d.dailyAmountMicro,
    monthlyAmountMicro: d.monthlyAmountMicro === undefined ? -1 : d.monthlyAmountMicro,
    maxOutputTokens: d.maxOutputTokens === undefined ? -1 : d.maxOutputTokens,
    probeEnabled: d.probeEnabled === undefined ? true : d.probeEnabled === true,
    probeMaxPerDay: d.probeMaxPerDay === undefined ? 3 : d.probeMaxPerDay,
  };
}

function sanitizeRevision(rev) {
  if (!Number.isInteger(rev) || rev < 0) bad('bad-custom-revision');
  return rev;
}

function sanitizeKeyList(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 128) bad('bad-custom-items');
  const out = [];
  for (const item of v) {
    if (!isStr(item) || item.length === 0 || item.length > 265) bad('bad-custom-items');
    if (!/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(item)) bad('bad-custom-items');
    out.push(item);
  }
  return out;
}

module.exports = { sanitizeDraft, sanitizeBinding, sanitizeRevision, sanitizeKeyList, MODES, CATEGORIES, REQUIRES };
