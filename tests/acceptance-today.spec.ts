import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Acceptance pass over everything changed in this round of work.
 * Each check walks the app the way a person would, rather than poking internals,
 * so a feature that only works "on paper" fails here.
 */

const ROOT = join(__dirname, '..', 'eng-puzzle');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
  'base64'
);

const LESSON_JSON = {
  title: 'Часи в англійській мові',
  level: 'A1',
  pages: [
    { heading: 'Present', paragraphs: ['Про **зараз**.'], examples: [{ en: 'I am working.', uk: 'Я працюю.' }] },
    { heading: 'Past', paragraphs: ['Про **минуле**.'], examples: [] },
  ],
  quiz: [
    { question: 'Обери правильне', options: ['I working', 'I am working', 'I works', 'I be working'], correct: 1, optionExplanations: ['', '', '', ''] },
  ],
};


function mockAi(page: Page, payload: any) {
  const calls: any[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    const sent = route.request().postDataJSON();
    if (sent.route !== 'chat') return route.fallback();
    calls.push(sent.body);
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: body } }] }),
    });
  });
  return calls;
}

function applySubscription(page: Page, d: { lifetime?: boolean; expiresInDays?: number; registeredDaysAgo?: number; plan?: string }) {
  return page.evaluate((data) => {
    const stamp = (date: Date) => ({ toDate: () => date });
    const day = 24 * 60 * 60 * 1000;
    const userData: any = { email: 'test@example.com' };
    if (data.lifetime) userData.lifetime = true;
    if (data.expiresInDays !== undefined) userData.subscriptionExpiration = stamp(new Date(Date.now() + data.expiresInDays * day));
    if (data.registeredDaysAgo !== undefined) userData.registrationDate = stamp(new Date(Date.now() - data.registeredDaysAgo * day));
    if (data.plan) userData.subscriptionPlan = data.plan;
    // @ts-ignore
    checkSubscription(userData);
  }, d);
}

const openDictionary = (page: Page) => page.click('.acc-action-btn:has-text("Словник")');
const openAdd = (page: Page) => page.click('.acc-action-btn:has-text("Додати")');
const openGrammar = (page: Page) => page.click('.acc-tile:has-text("Граматика")');

async function makeFolder(page: Page, name: string, bar = '#folder-bar') {
  await page.click(`${bar} .folder-chip:has(.fa-plus)`);
  await page.fill('#app-prompt-input', name);
  await page.click('#app-prompt-ok');
  await expect(page.locator(`${bar} .folder-chip:has-text("${name}")`)).toBeVisible();
}

async function fileWord(page: Page, word: string, folder: string) {
  await page.locator(`#words li:has-text("${word}")`).click();
  await page.click('#wordInfoPopup button:has-text("Додати в папку")');
  await page.click(`#folder-pick-list .folder-pick-row:has-text("${folder}")`);
  await page.click('#folder-pick-modal .app-modal-actions button');
}

async function seedPhrases(page: Page) {
  await page.evaluate(async () => {
    const rows = [
      { id: 'slow_down', english: 'Slow down', translation: 'Пригальмуйте' },
      { id: 'take_a_seat', english: 'Take a seat', translation: 'Сідайте' },
    ];
    for (const r of rows) {
      // @ts-ignore
      await db.collection('users').doc('test-user-123').collection('phrases').doc(r.id).set({
        english: r.english, translation: r.translation,
        interactions: 0, correctAnswers: 0, priority: 0, folders: [], dateAdded: { seconds: 1 },
      });
    }
  });
}

// ─────────────────────────────  subscription  ─────────────────────────────

test.describe('1. Subscription badge and paywall', () => {
  test('1.1 lifetime access reads PRO ∞ and keeps the app open', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { lifetime: true, registeredDaysAgo: 400 });
    await expect(page.locator('#subscription-badge-label')).toHaveText('PRO ∞');
    await expect(page.locator('#account-screen')).toBeVisible();
  });

  test('1.2 a paid subscription counts the days down', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: 12, registeredDaysAgo: 60, plan: 'paid' });
    await expect(page.locator('#subscription-badge-label')).toHaveText('PRO 12д');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-active/);
  });

  test('1.3 the signup grant reads as a trial, in its own colour', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: 3, registeredDaysAgo: 0 });
    await expect(page.locator('#subscription-badge-label')).toHaveText('Проба 3д');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-trial/);
  });

  test('1.4 an old account on a long plan is not mistaken for a trial', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: 300, registeredDaysAgo: 200 });
    await expect(page.locator('#subscription-badge-label')).toHaveText('PRO 300д');
  });

  test('1.5 expiry closes the app behind the payment screen', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: -2, registeredDaysAgo: 60, plan: 'paid' });
    await expect(page.locator('#payment-section')).toBeVisible();
    await expect(page.locator('#account-screen')).toBeHidden();
    await expect(page.locator('#subscription-badge-label')).toHaveText('Оплата');
  });

  test('1.6 the star + back route cannot walk around an expired subscription', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: -2, registeredDaysAgo: 60, plan: 'paid' });
    await page.click('#subscription-badge');
    await expect(page.locator('#tariffs-section')).toBeVisible();
    await page.click('#tariffs-section .back-button');
    await expect(page.locator('#payment-section')).toBeVisible();
    await expect(page.locator('#account-screen')).toBeHidden();
  });

  test('1.7 an active subscription still returns to the account', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: 12, registeredDaysAgo: 60, plan: 'paid' });
    await page.click('#subscription-badge');
    await page.click('#tariffs-section .back-button');
    await expect(page.locator('#account-screen')).toBeVisible();
  });

  test('1.8 a missing expiry is treated as no access', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { registeredDaysAgo: 10 });
    await expect(page.locator('#payment-section')).toBeVisible();
  });

  test('1.9 the old subscription bar is gone from the body', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#subscription-info')).toHaveCount(0);
    await expect(page.locator('#account-screen')).not.toContainText('Підписка:');
  });
});

// ─────────────────────────────  translations  ─────────────────────────────

