// 事件链路 E2E：登录 → 选目标 → 选会话 → 历史事件可见（真实浏览器）。
// 补 W02-A 只测登录/刷新的缺口：验证 targets/sessions/events 只读链在浏览器里真的可用。
// 数据来自合成 transport（sess-1 有 10 帧历史事件），不碰真实 daemon。
import { test, expect, type Page } from '@playwright/test';

async function loginAndOpenFirstSession(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[autocomplete="username"]', 'tester');
  await page.fill('input[type="password"]', 'test-password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/workbench/);

  // 目标列表加载后选中首个目标（Simulated），再选中首个会话（会话 1）
  await expect(page.locator('[data-targets] .link')).toHaveCount(1);
  await page.locator('[data-targets] .link').first().click();
  await expect(page.locator('[data-sessions] .link')).toHaveCount(6);
  await page.locator('[data-sessions] .link').first().click();
}

test('只读工作台展示目标/会话/历史事件', async ({ page }) => {
  await loginAndOpenFirstSession(page);

  // 会话详情（只读状态，不应出现任何可执行按钮）
  await page.locator('.session-details summary').click();
  await expect(page.locator('.detail')).toBeVisible();
  await expect(page.locator('.detail')).toContainText('会话 1');

  // 历史事件：合成数据的 10 帧
  const items = page.locator('[data-events] .event');
  await expect(items).toHaveCount(10);
  await expect(items.first()).toContainText('会话 1 事件 1');

  // SSE 连接建立（服务端会写 200 + text/event-stream，浏览器 onopen 后置为 open）
  await expect(page.locator('[data-stream-status]')).toContainText('实时已连接', {
    timeout: 15000,
  });
});

test('刷新后登录态恢复且历史仍在', async ({ page }) => {
  await loginAndOpenFirstSession(page);
  await expect(page.locator('[data-events] .event')).toHaveCount(10);

  await page.reload();
  await expect(page).toHaveURL(/\/workbench/);
  await page.locator('[data-targets] .link').first().click();
  await page.locator('[data-sessions] .link').first().click();
  await expect(page.locator('[data-events] .event')).toHaveCount(10);
});
