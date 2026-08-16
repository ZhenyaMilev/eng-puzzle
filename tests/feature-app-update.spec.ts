import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'eng-puzzle');

function serveVersion(page: Page, version: string) {
  const calls: string[] = [];
  page.route('**/version.json*', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version }) });
  });
  return calls;
}

test.describe('App update check', () => {
  // Two files carry the version; if they drift, the app either nags forever or never updates.
  test('version.json matches the version baked into the app', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    const inApp = html.match(/APP_VERSION\s*=\s*'([^']+)'/);
    const inFile = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf-8'));
    expect(inApp).not.toBeNull();
    expect(inApp![1]).toBe(inFile.version);
  });

  test('the HTML is revalidated so a home-screen shortcut cannot keep an old copy', () => {
    const headers = readFileSync(join(ROOT, '_headers'), 'utf-8');
    expect(headers).toMatch(/^\/\s*$/m);
    expect(headers).toMatch(/^\/index\.html\s*$/m);
    expect(headers).toMatch(/^\s+Cache-Control: no-cache\s*$/m);
  });

  test('a newer deployed version raises the update banner', async ({ page }) => {
    await loadApp(page);
    serveVersion(page, 'some-newer-build');

    await page.evaluate(() => {
      // @ts-ignore — the app's own check, normally on a timer
      checkForAppUpdate();
    });

    await expect(page.locator('#app-update-banner')).toBeVisible();
    await expect(page.locator('#app-update-banner')).toContainText('нова версія');
  });

  test('the same version raises nothing', async ({ page }) => {
    await loadApp(page);
    const current = await page.evaluate(() => {
      // @ts-ignore
      return APP_VERSION;
    });
    serveVersion(page, current);

    await page.evaluate(() => {
      // @ts-ignore
      return checkForAppUpdate();
    });
    await page.waitForTimeout(300);

    await expect(page.locator('#app-update-banner')).toHaveCount(0);
  });

  test('the check is asked for again when the app is brought back to the foreground', async ({ page }) => {
    await loadApp(page);
    const calls = serveVersion(page, 'some-newer-build');

    // A home-screen app is resumed, not reloaded — that is the moment to look
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('#app-update-banner')).toBeVisible();
    expect(calls.length).toBeGreaterThan(0);
    // Cache-busted, so no stale answer can come back
    expect(calls[0]).toContain('version.json?t=');
  });

  test('the banner reloads the page off the cache', async ({ page }) => {
    await loadApp(page);
    serveVersion(page, 'some-newer-build');
    await page.evaluate(() => {
      // @ts-ignore
      checkForAppUpdate();
    });
    await expect(page.locator('#app-update-banner')).toBeVisible();

    await page.click('#app-update-banner button');
    await page.waitForURL(/\?v=\d+/);
    expect(page.url()).toMatch(/\?v=\d+/);
  });

  test('an unreachable version file is ignored rather than shown as an error', async ({ page }) => {
    await loadApp(page);
    await page.route('**/version.json*', (route) => route.abort());

    await page.evaluate(() => {
      // @ts-ignore
      return checkForAppUpdate();
    });
    await page.waitForTimeout(300);

    await expect(page.locator('#app-update-banner')).toHaveCount(0);
    await expect(page.locator('#account-screen')).toBeVisible();
  });
});