test.describe('2. Translation suggestions', () => {
  test('2.1 AI answers and the crowd memory is never touched', async ({ page }) => {
    await loadApp(page);
    let memoryHit = false;
    await page.route('**/api.mymemory.translated.net/**', async (r) => {
      memoryHit = true;
      await r.fulfill({ contentType: 'application/json', body: '{}' });
    });
    const calls = mockAi(page, ['тінь', 'затінок']);

    await openAdd(page);
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(2, { timeout: 10000 });
    expect(memoryHit).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test('2.2 broken encodings and foreign strings are filtered out', async ({ page }) => {
    await loadApp(page);
    mockAi(page, ['ÐØÐ³Ð¼Ñ', 'shadeNote KRunner keyword', 'тінь']);

    await openAdd(page);
    await page.fill('#english-word', 'Shade');
    const list = page.locator('#translation-suggestions .suggestion');
    await expect(list).toHaveCount(1, { timeout: 10000 });
    await expect(list.first()).toHaveText('тінь');
  });

  test('2.3 duplicates collapse to one entry', async ({ page }) => {
    await loadApp(page);
    mockAi(page, ['Пригальмуйте', 'пригальмуйте', 'ПРИГАЛЬМУЙТЕ']);

    await openAdd(page);
    await page.fill('#english-word', 'Slow down');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(1, { timeout: 10000 });
  });

  test('2.4 picking one fills the field and closes everything', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, ['тінь', 'затінок']);

    await openAdd(page);
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(2, { timeout: 10000 });
    await page.locator('#translation-suggestions .suggestion').first().click();
    await page.waitForTimeout(1500);

    expect(await page.locator('#translation').inputValue()).toBe('тінь');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(0);
    await expect(page.locator('#reverse-translation-suggestions .suggestion')).toHaveCount(0);
    expect(calls).toHaveLength(1);
  });

  test('2.5 suggestions arrive while typing, not when leaving the field', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, ['тінь']);

    await openAdd(page);
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(1, { timeout: 10000 });

    const before = (await page.locator('#add-word-form > button').boundingBox())!;
    await page.locator('#english-word').blur();
    await page.waitForTimeout(1200);
    expect(calls).toHaveLength(1);
    const after = (await page.locator('#add-word-form > button').boundingBox())!;
    expect(after.y).toBe(before.y);
  });

  test('2.6 tapping "Додати" straight after typing adds the word', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/ai', async (route) => {
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '["тінь"]' } }] }) });
    });

    await openAdd(page);
    await page.fill('#english-word', 'Shade');
    await page.fill('#translation', 'Тінь');
    await page.locator('#add-word-form > button').click();
    await expect(page.locator('#english-word')).toHaveValue('', { timeout: 10000 });
  });

  test('2.7 the suggestion list never covers the add button', async ({ page }) => {
    await loadApp(page);
    mockAi(page, ['тінь', 'затінок', 'сутінки']);

    await openAdd(page);
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(3, { timeout: 10000 });
    const list = (await page.locator('#translation-suggestions').boundingBox())!;
    const button = (await page.locator('#add-word-form > button').boundingBox())!;
    expect(list.y + list.height).toBeLessThanOrEqual(button.y);
  });
});

// ─────────────────────────────  add word / phrase  ─────────────────────────────

test.describe('3. Adding words and phrases', () => {
  test('3.1 a Cyrillic word gets a specific hint', async ({ page }) => {
    await loadApp(page);
    await openAdd(page);
    await page.fill('#english-word', 'шейд');
    await page.click('#add-word-form button:has-text("Додати")');
    await expect(page.locator('#english-word-error')).toContainText('латиницею');
  });

  test('3.2 the error clears the moment the field is corrected', async ({ page }) => {
    await loadApp(page);
    await openAdd(page);
    await page.click('#add-word-form button:has-text("Додати")');
    await expect(page.locator('#english-word-error')).not.toHaveText('');
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#english-word-error')).toHaveText('');
  });

  test('3.3 hyphenated words are accepted', async ({ page }) => {
    await loadApp(page);
    await openAdd(page);
    await page.fill('#english-word', 'well-known');
    await page.fill('#translation', 'відомий');
    await page.click('#add-word-form button:has-text("Додати")');
    await expect(page.locator('#english-word-error')).toHaveText('');
  });

  test('3.4 the word tab offers camera and gallery separately', async ({ page }) => {
    await loadApp(page);
    await openAdd(page);
    await expect(page.locator('#photo-upload-label input[capture="environment"]')).toHaveCount(1);
    const gallery = page.locator('#photo-gallery-label input[type="file"]');
    await expect(gallery).toHaveAttribute('accept', 'image/*');
    expect(await gallery.getAttribute('capture')).toBeNull();
  });

  test('3.5 the phrase tab offers the same two sources', async ({ page }) => {
    await loadApp(page);
    await openAdd(page);
    await page.click('#add-tab-phrase');
    await expect(page.locator('#phrase-photo-upload-label input[capture="environment"]')).toHaveCount(1);
    expect(await page.locator('#phrase-photo-gallery-label input[type="file"]').getAttribute('capture')).toBeNull();
  });

  test('3.6 a gallery pick runs the word extraction', async ({ page }) => {
    await loadApp(page);
    mockAi(page, [{ english: 'shade', translation: 'тінь' }]);
    await openAdd(page);

    await page.setInputFiles('#photo-gallery-label input[type="file"]', { name: 'g.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.locator('#photo-words-preview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#photo-words-list')).toContainText('shade');
    await expect(page.locator('#photo-upload-row')).toBeVisible();
  });

  test('3.7 a photo on the phrase tab yields phrases, not single words', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, [{ english: 'Slow down', translation: 'Пригальмуйте' }]);
    await openAdd(page);
    await page.click('#add-tab-phrase');

    await page.setInputFiles('#phrase-photo-upload-label input[type="file"]', { name: 'p.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.locator('#photo-phrases-list')).toContainText('Slow down', { timeout: 10000 });
    expect(calls[0].messages[0].content[0].text).toContain('phrases');
  });

  test('3.8 selecting extracted phrases reveals a counted bulk add', async ({ page }) => {
    await loadApp(page);
    mockAi(page, [{ english: 'Slow down', translation: 'Пригальмуйте' }, { english: 'Take a seat', translation: 'Сідайте' }]);
    await openAdd(page);
    await page.click('#add-tab-phrase');
    await page.setInputFiles('#phrase-photo-upload-label input[type="file"]', { name: 'p.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.locator('#photo-phrases-list button')).toHaveCount(2, { timeout: 10000 });

    await expect(page.locator('#bulk-add-photo-phrases')).toBeHidden();
    await page.locator('#photo-phrases-list button').first().click();
    await expect(page.locator('#photo-phrases-selected-count')).toHaveText('1');
  });
});

// ─────────────────────────────  folders  ─────────────────────────────

test.describe('4. Folders', () => {
  test('4.1 naming a folder never reaches a browser dialog', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).prompt = () => { throw new Error('native prompt used'); };
      (window as any).confirm = () => { throw new Error('native confirm used'); };
    });
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await expect(page.locator('#folder-bar')).toContainText('Travel');
  });

  test('4.2 cancelling the name dialog creates nothing', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await page.click('#folder-bar .folder-chip:has(.fa-plus)');
    await page.click('#app-prompt-modal .app-modal-actions .secondary');
    await expect(page.locator('#folder-bar .folder-chip')).toHaveCount(2);
  });

  test('4.3 a new folder is selected and shows only its own words', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await expect(page.locator('#folder-toolbar')).toBeVisible();
    await expect(page.locator('#words li')).toHaveCount(0);
  });

  test('4.4 the toolbar carries actions only, no title', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await expect(page.locator('#folder-toolbar .folder-toolbar-actions button')).toHaveCount(3);
    await expect(page.locator('#folder-toolbar')).toHaveText('');
  });

  test('4.5 filing a word puts it in the folder and marks the row', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await expect(page.locator('#words .word-folder-btn')).toHaveCount(0);

    await fileWord(page, 'cat', 'Travel');
    await expect(page.locator('#words .word-folder-btn')).toHaveCount(1);

    await page.click('#folder-bar .folder-chip:has-text("Travel")');
    await expect(page.locator('#words li')).toHaveCount(1);
  });

  test('4.6 the card names the folders a word already sits in', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await fileWord(page, 'cat', 'Travel');

    await page.locator('#words li:has-text("cat")').click();
    await expect(page.locator('#wordInfoPopup')).toContainText('Вже у папках: Travel');
  });

  test('4.7 a word in no folder says so', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await page.locator('#words li:has-text("dog")').click();
    await expect(page.locator('#wordInfoPopup')).toContainText('Ще не в жодній папці');
  });

  test('4.8 renaming updates the chip', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.click('#folder-toolbar button[title="Перейменувати"]');
    await expect(page.locator('#app-prompt-input')).toHaveValue('Travel');
    await page.fill('#app-prompt-input', 'Подорожі');
    await page.click('#app-prompt-ok');
    await expect(page.locator('#folder-bar')).toContainText('Подорожі');
  });

  test('4.9 deleting a folder leaves the words alone', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await fileWord(page, 'cat', 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar button[title="Видалити"]');
    await page.click('#app-confirm-ok');
    await expect(page.locator('#words li')).toHaveCount(5);
  });

  test('4.10 an empty folder refuses to be shared', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.click('#folder-toolbar button[title="Поділитися"]');
    await expect(page.locator('#share-link-modal')).toBeHidden();
  });

  test('4.11 sharing publishes a public set behind a link', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Всі")');
    await fileWord(page, 'cat', 'Travel');
    await page.click('#folder-bar .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar button[title="Поділитися"]');

    await expect(page.locator('#share-link-value')).toContainText('?set=');
    const set = await page.evaluate(async () => {
      const link = document.getElementById('share-link-value')!.textContent || '';
      // @ts-ignore
      return (await db.collection('sets').doc(link.split('?set=')[1]).get()).data();
    });
    expect(set.type).toBe('folder');
    expect(set.visibility).toBe('public');
    expect(set.words.map((w: any) => w.english)).toEqual(['cat']);
  });

  test('4.12 a word added inside a folder joins it', async ({ page }) => {
    await loadApp(page);
    await openDictionary(page);
    await makeFolder(page, 'Travel');
    await page.evaluate(async () => {
      (document.getElementById('english-word') as HTMLInputElement).value = 'river';
      (document.getElementById('translation') as HTMLInputElement).value = 'річка';
      // @ts-ignore
      await addWord();
    });
    const folders = await page.evaluate(async () => {
      // @ts-ignore
      return (await db.collection('users').doc('test-user-123').collection('words').doc('river').get()).data().folders;
    });
    expect(folders).toHaveLength(1);
  });
});

