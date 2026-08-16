import { test, expect, Page } from '@playwright/test';
import { loadApp, loadAppNoAuth } from './helpers';

const PHONE = { width: 375, height: 720 };

// Telegram's in-app browser, which is where Google sign-in dead-ends.
function asTelegramWebview(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Telegram-iOS/10.2',
    });
  });
}

test.describe('Login screen', () => {
  test.use({ viewport: PHONE });

  test('the screen says "Вхід" and nothing else above it', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#login-form .auth-title')).toHaveText('Вхід');
    // The app name is redundant here — the card already says what this is
    await expect(page.locator('.title-main')).toBeHidden();
  });

  test('everything in the card shares one alignment', async ({ page }) => {
    await loadAppNoAuth(page);

    const boxes = await page.evaluate(() => {
      const card = document.querySelector('#login-form .auth-card')!.getBoundingClientRect();
      const pick = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { left: Math.round(r.left - card.left), right: Math.round(card.right - r.right) };
      };
      return {
        email: pick('#login-email'),
        password: pick('#login-password'),
        submit: pick('#login-form .auth-primary'),
        google: pick('#login-form .auth-google'),
      };
    });
    // Inputs and both buttons line up on the same edges
    const lefts = Object.values(boxes).map((b: any) => b.left);
    const rights = Object.values(boxes).map((b: any) => b.right);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1);
  });

  test('the card stays inside the screen', async ({ page }) => {
    await loadAppNoAuth(page);
    const m = await page.evaluate(() => ({
      card: document.querySelector('#login-form .auth-card')!.getBoundingClientRect().width,
      body: document.body.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(m.body).toBeLessThanOrEqual(m.inner);
    expect(m.card).toBeLessThanOrEqual(m.inner);
  });

  test('registering is an offer with a name, not a bare underlined link', async ({ page }) => {
    await loadAppNoAuth(page);

    const foot = page.locator('#login-form .auth-foot');
    await expect(foot).toContainText('Ще немає акаунта?');
    const link = foot.locator('.auth-link');
    await expect(link).toHaveText('Зареєструватися');
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');

    await link.click();
    await expect(page.locator('#register-form')).toBeVisible();
    await expect(page.locator('#login-form')).toBeHidden();
  });

  test('the register screen mirrors it and leads back', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.click('#login-form .auth-link');

    await expect(page.locator('#register-form .auth-title')).toHaveText('Реєстрація');
    await expect(page.locator('#register-form .auth-foot')).toContainText('Вже є акаунт?');
    await page.click('#register-form .auth-link');
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('Google sits below a divider, as a second option', async ({ page }) => {
    await loadAppNoAuth(page);
    const order = await page.evaluate(() => {
      const y = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
      return { submit: y('#login-form .auth-primary'), divider: y('#login-form .auth-divider'), google: y('#login-form .auth-google') };
    });
    expect(order.divider).toBeGreaterThan(order.submit);
    expect(order.google).toBeGreaterThan(order.divider);
  });

  test('the app title comes back once signed in', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.title-main')).toBeVisible();
    await expect(page.locator('#login-form')).toBeHidden();
  });
});

test.describe('Staying signed in', () => {
  test.use({ viewport: PHONE });

  test('the session is asked to outlive the tab', async ({ page }) => {
    await loadApp(page);
    const modes = await page.evaluate(() => (window as any).__authCalls.persistence);
    // 'local' survives closing the tab; 'session' or 'none' would not
    expect(modes).toContain('local');
  });

  test('a returning visit lands on the account, not the login form', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#login-form')).toBeHidden();

    await page.reload();
    await page.waitForFunction(() => !document.getElementById('account-screen')?.classList.contains('hidden'));
    await expect(page.locator('#login-form')).toBeHidden();
  });

  test('a redirect coming back from Google is picked up on start', async ({ page }) => {
    await loadApp(page);
    const checked = await page.evaluate(() => (window as any).__authCalls.redirectChecked);
    expect(checked).toBeGreaterThan(0);
  });

  test('phones take the redirect route, desktops keep the popup', async ({ page }) => {
    await loadApp(page);
    const verdicts = await page.evaluate(() => {
      const original = navigator.userAgent;
      const check = (ua: string) => {
        Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true });
        // @ts-ignore — the app's own helper
        return prefersRedirectSignIn();
      };
      const out = {
        iphone: check('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1'),
        android: check('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36'),
        mac: check('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36'),
      };
      Object.defineProperty(navigator, 'userAgent', { get: () => original, configurable: true });
      return out;
    });
    expect(verdicts).toEqual({ iphone: true, android: true, mac: false });
  });
});

test.describe('Google sign-in inside an in-app browser', () => {
  test.use({ viewport: PHONE });

  test('a normal browser gets the Google button as usual', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#login-inapp-note')).toBeHidden();
    await expect(page.locator('#login-form .auth-google')).toBeEnabled();
  });

  test('Telegram gets an explanation instead of a dead end', async ({ page }) => {
    await asTelegramWebview(page);
    await loadAppNoAuth(page);

    const note = page.locator('#login-inapp-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('вбудованому браузері');
    await expect(note).toContainText('поштою');
    await expect(page.locator('#login-form .auth-google')).toBeDisabled();
  });

  test('the note offers a way out to a real browser', async ({ page }) => {
    await asTelegramWebview(page);
    await loadAppNoAuth(page);

    const opened: string[] = [];
    await page.exposeFunction('__recordOpen', (u: string) => { opened.push(u); });
    await page.evaluate(() => {
      // @ts-ignore
      window.open = (u: string) => { (window as any).__recordOpen(u); return {}; };
    });

    await page.click('#login-inapp-note button');
    await expect.poll(() => opened.length).toBe(1);
    expect(opened[0]).toContain('http');
  });

  test('email sign-in is still offered there', async ({ page }) => {
    await asTelegramWebview(page);
    await loadAppNoAuth(page);
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-form .auth-primary')).toBeEnabled();
  });

  test('the detector knows the usual webviews from a real browser', async ({ page }) => {
    await loadAppNoAuth(page);
    const verdicts = await page.evaluate(() => {
      const original = navigator.userAgent;
      const check = (ua: string) => {
        Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true });
        // @ts-ignore — the app's own helper
        return isInAppBrowser();
      };
      const out = {
        telegram: check('Mozilla/5.0 Telegram-iOS/10.2'),
        instagram: check('Mozilla/5.0 Instagram 300.0.0.0'),
        facebook: check('Mozilla/5.0 [FBAN/FBIOS;FBAV/440.0]'),
        safari: check('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Safari/604.1'),
        chrome: check('Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36'),
      };
      Object.defineProperty(navigator, 'userAgent', { get: () => original, configurable: true });
      return out;
    });
    expect(verdicts).toEqual({ telegram: true, instagram: true, facebook: true, safari: false, chrome: false });
  });
});
