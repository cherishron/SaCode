const { rm, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({ appOutDir, electronPlatformName = process.platform }) => {
  await Promise.all([
    rm(join(appOutDir, 'debug.log'), { force: true }),
    rm(join(appOutDir, 'resources', 'default_app.asar'), { force: true }),
  ]);
  // 用户明确选择的临时兼容入口：不修改默认 exe 或应用的安全配置。
  // 必须位于 asar 外且与 exe 同目录，才能在 Electron 原生初始化前传入参数。
  if (electronPlatformName === 'win32') {
    // CMD 默认代码页不保证 UTF-8；入口只允许 ASCII，并固定输出 CRLF。
    // 中文说明放独立文本，避免批处理注释在某些 CMD 环境里被误解析成命令。
    const launcher = await readFile(join(__dirname, 'start-sacode-no-sandbox.cmd'), 'utf8');
    if (/[^\x00-\x7f]/.test(launcher)) throw new Error('临时 CMD 启动入口必须使用 ASCII 字符');
    await writeFile(join(appOutDir, 'start-sacode-no-sandbox.cmd'), launcher.replace(/\r?\n/g, '\r\n'), 'ascii');
    await writeFile(join(appOutDir, 'TEMPORARY-NO-SANDBOX.txt'), [
      '临时启动方式：双击 start-sacode-no-sandbox.cmd。',
      '该入口按用户要求关闭本次 Electron 的 Chromium 进程沙箱，安全隔离能力降低。',
      '仅用于可信的本地测试，不作为正式发布包，不打开不可信插件或外部内容。',
      'contextIsolation 和 nodeIntegration 原配置未修改；核心工具审批未修改。',
      '没有修改 Windows 防护、全局 TEMP/TMP 或现有用户数据。',
      '本仓目录版数据保存在 apps/desktop/data/sacode：sessions 会话、user 配置、electron 浏览器配置、cache 缓存、temp 临时文件，各版本共用。',
      '可用 SACODE_DATA_DIR 指定绝对数据根；目录不可写不会静默回退 C 盘。旧 C 盘记录不会自动迁移或删除。',
      '默认 SaCode.exe 不变；问题解决后直接使用 SaCode.exe 即恢复默认启动方式。',
      'NSIS 安装器临时文件错误未修复；当前优先使用 win-unpacked 目录版。',
      '',
    ].join('\r\n'), 'utf8');
  }
};