test.describe('5. Folders on the phrases tab', () => {
  async function openPhrasesTab(page: Page) {
    await openDictionary(page);
    await seedPhrases(page);
    await page.click('#vocab-tab-phrases');
  }

  test('5.1 the phrases tab has its own folder bar', async ({ page }) => {
    await loadApp(page);
    await openPhrasesTab(page);
    await expect(page.locator('#folder-bar-phrases .folder-chip').first()).toHaveText('Всі');
  });

  // Phrases are their own entity — their folders are not the word ones.
  test('5.2 a phrase folder stays out of the words tab', async ({ page }) => {
    await loadApp(page);
    await openPhrasesTab(page);
    await makeFolder(page, 'Travel', '#folder-bar-phrases');
    await page.click('#vocab-tab-words');
    await expect(page.locator('#folder-bar')).not.toContainText('Travel');
  });

  test('5.3 a phrase can be filed and the folder lists only it', async ({ page }) => {
    await loadApp(page);
    await openPhrasesTab(page);
    await makeFolder(page, 'Travel', '#folder-bar-phrases');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');

    await page.locator('#phrases li:has-text("Slow down")').click();
    await page.click('button:has-text("Додати в папку")');
    await page.click('#folder-pick-list .folder-pick-row:has-text("Travel")');
    await page.click('#folder-pick-modal .app-modal-actions button');

    await page.click('#folder-bar-phrases .folder-chip:has-text("Travel")');
    await expect(page.locator('#phrases li')).toHaveCount(1);
  });

  test('5.4 the chip counts the phrases inside it', async ({ page }) => {
    await loadApp(page);
    await openPhrasesTab(page);
    await makeFolder(page, 'Travel', '#folder-bar-phrases');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');
    await page.locator('#phrases li:has-text("Slow down")').click();
    await page.click('button:has-text("Додати в папку")');
    await page.click('#folder-pick-list .folder-pick-row:has-text("Travel")');
    await page.click('#folder-pick-modal .app-modal-actions button');

    await expect(page.locator('#folder-bar-phrases .folder-chip:has-text("Travel") .folder-chip-count')).toHaveText('1');
  });

  test('5.6 the two kinds live in separate collections', async ({ page }) => {
    await loadApp(page);
    await openPhrasesTab(page);
    await makeFolder(page, 'Travel', '#folder-bar-phrases');

    const stored = await page.evaluate(async () => {
      // @ts-ignore
      const w = await db.collection('users').doc('test-user-123').collection('folders').get();
      // @ts-ignore
      const p = await db.collection('users').doc('test-user-123').collection('phraseFolders').get();
      return { words: w.size, phrases: p.size };
    });
    expect(stored.words).toBe(0);
    expect(stored.phrases).toBe(1);
  });

  test('5.5 sharing carries phrases as well as words', async ({ page }) => {
    await loadApp(page);
    await openPhrasesTab(page);
    await makeFolder(page, 'Travel', '#folder-bar-phrases');
    await page.click('#folder-bar-phrases .folder-chip:has-text("Всі")');
    await page.locator('#phrases li:has-text("Slow down")').click();
    await page.click('button:has-text("Додати в папку")');
    await page.click('#folder-pick-list .folder-pick-row:has-text("Travel")');
    await page.click('#folder-pick-modal .app-modal-actions button');

    await page.click('#folder-bar-phrases .folder-chip:has-text("Travel")');
    await page.click('#folder-toolbar-phrases button[title="Поділитися"]');
    const set = await page.evaluate(async () => {
      const link = document.getElementById('share-link-value')!.textContent || '';
      // @ts-ignore
      return (await db.collection('sets').doc(link.split('?set=')[1]).get()).data();
    });
    expect(set.phrases.map((p: any) => p.english)).toEqual(['Slow down']);
  });
});

