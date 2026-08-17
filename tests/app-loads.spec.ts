import { test, expect } from '@playwright/test';
import { loadApp, loadAppNoAuth } from './helpers';

test.describe('App Loading', () => {
  test('page loads and shows title', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page).toHaveTitle('Мій словник');
  });

  test('login form is shown when not authenticated', async ({ page }) => {
    await loadAppNoAuth(page);
    const loginForm = page.locator('#login-form');
    await expect(loginForm).toBeVisible();
  });

  test('register form is hidden by default', async ({ page }) => {
    await loadAppNoAuth(page);
    const registerForm = page.locator('#register-form');
    await expect(registerForm).toBeHidden();
  });

  test('clicking register link shows register form', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.click('text=Зареєструватися');
    const registerForm = page.locator('#register-form');
    await expect(registerForm).toBeVisible();
    const loginForm = page.locator('#login-form');
    await expect(loginForm).toBeHidden();
  });

  test('clicking "Вже є акаунт" returns to login form', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.click('text=Зареєструватися');
    await expect(page.locator('#register-form')).toBeVisible();
    await page.click('#register-form .auth-link');
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#register-form')).toBeHidden();
  });
});

test.describe('Account Screen (mocked auth)', () => {
  test('shows account screen after auth', async ({ page }) => {
    await loadApp(page);
    const accountScreen = page.locator('#account-screen');
    await expect(accountScreen).toBeVisible();
  });

  // The "Привіт!" line was dropped — the account screen identifies the user by email.
  test('identifies the signed-in user', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#account-screen .user-email')).toHaveText('test@example.com');
  });

  // Level, XP and the streak moved to Прогрес, where the rest of the numbers live
  test('shows XP and level info in Прогрес', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Прогрес")');
    await expect(page.locator('#progressPopup #acc-level')).toBeVisible();
    await expect(page.locator('#progressPopup #acc-xp-text')).toBeVisible();
  });

  test('shows streak counter in Прогрес', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Прогрес")');
    await expect(page.locator('#progressPopup #streak-count')).toBeVisible();
  });

  test('shows user email', async ({ page }) => {
    await loadApp(page);
    const email = page.locator('.user-email');
    await expect(email).toContainText('test@example.com');
  });

  test('quick action buttons are present', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.acc-action-btn:has-text("Словник")')).toBeVisible();
    await expect(page.locator('.acc-action-btn:has-text("Додати")')).toBeVisible();
  });

  test('exercise tiles are present', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('button:has-text("Тестування")')).toBeVisible();
    await expect(page.locator('button:has-text("Картинки")')).toBeVisible();
    await expect(page.locator('button:has-text("На швидкість")')).toBeVisible();
  });
});
