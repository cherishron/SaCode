// 插件面的字段守卫（契约：docs/evidence/plugin-manager-contract-2026-10-05.md §3.2/§3.3）。
// 主进程先拦一遍，核心是权威；两处都放行才落盘。这里拦的不是「格式洁癖」，而是三条
// 会被静默误读的语义：
//   1. 缺 expectedRevision 绝不能当成无条件写。核心把 -1 解释成「不在乎版本」，
//      而「没给版本」和「不在乎版本」是两件事——协议面上 -1 不可达。
//   2. enabled 只收布尔。字符串 "true" 或数字 1 被当成「用户想启用」就是猜默认值，
//      猜错的方向是把已经启用的插件停掉。
//   3. spec 是数据不是命令行。主进程不解析它的内容（npm 名 / git 地址 / 本地目录
//      由宿主决定怎么解释），只做长度、空值与控制字符校验；registry 只认 http(s)，
//      file: 与 javascript: 这类形态一律拒收。
const NAME_MAX = 214;
const SPEC_MAX = 500;
const REGISTRY_MAX = 300;

const isStr = (v) => typeof v === 'string';

function bad(why) {
  throw new Error(why);
}

// 控制字符（含 CR/LF/TAB/NUL 与 DEL）一律拒：它们会跨层拼出误导性的日志行与
// 看起来一模一样的名字。
function hasControl(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

// 写动作的乐观并发凭据。缺失与非法分开报：missing-revision 是「渲染层忘了带」，
// bad-revision 是「带错了」，两句话在调试时指向不同的地方。
function sanitizeRevision(v) {
  if (v === undefined || v === null) bad('missing-revision');
  // isInteger 已经把 '1'、true、NaN、Infinity、1.5 全部挡在门外，不必再逐型判一遍。
  if (typeof v !== 'number' || !Number.isInteger(v)) bad('bad-revision');
  if (v < 1 || v > Number.MAX_SAFE_INTEGER) bad('bad-revision');
  return v;
}

function sanitizeEnabled(v) {
  if (typeof v !== 'boolean') bad('bad-enabled');
  return v;
}

function sanitizeName(v) {
  if (!isStr(v) || v.length === 0 || v.length > NAME_MAX || hasControl(v)) bad('bad-plugin-name');
  return v;
}

function sanitizeEntryId(v) {
  if (!isStr(v) || v.length === 0 || v.length > NAME_MAX || hasControl(v)) bad('bad-entry-id');
  return v;
}

// trim 后非空；不做路径与包名形态判断——那是宿主的职责，主进程一旦开始解析
// spec，就等于在这里长出第二个解析器。
function sanitizeSpec(v) {
  if (!isStr(v)) bad('bad-plugin-spec');
  const trimmed = v.trim();
  if (trimmed.length === 0 || v.length > SPEC_MAX || hasControl(v)) bad('bad-plugin-spec');
  return trimmed;
}

// 空串与 null 同义：都表示「用本机 pnpm 自己配置里那个源」。
// 私有源凭据留在本机 .npmrc，没有通道把凭据从渲染层递进来。
function sanitizeRegistry(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!isStr(v) || v.length > REGISTRY_MAX || hasControl(v)) bad('bad-plugin-registry');
  let parsed;
  try {
    parsed = new URL(v);
  } catch (e) {
    bad('bad-plugin-registry');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') bad('bad-plugin-registry');
  return v;
}

module.exports = {
  sanitizeRevision,
  sanitizeEnabled,
  sanitizeName,
  sanitizeEntryId,
  sanitizeSpec,
  sanitizeRegistry,
};
