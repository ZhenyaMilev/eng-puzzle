import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

const SHARED_FOLDER = {
  type: 'folder',
  title: 'Travel',
  visibility: 'public',
  importCount: 0,
  authorId: 'someone-else',
  words: [
    { english: 'airport', translation: 'аеропорт', example: '' },
    { english: 'ticket', translation: 'квиток', example: '' },
    // Already in the importing user's dictionary — must not be duplicated or reset
    { english: 'cat', translation: 'кошеня', example: '' },
  ],
};

const SHARED_LESSON = {
  type: 'lesson',
  title: 'Present Simple з дошки',
  level: 'A1',
  visibility: 'public',
  importCount: 0,
  authorId: 'someone-else',
  pages: [{ heading: 'Present Simple', paragraphs: ['Для звичок.'], examples: [] }],
  quiz: [{ question: 'Питання', options: ['A', 'B', 'C', 'D'], correct: 0, optionExplanations: ['', '', '', ''] }],
};

test.describe('Importing a shared link', () => {
  test('a folder link offers the folder with a preview of its words', async ({ page }) => {
    await loadApp(page, { seed: { sets: { abc123: SHARED_FOLDER } }, url: '/?set=abc123' });

    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#import-set-title')).toHaveText('Папка «Travel»');
    await expect(page.locator('#import-set-text')).toContainText('Слів і фраз: 3');
    await expect(page.locator('#import-set-preview')).toContainText('airport');
    await expect(page.locator('#import-set-preview')).toContainText('аеропорт');
  });

  test('importing adds the folder and its new words, leaving known ones alone', async ({ page }) => {
    await loadApp(page, { seed: { sets: { abc123: SHARED_FOLDER } }, url: '/?set=abc123' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });

    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });

    const state = await page.evaluate(async () => {
      // @ts-ignore — the app's own Firestore handle
      const words = await db.collection('users').doc('test-user-123').collection('words').get();
      const byId: any = {};
      words.docs.forEach((d: any) => { byId[d.id] = d.data(); });
      // @ts-ignore
      const folders = await db.collection('users').doc('test-user-123').collection('folders').get();
      return { byId, folderNames: folders.docs.map((d: any) => d.data().name) };
    });

    expect(state.folderNames).toContain('Travel');
    expect(Object.keys(state.byId)).toContain('airport');
    expect(state.byId.airport.translation).toBe('аеропорт');
    // "cat" was already known: its own translation stays, it just joins the folder
    expect(state.byId.cat.translation).toBe('кіт');
    expect(state.byId.cat.folders).toHaveLength(1);
  });

  test('the imported folder becomes a chip in the dictionary', async ({ page }) => {
    await loadApp(page, { seed: { sets: { abc123: SHARED_FOLDER } }, url: '/?set=abc123' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });

    await page.click('.acc-action-btn:has-text("Словник")');
    await expect(page.locator('#folder-bar')).toContainText('Travel');
  });

  test('declining leaves the dictionary untouched', async ({ page }) => {
    await loadApp(page, { seed: { sets: { abc123: SHARED_FOLDER } }, url: '/?set=abc123' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });

    await page.click('#import-set-modal .app-modal-actions .secondary');
    await expect(page.locator('#import-set-modal')).toBeHidden();

    const folderCount = await page.evaluate(async () => {
      // @ts-ignore
      const folders = await db.collection('users').doc('test-user-123').collection('folders').get();
      return folders.size;
    });
    expect(folderCount).toBe(0);
  });

  test('a lesson link offers the lesson and files it under grammar', async ({ page }) => {
    await loadApp(page, { seed: { sets: { les777: SHARED_LESSON } }, url: '/?set=les777' });

    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#import-set-title')).toHaveText('Конспект «Present Simple з дошки»');
    await expect(page.locator('#import-set-text')).toContainText('граматики');

    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });

    await page.click('button:has-text("Граматика")');
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-my-list')).toContainText('Present Simple з дошки');
  });

  test('an imported lesson opens with its pages and its own quiz', async ({ page }) => {
    await loadApp(page, { seed: { sets: { les777: SHARED_LESSON } }, url: '/?set=les777' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });

    await page.click('button:has-text("Граматика")');
    await page.click('#grammar-tab-mine');
    await page.locator('#grammar-my-list .topic-info:has-text("Present Simple з дошки")').click();
    await expect(page.locator('#grammar-lesson-content')).toContainText('Для звичок.');

    // Quiz travelled with the lesson, so no AI call is needed to take it
    let aiCalled = false;
    await page.route('**/.netlify/functions/ai', async (route) => { aiCalled = true; await route.abort(); });
    await page.click('#grammar-lesson > button');
    await expect(page.locator('#grammar-quiz-container')).toContainText('Питання');
    expect(aiCalled).toBe(false);
  });

  test('a dead link reports itself instead of hanging on a modal', async ({ page }) => {
    await loadApp(page, { seed: { sets: {} }, url: '/?set=nope' });
    await expect(page.locator('#account-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#import-set-modal')).toBeHidden();
  });

  test('a share link points at the app with the set id', async ({ page }) => {
    await loadApp(page);
    const link = await page.evaluate(() => {
      // @ts-ignore — the app's own helper
      return buildSetLink('xyz');
    });
    expect(link).toContain('?set=xyz');
    expect(link.startsWith('http')).toBe(true);
  });
});
