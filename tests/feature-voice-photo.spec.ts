import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Voice Input', () => {
  test('voice input button exists in add word section', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');
    // It is an icon button now, so the microphone is what identifies it
    await expect(page.locator('#add-word-section button[onclick^="startVoiceInput"]').first()).toBeVisible();
  });

  test('voice status indicator is hidden by default', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');
    await expect(page.locator('#voice-status')).toBeHidden();
  });

  test('startVoiceInput function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).startVoiceInput === 'function');
    expect(exists).toBe(true);
  });
});

test.describe('Photo Input', () => {
  // Scoped to the word form: the phrase tab now has a photo label of its own.
  test('photo input button exists in add word section', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');
    await expect(page.locator('#photo-upload-label')).toBeVisible();
  });

  // Both sources are offered: shoot now, or pick a shot already taken.
  test('photo can be taken with the camera or picked from the gallery', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');

    const camera = page.locator('#photo-upload-label input[type="file"]');
    await expect(camera).toHaveAttribute('accept', 'image/*');
    await expect(camera).toHaveAttribute('capture', 'environment');

    const gallery = page.locator('#photo-gallery-label input[type="file"]');
    await expect(gallery).toHaveAttribute('accept', 'image/*');
    // No capture attribute — otherwise the phone jumps straight into the camera
    expect(await gallery.getAttribute('capture')).toBeNull();

    await expect(page.locator('#photo-gallery-label')).toBeVisible();
  });

  test('a gallery pick runs the same extraction as a fresh shot', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/ai', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify([{ english: 'shade', translation: 'тінь' }]) } }],
        }),
      });
    });
    await page.click('.acc-action-btn:has-text("Додати")');
    await page.setInputFiles('#photo-gallery-label input[type="file"]', {
      name: 'from-gallery.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
        'base64'
      ),
    });

    await expect(page.locator('#photo-words-preview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#photo-words-list')).toContainText('shade');
    await expect(page.locator('#photo-upload-row')).toBeVisible();
    await expect(page.locator('#photo-upload-loading')).toBeHidden();
  });

  test('photo words preview is hidden by default', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');
    await expect(page.locator('#photo-words-preview')).toBeHidden();
  });

  test('handlePhotoInput function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).handlePhotoInput === 'function');
    expect(exists).toBe(true);
  });

  // The photo list lives on module-level state, so it is driven the only way a
  // person can drive it: by handing the app a photo and letting it extract.
  async function extract(page: Page, words: any[]) {
    await page.route('**/.netlify/functions/ai', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(words) } }] }),
      }));
    await page.click('.acc-action-btn:has-text("Додати")');
    await page.setInputFiles('#photo-gallery-label input[type="file"]', {
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
        'base64'),
    });
    await expect(page.locator('#photo-words-preview')).toBeVisible({ timeout: 10000 });
  }

  test('a word found on a photo can be picked and unpicked', async ({ page }) => {
    await loadApp(page);
    await extract(page, [{ english: 'apple', translation: 'яблуко' }]);

    const word = page.locator('#photo-words-list button').first();
    await word.click();
    const picked = await word.evaluate((el) => getComputedStyle(el).borderColor);

    await word.click();
    const unpicked = await word.evaluate((el) => getComputedStyle(el).borderColor);

    expect(picked).not.toBe(unpicked);
  });

  test('a word from a photo cannot inject markup into the list', async ({ page }) => {
    await loadApp(page);
    await extract(page, [{ english: '<img src=x onerror=alert(1)>', translation: 'x' }]);

    const html = await page.locator('#photo-words-list').innerHTML();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
