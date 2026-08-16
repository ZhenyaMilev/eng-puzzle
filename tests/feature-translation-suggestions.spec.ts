import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

// Exactly the junk the crowd-sourced MyMemory translation memory served for "Shade" and
// "Slow down" in production: broken UTF-8, a string from a KDE localization, a duplicate,
// and one genuinely useful translation.
const MYMEMORY_JUNK = {
  responseData: { translatedText: 'Тінь' },
  matches: [
    { translation: 'ÐØÐ³Ð¼ÑØÐ¼ÑÑÐ¸', quality: '74', match: 1 },
    { translation: 'shadeNote this is a KRunner keyword', quality: '74', match: 1 },
    { translation: 'Пригальмуйте', quality: '74', match: 0.98 },
    { translation: 'Чуть помєдлєнєє, коні.', quality: '74', match: 0.97 },
    { translation: 'Чуть помєдлєнєє, коні.', quality: '74', match: 0.96 },
  ],
};

function mockMyMemory(page: Page, payload: any = MYMEMORY_JUNK) {
  return page.route('**/api.mymemory.translated.net/**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

function mockAiTranslation(page: Page, variants: string[]) {
  const calls: any[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    calls.push(route.request().postDataJSON().body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(variants) } }] }),
    });
  });
  return calls;
}


