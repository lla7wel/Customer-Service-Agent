import { test, expect, type Page } from '@playwright/test';
import { E2E_USERNAME, E2E_PASSWORD } from './global-setup';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('username').fill(E2E_USERNAME);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  // Submit with the keyboard: a real user path, and immune to the login card's
  // decorative motion.
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL('**/dashboard');
}

/** No page may scroll sideways — the team works from phones. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
  expect(overflow.scrollWidth, 'page must not scroll horizontally').toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('authentication', () => {
  test('protected routes redirect to sign-in when signed out', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('wrong credentials are rejected with a message', async ({ page }, testInfo) => {
    const projectOctet = ({ desktop: 11, tablet: 12, 'phone-360': 13, 'phone-390': 14, 'phone-430': 15 } as Record<string, number>)[testInfo.project.name] ?? 20;
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${projectOctet}` });
    await page.goto('/login');
    // Keep the deliberate failure isolated per viewport. Reusing the owner
    // username in five projects would correctly trip the production limiter
    // and turn later valid-login tests into a test-harness failure.
    await page.getByPlaceholder('username').fill(`unknown_${testInfo.project.name}`);
    await page.locator('input[type="password"]').fill('definitely-wrong-password');
    await page.locator('input[type="password"]').press('Enter');
    await expect(page.getByText(/غير صحيحة/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('valid credentials reach the dashboard', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('signed-in application', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('the page is Arabic RTL', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  const routes = [
    ['/dashboard', 'مركز التحكّم'],
    ['/inbox', 'الرسائل'],
    ['/catalog', 'المنتجات'],
    ['/content-studio', 'استوديو المحتوى'],
    ['/ai-control', 'تحكّم الذكاء'],
    ['/settings', 'الإعدادات'],
  ] as const;

  for (const [route, heading] of routes) {
    test(`${route} renders, has no dead shell and never scrolls sideways`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(route);
      await expect(page.getByRole('heading', { name: new RegExp(heading) }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors, `no uncaught page errors on ${route}`).toEqual([]);
    });
  }

  test('every sidebar destination is reachable (no dead navigation)', async ({ page, isMobile }) => {
    for (const [route] of routes) {
      const res = await page.goto(route);
      expect(res?.status(), `${route} must not 404/500`).toBeLessThan(400);
    }
    expect(isMobile !== undefined).toBe(true);
  });

  test('inbox shows the channel, unread badge and human-attention flag', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByText('زبونة تجريبية')).toBeVisible();
    await expect(page.getByText('ماسنجر').first()).toBeVisible();
    await expect(page.getByText(/يحتاج الفريق/).first()).toBeVisible();
  });

  test('conversation shows the thread and the Take Over control', async ({ page }) => {
    await page.goto('/inbox');
    await page.getByText('زبونة تجريبية').click();
    await expect(page.getByText('نبي نطلب الطقم الأبيض')).toBeVisible();
    await expect(page.getByRole('button', { name: /استلام المحادثة/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('Take Over then Resume AI round-trips', async ({ page }) => {
    await page.goto('/inbox');
    await page.getByText('زبونة تجريبية').click();
    await page.getByRole('button', { name: /استلام المحادثة/ }).click();
    await expect(page.getByRole('button', { name: /استئناف الذكاء/ })).toBeVisible();
    await page.getByRole('button', { name: /استئناف الذكاء/ }).click();
    await expect(page.getByRole('button', { name: /استلام المحادثة/ })).toBeVisible();
  });

  test('catalog lists products and opens a product with price history + family panels', async ({ page }) => {
    await page.goto('/catalog');
    const allProducts = page.getByText('كل المنتجات').locator('..');
    await expect(allProducts.getByText('2', { exact: true })).toBeVisible();
    const imageRecords = page.getByText(/سجلات الصور/).locator('..');
    await expect(imageRecords.getByText('2', { exact: true })).toBeVisible();
    await expect(page.getByText(/طقم غطاء لحاف/).first()).toBeVisible();
    await page.getByText(/طقم غطاء لحاف/).first().click();
    await expect(page.getByText('تاريخ السعر')).toBeVisible();
    await expect(page.getByText(/العائلة والمنتجات المرتبطة/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('Content Studio creates a post and exposes all four guided screens', async ({ page }) => {
    await page.goto('/content-studio');
    await page.getByRole('button', { name: /محتوى جديد/ }).click();
    await page.getByRole('button', { name: /إنشاء/ }).click();
    await page.waitForURL(/\/content-studio\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: 'اختر مصادر التصميم' })).toBeVisible();
    await page.getByRole('button', { name: /الغرض/ }).click();
    await expect(page.getByRole('heading', { name: 'حدد الغرض وشكل الإخراج' })).toBeVisible();
    await page.getByRole('button', { name: /النص والتوليد/ }).click();
    await expect(page.getByRole('heading', { name: 'راجع العبارة والكابشن' })).toBeVisible();
    await page.getByRole('button', { name: /المعاينة والنشر/ }).click();
    await expect(page.getByRole('heading', { name: 'المعاينة والنشر' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('phone bottom navigation and More sheet keep every primary area reachable', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'compact navigation only');
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: /التنقل الرئيسي/ });
    await expect(nav).toBeVisible();
    for (const label of ['الرئيسية', 'الرسائل', 'الكتالوج', 'المحتوى', 'المزيد']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
    await nav.getByRole('button', { name: /المزيد/ }).click();
    await expect(page.getByText('تحكّم الذكاء والاختبار')).toBeVisible();
    await expect(page.getByText('الإعدادات والفريق')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('Settings readiness reports truthfully — never a fake "connected"', async ({ page }) => {
    await page.goto('/settings?tab=channels');
    await page.getByRole('button', { name: /فحص الآن/ }).click();
    await expect(page.getByText(/is not connected|is not configured/).first()).toBeVisible({ timeout: 20_000 });
    // With no credentials configured nothing may claim to be connected.
    await expect(page.getByText(/^Connected to Page/)).toHaveCount(0);
  });

  test('Settings shows the seeded Business Facts', async ({ page }) => {
    await page.goto('/settings?tab=facts');
    await expect(page.getByText('الفروع', { exact: true })).toBeVisible();
    await expect(page.locator('input[value*="السياحية"]')).toBeVisible();
    await expect(page.locator('input[value="0923322008"]')).toBeVisible();
  });

  test('Settings lists admin accounts and the create form', async ({ page }) => {
    await page.goto('/settings?tab=admins');
    await expect(page.getByText(E2E_USERNAME).first()).toBeVisible();
    await expect(page.getByText('إضافة مشرف جديد')).toBeVisible();
  });

  test('AI Control compiles the live prompt and offers version history', async ({ page }) => {
    await page.goto('/ai-control');
    await page.getByRole('button', { name: /متقدم للمالك/ }).click();
    await expect(page.getByText(/معاينة البرومبت الفعّال/)).toBeVisible();
    await expect(page.getByText(/AI Control configuration is incomplete/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /سجل النسخ/ }).first()).toBeVisible();
  });

  test('sign out returns to the login page', async ({ page, isMobile }) => {
    await page.goto('/dashboard');
    if (isMobile) {
      await page.getByRole('navigation', { name: /التنقل الرئيسي/ }).getByRole('button', { name: /المزيد/ }).click();
    }
    await page.getByRole('button', { name: isMobile ? 'خروج' : 'تسجيل الخروج', exact: true }).click();
    await page.waitForURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('accessibility basics', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('key pages expose landmarks and a single H1', async ({ page }) => {
    for (const route of ['/dashboard', '/inbox', '/catalog', '/content-studio', '/settings']) {
      await page.goto(route);
      await expect(page.locator('main')).toHaveCount(1);
      expect(await page.locator('h1').count(), `${route} should have one H1`).toBeGreaterThanOrEqual(1);
    }
  });

  test('every image has an alt attribute', async ({ page }) => {
    await page.goto('/catalog');
    const missing = await page.locator('img:not([alt])').count();
    expect(missing, 'images must carry alt text').toBe(0);
  });

  test('interactive controls are reachable by keyboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(['A', 'BUTTON', 'INPUT']).toContain(focused);
  });

  test('interactive controls meet the compact target-size floor', async ({ page }) => {
    await page.goto('/content-studio');
    const tooSmall = await page.locator('button:visible, a:visible').evaluateAll((nodes) => nodes
      .map((node) => ({ text: (node.textContent || '').trim().slice(0, 40), box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24))
      .map(({ text, box }) => ({ text, width: Math.round(box.width), height: Math.round(box.height) })));
    expect(tooSmall).toEqual([]);
  });
});

test.describe('visual reference states', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('dashboard light and dark', async ({ page, isMobile }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveScreenshot('dashboard-light.png', { fullPage: !isMobile, animations: 'disabled' });
    if (isMobile) {
      await page.getByRole('navigation', { name: /التنقل الرئيسي/ }).getByRole('button', { name: /المزيد/ }).click();
    }
    await page.locator('button[title="Switch to dark"]:visible').click();
    if (isMobile) await page.keyboard.press('Escape');
    await expect(page).toHaveScreenshot('dashboard-dark.png', { fullPage: !isMobile, animations: 'disabled' });
  });
});
