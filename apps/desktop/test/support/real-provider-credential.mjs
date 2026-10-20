// 全套回归默认不发真实模型请求；明确启用后也只接受进程环境注入，不搜索磁盘凭据。
export function realProviderCredential(env=process.env) {
  return env.SACODE_RUN_REAL_PROVIDER_TESTS==='1' ? env.STEPFUN_API_KEY||'' : '';
}
