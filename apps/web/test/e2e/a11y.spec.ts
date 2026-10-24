// 无障碍与响应式护栏：验证改动真的生效（不依赖视觉审查）
import { test, expect, type Page } from '@playwright/test';
import { measureContrast } from '../helpers/contrast';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[autocomplete="username"]', 'tester');
  await page.fill('input[type="password"]', 'test-password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/workbench/);
}

test('移动端 375px 无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  await page.locator('[data-targets] .link').first().click();
  await page.locator('[data-sessions] .link').first().click();
  await expect(page.locator('[data-events] .event').first()).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // 允许 1px 取整误差
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('键盘可导航且焦点环可见', async ({ page }) => {
  await login(page);
  // 初始焦点在 body，Tab 后应落到可交互元素
  await page.keyboard.press('Tab');

  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { tag: '', outline: 'none', width: '0px' };
    const cs = getComputedStyle(el);
    return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth };
  });
  expect(focus.tag).not.toBe('BODY');
  // 焦点环必须真实可见（WCAG 2.4.7）
  expect(focus.outline).not.toBe('none');
  expect(focus.width).not.toBe('0px');
});

test('自托管字体生效（Intentional pairing，非系统默认）', async ({ page }) => {
  const fontResponses = [];
  page.on('response', (r) => {
    if (r.url().includes('.woff2')) fontResponses.push(r.status());
  });
  await login(page);
  // 打开会话以渲染时间戳（.at 使用等宽字体），否则浏览器不会下载未使用的字体
  await page.locator('[data-targets] .link').first().click();
  await page.locator('[data-sessions] .link').first().click();
  await expect(page.locator('[data-events] .event').first()).toBeVisible();

  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const body = getComputedStyle(document.body).fontFamily;
    const at = document.querySelector('.at');
    return {
      sans: body,
      mono: at ? getComputedStyle(at).fontFamily : '',
      interLoaded: document.fonts.check('16px "Inter Variable"'),
      monoLoaded: document.fonts.check('16px "JetBrains Mono Variable"'),
    };
  });

  // 界面字体栈以 Inter 开头（中文由后续 fallback 承接）
  expect(info.sans).toContain('Inter Variable');
  // 数据（时间戳）使用等宽字体
  expect(info.mono).toContain('JetBrains Mono Variable');
  // 字体真实加载成功（不是回退到系统字体）
  expect(info.interLoaded).toBe(true);
  expect(info.monoLoaded).toBe(true);
  // 字体经同源加载，未被阻止
  expect(fontResponses.length).toBeGreaterThan(0);
  expect(fontResponses.every((s) => s === 200)).toBe(true);
});

test('关键文本对比度达 WCAG AA（实测计算，非声明）', async ({ page }) => {
  await login(page);
  await page.locator('[data-targets] .link').first().click();
  await page.locator('[data-sessions] .link').first().click();
  await expect(page.locator('[data-events] .event').first()).toBeVisible();

  const sels = ['.status', '.history-toolbar p', '.kind', '.at', '.muted', '.session-section h2'];
  const measured = await page.evaluate(measureContrast, sels);

  // 输出实测值，便于观测趋势（不依赖视觉审查）
  console.log('CONTRAST_DARK', JSON.stringify(measured));

  // 至少覆盖到这几类文本，否则说明选择器失效而非通过
  expect(measured.length).toBeGreaterThanOrEqual(4);
  for (const m of measured) {
    expect(m.ratio, `${m.sel} 对比度 ${m.ratio}:1 低于 AA 4.5:1`).toBeGreaterThanOrEqual(4.5);
  }
});

test('浅色主题：切换生效、对比度仍达 AA、刷新后保持', async ({ page }) => {
  await login(page);
  await page.locator('[data-targets] .link').first().click();
  await page.locator('[data-sessions] .link').first().click();
  await expect(page.locator('[data-events] .event').first()).toBeVisible();

  const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // 切换到浅色
  await page.click('[data-theme-toggle]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // 等待实际背景到达最终令牌值，不用固定延时掩盖过渡状态。
  await expect(page.locator('.link.active').first()).toHaveCSS('background-color', 'rgb(238, 237, 232)');

  const bgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // 背景确实变浅（不再是深色）
  expect(bgAfter).not.toBe(bgBefore);
  const light = await page.evaluate((c) => {
    const m = c.match(/\d+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
  }, bgAfter);
  expect(light).not.toBeNull();
  // 浅色：三通道均值应明显偏高
  expect((light![0] + light![1] + light![2]) / 3).toBeGreaterThan(200);

  // 浅色下文本仍需满足 AA
  const sels = ['.status', '.history-toolbar p', '.kind', '.at', '.muted', '.session-section h2'];
  const measured = await page.evaluate(measureContrast, sels);
  console.log('CONTRAST_LIGHT', JSON.stringify(measured));
  expect(measured.length).toBeGreaterThanOrEqual(4);
  for (const m of measured) {
    expect(m.ratio, `浅色 ${m.sel} 对比度 ${m.ratio}:1 低于 AA 4.5:1`).toBeGreaterThanOrEqual(4.5);
  }

  // 刷新后主题保持（localStorage 持久化）
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('登录页可双向切换主题，刷新后保存浅色与深色', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换到浅色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换到深色主题' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('触摸目标不小于 44px', async ({ page }) => {
  await login(page);
  await page.locator('[data-targets] .link').first().click();
  const box = await page.locator('[data-targets] .link').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
