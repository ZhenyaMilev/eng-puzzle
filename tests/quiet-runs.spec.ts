import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A run must never make a sound. Every exercise speaks its word as it shows it,
 * and with no AI key that falls through to speechSynthesis — which on a Mac is
 * the system voice, a process of its own that Chromium's --mute-audio does not
 * reach. A full suite was reading hundreds of words out loud across the room.
 */
test.describe('A test run is silent', () => {
  test('the browser speaks through a stub, not through the machine', async ({ page }) => {
    await loadApp(page);

    const stubbed = await page.evaluate(() =>
      Object.prototype.hasOwnProperty.call(window.speechSynthesis, 'speak'));
    expect(stubbed).toBe(true);

    await page.evaluate(() => (window as any).kokoroSpeak('hello', 'UK English Female'));
    await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toContain('hello');
  });

  /**
   * Silence cannot be bought with a hang: the app hands its utterance an onend
   * and waits for it before moving to the next word.
   */
  test('and the callback the app waits for still arrives', async ({ page }) => {
    await loadApp(page);
    const outcome = await page.evaluate(() => new Promise((done) => {
      (window as any).kokoroSpeak('cat', 'UK English Female', { onend: () => done('ended') });
      setTimeout(() => done('hung'), 2000);
    }));
    expect(outcome).toBe('ended');
  });

  test('audio elements are muted before they are allowed to play', async ({ page }) => {
    await loadApp(page);
    const muted = await page.evaluate(() => {
      const audio = new Audio();
      // Not awaited on purpose: with no source the promise never settles, and
      // the muting happens before the call is passed on anyway
      audio.play().catch(() => {});
      return { muted: audio.muted, volume: audio.volume };
    });
    expect(muted).toEqual({ muted: true, volume: 0 });
  });

  test('the browser itself is launched muted as well', () => {
    const config = readFileSync(join(__dirname, '..', 'playwright.config.ts'), 'utf-8');
    expect(config).toContain("'--mute-audio'");
  });
});
