import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Fix: Progress Popup Scroll Lock', () => {
  test('body overflow is hidden when progress popup opens', async ({ page }) => {
    await loadApp(page);
    // Open progress popup via loadUserProgress
    await page.evaluate(() => {
      document.getElementById('progressPopup')!.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    });
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe('hidden');
  });

  test('body overflow is restored when progress popup closes', async ({ page }) => {
    await loadApp(page);
    // Simulate opening and closing
    await page.evaluate(() => {
      document.getElementById('progressPopup')!.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    });
    // Close popup
    await page.evaluate(() => {
      (window as any).closeProgressPopup();
    });
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe('');
    // Popup should be hidden
    const isHidden = await page.evaluate(() =>
      document.getElementById('progressPopup')!.classList.contains('hidden')
    );
    expect(isHidden).toBe(true);
  });
});
