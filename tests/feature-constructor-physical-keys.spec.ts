import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

const WORDS = ['apple', 'table', 'water', 'house', 'green', 'light', 'music', 'river', 'stone', 'sugar'];

/**
 * На комп'ютері власна клавіатура вправи — зайва: фізична вже під руками.
 * Але поле відповіді readonly з inputmode="none" (щоб на телефоні не лізла
 * системна клавіатура), тож без окремого обробника набрати було нічим.
 */

async function seedWords(page: Page) {
  await page.evaluate(async (words) => {
    for (const w of words) {
      // @ts-ignore — the app's own Firestore handle
      await db.collection('users').doc('test-user-123').collection('words').doc(w).set({
        translation: w + '-uk', interactions: 0, correctAnswers: 0, priority: 0, folders: [],
        dateAdded: { seconds: 1 },
      });
    }
  }, WORDS);
}

async function openConstructor(page: Page, mode: 'word' | 'full') {
  await page.click('.acc-tile:has-text("Конструктор")');
  await expect(page.locator('#constructor-mode-select')).toBeVisible();
  await seedWords(page);
  await page.click(`#constructor-mode-${mode}`);
  await page.click('#constructor-mode-select button:has-text("Почати")');
  await expect(page.locator('#constructor-answer')).toBeVisible({ timeout: 10000 });
}

function currentWord(page: Page) {
  // @ts-ignore — module-level globals declared in the app's own script
  return page.evaluate(() => constructorWords[currentConstructorQuestion].english);
}

const answer = (page: Page) => page.inputValue('#constructor-answer');

test.describe('Typing on a real keyboard', () => {
  test('letters typed on the physical keyboard reach the answer box', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');
    const word = await currentWord(page);

    await page.keyboard.type(word);

    expect(await answer(page)).toBe(word);
  });

  test('Backspace takes the last letter back', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');
    const word = await currentWord(page);

    await page.keyboard.type(word);
    await page.keyboard.press('Backspace');

    expect(await answer(page)).toBe(word.slice(0, -1));
  });

  test('Enter checks the word instead of the mouse', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');
    const word = await currentWord(page);

    await page.keyboard.type(word);
    await page.keyboard.press('Enter');

    await expect(page.locator('#constructor-feedback')).toHaveText('Правильно!');
  });

  test('a wrong word typed by hand is told so', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    await page.keyboard.type('zzz');
    await page.keyboard.press('Enter');

    await expect(page.locator('#constructor-feedback')).toContainText('Неправильно');
  });

  /** У режимі «тільки букви цього слова» фізична клавіатура має ті самі межі. */
  test('letters absent from the word are refused, as on screen', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'word');
    const word = await currentWord(page);
    const missing = 'qwertyuiopasdfghjklzxcvbnm'.split('').find(c => !word.includes(c))!;

    await page.keyboard.type(missing);

    expect(await answer(page)).toBe('');
  });

  test('a letter is spent once, like its key', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'word');
    const word = await currentWord(page);
    const once = word.split('').find((c, i) => word.indexOf(c) === word.lastIndexOf(c))!;

    await page.keyboard.type(once + once);

    expect(await answer(page)).toBe(once);
  });
});

test.describe('The handler keeps to its own screen', () => {
  test('typing does nothing on the account screen', async ({ page }) => {
    await loadApp(page);
    await page.keyboard.type('apple');

    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#word-constructor-training-section')).toBeHidden();
  });

  test('a word being added is typed into its own field, not the constructor', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showAddWord());
    const field = page.locator('#english-word');
    await expect(field).toBeVisible();

    await field.click();
    await page.keyboard.type('bridge');

    expect(await field.inputValue()).toBe('bridge');
  });
});
