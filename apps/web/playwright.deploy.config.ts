// 部署拓扑 E2E：baseURL 指向前置反代 8080；BFF 与 SPA 由 dist/server 单进程同时提供。
// 前置条件（本仓库不自带 webServer，需外部先起）：
//   1) 构建：npm run build
//   2) 起 BFF（回环）：SACODE_WEB_ORIGIN=http://127.0.0.1:8080 SACODE_WEB_BIND=127.0.0.1 \
//      SACODE_WEB_PORT=18787 SACODE_WEB_TARGETS_FILE=... SACODE_WEB_AUTH_FILE=... npm start
//   3) 起前置反代（Caddy/nginx，或干跑用的最小反代）监听 8080 → 127.0.0.1:18787
// 运行：npm run test:e2e:deploy
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    headless: true,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: process.env['PW_CHROMIUM_EXE']
          ? { executablePath: process.env['PW_CHROMIUM_EXE'] }
          : {},
      },
    },
  ],
});
