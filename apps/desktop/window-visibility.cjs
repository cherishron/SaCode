// 隐藏窗口完成加载后必须显示，不能只等待可能缺失的首次绘制事件。
function installWindowVisibility(win, { hidden = false } = {}) {
  if (hidden) return;
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      // Windows 继承隐藏启动状态时首次显示可能仍隐藏；只追加一次有界重试。
      if (!win.isVisible()) setImmediate(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.show();
      });
    }
  };
  win.once('ready-to-show', show);
  win.webContents.once('did-stop-loading', show);
}

module.exports = { installWindowVisibility };
