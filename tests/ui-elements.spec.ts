import { test, expect } from '@playwright/test';
import { loadApp, loadAppNoAuth } from './helpers';

test.describe('Login Form', () => {
  test('has email and password inputs', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
  });

  test('has login button', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#login-form button:has-text("Увійти")')).toBeVisible();
  });

  test('register form has email and password inputs', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.click('text=Зареєструватися');
    await expect(page.locator('#register-email')).toBeVisible();
    await expect(page.locator('#register-password')).toBeVisible();
  });
});

test.describe('Account Screen Elements', () => {
  test('all back buttons have consistent padding', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    const backBtn = page.locator('#my-words-section .back-button');
    await expect(backBtn).toBeVisible();
    const paddingTop = await backBtn.evaluate(el => getComputedStyle(el).paddingTop);
    expect(paddingTop).toBe('14px');
  });

  test('exercise tiles grid is visible', async ({ page }) => {
    await loadApp(page);
    const tiles = page.locator('.acc-tile');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(5);
  });
});

test.describe('Account Screen Header', () => {
  test('no greeting line — the screen starts at the email', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#account-screen')).not.toContainText('Привіт');
    await expect(page.locator('.acc-greeting')).toHaveCount(0);
    await expect(page.locator('#account-screen .acc-email')).toBeVisible();
  });
});

test.describe('Responsive Design', () => {
  test('app works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadAppNoAuth(page);
    await expect(page).toHaveTitle('Мій словник');
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('app works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loadAppNoAuth(page);
    await expect(page).toHaveTitle('Мій словник');
    await expect(page.locator('#login-form')).toBeVisible();
  });
});