// ─────────────────────────────  import  ─────────────────────────────

const SHARED_FOLDER = {
  type: 'folder', title: 'Travel', visibility: 'public', importCount: 0, authorId: 'other',
  words: [
    { english: 'airport', translation: 'аеропорт', example: '' },
    { english: 'cat', translation: 'кошеня', example: '' },
  ],
  phrases: [{ english: 'Slow down', translation: 'Пригальмуйте' }],
};

const SHARED_LESSON = {
  type: 'lesson', title: 'Present Simple', level: 'A1', visibility: 'public', importCount: 0, authorId: 'other',
  pages: [{ heading: 'Present Simple', paragraphs: ['Для звичок.'], examples: [] }],
  quiz: [{ question: 'Питання', options: ['A', 'B', 'C', 'D'], correct: 0, optionExplanations: ['', '', '', ''] }],
};

test.describe('6. Importing a shared link', () => {
  test('6.1 a folder link previews what is inside', async ({ page }) => {
    await loadApp(page, { seed: { sets: { s1: SHARED_FOLDER } }, url: '/?set=s1' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#import-set-title')).toHaveText('Папка «Travel»');
    await expect(page.locator('#import-set-text')).toContainText('3');
    await expect(page.locator('#import-set-preview')).toContainText('airport');
    await expect(page.locator('#import-set-preview')).toContainText('Slow down');
  });

  test('6.2 importing brings words and phrases, sparing what is already known', async ({ page }) => {
    await loadApp(page, { seed: { sets: { s1: SHARED_FOLDER } }, url: '/?set=s1' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });

    const state = await page.evaluate(async () => {
      // @ts-ignore
      const w = await db.collection('users').doc('test-user-123').collection('words').get();
      // @ts-ignore
      const p = await db.collection('users').doc('test-user-123').collection('phrases').get();
      // @ts-ignore
      const f = await db.collection('users').doc('test-user-123').collection('folders').get();
      const byId: any = {};
      w.docs.forEach((d: any) => { byId[d.id] = d.data(); });
      return { byId, phrases: p.docs.map((d: any) => d.id), folders: f.docs.map((d: any) => d.data().name) };
    });
    expect(state.folders).toContain('Travel');
    expect(state.byId.airport.translation).toBe('аеропорт');
    expect(state.byId.cat.translation).toBe('кіт');      // the importer's own translation survives
    expect(state.byId.cat.folders).toHaveLength(1);
    expect(state.phrases).toContain('slow_down');
  });

  test('6.3 the imported folder shows up as a chip', async ({ page }) => {
    await loadApp(page, { seed: { sets: { s1: SHARED_FOLDER } }, url: '/?set=s1' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });
    await openDictionary(page);
    await expect(page.locator('#folder-bar')).toContainText('Travel');
  });

  test('6.4 declining changes nothing', async ({ page }) => {
    await loadApp(page, { seed: { sets: { s1: SHARED_FOLDER } }, url: '/?set=s1' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await page.click('#import-set-modal .app-modal-actions .secondary');
    const folders = await page.evaluate(async () => {
      // @ts-ignore
      return (await db.collection('users').doc('test-user-123').collection('folders').get()).size;
    });
    expect(folders).toBe(0);
  });

  test('6.5 a lesson link files itself under my lessons, quiz included', async ({ page }) => {
    await loadApp(page, { seed: { sets: { l1: SHARED_LESSON } }, url: '/?set=l1' });
    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await page.click('#import-set-confirm');
    await expect(page.locator('#import-set-modal')).toBeHidden({ timeout: 15000 });

    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.locator('#grammar-my-list .topic-info:has-text("Present Simple")').click();
    await expect(page.locator('#grammar-lesson-content')).toContainText('Для звичок.');

    let aiHit = false;
    await page.route('**/.netlify/functions/ai', async (r) => { aiHit = true; await r.abort(); });
    await page.click('#grammar-lesson > button');
    await expect(page.locator('#grammar-quiz-container')).toContainText('Питання');
    expect(aiHit).toBe(false);
  });

  test('6.6 a dead link says nothing rather than hanging', async ({ page }) => {
    await loadApp(page, { seed: { sets: {} }, url: '/?set=missing' });
    await expect(page.locator('#account-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#import-set-modal')).toBeHidden();
  });
});

// ─────────────────────────────  grammar  ─────────────────────────────

test.describe('7. Grammar and custom lessons', () => {
  test('7.1 topics and my lessons are separate tabs', async ({ page }) => {
    await loadApp(page);
    await openGrammar(page);
    await expect(page.locator('#grammar-tab-topics')).toHaveClass(/active/);
    await expect(page.locator('#grammar-topics-view')).toBeVisible();
    await expect(page.locator('#grammar-mine-view')).toBeHidden();
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-mine-view')).toBeVisible();
  });

  test('7.2 every topic icon is a real glyph, no emoji left', async ({ page }) => {
    await loadApp(page);
    await openGrammar(page);
    await page.waitForTimeout(1200); // let the icon font land

    const bad = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('#grammar-topic-list .topic-icon').forEach((el) => {
        const icon = el.querySelector('i');
        if (!icon) { out.push('no <i>: ' + el.textContent); return; }
        const c = getComputedStyle(icon, '::before').content;
        if (!c || c === 'none' || c === '""' || c === 'normal') out.push(icon.className);
      });
      return out;
    });
    expect(bad).toEqual([]);
    expect(await page.locator('#grammar-topic-list .grammar-topic').count()).toBe(39);
  });

  test('7.3 the empty lessons tab explains itself', async ({ page }) => {
    await loadApp(page);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-mine-count')).toHaveText('0');
    await expect(page.locator('#grammar-my-list')).toContainText('зі своїх фото');
  });

  test('7.4 a lesson is built from text and opens paged', async ({ page }) => {
    await loadApp(page);
    mockAi(page, LESSON_JSON);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');

    await page.fill('#custom-lesson-text', 'Present, past and future tenses.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson-content')).toContainText('1 / 2', { timeout: 10000 });
    await expect(page.locator('#grammar-lesson-content')).toContainText('I am working.');
  });

  test('7.5 a photo is transcribed first, then turned into a lesson', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, LESSON_JSON);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');

    await page.setInputFiles('#custom-lesson-input input[capture="environment"]', { name: 'b.png', mimeType: 'image/png', buffer: TINY_PNG });
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    expect(calls).toHaveLength(2);
    const first = calls[0].messages[0].content;
    expect(first[0].text).toContain('Transcribe EVERYTHING');
    expect(first.find((p: any) => p.type === 'image_url').image_url.detail).toBe('high');
    expect(typeof calls[1].messages[0].content).toBe('string');
  });

  test('7.6 the lesson prompt insists on the whole material', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, LESSON_JSON);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await page.fill('#custom-lesson-text', 'A table with nine cells.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    const prompt = calls[0].messages[0].content;
    expect(prompt).toContain('every row, every column and every cell');
    expect(prompt).toContain('Never sample');
    expect(prompt).toContain('there is no page limit');
  });

  test('7.7 a saved lesson lives in its own tab, not among the topics', async ({ page }) => {
    await loadApp(page);
    mockAi(page, LESSON_JSON);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await page.fill('#custom-lesson-text', 'Present, past and future tenses table.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    await page.click('#grammar-section .back-button');
    await expect(page.locator('#grammar-topic-list')).not.toContainText('Часи в англійській мові');
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-my-list')).toContainText('Часи в англійській мові');
    await expect(page.locator('#grammar-mine-count')).toHaveText('1');
  });

  test('7.8 a lesson grows instead of spawning a second one', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, LESSON_JSON);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await page.fill('#custom-lesson-text', 'Present, past and future tenses table.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    // Extending is a named button inside the lesson now
    await page.click('#grammar-extend-btn');
    await expect(page.locator('#custom-lesson-heading')).toContainText('Доповнити');
    await page.fill('#custom-lesson-text', 'One more rule about the perfect tenses.');
    await page.click('#custom-lesson-generate-btn');

    await expect(page.locator('#grammar-lesson-content')).toContainText('3 / 4', { timeout: 10000 });
    expect(calls[calls.length - 1].messages[0].content).toContain('being ADDED to an existing lesson');

    await page.click('#grammar-section .back-button');
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-mine-count')).toHaveText('1');
  });

  test('7.9 a lesson can be published as a link', async ({ page }) => {
    await loadApp(page);
    mockAi(page, LESSON_JSON);
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await page.fill('#custom-lesson-text', 'Present, past and future tenses table.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    // Sharing sits in the lesson header, where there is room for a real target
    await page.click('#grammar-share-btn');
    await expect(page.locator('#share-link-value')).toContainText('?set=');
  });

  test('7.10 model output cannot inject markup into the lesson', async ({ page }) => {
    await loadApp(page);
    mockAi(page, { ...LESSON_JSON, pages: [{ heading: 'X', paragraphs: ['**жирне** <img src=x onerror=alert(1)>'], examples: [] }] });
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await page.fill('#custom-lesson-text', 'Some material long enough to pass the check.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#grammar-lesson-content img')).toHaveCount(0);
    expect(await page.locator('#grammar-lesson-content b').first().textContent()).toBe('жирне');
  });

  test('7.11 "Конспект і тест" is gone from the account screen', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.acc-tile:has-text("Конспект і тест")')).toHaveCount(0);
    await expect(page.locator('#magic-notes-section')).toHaveCount(0);
  });
});

