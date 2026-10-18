import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`Landing at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Every deliverable you sell gets an owner, a deadline and an approval.',
    );
    await expect(page.getByRole('link', { name: 'Try the demo' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
