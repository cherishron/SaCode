// 构建子进程限时：Windows 结束自己启动的树，POSIX 结束自己的进程组。
// stdout/stderr 直接继承，不因后代继承捕获管道而永久等不到 close。
import { spawn, execFileSync } from 'node:child_process';
export function runBuild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit', detached: process.platform !== 'win32' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); }
        catch { child.kill(); }
      } else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }, options.timeout || 1200000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', (status, signal) => {
      clearTimeout(timer);
      if (timedOut || status !== 0) {
        const error = new Error(`构建失败 ${command}: status=${status}, signal=${signal}, timedOut=${timedOut}`);
        Object.assign(error, { status, signal, timedOut }); reject(error);
      } else resolve();
    });
  });
}
