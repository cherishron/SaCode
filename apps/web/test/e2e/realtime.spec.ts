// 实时链路与 fan-out E2E：验证「上游一帧 → broker 环 → 多订阅者 → 各自 SSE → 浏览器」。
// 事件由 e2e 专用驱动端点按需推送（127.0.0.1:18788/emit），确定性，不自动定时。
//
// 关键时序：SSE 连接建立时会回放环形缓冲中的历史帧，因此必须先等「实时已连接」
// （此时回放已结束），再 emit；之后到达的帧才能证明是实时推送而非回放。
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const DRIVER = 'http://127.0.0.1:18788/emit';

async function emit(
  request: APIRequestContext,
  generation?: number,
): Promise<{ id: string; summary: string }> {
  const url = generation === undefined ? DRIVER : `${DRIVER}?generation=${generation}`;
  const r = await request.post(url);
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { id: string; summary: string };
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[autocomplete="username"]', 'tester');
  await page.fill('input[type="password"]', 'test-password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/workbench/);
}

/** 打开 sim-1 / sess-1 并等待事件渲染（不断言精确条数：环中可能有前面测试留下的帧被回放） */
async function openSess1(page: Page): Promise<void> {
  await page.locator('[data-targets] .link').first().click();
  await page.locator('[data-sessions] .link').first().click();
  await expect(page.locator('[data-events] .event').first()).toBeVisible();
  await expect(page.locator('[data-stream-status]')).toContainText('实时已连接');
}

test('实时事件经 SSE 到达浏览器', async ({ page, request }) => {
  await login(page);
  await openSess1(page);

  const { summary } = await emit(request);
  // 连接已建立（回放已结束），因此这条必定是实时推送到达
  await expect(page.locator('[data-events]')).toContainText(summary);
});

test('单上游订阅 fan-out 到多个浏览器订阅者', async ({ browser, request }) => {
  // 两个独立上下文 = 两个浏览器订阅者，订阅同一 target 的同一会话
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await login(pageA);
    await openSess1(pageA);
    await login(pageB);
    await openSess1(pageB);

    const { summary } = await emit(request);

    // 同一帧必须同时到达两个订阅者（broker fan-out，而非各自回放）
    await expect(pageA.locator('[data-events]')).toContainText(summary);
    await expect(pageB.locator('[data-events]')).toContainText(summary);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('代际变化触发服务端清环与前端补读', async ({ page, request }) => {
  // 记录前端对 /events（补读接口）的调用次数：初次加载历史 1 次 + 代际变化后补读 1 次
  const eventApiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/targets/') && r.url().includes('/events')) {
      eventApiCalls.push(r.url());
    }
  });

  await login(page);
  await openSess1(page);
  await expect.poll(() => eventApiCalls.length).toBe(1);

  // 推一帧代际 2 的事件：broker 应清空旧环并向订阅者发 refill 提示
  const { summary } = await emit(request, 2);

  // 前端收到 refill 后按游标补读（多出一次 events 请求）
  await expect.poll(() => eventApiCalls.length).toBeGreaterThan(1);
  // 补读请求必须带不透明游标
  expect(eventApiCalls[1]).toContain('cursor=');
  // 该帧仍应到达浏览器
  await expect(page.locator('[data-events]')).toContainText(summary);
});
