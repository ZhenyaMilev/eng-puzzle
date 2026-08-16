import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

// Naming and deleting go through the app's own dialogs now, not the browser's.
async function fillAppPrompt(page: Page, value: string) {
  await expect(page.locator('#app-prompt-modal')).toBeVisible();
  await page.fill('#app-prompt-input', value);
  await page.click('#app-prompt-ok');
  await expect(page.locator('#app-prompt-modal')).toBeHidden();
}

async function confirmApp(page: Page) {
  await expect(page.locator('#app-confirm-modal')).toBeVisible();
  await page.click('#app-confirm-ok');
  await expect(page.locator('#app-confirm-modal')).toBeHidden();
}

// Any call to a browser dialog fails the test — they are what we replaced.
function banNativeDialogs(page: Page) {
  return page.addInitScript(() => {
    (window as any).prompt = () => { throw new Error('native prompt() was used'); };
    (window as any).confirm = () => { throw new Error('native confirm() was used'); };
  });
}

async function openDictionary(page: Page) {
  await page.click('.acc-action-btn:has-text("Словник")');
  await expect(page.locator('#my-words-section')).toBeVisible();
}

async function createFolder(page: Page, name: string) {
  await page.click('#folder-bar .folder-chip:has(.fa-plus)');
  await fillAppPrompt(page, name);
  await expect(page.locator(`#folder-bar .folder-chip:has-text("${name}")`)).toBeVisible();
}

// A word with no folder has no folder icon, so filing it starts from its card.
async function openFolderPickerFor(page: Page, word: string) {
  await page.locator(`#words li:has-text("${word}")`).click();
  await page.click('#wordInfoPopup button:has-text("Додати в папку")');
  await expect(page.locator('#folder-pick-modal')).toBeVisible();
}

async function fileWordInto(page: Page, word: string, folder: string) {
  await openFolderPickerFor(page, word);
  await page.click(`#folder-pick-list .folder-pick-row:has-text("${folder}")`);
  await page.click('#folder-pick-modal .app-modal-actions button');
}

