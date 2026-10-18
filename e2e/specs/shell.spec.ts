import { expect, test, type Page } from '@playwright/test';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

const personas = ['faisal', 'omar', 'imran', 'ravi', 'karim', 'laith'] as const;
const staff = ['today', 'runs', 'recovery', 'audit', 'connections', 'templates', 'team', 'settings'] as const;
const paths = ['/today', '/runs', '/recovery', '/audit-log', '/connections', '/templates', '/team', '/settings'];
async function noSidewaysScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: window.innerWidth }))).toEqual({ document: page.viewportSize()!.width, body: page.viewportSize()!.width, viewport: page.viewportSize()!.width });
}

for (const locale of ['en', 'ar'] as const) for (const width of [360, 390, 1440]) {
  const m = locale === 'en' ? en : ar;
  test(`Public pages ${locale} ${width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?lang=${locale}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.landing.headline);
    await expect(page.getByRole('link', { name: m.landing.demo })).toBeVisible();
    for (const title of m.landing.sections) await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await noSidewaysScroll(page);
    await page.getByRole('link', { name: m.landing.demo }).click();
    for (const persona of personas) await expect(page.getByRole('button', { name: `${m.demo.people[persona]} ${m.demo.roles[persona === 'faisal' ? 'admin' : persona === 'omar' ? 'account_manager' : persona === 'imran' ? 'delivery_lead' : persona === 'ravi' ? 'contributor' : 'client_reviewer']}` })).toBeVisible();
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  for (const persona of personas) test(`Shell ${persona} ${locale} ${width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/demo?lang=${locale}`);
    await page.getByRole('button', { name: new RegExp(m.demo.people[persona]) }).click();
    await expect(page.getByRole('status')).toContainText(m.demo.ready);
    await page.getByRole('link', { name: m.demo.open }).click();
    const reviewer = persona === 'karim' || persona === 'laith';
    await expect(page).toHaveURL(new RegExp(reviewer ? '/home$' : '/today$'));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByText('Northlight Studio', { exact: true })).toBeVisible();
    await expect(page.getByText(m.shell.sample, { exact: true })).toBeVisible();
    const navigation = page.locator(width < 768 ? '.phone-tabs' : '.app-sidebar nav');
    const visible = reviewer ? ['home', 'inputs'] as const : width < 768 ? ['today', 'runs', 'queue', 'more'] as const : staff;
    for (const key of visible) await expect(navigation.getByRole('link', { name: m.nav[key], exact: true })).toBeVisible();
    await noSidewaysScroll(page);
    await expect(page.locator('.count-badge')).toHaveCount(0);
    for (const [index, route] of (reviewer ? ['/home', '/inputs'] : paths).entries()) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.nav[reviewer ? index === 0 ? 'home' : 'inputs' : staff[index]]);
      await noSidewaysScroll(page);
    }
    if (!reviewer && width < 768) {
      await page.locator('.phone-tabs').getByRole('link', { name: m.nav.more }).click();
      for (const key of staff.slice(2)) await expect(page.locator('.more-navigation').getByRole('link', { name: m.nav[key] })).toBeVisible();
      await noSidewaysScroll(page);
    }
    expect(errors).toEqual([]);
  });
}

test('Reset waits for confirmation and persona switch changes the frame', async ({ page }) => {
  await page.goto('/demo?lang=en');
  await page.getByRole('button', { name: /Faisal Rahman/ }).click();
  await page.getByRole('link', { name: en.demo.open }).click();
  let starts = 0;
  page.on('request', request => { if (request.url().endsWith('/api/demo/start')) starts++; });
  await page.getByRole('button', { name: en.shell.reset, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(starts).toBe(0);
  await page.getByRole('button', { name: en.common.cancel }).click();
  expect(starts).toBe(0);
  await page.getByRole('button', { name: en.shell.reset, exact: true }).click();
  await page.getByRole('button', { name: en.shell.resetConfirm, exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(starts).toBe(1);
  await page.getByLabel(en.shell.persona).selectOption('karim');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('.app-sidebar nav').getByRole('link', { name: en.nav.inputs })).toBeVisible();
});

test('Demo error allows retry and announces creating and ready', async ({ page }) => {
  let attempts = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/demo/start', async route => {
    attempts++;
    if (attempts === 1) { await pending; await route.fulfill({ status: 503, body: '{}' }); }
    else await route.continue();
  });
  await page.goto('/demo?lang=en');
  await page.getByRole('button', { name: /Faisal Rahman/ }).click();
  await expect(page.getByRole('status')).toContainText(en.demo.creating);
  release!();
  await expect(page.getByRole('status')).toContainText(en.demo.error);
  await page.getByRole('button', { name: en.common.retry }).click();
  await expect(page.getByRole('status')).toContainText(en.demo.ready);
});

test('Existing sign in and memory pages still render without starting sign in', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/sign-in?lang=en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/memory');
  await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
  await page.goto('/today');
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(errors).toEqual([]);
});
