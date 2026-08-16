import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');

/**
 * A delete button in every row is a standing offer to destroy what you just
 * added. The actions hide behind a deliberate gesture now — one helper, used
 * by words, phrases and conversation history alike.
 */

async function swipe(page: Page, selector: string, dx: number) {
  await page.evaluate(({ sel, dist }) => {
    const row = document.querySelector(sel) as HTMLElement;
    const at = (x: number) => ({ touches: [{ clientX: x, clientY: 100 }] });
    row.dispatchEvent(Object.assign(new Event('touchstart'), at(300)));
    row.dispatchEvent(Object.assign(new Event('touchmove'), at(300 - 20)));
    row.dispatchEvent(Object.assign(new Event('touchmove'), at(300 + dist)));
    row.dispatchEvent(new Event('touchend'));
  }, { sel: selector, dist: dx });
}

test.describe('Swiping a word row', () => {
  test('the row carries no delete button on its face', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    // The trash used to be a direct child of the row, always one tap from a
    // loss. It exists only inside the hidden action tray now.
    await expect(page.locator('#words li > .fa-trash')).toHaveCount(0);
    await expect(page.locator('#words li .swipe-actions .fa-trash').first()).toHaveCount(1);
  });

  test('a swipe left reveals delete and add-to-folder', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    await swipe(page, '#words li', -120);

    const row = page.locator('#words li').first();
    await expect(row).toHaveClass(/swipe-open/);
    await expect(row.locator('.swipe-action', { hasText: 'Видалити' })).toBeVisible();
    await expect(row.locator('.swipe-action', { hasText: 'Папка' })).toBeVisible();
  });

  test('a short swipe springs back', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    await swipe(page, '#words li', -30);
    await expect(page.locator('#words li').first()).not.toHaveClass(/swipe-open/);
  });

  test('a vertical drag scrolls instead of opening the row', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      const row = document.querySelector('#words li') as HTMLElement;
      const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
      row.dispatchEvent(Object.assign(new Event('touchstart'), at(300, 100)));
      row.dispatchEvent(Object.assign(new Event('touchmove'), at(295, 180)));
      row.dispatchEvent(Object.assign(new Event('touchmove'), at(230, 260)));
      row.dispatchEvent(new Event('touchend'));
    });

    await expect(page.locator('#words li').first()).not.toHaveClass(/swipe-open/);
  });

  test('only one row is open at a time', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').nth(1)).toBeVisible({ timeout: 10000 });

    await swipe(page, '#words li:nth-child(1)', -120);
    await swipe(page, '#words li:nth-child(2)', -120);

    await expect(page.locator('#words li').nth(0)).not.toHaveClass(/swipe-open/);
    await expect(page.locator('#words li').nth(1)).toHaveClass(/swipe-open/);
  });

  test('the folder action opens the folder picker for that word', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    await swipe(page, '#words li', -120);
    await page.locator('#words li .swipe-action', { hasText: 'Папка' }).first().click();

    await expect(page.locator('#folder-pick-modal')).toBeVisible();
    await expect(page.locator('#folder-pick-word')).not.toBeEmpty();
  });

  test('phrases behave the same way', () => {
    const html = readFileSync(INDEX, 'utf-8');
    // One helper, both lists — so they cannot drift apart
    expect((html.match(/makeSwipeable\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Conversation history', () => {
  test('a swipe offers to delete a conversation', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(async () => {
      // @ts-ignore
      await db.collection('users').doc(auth.currentUser.uid).update({
        scHistory: [
          { topic: 'Подорожі', date: new Date().toISOString(), messages: 12, xp: 40, level: 'B1' },
          { topic: 'Робота', date: new Date().toISOString(), messages: 8, xp: 20, level: 'B1' },
        ],
      });
      (window as any).showSpeakingClub();
    });
    await page.evaluate(() => (window as any).scShowHistoryScreen());
    await expect(page.locator('#sc-history .sc-analysis-card').first()).toBeVisible({ timeout: 10000 });

    await swipe(page, '#sc-history .sc-analysis-card', -120);
    await expect(page.locator('#sc-history .sc-analysis-card').first()).toHaveClass(/swipe-open/);
    await expect(page.locator('#sc-history .swipe-action', { hasText: 'Видалити' }).first()).toBeVisible();
  });

  test('deleting one leaves the rest', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(async () => {
      // @ts-ignore
      await db.collection('users').doc(auth.currentUser.uid).update({
        scHistory: [
          { topic: 'Подорожі', date: new Date().toISOString(), messages: 12, xp: 40 },
          { topic: 'Робота', date: new Date().toISOString(), messages: 8, xp: 20 },
        ],
      });
      (window as any).showSpeakingClub();
      (window as any).scShowHistoryScreen();
    });
    await expect(page.locator('#sc-history .sc-analysis-card')).toHaveCount(2, { timeout: 10000 });

    // The confirm blocks until answered, so it cannot be awaited first
    const deleting = page.evaluate(() => (window as any).scDeleteHistory(0));
    await page.click('#app-confirm-ok');
    await deleting;

    await expect(page.locator('#sc-history .sc-analysis-card')).toHaveCount(1);
    await expect(page.locator('#sc-history')).toContainText('Робота');
    await expect(page.locator('#sc-history')).not.toContainText('Подорожі');
  });
});

test.describe('Wording and layout the audit asked for', () => {
  test('the conversation partner is named as an AI', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain('Голос AI-співрозмовника');
    expect(html).toContain('AI-співрозмовник вас пам\'ятає');
  });

  test('the generation screen has no sparkle', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const header = html.slice(html.indexOf('id="daily-words-header"'), html.indexOf('id="daily-words-list"'));
    expect(header).not.toContain('✨');
  });

  test('screen titles are not pressed against the tabs beneath them', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());

    const gap = await page.evaluate(() => {
      const title = document.querySelector('#my-words-section .title-and-btn')!.getBoundingClientRect();
      const tabs = document.querySelector('#my-words-section .vocab-tabs')!.getBoundingClientRect();
      return Math.round(tabs.top - title.bottom);
    });
    expect(gap).toBeGreaterThanOrEqual(10);
  });

  test('the sticky button names what it adds, per tab', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const entry = html.slice(html.indexOf("section: 'daily-words-section'"), html.indexOf("section: 'phrase-constructor-section'"));
    expect(entry).toContain('Додати всі фрази');
    expect(entry).toContain('Додати всі слова');
    expect(entry).toContain('addAllDailyPhrases()');
  });

  test('adding existing words to a folder no longer collides with the per-word picker', () => {
    const html = readFileSync(INDEX, 'utf-8');
    // Two different jobs, two different names
    expect(html).toContain('async function openAddToFolder()');
    expect(html).toContain('function openFolderPicker(id, type)');
    expect((html.match(/function openFolderPicker\(/g) || []).length).toBe(1);
  });
});
