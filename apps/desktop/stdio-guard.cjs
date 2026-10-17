// 桌面进程可能比启动它的终端活得更久；断开的诊断管道不应弹出主进程错误。
// 仅处理标准输出/错误的 EPIPE，宿主协议管道与其他错误仍按原路径报错。
function installStdioGuard(streams = [process.stdout, process.stderr]) {
  const onError = (error) => {
    if (error.code !== 'EPIPE') throw error;
  };
  for (const stream of new Set(streams)) {
    stream.on('error', onError);
  }
}

module.exports = { installStdioGuard };
