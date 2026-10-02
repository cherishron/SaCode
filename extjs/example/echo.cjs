// 无副作用示例扩展：只回显，用来验证注册/调用/卸载生命周期。
module.exports = {
  name: "example.echo",
  description: "回显传入文本，不触碰文件系统",
  params: "text",
  handler(params) {
    return { echoed: params.text };
  },
};