// ─────────────────────────────  crossword  ─────────────────────────────

test.describe('8. Crossword direction', () => {
  const sel = (r: number, c: number) => `.crossword-cell input[data-row="${r}"][data-col="${c}"]`;

  async function buildCrossword(page: Page) {
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('crossword-section')!.classList.remove('hidden');
      // @ts-ignore
      crosswordSize = 15;
      // @ts-ignore
      crosswordGrid = Array.from({ length: 15 }, () => new Array(15).fill(null));
      // @ts-ignore — across listed first on purpose: that ordering caused the old flip
      placedWords = [
        { english: 'CAT', translation: 'кіт', row: 2, col: 1, direction: 'across' },
        { english: 'WORD', translation: 'слово', row: 0, col: 2, direction: 'down' },
      ];
      // @ts-ignore
      placedWords.forEach((w) => {
        for (let i = 0; i < w.english.length; i++) {
          const r = w.direction === 'down' ? w.row + i : w.row;
          const c = w.direction === 'across' ? w.col + i : w.col;
          // @ts-ignore
          crosswordGrid[r][c] = w.english[i];
        }
      });
      // @ts-ignore
      renderCrossword();
    });
  }

  const activeCell = (page: Page) => page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return el && el.dataset && el.dataset.row !== undefined ? `${el.dataset.row}-${el.dataset.col}` : null;
  });

  const typeLetter = (page: Page, r: number, c: number, l: string) =>
    page.locator(sel(r, c)).evaluate((el, letter) => {
      (el as HTMLInputElement).value = letter;
      el.dispatchEvent(new KeyboardEvent('keyup', { key: letter, bubbles: true }));
    }, l);

  // @ts-ignore
  const direction = (page: Page) => page.evaluate(() => cwDirection);

  test('8.1 typing down carries on through the crossing', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator(sel(0, 2)).click();
    await typeLetter(page, 0, 2, 'W');
    await typeLetter(page, 1, 2, 'O');
    expect(await activeCell(page)).toBe('2-2');
    await typeLetter(page, 2, 2, 'R');
    expect(await activeCell(page)).toBe('3-2');
    expect(await direction(page)).toBe('down');
  });

  test('8.2 the caret stops at the end of its word', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator(sel(0, 2)).click();
    for (const [i, l] of ['W', 'O', 'R', 'D'].entries()) await typeLetter(page, i, 2, l);
    expect(await activeCell(page)).toBe('3-2');
  });

  test('8.3 a second tap on the crossing flips direction', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator(sel(0, 2)).click();
    await page.locator(sel(2, 2)).click();
    expect(await direction(page)).toBe('down');
    await page.locator(sel(2, 2)).click();
    expect(await direction(page)).toBe('across');
  });

  test('8.4 the chip shows and switches the direction', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await expect(page.locator('#crossword-direction-label')).toHaveText('→ Пишемо вправо');
    await page.click('#crossword-direction-toggle');
    await expect(page.locator('#crossword-direction-label')).toHaveText('↓ Пишемо вниз');
  });

  test('8.5 the chip follows a tap that changes direction', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator(sel(0, 2)).click();
    await expect(page.locator('#crossword-direction-label')).toHaveText('↓ Пишемо вниз');
    await page.locator(sel(2, 1)).click();
    await expect(page.locator('#crossword-direction-label')).toHaveText('→ Пишемо вправо');
  });

  test('8.6 a clue jumps to its word', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.click('#down-clues li:has-text("слово")');
    expect(await activeCell(page)).toBe('0-2');
    expect(await direction(page)).toBe('down');
  });

  test('8.7 arrow keys move and set direction', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator(sel(2, 1)).click();
    await page.locator(sel(2, 1)).press('ArrowRight');
    expect(await activeCell(page)).toBe('2-2');
    await page.locator(sel(2, 2)).press('ArrowDown');
    expect(await direction(page)).toBe('down');
  });

  test('8.8 the highlight follows the current direction', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator(sel(0, 2)).click();
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(4);
    await page.locator(sel(2, 2)).click();
    await page.locator(sel(2, 2)).click();
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(3);
  });
});

