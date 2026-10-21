const { rm } = require('node:fs/promises');
const { join } = require('node:path');

// 新候选只保留默认安全入口；历史R4外部目录不由打包钩子改写。
module.exports = async ({ appOutDir }) => {
  await Promise.all([
    rm(join(appOutDir, 'debug.log'), { force: true }),
    rm(join(appOutDir, 'resources', 'default_app.asar'), { force: true }),
  ]);
};