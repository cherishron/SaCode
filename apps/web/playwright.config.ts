import { defineConfig } from '@playwright/test';

// W02-A 真实浏览器冒烟：webServer 拉起 BFF(18787) + Vite(5173) 同源代理，
// 浏览器从 5173 访问 SPA，/api 经代理到 BFF。Origin 与 BFF 配置一致（http://127.0.0.1:5173）。
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // 不硬编码本机浏览器路径：默认使用 Playwright 自身下载的 chromium；
      // 需要指定构建时才用 PW_CHROMIUM_EXE（本机缓存或 CI 自定义位置）。
      use: {
        browserName: 'chromium',
        launchOptions: process.env['PW_CHROMIUM_EXE']
          ? { executablePath: process.env['PW_CHROMIUM_EXE'] }
          : {},
      },
    },
  ],
  webServer: {
    command: 'npx tsx test/e2e/serve.ts',
    url: 'http://127.0.0.1:5173',
    timeout: 60_000,
    // 仅显式联调复用预览；默认由测试自启已知夹具，避免误把其他服务当通过。
    reuseExistingServer: process.env['SACODE_WEB_E2E_REUSE'] === '1',
  },
});