// ─────────────────────────────  constructor  ─────────────────────────────

test.describe('9. Word constructor', () => {
  async function start(page: Page, mode: 'word' | 'full') {
    await page.click('.acc-tile:has-text("Конструктор")');
    await page.evaluate(async () => {
      for (const w of ['apple', 'table', 'water', 'house', 'green', 'light', 'music', 'river', 'stone', 'sugar']) {
        // @ts-ignore
        await db.collection('users').doc('test-user-123').collection('words').doc(w).set({
          translation: w + '-uk', interactions: 0, correctAnswers: 0, priority: 0, folders: [], dateAdded: { seconds: 1 },
        });
      }
    });
    await page.click(`#constructor-mode-${mode}`);
    await page.click('#constructor-mode-select button:has-text("Почати")');
    await expect(page.locator('#constructor-answer')).toBeVisible({ timeout: 10000 });
    const keys = mode === 'full' ? '.cw-key' : '#letter-buttons .unique-letter-button';
    await expect(page.locator(keys).first()).toBeVisible({ timeout: 10000 });
  }

  test('9.1 the mode is asked first and defaults to the word letters', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Конструктор")');
    await expect(page.locator('#constructor-mode-select')).toBeVisible();
    await expect(page.locator('#word-constructor-quiz-container')).toBeHidden();
    await expect(page.locator('#constructor-mode-word')).toHaveClass(/active/);
  });

  test('9.2 word mode offers only that word letters', async ({ page }) => {
    await loadApp(page);
    await start(page, 'word');
    const word = await page.evaluate(() => {
      // @ts-ignore
      return constructorWords[currentConstructorQuestion].english;
    });
    const keys = await page.locator('#letter-buttons .unique-letter-button').allTextContents();
    expect(new Set(keys)).toEqual(new Set(word.split('')));
  });

  test('9.3 the full keyboard is laid out in three rows, like a phone', async ({ page }) => {
    await loadApp(page);
    await start(page, 'full');

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.cw-keyboard-row')].map((row) =>
        [...row.querySelectorAll('.cw-key')]
          .map((k) => (k.getAttribute('data-letter') || ''))
          .filter(Boolean).join('')));

    // All 26 letters, but crucially in rows of 10 / 9 / 7 — a single wrapping
    // container put "p" on the second row and "a" not first on the left
    expect(rows).toEqual(['qwertyuiop', 'asdfghjkl', 'zxcvbnm']);
  });

  test('9.3b every key sits on the row a thumb expects', async ({ page }) => {
    await loadApp(page);
    await start(page, 'full');

    const tops = await page.evaluate(() => {
      const y = (letter: string) =>
        Math.round(document.querySelector(`.cw-key[data-letter="${letter}"]`)!.getBoundingClientRect().top);
      return { q: y('q'), p: y('p'), a: y('a'), l: y('l'), z: y('z') };
    });

    expect(tops.p).toBe(tops.q);   // p ends the first row
    expect(tops.l).toBe(tops.a);   // l ends the second
    expect(tops.a).toBeGreaterThan(tops.q);
    expect(tops.z).toBeGreaterThan(tops.a);
  });

  test('9.4 letters never run out on the full keyboard', async ({ page }) => {
    await loadApp(page);
    await start(page, 'full');
    const key = page.locator('.cw-key[data-letter="a"]');
    for (let i = 0; i < 5; i++) await key.click();
    await expect(key).toBeEnabled();
    expect(await page.locator('#constructor-answer').inputValue()).toBe('aaaaa');
  });

  test('9.5 the endless keys carry no counter badge', async ({ page }) => {
    await loadApp(page);
    await start(page, 'full');
    const badge = await page.evaluate(() => {
      const el = document.querySelector('.cw-key')!;
      return getComputedStyle(el, '::after').content;
    });
    expect(['none', 'normal', '""']).toContain(badge);
  });

  test('9.6 the device keyboard is never summoned', async ({ page }) => {
    await loadApp(page);
    await start(page, 'full');
    const box = page.locator('#constructor-answer');
    await expect(box).toHaveAttribute('inputmode', 'none');
    await box.click();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('constructor-answer');
  });

  test('9.7 a word typed on the full keyboard is accepted', async ({ page }) => {
    await loadApp(page);
    await start(page, 'full');
    const word = await page.evaluate(() => {
      // @ts-ignore
      return constructorWords[currentConstructorQuestion].english;
    });
    for (const l of word) await page.locator(`.cw-key[data-letter="${l}"]`).click();
    await page.click('.cw-keyboard-actions .check-button');
    await expect(page.locator('#constructor-feedback')).toContainText('авильно');
  });
});

// ─────────────────────────────  phrase practice  ─────────────────────────────

