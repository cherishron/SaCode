// 会协作收束的样例扩展：handler 等 abort 信号，收到就立刻结束。
// stats 挂在导出对象上，好让测试用同一份模块实例观察「扩展到底有没有被通知到」——
// 取消之后调用方拿不到返回值，没有这个计数就只能靠猜。
const stats = { started: 0, aborted: 0, ranOut: 0 };

module.exports = {
  name: "example.watchful",
  description: "等待取消信号，收到即协作收束",
  params: "text",
  stats,
  async handler(params, ctx) {
    stats.started += 1;
    const signal = ctx && ctx.signal;
    if (!signal) {
      // 宿主没给信号 = 扩展无从协作：跑满窗口，让调用方只能「放弃等待」
      await new Promise((r) => setTimeout(r, 60));
      stats.ranOut += 1;
      return { cooperated: false };
    }
    const aborted = await new Promise((res) => {
      if (signal.aborted) {
        res(true);
        return;
      }
      signal.addEventListener("abort", () => res(true), { once: true });
      setTimeout(() => res(false), 3000);
    });
    if (aborted) {
      stats.aborted += 1;
      return { cooperated: true };
    }
    stats.ranOut += 1;
    return { cooperated: false };
  },
};
