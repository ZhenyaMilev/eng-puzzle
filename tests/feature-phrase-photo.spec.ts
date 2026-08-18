import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
  'base64'
);

const PHRASES = [
  { english: 'Slow down', translation: 'Пригальмуйте' },
  { english: 'Take a seat', translation: 'Сідайте' },
];

function mockPhraseExtraction(page: Page, phrases = PHRASES) {
  const calls: any[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    calls.push(route.request().postDataJSON().body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(phrases) } }] }),
    });
  });
  return calls;
}


async function openPhraseTab(page: Page) {
  await page.click('.acc-action-btn:has-text("Додати")');
  await page.click('#add-tab-phrase');
}

/**
 * The camera is a key in the keyboard, and it hands straight over to the device
 * picker — the one that already offers a library, a fresh shot and a file.
 */
async function pickPhrasePhoto(page: Page, file: any) {
  await page.click('#phrase-english-inline');
  await expect(page.locator('#input-keyboard')).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#input-keyboard button:has-text("Фото")'),
  ]);
  await chooser.setFiles(file);
}

test.describe('Add phrase from photo', () => {
  test('the phrase tab reaches a photo through its keyboard', async ({ page }) => {
    await loadApp(page);
    await openPhraseTab(page);
    await page.click('#phrase-english-inline');

    await expect(page.locator('#input-keyboard button:has-text("Фото")')).toBeVisible();
    await expect(page.locator('#phrase-photo-upload-row')).toHaveCount(0);
  });

  // Both sources are offered here too: shoot now, or pick a shot already taken.
  test('phrase photo can be taken with the camera or picked from the gallery', async ({ page }) => {
    await loadApp(page);
    await openPhraseTab(page);

    await page.click('#phrase-english-inline');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#input-keyboard button:has-text("Фото")'),
    ]);
    expect(await chooser.element().getAttribute('accept')).toBe('image/*');
    // Not pinned to the camera — that is what leaves the library out of the menu
    expect(await chooser.element().getAttribute('capture')).toBeNull();
  });

  test('preview is hidden until a photo is analysed', async ({ page }) => {
    await loadApp(page);
    await openPhraseTab(page);
    await expect(page.locator('#photo-phrases-preview')).toBeHidden();
  });

  test('photo yields selectable phrases, not single words', async ({ page }) => {
    await loadApp(page);
    const calls = mockPhraseExtraction(page);
    await openPhraseTab(page);

    await pickPhrasePhoto(page, {
      name: 'sign.png', mimeType: 'image/png', buffer: TINY_PNG,
    });

    await expect(page.locator('#photo-phrases-preview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#photo-phrases-list button')).toHaveCount(2);
    await expect(page.locator('#photo-phrases-list')).toContainText('Slow down');
    await expect(page.locator('#photo-phrases-list')).toContainText('Пригальмуйте');

    // The prompt asks for phrases, and the image is actually attached
    const parts = calls[0].messages[0].content;
    expect(parts[0].text).toContain('phrases');
    expect(parts.some((p: any) => p.type === 'image_url')).toBe(true);
  });

  test('selecting phrases reveals the bulk-add button with a live count', async ({ page }) => {
    await loadApp(page);
    mockPhraseExtraction(page);
    await openPhraseTab(page);

    await pickPhrasePhoto(page, {
      name: 'sign.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await expect(page.locator('#photo-phrases-list button')).toHaveCount(2, { timeout: 10000 });

    await expect(page.locator('#bulk-add-photo-phrases')).toBeHidden();

    await page.locator('#photo-phrases-list button').first().click();
    await expect(page.locator('#bulk-add-photo-phrases')).toBeVisible();
    await expect(page.locator('#photo-phrases-selected-count')).toHaveText('1');

    await page.locator('#photo-phrases-list button').nth(1).click();
    await expect(page.locator('#photo-phrases-selected-count')).toHaveText('2');

    // Deselect returns the button to hidden
    await page.locator('#photo-phrases-list button').first().click();
    await page.locator('#photo-phrases-list button').nth(1).click();
    await expect(page.locator('#bulk-add-photo-phrases')).toBeHidden();
  });

  test('bulk add saves the selection and closes the preview', async ({ page }) => {
    await loadApp(page);
    mockPhraseExtraction(page);
    await openPhraseTab(page);

    await pickPhrasePhoto(page, {
      name: 'sign.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await expect(page.locator('#photo-phrases-list button')).toHaveCount(2, { timeout: 10000 });

    await page.locator('#photo-phrases-list button').first().click();
    await page.click('#bulk-add-photo-phrases');

    await expect(page.locator('#photo-phrases-preview')).toBeHidden({ timeout: 10000 });
  });

  test('a gallery pick runs the same extraction as a fresh shot', async ({ page }) => {
    await loadApp(page);
    mockPhraseExtraction(page);
    await openPhraseTab(page);

    await pickPhrasePhoto(page, {
      name: 'from-gallery.png', mimeType: 'image/png', buffer: TINY_PNG,
    });

    await expect(page.locator('#photo-phrases-list button')).toHaveCount(2, { timeout: 10000 });
    // The spinner stands down once the analysis is done
    await expect(page.locator('#phrase-photo-upload-loading')).toBeHidden();
  });

  test('key functions exist on window', async ({ page }) => {
    await loadApp(page);
    for (const name of ['handlePhrasePhotoInput', 'renderPhotoPhrases', 'togglePhotoPhrase', 'bulkAddPhotoPhrases', 'phraseDocId']) {
      const exists = await page.evaluate((n) => typeof (window as any)[n] === 'function', name);
      expect(exists, `${name} should be a function`).toBe(true);
    }
  });
});
