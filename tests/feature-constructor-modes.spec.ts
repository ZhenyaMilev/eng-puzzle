import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

const WORDS = ['apple', 'table', 'water', 'house', 'green', 'light', 'music', 'river', 'stone', 'sugar'];

// The shared mock keeps five fixed words; the constructor needs ten, so seed the rest.
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
  const keys = mode === 'full' ? '.cw-key' : '#letter-buttons .unique-letter-button';
  await expect(page.locator(keys).first()).toBeVisible({ timeout: 10000 });
}

function currentWord(page: Page) {
  return page.evaluate(() => {
    // @ts-ignore — module-level globals declared in the app's own script
    return constructorWords[currentConstructorQuestion].english;
  });
}

test.describe('Word constructor modes', () => {
  test('the mode is asked for first, letters-of-the-word by default', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Конструктор")');

    await expect(page.locator('#constructor-mode-select')).toBeVisible();
    await expect(page.locator('#word-constructor-quiz-container')).toBeHidden();
    await expect(page.locator('#constructor-mode-word')).toHaveClass(/active/);
    await expect(page.locator('#constructor-mode-full')).not.toHaveClass(/active/);
    await expect(page.locator('#constructor-mode-hint')).toContainText('зникає');
  });

  test('picking the full keyboard explains what changes', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Конструктор")');
    await page.click('#constructor-mode-full');

    await expect(page.locator('#constructor-mode-full')).toHaveClass(/active/);
    await expect(page.locator('#constructor-mode-hint')).toContainText('26 літер');
    await expect(page.locator('#constructor-mode-hint')).toContainText('жодна не зникає');
  });

  test('letters-of-the-word offers only that word and they run out', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'word');

    const word = await currentWord(page);
    const unique = new Set(word.split(''));
    const keys = await page.locator('#letter-buttons .unique-letter-button').allTextContents();
    expect(new Set(keys)).toEqual(unique);

    // Spend one letter — its key is used up
    const first = page.locator(`#letter-buttons .unique-letter-button[data-letter="${word[0]}"]`);
    const supply = Number(await first.getAttribute('data-count'));
    await first.click();
    expect(Number(await first.getAttribute('data-count'))).toBe(supply - 1);
    if (supply === 1) await expect(first).toBeDisabled();
  });

  test('the full keyboard shows every letter, in keyboard order', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const keys = await page.locator('.cw-key[data-letter]').allTextContents();
    expect(keys).toHaveLength(26);
    expect(keys.slice(0, 10).join('')).toBe('qwertyuiop');
    expect(new Set(keys).size).toBe(26);
  });

  test('on the full keyboard a letter never runs out', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const key = page.locator('.cw-key[data-letter="a"]');
    for (let i = 0; i < 4; i++) await key.click();

    await expect(key).toBeEnabled();
    expect(await page.locator('#constructor-answer').inputValue()).toBe('aaaa');
  });

  test('backspace works on the full keyboard without handing letters back', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    await page.locator('.cw-key[data-letter="c"]').click();
    await page.locator('.cw-key[data-letter="a"]').click();
    expect(await page.locator('#constructor-answer').inputValue()).toBe('ca');

    await page.click('.delete-constructor-button');
    expect(await page.locator('#constructor-answer').inputValue()).toBe('c');
    // The full keyboard never takes a key away, so there is nothing to hand back
    await expect(page.locator('.cw-key[data-letter="a"]')).toBeEnabled();
  });

  test('the keyboard leaves with the exercise', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');
    await expect(page.locator('#constructor-keyboard')).toBeVisible();

    await page.click('#word-constructor-training-section .back-button');
    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#constructor-keyboard')).toBeHidden();

    // and does not haunt another section either
    await page.click('.acc-action-btn:has-text("Словник")');
    await expect(page.locator('#constructor-keyboard')).toBeHidden();
  });

  test('the answer box never summons the device keyboard', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const box = page.locator('#constructor-answer');
    await expect(box).toHaveAttribute('readonly', '');
    await expect(box).toHaveAttribute('inputmode', 'none');

    // Even tapping it leaves focus alone, so no native keyboard slides up
    await box.click();
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focused).not.toBe('constructor-answer');
  });

  test('the keyboard is already open — no tap on the box needed', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Конструктор")');
    await seedWords(page);
    await page.click('#constructor-mode-full');
    await page.click('#constructor-mode-select button:has-text("Почати")');

    await expect(page.locator('#constructor-keyboard')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.cw-keyboard-head')).toHaveCount(0); // no close button any more
  });

  test('check, skip and progress sit under the keys', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.cw-keyboard-row')];
      const keys = rows[rows.length - 1].getBoundingClientRect();
      const actions = document.querySelector('.cw-keyboard-actions')!.getBoundingClientRect();
      const bar = document.querySelector('.cw-kb-progress')!.getBoundingClientRect();
      return { keysBottom: keys.bottom, actionsTop: actions.top, barTop: bar.top };
    });
    expect(m.actionsTop).toBeGreaterThanOrEqual(m.keysBottom);
    expect(m.barTop).toBeGreaterThanOrEqual(m.actionsTop);

    await expect(page.locator('.cw-keyboard-actions .check-button')).toBeVisible();
    await expect(page.locator('.cw-keyboard-actions .skip-button')).toBeVisible();
    await expect(page.locator('.cw-kb-count')).toHaveText(/^1\/\d+$/);
  });

  test('the answer box takes the width it has', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const m = await page.evaluate(() => {
      const input = document.getElementById('constructor-answer')!.getBoundingClientRect();
      const row = document.querySelector('.input-block-custom')!.getBoundingClientRect();
      return { input: input.width, row: row.width };
    });
    // The delete key is the only thing beside it
    expect(m.input).toBeGreaterThan(m.row * 0.7);
  });

  test('the layer sits at the bottom like a real keyboard, with bigger keys', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const m = await page.evaluate(() => {
      const kb = document.getElementById('constructor-keyboard')!;
      const key = document.querySelector('.cw-key') as HTMLElement;
      const cs = getComputedStyle(kb);
      const box = kb.getBoundingClientRect();
      return {
        position: cs.position,
        atBottom: Math.round(window.innerHeight - box.bottom),
        keyH: Math.round(key.getBoundingClientRect().height),
        font: parseFloat(getComputedStyle(key).fontSize),
      };
    });
    expect(m.position).toBe('fixed');
    expect(m.atBottom).toBeLessThanOrEqual(1);
    // Three phone-style rows fit in less height than one wrapping block, so the
    // keys are a little shorter but the whole layout is the familiar one
    expect(m.keyH).toBeGreaterThanOrEqual(42);
    expect(m.font).toBeGreaterThanOrEqual(18);
  });

  test('the word-letters mode keeps its keys inline, no layer', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'word');
    // The layer exists but stays out of the way when only a few keys are needed
    await expect(page.locator('#constructor-keyboard')).toBeHidden();
    await expect(page.locator('#letter-buttons')).toBeVisible();
  });

  test('a word typed on the full keyboard is accepted', async ({ page }) => {
    await loadApp(page);
    await openConstructor(page, 'full');

    const word = await currentWord(page);
    for (const letter of word) {
      await page.locator(`.cw-key[data-letter="${letter}"]`).click();
    }
    expect(await page.locator('#constructor-answer').inputValue()).toBe(word);

    await page.click('.cw-keyboard-actions .check-button');
    await expect(page.locator('#constructor-feedback')).toContainText('авильно');
  });
});