test.describe('10. Phrase practice modes', () => {
  const PHRASES = [
    { id: 'p1', english: 'Slow down', translation: 'Пригальмуйте', interactions: 0, correctAnswers: 0, priority: 0 },
    { id: 'p2', english: 'Take a seat', translation: 'Сідайте', interactions: 0, correctAnswers: 0, priority: 0 },
  ];

  async function start(page: Page, dir: string, method: string) {
    await page.click('.acc-tile:has-text("Фрази")');
    await page.click(`#phrase-dir-${dir}`);
    await page.click(`#phrase-method-${method}`);
    await page.evaluate((phrases) => {
      // @ts-ignore
      phraseConstructorPhrases = phrases;
      // @ts-ignore
      currentPhraseQuestion = 0;
      // @ts-ignore
      phraseCorrectAnswers = 0;
      document.getElementById('phrase-mode-select')!.classList.add('hidden');
      document.getElementById('phrase-constructor-container')!.classList.remove('hidden');
      // @ts-ignore
      showPhraseConstructorQuestion();
    }, PHRASES);
  }

  test('10.1 direction and method are asked before starting', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Фрази")');
    await expect(page.locator('#phrase-mode-select')).toBeVisible();
    await expect(page.locator('#phrase-dir-uk_to_en')).toHaveClass(/active/);
    await expect(page.locator('#phrase-method-blocks')).toHaveClass(/active/);
  });

  test('10.2 uk→en shows the Ukrainian and asks for English blocks', async ({ page }) => {
    await loadApp(page);
    await start(page, 'uk_to_en', 'blocks');
    await expect(page.locator('.phrase-prompt')).toHaveText('Пригальмуйте');
    const blocks = await page.locator('#phrase-blocks .phrase-block').allTextContents();
    expect(blocks.sort()).toEqual(['Slow', 'down']);
  });

  test('10.3 en→uk flips both sides', async ({ page }) => {
    await loadApp(page);
    await start(page, 'en_to_uk', 'blocks');
    await expect(page.locator('.phrase-prompt')).toHaveText('Slow down');
    await page.click('#phrase-blocks .phrase-block');
    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toContainText('Правильно');
  });

  test('10.4 voice mode swaps blocks for a recorder', async ({ page }) => {
    await loadApp(page);
    await start(page, 'uk_to_en', 'voice');
    await expect(page.locator('#phrase-voice-btn')).toBeVisible();
    await expect(page.locator('#phrase-blocks')).toHaveCount(0);
  });

  test('10.5 an exact answer is accepted without asking the model', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, { correct: false, note: 'must not be called' });
    await start(page, 'uk_to_en', 'voice');
    await page.evaluate(() => {
      // @ts-ignore
      phraseVoiceTranscript = 'slow down';
    });
    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toContainText('Правильно');
    expect(calls).toHaveLength(0);
  });

  test('10.6 a different but valid wording is accepted by the model', async ({ page }) => {
    await loadApp(page);
    const calls = mockAi(page, { correct: true, note: 'Гарний варіант!' });
    await start(page, 'uk_to_en', 'voice');
    await page.evaluate(() => {
      // @ts-ignore
      phraseVoiceTranscript = 'could you slow down please';
    });
    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toContainText('Правильно');
    await expect(page.locator('#phrase-feedback')).toContainText('Гарний варіант!');
    expect(calls[0].messages[0].content).toContain('could you slow down please');
  });

  test('10.7 a wrong answer is rejected with the reason and the reference', async ({ page }) => {
    await loadApp(page);
    mockAi(page, { correct: false, note: 'Це про іншу дію.' });
    await start(page, 'uk_to_en', 'voice');
    await page.evaluate(() => {
      // @ts-ignore
      phraseVoiceTranscript = 'stand up';
    });
    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toContainText('Неправильно');
    await expect(page.locator('#phrase-feedback')).toContainText('Slow down');
    await expect(page.locator('#phrase-feedback')).toContainText('Це про іншу дію.');
  });

  test('10.8 checking with nothing said is not an answer', async ({ page }) => {
    await loadApp(page);
    await start(page, 'uk_to_en', 'voice');
    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toBeHidden();
  });
});

// ─────────────────────────────  speaking club  ─────────────────────────────

test.describe('11. Speaking Club memory', () => {
  const openSC = (page: Page) => page.click('.acc-tile:has-text("Speaking Club")');

  test('11.1 a newcomer sees no memory badge', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    await expect(page.locator('#sc-memory-badge')).toBeHidden();
  });

  test('11.2 the badge counts conversations without naming the companion', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    await page.evaluate(() => {
      // @ts-ignore
      scMemory = { profile: 'Name: Evgen.', conversations: 4 };
      // @ts-ignore
      scRenderMemoryBadge();
    });
    await expect(page.locator('#sc-memory-badge')).toBeVisible();
    await expect(page.locator('#sc-memory-count')).toHaveText('4');
    await expect(page.locator('#sc-memory-badge')).not.toContainText('Sam');
  });

  test('11.3 what is remembered reaches the system prompt', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    await page.evaluate(() => {
      // @ts-ignore
      scMemory = { profile: 'Has a cat called Mia.', conversations: 3 };
    });
    const calls = mockAi(page, 'Hey again!');
    await page.evaluate(() => {
      // @ts-ignore
      scConfig.topic = 'Travel';
      // @ts-ignore
      scStartChat();
    });
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    const system = calls[0].messages[0].content;
    expect(system).toContain('cat called Mia');
    expect(system).toContain('do NOT introduce yourself again');
  });

  test('11.4 with no memory the prompt is a clean first meeting', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    const calls = mockAi(page, 'Hi!');
    await page.evaluate(() => {
      // @ts-ignore
      scConfig.topic = 'Travel';
      // @ts-ignore
      scStartChat();
    });
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls[0].messages[0].content).not.toContain('WHAT YOU ALREADY KNOW');
  });

  test('11.5 a conversation merges into the profile and counts up', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    await page.evaluate(() => {
      // @ts-ignore
      scMemory = { profile: 'Name: Evgen.', conversations: 1 };
    });
    const calls = mockAi(page, 'Name: Evgen. Likes cycling.');
    await page.evaluate(async () => {
      // @ts-ignore
      scChatHistory = [{ role: 'system', content: 's' }, { role: 'user', content: 'I like cycling.' }];
      // @ts-ignore
      await scUpdateMemory({ summary: 'ok' });
    });
    const memory = await page.evaluate(() => {
      // @ts-ignore
      return scMemory;
    });
    expect(memory.conversations).toBe(2);
    expect(memory.profile).toContain('cycling');
    expect(calls[0].messages[0].content).toContain('merges the old one with anything new');
  });

  test('11.6 the profile cannot grow past its cap', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    mockAi(page, 'y'.repeat(6000));
    await page.evaluate(async () => {
      // @ts-ignore
      scChatHistory = [{ role: 'user', content: 'hi' }];
      // @ts-ignore
      await scUpdateMemory({ summary: '' });
    });
    const [profile, limit] = await page.evaluate(() => {
      // @ts-ignore
      return [scMemory.profile.length, SC_MEMORY_LIMIT];
    });
    expect(profile).toBeLessThanOrEqual(limit);
  });

  test('11.7 a conversation is wrapped up exactly once', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    const calls = mockAi(page, JSON.stringify({ errors: [], words: [], phrases: [], grammar: [], summary: 'ok' }));
    await page.evaluate(async () => {
      // @ts-ignore
      scChatHistory = [{ role: 'system', content: 's' }, { role: 'user', content: 'I like cycling.' }];
      // @ts-ignore
      scMessageCount = 2;
      // @ts-ignore
      scEnded = false;
      // @ts-ignore
      await scEndChat();
      // @ts-ignore
      await scEndChat();
    });
    const history = await page.evaluate(async () => {
      // @ts-ignore
      return ((await db.collection('users').doc('test-user-123').get()).data().scHistory || []).length;
    });
    expect(history).toBe(1);
    const analyses = calls.filter((c: any) =>
      typeof c.messages[0].content === 'string' && c.messages[0].content.includes('Analyze this English learner'));
    expect(analyses).toHaveLength(1);
  });

  test('11.8 forgetting clears the profile', async ({ page }) => {
    await loadApp(page);
    await openSC(page);
    await page.evaluate(() => {
      // @ts-ignore
      scMemory = { profile: 'Name: Evgen.', conversations: 3 };
      // @ts-ignore
      scRenderMemoryBadge();
    });
    await page.click('#sc-memory-badge button[title="Забути"]');
    await page.click('#app-confirm-ok');
    await expect(page.locator('#sc-memory-badge')).toBeHidden();
  });
});

