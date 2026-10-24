// Playwright E2E（W02-A 出口要求至少一条真实浏览器登录/刷新证据）。
//
// 运行：npm run test:e2e
//   - 由 playwright.config.ts 的 webServer 拉起 BFF(18787) + Vite(5173) 同源代理
//   - 浏览器从 5173 访问 SPA，/api 经代理到 BFF（Origin 与 BFF 配置一致）
//   - 账号 tester / test-password（见 test/e2e/serve.ts）
//
// 本文件默认不被 vitest 运行（test/e2e 已在 vitest.config exclude），也不参与 tsconfig 类型检查。
import { test, expect } from '@playwright/test';

test('登录后可进入工作台，刷新后恢复登录态', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[autocomplete="username"]', 'tester');
  await page.fill('input[type="password"]', 'test-password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/workbench/);

  await page.reload();
  await expect(page).toHaveURL(/\/workbench/);
});
