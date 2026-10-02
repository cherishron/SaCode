// 慢但终会应答的扩展：用来断言「等待方放弃后，迟到帧单独记账而不是被吞掉」。
module.exports = {
  name: "example.delayed",
  description: "延迟 300ms 后应答",
  params: "text",
  async handler(params) {
    await new Promise((r) => setTimeout(r, 300));
    return { echoed: params.text };
  },
};
