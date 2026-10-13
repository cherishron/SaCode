// 桌面持久数据与项目源码分开；本地目录版共用 desktop/data/sacode，不默认写 C 盘 AppData。
const { join, dirname, resolve, isAbsolute } = require('node:path');
const { mkdirSync, existsSync, readFileSync } = require('node:fs');

function defaultDataRoot(exe) {
  // 仓内不同版本目录共用数据；独立分发目录则在 exe 旁保存，不猜测其他项目归属。
  let parent = dirname(exe);
  for (let depth = 0; depth < 7; depth++) {
    const manifest = join(parent, 'package.json');
    try {
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === '@stand-alone/sacode-desktop') return join(parent, 'data', 'sacode');
    } catch (_) { /* 非桌面包清单不用于推断数据位置。 */ }
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  return join(dirname(exe), 'data', 'sacode');
}

function configureDataPaths({ app, env, isolated = false, platform = process.platform }) {
  // 显式会话／冒烟目录由调用者拥有，不能偷偷读取或创建真实用户的数据根。
  if (isolated) return null;
  const override = env.SACODE_DATA_DIR;
  // Linux/macOS 安装位置通常只读；使用应用专属可写用户目录，显式覆盖仍优先。
  const root = override || (platform !== 'win32' ? app.getPath('userData') :
    app.isPackaged ? defaultDataRoot(app.getPath('exe')) : null);
  if (!root) return null;
  if (!isAbsolute(root)) throw new Error('SaCode 数据目录必须是绝对路径');
  const paths = {
    root: resolve(root),
    sessions: join(root, 'sessions'),
    settings: join(root, 'user'),
    userData: join(root, 'electron'),
    sessionData: join(root, 'cache'),
    temp: join(root, 'temp'),
    logs: join(root, 'logs'),
    crashDumps: join(root, 'crashes'),
  };
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });
  // 必须在 app.ready 前设置；目录不可写时明确失败，绝不回退 C 盘。
  for (const name of ['userData', 'sessionData', 'temp', 'logs', 'crashDumps']) app.setPath(name, paths[name]);
  return paths;
}

module.exports = { configureDataPaths };
