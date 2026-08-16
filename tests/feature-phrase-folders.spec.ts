import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

// The shared mock keeps `phrases` empty, so seed a few through the app's own handle.
async function seedPhrases(page: Page) {
  await page.evaluate(async () => {
    const rows = [
      { id: 'slow_down', english: 'Slow down', translation: 'Пригальмуйте' },
      { id: 'take_a_seat', english: 'Take a seat', translation: 'Сідайте' },
      { id: 'see_you_later', english: 'See you later', translation: 'До зустрічі' },
    ];
    for (const r of rows) {
      // @ts-ignore — the app's own Firestore handle
      await db.collection('users').doc('test-user-123').collection('phrases').doc(r.id).set({
        english: r.english, translation: r.translation,
        interactions: 0, correctAnswers: 0, priority: 0, folders: [],
        dateAdded: { seconds: 1 },
      });
    }
  });
}

async function fillAppPrompt(page: Page, value: string) {
  await expect(page.locator('#app-prompt-modal')).toBeVisible();
  await page.fill('#app-prompt-input', value);
  await page.click('#app-prompt-ok');
  await expect(page.locator('#app-prompt-modal')).toBeHidden();
}

async function openPhrases(page: Page) {
  await page.click('.acc-action-btn:has-text("Словник")');
  await expect(page.locator('#my-words-section')).toBeVisible();
  await seedPhrases(page);
  await page.click('#vocab-tab-phrases');
  await expect(page.locator('#vocab-phrases-content')).toBeVisible();
}

async function createFolderFromPhrases(page: Page, name: string) {
  await page.click('#folder-bar-phrases .folder-chip:has(.fa-plus)');
  await fillAppPrompt(page, name);
  await expect(page.locator(`#folder-bar-phrases .folder-chip:has-text("${name}")`)).toBeVisible();
}

// A phrase with no folder shows no folder icon, so filing starts from its card.
async function filePhraseInto(page: Page, phrase: string, folder: string) {
  await page.locator(`#phrases li:has-text("${phrase}")`).click();
  await page.click('button:has-text("Додати в папку")');
  await expect(page.locator('#folder-pick-modal')).toBeVisible();
  await page.click(`#folder-pick-list .folder-pick-row:has-text("${folder}")`);
  await page.click('#folder-pick-modal .app-modal-actions button');
}

test.describe('Phrase folders', () => {
  test('the phrases tab has a folder bar of its own', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);

    await expect(page.locator('#folder-bar-phrases .folder-chip').first()).toHaveText('Всі');
    await expect(page.locator('#folder-bar-phrases .folder-chip:has(.fa-plus)')).toBeVisible();
    await expect(page.locator('#folder-toolbar-phrases')).toBeHidden();
  });

  // Phrases are their own entity: their folders are separate from the word ones.
  test('a phrase folder does not appear among the word folders', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');

    await page.click('#vocab-tab-words');
    await expect(page.locator('#folder-bar')).not.toContainText('Travel');
    await expect(page.locator('#folder-bar .folder-chip')).toHaveCount(2); // "Всі" + "+"
  });

  test('a word folder does not appear among the phrase folders', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('#folder-bar .folder-chip:has(.fa-plus)');
    await fillAppPrompt(page, 'Words only');

    await seedPhrases(page);
    await page.click('#vocab-tab-phrases');
    await expect(page.locator('#folder-bar-phrases')).not.toContainText('Words only');
    await expect(page.locator('#folder-bar-phrases .folder-chip')).toHaveCount(2);
  });

  test('the two kinds are stored apart', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');

    const stored = await page.evaluate(async () => {
      // @ts-ignore — the app's own Firestore handle
      const words = await db.collection('users').doc('test-user-123').collection('folders').get();
      // @ts-ignore
      const phrases = await db.collection('users').doc('test-user-123').collection('phraseFolders').get();
      return { words: words.size, phrases: phrases.docs.map((d: any) => d.data().name) };
    });
    expect(stored.words).toBe(0);
    expect(stored.phrases).toEqual(['Travel']);
  });

  test('a phrase can be filed and the folder then lists only it', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');

    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');
    await expect(page.locator('#phrases li')).toHaveCount(3);

    await filePhraseInto(page, 'Slow down', 'Travel');

    await page.click('#folder-bar-phrases .folder-chip:has-text("Travel")');
    await expect(page.locator('#phrases li')).toHaveCount(1);
    await expect(page.locator('#phrases')).toContainText('Slow down');
  });

  test('the folder icon appears only on phrases that are in a folder', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');

    await expect(page.locator('#phrases .word-folder-btn')).toHaveCount(0);
    await filePhraseInto(page, 'Slow down', 'Travel');
    await expect(page.locator('#phrases .word-folder-btn')).toHaveCount(1);
  });

  test('the chip counts the phrases inside it', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');
    await filePhraseInto(page, 'Slow down', 'Travel');

    await expect(page.locator('#folder-bar-phrases .folder-chip:has-text("Travel") .folder-chip-count')).toHaveText('1');
  });

  test('the picker for a phrase offers phrase folders only', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('#folder-bar .folder-chip:has(.fa-plus)');
    await fillAppPrompt(page, 'Words only');

    await seedPhrases(page);
    await page.click('#vocab-tab-phrases');
    await createFolderFromPhrases(page, 'Phrases only');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');

    await page.locator('#phrases li:has-text("Slow down")').click();
    await page.click('button:has-text("Додати в папку")');
    await expect(page.locator('#folder-pick-list')).toContainText('Phrases only');
    await expect(page.locator('#folder-pick-list')).not.toContainText('Words only');
  });

  test('sharing a folder carries its phrases alongside its words', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');
    await filePhraseInto(page, 'Slow down', 'Travel');

    await page.click('#folder-bar-phrases .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar-phrases button[title="Поділитися"]');
    await expect(page.locator('#share-link-modal')).toBeVisible();

    const set = await page.evaluate(async () => {
      const link = document.getElementById('share-link-value')!.textContent || '';
      // @ts-ignore
      const doc = await db.collection('sets').doc(link.split('?set=')[1]).get();
      return doc.data();
    });
    expect(set.kind).toBe('phrases');
    expect(set.phrases.map((p: any) => p.english)).toEqual(['Slow down']);
    expect(set.words).toEqual([]);
  });

  test('deleting a folder keeps the phrases in the dictionary', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');
    await filePhraseInto(page, 'Slow down', 'Travel');

    await page.click('#folder-bar-phrases .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar-phrases button[title="Видалити"]');
    await page.click('#app-confirm-ok');

    await expect(page.locator('#folder-bar-phrases')).not.toContainText('Travel');
    await expect(page.locator('#phrases li')).toHaveCount(3);
  });

  test('a phrase added while a folder is open lands in it', async ({ page }) => {
    await loadApp(page);
    await openPhrases(page);
    await createFolderFromPhrases(page, 'Travel');

    await page.evaluate(async () => {
      (document.getElementById('phrase-english-inline') as HTMLInputElement).value = 'Watch out';
      (document.getElementById('phrase-translation-inline') as HTMLInputElement).value = 'Обережно';
      // @ts-ignore — the app's own function
      await addPhraseInline();
    });

    const folders = await page.evaluate(async () => {
      // @ts-ignore
      const doc = await db.collection('users').doc('test-user-123').collection('phrases').doc('watch_out').get();
      return doc.data().folders;
    });
    expect(folders).toHaveLength(1);
  });
});