test.describe('Translation suggestions', () => {
  test('junk from the translation memory never reaches the UI', async ({ page }) => {
    await loadApp(page);
    await mockMyMemory(page);
    await page.evaluate(() => {
      // Signed out, so the MyMemory fallback path is what runs
      (window as any).__firebaseAuthInstance.currentUser = null;
    });

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');

    const suggestions = page.locator('#translation-suggestions .suggestion');
    await expect(suggestions).toHaveCount(1, { timeout: 10000 });
    await expect(suggestions.first()).toHaveText('Тінь');

    const text = await page.locator('#translation-suggestions').textContent();
    expect(text).not.toContain('Ð');                       // broken UTF-8
    expect(text).not.toContain('KRunner');                 // foreign localization string
  });

  test('duplicates are collapsed', async ({ page }) => {
    await loadApp(page);
    // The production screenshot showed "Чуть помєдлєнєє, коні." listed twice in a row
    mockAiTranslation(page, ['Пригальмуйте', 'пригальмуйте', 'Пригальмуйте', 'Сповільніться']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Slow down');

    const suggestions = page.locator('#translation-suggestions .suggestion');
    await expect(suggestions).toHaveCount(2, { timeout: 10000 });
    await expect(suggestions.nth(0)).toHaveText('Пригальмуйте');
    await expect(suggestions.nth(1)).toHaveText('Сповільніться');
  });

  test('the crowd translation memory is not read at all on the fallback path', async ({ page }) => {
    await loadApp(page);
    await mockMyMemory(page);
    await page.evaluate(() => {
      (window as any).__firebaseAuthInstance.currentUser = null;
    });

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');

    // Only the machine translation survives; every matches[] entry is ignored by design
    const suggestions = page.locator('#translation-suggestions .suggestion');
    await expect(suggestions).toHaveCount(1, { timeout: 10000 });
    await expect(suggestions.first()).toHaveText('Тінь');

    const text = (await page.locator('#translation-suggestions').textContent()) || '';
    expect(text).not.toContain('Пригальмуйте');
    expect(text).not.toContain('коні');
  });

  test('AI is the primary source when a key is available', async ({ page }) => {
    await loadApp(page);
    let memoryCalled = false;
    await page.route('**/api.mymemory.translated.net/**', async (route) => {
      memoryCalled = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(MYMEMORY_JUNK) });
    });
    const calls = mockAiTranslation(page, ['тінь', 'затінок']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');

    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(2, { timeout: 10000 });
    expect(calls).toHaveLength(1);
    expect(memoryCalled).toBe(false);
  });

  test('clicking a suggestion fills the translation field', async ({ page }) => {
    await loadApp(page);
    mockAiTranslation(page, ['тінь']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');

    await page.locator('#translation-suggestions .suggestion').first().click();
    expect(await page.locator('#translation').inputValue()).toBe('тінь');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(0);
  });

  // Picking a translation used to fire the field's own input handler, which then
  // asked for the reverse translation — so a second list appeared under the answer
  // you had just chosen.
  test('picking a suggestion does not trigger another round of suggestions', async ({ page }) => {
    await loadApp(page);
    const calls = mockAiTranslation(page, ['тінь', 'затінок']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(2, { timeout: 10000 });

    await page.locator('#translation-suggestions .suggestion').first().click();
    await page.waitForTimeout(1500); // longer than the debounce

    expect(await page.locator('#translation').inputValue()).toBe('тінь');
    await expect(page.locator('#reverse-translation-suggestions .suggestion')).toHaveCount(0);
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(0);
    expect(calls).toHaveLength(1); // the first lookup only — no round trip back
  });

  test('a suggestion still clears the error on the field it fills', async ({ page }) => {
    await loadApp(page);
    mockAiTranslation(page, ['тінь']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.click('#add-word-form button:has-text("Додати")');
    await expect(page.locator('#translation-error')).not.toHaveText('');

    await page.fill('#english-word', 'Shade');
    await page.locator('#translation-suggestions .suggestion').first().click();
    await expect(page.locator('#translation-error')).toHaveText('');
  });

  test('a wrong-alphabet answer is dropped rather than shown', async ({ page }) => {
    await loadApp(page);
    // Model returns English where Ukrainian was asked for — nothing usable, so nothing is offered
    mockAiTranslation(page, ['shade', 'shadow']);
    await mockMyMemory(page, { responseData: { translatedText: '' }, matches: [] });

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');

    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(0, { timeout: 10000 });
  });

  test('phrases tab gets the same filtered suggestions', async ({ page }) => {
    await loadApp(page);
    mockAiTranslation(page, ['Пригальмуйте', 'Сповільніться']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.click('#add-tab-phrase');
    await page.fill('#phrase-english-inline', 'Slow down');

    const suggestions = page.locator('#phrase-translation-suggestions-inline .suggestion');
    await expect(suggestions).toHaveCount(2, { timeout: 10000 });
    await suggestions.first().click();
    expect(await page.locator('#phrase-translation-inline').inputValue()).toBe('Пригальмуйте');
  });
});

// The bug behind the reported screenshot: the suggestion block was inserted into the flow
// between the input and the button, and it arrived *after* blur — i.e. mid-tap. The button
// slid down under the finger, the tap missed it, and nothing was added while the errors from
// an earlier attempt stayed on screen.
test.describe('Suggestions must not steal the tap', () => {
  function mockSlowAi(page: Page, variants: string[], delayMs = 150) {
    return page.route('**/.netlify/functions/ai', async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(variants) } }] }),
      });
    });
  }

  test('leaving the field does not spawn a late suggestion list', async ({ page }) => {
    await loadApp(page);
    const calls = mockAiTranslation(page, ['тінь', 'затінок', 'сутінки']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(3, { timeout: 10000 });

    // Once the list has settled, blurring must not re-request or re-render anything:
    // a render at blur time is exactly what used to land mid-tap.
    const button = page.locator('#add-word-form > button');
    const before = await button.boundingBox();
    await page.locator('#english-word').blur();
    await page.waitForTimeout(1200);

    expect(calls).toHaveLength(1);
    const after = await button.boundingBox();
    expect(after!.y).toBe(before!.y);
  });

  test('tapping "Додати" straight after typing still adds the word', async ({ page }) => {
    await loadApp(page);
    // Slow enough that, under the old blur-triggered behaviour, the list would land mid-tap
    await mockSlowAi(page, ['тінь', 'затінок', 'сутінки']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');
    await page.fill('#translation', 'Тінь');
    await page.locator('#add-word-form > button').click();

    // Cleared fields mean addWord() actually ran and reached the success path
    await expect(page.locator('#english-word')).toHaveValue('', { timeout: 10000 });
    await expect(page.locator('#translation')).toHaveValue('');
    await expect(page.locator('#english-word-error')).toHaveText('');
  });

  test('a settled suggestion list never covers the "Додати" button', async ({ page }) => {
    await loadApp(page);
    mockAiTranslation(page, ['тінь', 'затінок', 'сутінки']);

    await page.click('.acc-action-btn:has-text("Додати")');
    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#translation-suggestions .suggestion')).toHaveCount(3, { timeout: 10000 });

    // Suggestions sit in the flow, so they push content instead of floating over the button
    const button = (await page.locator('#add-word-form > button').boundingBox())!;
    const list = (await page.locator('#translation-suggestions').boundingBox())!;
    expect(list.y + list.height).toBeLessThanOrEqual(button.y);
  });
});

test.describe('Add-word validation', () => {
  test('a Cyrillic word gets a specific hint, not the generic error', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');

    await page.fill('#english-word', 'шейд');
    await page.click('#add-word-form button:has-text("Додати")');

    await expect(page.locator('#english-word-error')).toContainText('латиницею');
  });

  test('the error clears as soon as the field is corrected', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');

    await page.click('#add-word-form button:has-text("Додати")');
    await expect(page.locator('#english-word-error')).not.toHaveText('');
    await expect(page.locator('#translation-error')).not.toHaveText('');

    await page.fill('#english-word', 'Shade');
    await expect(page.locator('#english-word-error')).toHaveText('');

    await page.fill('#translation', 'Тінь');
    await expect(page.locator('#translation-error')).toHaveText('');
  });

  test('hyphens and apostrophes are accepted in an English word', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');

    await page.fill('#english-word', "well-known");
    await page.fill('#translation', 'відомий');
    await page.click('#add-word-form button:has-text("Додати")');

    await expect(page.locator('#english-word-error')).toHaveText('');
  });
});
