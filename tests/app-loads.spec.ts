import { test, expect } from '@playwright/test';
import { loadApp, loadAppNoAuth } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

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

/**
 * Nothing in the app runs until index.html, the three Firebase scripts and
 * whatever else sits in front of them have arrived. These keep that queue short.
 */
test.describe('What the app makes a phone download before it starts', () => {
  const ROOT = join(__dirname, '..', 'eng-puzzle');
  const html = () => readFileSync(join(ROOT, 'index.html'), 'utf-8');

  test('the Firebase scripts are asked for in the first kilobyte, not the last', () => {
    const source = html();
    const head = source.slice(0, source.indexOf('</head>'));
    for (const file of ['firebase-app', 'firebase-auth', 'firebase-firestore']) {
      expect(head).toContain(`rel="preload" as="script" href="https://www.gstatic.com/firebasejs/8.10.1/${file}.js`);
    }
    // Telegram's SDK carries the signature the sign-in needs, so it goes first
    expect(head).toContain('rel="preload" as="script" href="https://telegram.org/js/telegram-web-app.js');
    expect(head.indexOf('telegram-web-app.js')).toBeLessThan(head.indexOf('firebase-app.js'));
    // Their own tags stay at the end of the body, so execution order is untouched
    expect(source.indexOf('<script src="https://www.gstatic.com/firebasejs'))
      .toBeGreaterThan(source.indexOf('</head>'));
  });

  test('no HTTP library rides along for one GET', () => {
    // A comment says where it went, on purpose — only the tag and the calls count
    expect(html()).not.toMatch(/<script[^>]+axios/);
    expect(html()).not.toMatch(/\baxios\s*\./);
  });

  test('the 118 KB brands webfont is never pulled in', async ({ page }) => {
    // FontAwesome fetches a webfont only when a glyph on the page uses it, and
    // the whole brands family was being pulled for a Google mark and a plane
    expect(html()).not.toContain('fab fa-');

    const fonts: string[] = [];
    page.on('request', (r) => { if (/\.woff2?$/.test(r.url())) fonts.push(r.url()); });
    await loadApp(page);
    await page.waitForTimeout(1200);
    expect(fonts.filter((f) => /fa-brands/.test(f))).toEqual([]);
  });

  test('both brand marks still draw, as SVG', async ({ page }) => {
    await loadAppNoAuth(page);
    const google = page.locator('#login-form svg.brand-icon');
    await expect(google).toBeVisible();
    expect(await google.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(8);

    await loadApp(page);
    await page.evaluate(() => document.getElementById('acc-telegram')!.classList.remove('hidden'));
    const telegram = page.locator('#acc-telegram-btn svg.brand-icon');
    await expect(telegram).toBeVisible();
  });
});
