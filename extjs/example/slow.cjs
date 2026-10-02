// 在途调用不结算的扩展：handler 永不 resolve，同时登记一个监听器。
// 用来断言宿主退出时 pending 调用被明确结算（而非悬挂）、监听残留归 0。
let pending;
module.exports = {
  name: "example.slow",
  description: "永不完成的调用",
  params: "",
  handler() {
    return new Promise((resolve) => {
      pending = resolve;
    });
  },
  setup(ctx) {
    ctx.on("turn/start", () => {});
    ctx.on("turn/start", () => {});
  },
  resolvePending() {
    if (pending) pending("late");
  },
};
