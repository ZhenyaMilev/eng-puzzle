import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Ambient Music', () => {
  test('ambient music button exists', async ({ page }) => {
    await loadApp(page);
    const btn = page.locator('#ambient-music-btn');
    await expect(btn).toBeAttached();
  });

  test('ambient music button becomes visible after auth', async ({ page }) => {
    await loadApp(page);
    await page.waitForTimeout(300);
    const isHidden = await page.evaluate(() =>
      document.getElementById('ambient-music-btn')!.classList.contains('hidden')
    );
    // showAmbientButton is called in onAuthStateChanged, should remove hidden
    expect(isHidden).toBe(false);
  });

  test('startAmbientMusic function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).startAmbientMusic === 'function');
    expect(exists).toBe(true);
  });

  test('stopAmbientMusic function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).stopAmbientMusic === 'function');
    expect(exists).toBe(true);
  });

  test('ambient music is not playing by default', async ({ page }) => {
    await loadApp(page);
    const isPlaying = await page.evaluate(() => (window as any).ambientPlaying);
    expect(isPlaying).toBeFalsy();
  });
});