// ─────────────────────────────  updates & chrome  ─────────────────────────────

test.describe('12. Update delivery and general chrome', () => {
  test('12.1 the two version files agree', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    const inApp = html.match(/APP_VERSION\s*=\s*'([^']+)'/);
    const inFile = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf-8'));
    expect(inApp![1]).toBe(inFile.version);
  });

  test('12.2 the HTML must be revalidated, but may be reused when unchanged', () => {
    const headers = readFileSync(join(ROOT, '_headers'), 'utf-8');
    expect(headers).toMatch(/^\/index\.html\s*$/m);
    // Match the directive lines, not the prose: a comment mentioning a
    // directive used to make this pass while the header said something else
    const directives = headers.split('\n')
      .filter((l) => /^\s+Cache-Control:/.test(l))
      .map((l) => l.split(':')[1].trim());
    expect(directives.length).toBe(3);
    for (const d of directives) {
      expect(d).toContain('no-cache');
      // no-store would forbid keeping a copy at all, so every launch would
      // re-download 840 KB instead of getting a 304
      expect(d).not.toContain('no-store');
    }
  });

  test('12.3 a newer build raises the banner', async ({ page }) => {
    await loadApp(page);
    await page.route('**/version.json*', (r) =>
      r.fulfill({ contentType: 'application/json', body: '{"version":"newer"}' }));
    await page.evaluate(() => {
      // @ts-ignore
      checkForAppUpdate();
    });
    await expect(page.locator('#app-update-banner')).toBeVisible();
  });

  test('12.4 the same build raises nothing', async ({ page }) => {
    await loadApp(page);
    const current = await page.evaluate(() => {
      // @ts-ignore
      return APP_VERSION;
    });
    await page.route('**/version.json*', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: current }) }));
    await page.evaluate(() => {
      // @ts-ignore
      return checkForAppUpdate();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#app-update-banner')).toHaveCount(0);
  });

  test('12.5 coming back to the foreground triggers the check', async ({ page }) => {
    await loadApp(page);
    const urls: string[] = [];
    await page.route('**/version.json*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ contentType: 'application/json', body: '{"version":"newer"}' });
    });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('#app-update-banner')).toBeVisible();
    expect(urls[0]).toContain('version.json?t=');
  });

  test('12.6 the banner reloads past the cache', async ({ page }) => {
    await loadApp(page);
    await page.route('**/version.json*', (r) =>
      r.fulfill({ contentType: 'application/json', body: '{"version":"newer"}' }));
    await page.evaluate(() => {
      // @ts-ignore
      checkForAppUpdate();
    });
    await page.click('#app-update-banner button');
    await page.waitForURL(/\?v=\d+/);
  });

  test('12.7 an unreachable version file is ignored', async ({ page }) => {
    await loadApp(page);
    await page.route('**/version.json*', (r) => r.abort());
    await page.evaluate(() => {
      // @ts-ignore
      return checkForAppUpdate();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#app-update-banner')).toHaveCount(0);
    await expect(page.locator('#account-screen')).toBeVisible();
  });

  test('12.8 the greeting line is gone', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.acc-greeting')).toHaveCount(0);
    await expect(page.locator('#account-screen')).not.toContainText('Привіт');
    await expect(page.locator('#account-screen .acc-email')).toBeVisible();
  });

  test('12.11 streak, level and XP live in Прогрес, not on the account screen', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#account-screen .acc-gamification')).toHaveCount(0);

    await page.click('.acc-action-btn:has-text("Прогрес")');
    await expect(page.locator('#progressPopup .acc-gamification')).toBeVisible();
    await expect(page.locator('#progressPopup #acc-level')).toBeVisible();
    await expect(page.locator('#progressPopup #streak-count')).toBeVisible();
  });

  test('12.12 the account card does not creep under the header buttons', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await loadApp(page);
    await page.click('.acc-tile:has-text("Кросворд")');
    await page.locator('.back-button:visible').first().click();

    const overlap = await page.evaluate(() => {
      const b = document.querySelector('.buttons-right-corner')!.getBoundingClientRect();
      const a = document.getElementById('account-screen')!.getBoundingClientRect();
      return Math.round(b.bottom - a.top);
    });
    expect(overlap).toBeLessThanOrEqual(0);
  });

  test('12.9 the account screen still carries its actions and tiles', async ({ page }) => {
    await loadApp(page);
    // Four since the leaderboard went: Словник, Додати, Нові слова, Прогрес
    await expect(page.locator('.acc-action-btn')).toHaveCount(4);
    expect(await page.locator('.acc-tile').count()).toBeGreaterThan(10);
  });

  test('12.10 nothing on the page throws while loading', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await loadApp(page);
    await openDictionary(page);
    await page.locator('#my-words-section .back-button').click();
    await openGrammar(page);
    await page.click('#grammar-tab-mine');
    await page.locator('#grammar-section .back-button').click();
    await openAdd(page);
    expect(errors).toEqual([]);
  });
});