test.describe('Dictionary folders', () => {
  test('the folder bar starts with "Всі" and a create button', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);

    await expect(page.locator('#folder-bar .folder-chip').first()).toHaveText('Всі');
    await expect(page.locator('#folder-bar .folder-chip:has(.fa-plus)')).toBeVisible();
    await expect(page.locator('#folder-toolbar')).toBeHidden();
  });

  test('folders are named in the app, never through a browser dialog', async ({ page }) => {
    await banNativeDialogs(page);
    await loadApp(page);
    await openDictionary(page);

    await page.click('#folder-bar .folder-chip:has(.fa-plus)');
    await expect(page.locator('#app-prompt-modal')).toBeVisible();
    await expect(page.locator('#app-prompt-title')).toHaveText('Нова папка');

    await fillAppPrompt(page, 'Travel');
    await expect(page.locator('#folder-bar')).toContainText('Travel');
  });

  test('cancelling the name dialog creates nothing', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);

    await page.click('#folder-bar .folder-chip:has(.fa-plus)');
    await page.click('#app-prompt-modal .app-modal-actions .secondary');

    await expect(page.locator('#app-prompt-modal')).toBeHidden();
    await expect(page.locator('#folder-bar .folder-chip')).toHaveCount(2); // "Всі" + "+"
  });

  test('creating a folder selects it and reveals its toolbar', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');

    await expect(page.locator('#folder-bar .folder-chip.active')).toContainText('Travel');
    await expect(page.locator('#folder-toolbar')).toBeVisible();
    // The chip already names the folder — the toolbar is only the three actions
    await expect(page.locator('#folder-toolbar .folder-toolbar-actions button')).toHaveCount(3);
    await expect(page.locator('#folder-toolbar')).toHaveText('');
    await expect(page.locator('#words li')).toHaveCount(0);
  });

  test('a word can be put into a folder and the folder then lists it', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');

    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await expect(page.locator('#words li')).toHaveCount(5);
    await fileWordInto(page, 'cat', 'Travel');

    await page.click('#folder-bar .folder-chip:has-text("Travel")');
    await expect(page.locator('#words li')).toHaveCount(1);
    await expect(page.locator('#words')).toContainText('cat');
  });

  test('the chip shows how many words are in the folder', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');

    await fileWordInto(page, 'dog', 'Travel');

    await expect(page.locator('#folder-bar .folder-chip:has-text("Travel") .folder-chip-count')).toHaveText('1');
  });

  test('the folder icon appears only on words that are in a folder', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');

    // Nothing is filed yet, so the list carries no folder icons at all
    await expect(page.locator('#words .word-folder-btn')).toHaveCount(0);

    await fileWordInto(page, 'cat', 'Travel');

    await expect(page.locator('#words .word-folder-btn')).toHaveCount(1);
    await expect(page.locator('#words li:has-text("cat") .word-folder-btn')).toBeVisible();
  });

  test('the icon goes away again when the word leaves its last folder', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await fileWordInto(page, 'cat', 'Travel');
    await expect(page.locator('#words .word-folder-btn')).toHaveCount(1);

    await page.locator('#words li:has-text("cat") .word-folder-btn').click();
    await page.click('#folder-pick-list .folder-pick-row:has-text("Travel")');
    await page.click('#folder-pick-modal .app-modal-actions button');

    await expect(page.locator('#words .word-folder-btn')).toHaveCount(0);
  });

  test('renaming updates the chip', async ({ page }) => {
    await banNativeDialogs(page);
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');

    await page.click('#folder-toolbar button[title="Перейменувати"]');
    // The dialog opens with the current name ready to edit
    await expect(page.locator('#app-prompt-input')).toHaveValue('Travel');
    await fillAppPrompt(page, 'Подорожі');

    await expect(page.locator('#folder-bar')).toContainText('Подорожі');
    await expect(page.locator('#folder-bar')).not.toContainText('Travel');
  });

  test('deleting a folder keeps the words in the dictionary', async ({ page }) => {
    await banNativeDialogs(page);
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await fileWordInto(page, 'cat', 'Travel');

    await page.click('#folder-bar .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar button[title="Видалити"]');
    await expect(page.locator('#app-confirm-title')).toContainText('Travel');
    await confirmApp(page);

    await expect(page.locator('#folder-bar')).not.toContainText('Travel');
    await expect(page.locator('#folder-toolbar')).toBeHidden();
    await expect(page.locator('#words li')).toHaveCount(5);
  });

  test('cancelling the delete dialog keeps the folder', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');

    await page.click('#folder-toolbar button[title="Видалити"]');
    await page.click('#app-confirm-modal .app-modal-actions .secondary');

    await expect(page.locator('#app-confirm-modal')).toBeHidden();
    await expect(page.locator('#folder-bar')).toContainText('Travel');
  });

  test('sharing an empty folder is refused instead of publishing nothing', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');

    await page.click('#folder-toolbar button[title="Поділитися"]');
    await expect(page.locator('#share-link-modal')).toBeHidden();
  });

  test('sharing a folder publishes it and shows a link', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await fileWordInto(page, 'cat', 'Travel');

    await page.click('#folder-bar .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar button[title="Поділитися"]');

    await expect(page.locator('#share-link-modal')).toBeVisible();
    await expect(page.locator('#share-link-value')).toContainText('?set=');

    const set = await page.evaluate(async () => {
      const link = document.getElementById('share-link-value')!.textContent || '';
      const id = link.split('?set=')[1];
      // @ts-ignore — the app's own Firestore handle
      const doc = await db.collection('sets').doc(id).get();
      return doc.data();
    });
    expect(set.type).toBe('folder');
    expect(set.title).toBe('Travel');
    expect(set.visibility).toBe('public');
    expect(set.words.map((w: any) => w.english)).toEqual(['cat']);
  });

  test('a word added while a folder is open lands in that folder', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await createFolder(page, 'Travel');

    await page.evaluate(async () => {
      (document.getElementById('english-word') as HTMLInputElement).value = 'river';
      (document.getElementById('translation') as HTMLInputElement).value = 'річка';
      // @ts-ignore — the app's own function
      await addWord();
    });

    const folders = await page.evaluate(async () => {
      // @ts-ignore
      const doc = await db.collection('users').doc('test-user-123').collection('words').doc('river').get();
      return doc.data().folders;
    });
    expect(folders).toHaveLength(1);
  });
});
