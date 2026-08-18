import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

/**
 * The constructor was a dictation: the English word was spoken and you spelled
 * that same word back. Which way the translation runs is a choice now, and it
 * decides both what you are shown and which alphabet you answer in.
 */
/** The constructor refuses to start below ten words, and it needs real translations. */
const VOCAB = {
  apple: 'яблуко', table: 'стіл', water: 'вода', house: 'будинок', green: 'зелений',
  light: 'світло', music: 'музика', river: 'ріка', stone: 'камінь', sugar: 'цукор',
  bread: 'хліб', window: 'вікно',
};

function seed() {
  const words: Record<string, any> = {};
  Object.entries(VOCAB).forEach(([english, translation], i) => {
    words[english] = {
      translation, example: '', folders: [],
      interactions: 0, correctAnswers: 0, priority: i, dateAdded: { seconds: 100 - i },
    };
  });
  return { words };
}

const current = (page: Page) => page.evaluate(() => {
  // @ts-ignore — the app's own state
  const w = constructorWords[currentConstructorQuestion];
  return { english: w.english, translation: w.translation };
});

async function startConstructor(page: Page, direction: 'uk-en' | 'en-uk', mode: 'word' | 'full') {
  await page.click('.acc-tile:has-text("Конструктор")');
  await page.click(`#constructor-dir-${direction}`);
  await page.click(`#constructor-mode-${mode}`);
  await page.click('#constructor-mode-select button:has-text("Почати")');
  await expect(page.locator('#constructor-answer')).toBeVisible({ timeout: 10000 });
}

test.use({ viewport: { width: 390, height: 860 } });

test.describe('Which way the constructor runs', () => {
  test('Ukrainian to English shows the translation and takes Latin letters', async ({ page }) => {
    await loadApp(page, { seed: seed() });
    await startConstructor(page, 'uk-en', 'full');

    const word = await current(page);
    await expect(page.locator('.constructor-asking')).toHaveText(word.translation);
    expect(await page.locator('#constructor-keyboard .cw-key').first().textContent()).toBe('q');
  });

  test('English to Ukrainian shows the word and takes Cyrillic letters', async ({ page }) => {
    await loadApp(page, { seed: seed() });
    await startConstructor(page, 'en-uk', 'full');

    const word = await current(page);
    await expect(page.locator('.constructor-asking')).toHaveText(word.english);
    expect(await page.locator('#constructor-keyboard .cw-key').first().textContent()).toBe('й');
    await expect(page.locator('#constructor-answer')).toHaveAttribute('placeholder', /переклад/);
  });

  test('the letters offered are the letters of the answer, not of the prompt', async ({ page }) => {
    await loadApp(page, { seed: seed() });
    await startConstructor(page, 'en-uk', 'word');

    const word = await current(page);
    const offered = await page.locator('#letter-buttons .unique-letter-button')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.letter));
    // Every letter of the Ukrainian translation is there, and nothing Latin is
    for (const letter of new Set(word.translation.toLowerCase().replace(/\s/g, ''))) {
      expect(offered).toContain(letter);
    }
    expect(offered.filter((l) => /[a-z]/.test(l!))).toEqual([]);
  });

  test('a translation typed the right way round is accepted', async ({ page }) => {
    await loadApp(page, { seed: seed() });
    await startConstructor(page, 'en-uk', 'full');
    const word = await current(page);

    for (const letter of word.translation.toLowerCase()) {
      const key = page.locator(`#constructor-keyboard .cw-key[data-letter="${letter === ' ' ? ' ' : letter}"]`);
      if (await key.count()) await key.first().click();
    }
    await page.click('#constructor-keyboard .check-button');
    await expect(page.locator('#constructor-feedback')).toHaveText('Правильно!');
  });

  test('the older direction is still the default', async ({ page }) => {
    await loadApp(page, { seed: seed() });
    await page.click('.acc-tile:has-text("Конструктор")');
    await expect(page.locator('#constructor-dir-uk-en')).toHaveClass(/active/);
  });
});
