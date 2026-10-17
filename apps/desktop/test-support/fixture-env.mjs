import { join } from 'node:path';

// 协议夹具拥有自己的用户配置；不能让测试默认读取真实注册表或环境凭据。
// 需要模型的用例在 extra 中显式提供本地服务配置，真实远端用例另行门控。
export function fixtureHostEnv(directory, extra = {}) {
  return {
    ...process.env,
    SACODE_USER_SETTINGS_DIR: join(directory, 'test-user-settings'),
    SACODE_PROVIDER_BASE_URL: '', SACODE_PROVIDER_MODEL: '', SACODE_PROVIDER_KEY: '', STEPFUN_API_KEY: '',
    ...extra,
  };
}
