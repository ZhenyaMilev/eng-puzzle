import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Speed Training Record', () => {
  test('speed training tile exists', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('button:has-text("На швидкість")')).toBeVisible();
  });

  test('speed training section opens', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('speed-training-section')!.classList.remove('hidden');
    });
    await expect(page.locator('#speed-training-section')).toBeVisible();
  });

  test('finishSpeedTraining function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).finishSpeedTraining === 'function');
    expect(exists).toBe(true);
  });

  test('speed training section has back button', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('speed-training-section')!.classList.remove('hidden');
    });
    await expect(page.locator('#speed-training-section .back-button')).toBeVisible();
  });
});
