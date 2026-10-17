// 会话级工作树的桌面契约适配：Host 侧 6 个方法里桌面只用进出面的 4 个
// （worktree/describe、worktree/enter、worktree/exit、worktree/cleanup）。
// 这里集中做三件事：字段逐条校验（缺字段拒绝，不把未知状态当作「干净」或「未激活」）、
// 负载白名单（渲染层拼不出第四个键，也说不出 force/path 这类越界字段）、
// 删除确认（归属/未提交/独有提交三重保护的原因必须原样冒泡，绝不吞成成功）。
// 冻结契约：docs/superpowers/plans/2026-10-08-session-worktree.md「冻结契约」。

// describe() 的字段集恰好这 8 个，Host 透传、桌面逐字段校验，任何一面不得增删或改名。
const FIELDS = ['active', 'name', 'directory', 'originalDirectory', 'branch', 'dirty', 'uncommittedCount', 'uniqueCommits'];
const STRINGS = ['name', 'directory', 'originalDirectory', 'branch'];
const COUNTS = ['uncommittedCount', 'uniqueCommits'];
// 退出动作取值只有这两个（草稿里出现过的 delete 一律是 remove）。
const ACTIONS = ['keep', 'remove'];
// 名称口径：≤64 字符，字母、数字、. _ -；不接路径分隔符、控制字符与前导连字符。
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// PR 入口只接编号（可带 # 前缀）与 https://github.com/<owner>/<repo>/pull/<N>。
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}\/pull\/[1-9][0-9]{0,9}$/;
const PR_NUMBER_RE = /^#?[1-9][0-9]{0,9}$/;

const contract = (field) => new Error(`worktree-contract: ${field}`);
const bad = () => new Error('bad-worktree-arguments');

// 名称与 PR 引用都得是「一整串可打印字符」：JS 的 `$` 会在结尾换行前也匹配，
// 所以除字符集外还要显式赶掉控制字符，否则 'feature\n' 能混进路径参数里。
const CONTROL_RE = /[\x00-\x20\x7f]/;
function printable(value) {
  return typeof value === 'string' && !CONTROL_RE.test(value);
}
function isName(value) {
  return printable(value) && NAME_RE.test(value) && !value.startsWith('-') && !value.includes('..');
}
function isReference(value) {
  return printable(value) && (PR_URL_RE.test(value) || PR_NUMBER_RE.test(value));
}

// 恰好 required 这几个键，多一个少一个都不行；args 是 IPC 送进来的网页对象，原型不可信。
function exact(args, required) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw bad();
  const keys = Object.keys(args);
  if (keys.length !== required.length || !required.every((key) => keys.includes(key))) throw bad();
}
// describe/cleanup 无输入字段：只接「没有负载」或「空对象」，别的形状一律拒。
function empty(args) {
  if (args === undefined) return;
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw bad();
}

// 适配器：把 describe 的 JSON 收成本地可信的 8 字段视图。
// 任何缺字段 / 类型不符 / 计数为负或非整数 / 多余字段，一律 worktree-contract 抛出去——
// 「未知」不等于「干净」，更不等于「未激活」，猜错的方向是删掉用户的工作树。
function describe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contract('value');
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || !FIELDS.every((key) => keys.includes(key))) throw contract('fields');
  if (typeof value.active !== 'boolean') throw contract('active');
  if (typeof value.dirty !== 'boolean') throw contract('dirty');
  for (const key of STRINGS) {
    if (typeof value[key] !== 'string') throw contract(key);
    // 未绑定时这四个串允许为空（核心没名字可给）；一旦声明激活就必须有实体。
    if (value.active && !value[key]) throw contract(key);
  }
  for (const key of COUNTS) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw contract(key);
  }
  return FIELDS.reduce((view, key) => Object.assign(view, { [key]: value[key] }), {});
}

function registerWorktreeIpc({ ipcMain, request, confirmDelete }) {
  ipcMain.handle('sacode:worktreeDescribe', async (_event, args) => {
    empty(args);
    return describe(await request('worktree/describe', {}));
  });

  ipcMain.handle('sacode:worktreeEnter', async (_event, args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw bad();
    const keys = Object.keys(args);
    if (keys.length !== 1 || !['name', 'reference'].includes(keys[0])) throw bad();
    const value = args[keys[0]];
    if (keys[0] === 'name' ? !isName(value) : !isReference(value)) throw bad();
    const state = describe(await request('worktree/enter', { [keys[0]]: value }));
    if (!state.active) throw new Error('worktree-enter-not-active');
    return state;
  });

  ipcMain.handle('sacode:worktreeExit', async (_event, args) => {
    exact(args, ['name', 'action', 'discardChanges']);
    const { name, action, discardChanges } = args;
    if (!isName(name) || !ACTIONS.includes(action) || typeof discardChanges !== 'boolean') throw bad();
    // keep 不删任何东西，discardChanges 在它身上没有意义：出现即形状错误。
    if (action === 'keep' && discardChanges) throw bad();
    // 删除与退出都作用在「刚刚核实过的那条绑定」上，不信任渲染层自带的名称。
    const state = describe(await request('worktree/describe', {}));
    if (!state.active) throw new Error('worktree-not-active');
    if (state.name !== name) throw new Error('worktree-name-mismatch');
    if (action === 'remove' && !await confirmDelete(state, discardChanges)) return { cancelled: true };
    const after = describe(await request('worktree/exit', { name, action, discardChanges }));
    if (after.active) throw new Error('worktree-still-active');
    return after;
  });

  ipcMain.handle('sacode:worktreeCleanup', async (_event, args) => {
    empty(args);
    // 清理只发空参数：哪些目录算过期、能不能删，全由核心按归属与 Git 状态判定；
    // 桌面没有通路递路径、递 force、递天数。
    const removed = await request('worktree/cleanup', {});
    if (!Number.isSafeInteger(removed) || removed < 0) throw contract('cleanup-count');
    return removed;
  });
}

// 应用关闭守卫：活动绑定未退出时，走与面板同一套保留/删除确认。
// 返回 true 才允许继续退出；false 表示用户取消（调用方必须中止关闭）；
// 抛错表示读取或退出失败——调用方要把原因显示出来，既不静默强删也不假装已结算。
async function protectClose({ request, choose, confirmDelete }) {
  const state = describe(await request('worktree/describe', {}));
  if (!state.active) return true;
  const action = await choose(state);
  if (action === 'cancel') return false;
  if (!ACTIONS.includes(action)) throw new Error('bad-worktree-close-choice');
  // 关闭态没有「留着未提交更改再说」的余地：删除必须先经显式确认，确认不过就不删。
  if (action === 'remove' && !await confirmDelete(state, true)) return false;
  const after = describe(await request('worktree/exit', {
    name: state.name, action, discardChanges: action === 'remove',
  }));
  if (after.active) throw new Error('worktree-still-active');
  return true;
}

module.exports = { describe, registerWorktreeIpc, protectClose, FIELDS };
