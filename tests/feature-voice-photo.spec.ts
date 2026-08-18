import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';


/**
 * The microphone used to hang on the fields themselves and the camera sat in a
 * row of its own under the form — three mechanisms for one screen. Both live in
 * the keyboard now, which comes up when a field is focused.
 */
async function openAddWord(page: Page) {
  await page.click('.acc-action-btn:has-text("Додати")');
  await page.click('#english-word');
  await expect(page.locator('#input-keyboard')).toBeVisible();
}

async function galleryInput(page: Page) {
  await page.click('#input-keyboard button:has-text("Фото")');
  await expect(page.locator('#kb-photo-sheet')).toBeVisible();
  return page.locator('#kb-photo-sheet label:has-text("З галереї") input[type="file"]');
}

test.describe('Voice Input', () => {
  test('the microphone is in the keyboard, not on the field', async ({ page }) => {
    await loadApp(page);
    await openAddWord(page);
    await expect(page.locator('#input-keyboard #text-kb-mic')).toBeVisible();
    await expect(page.locator('#add-word-form button[onclick^="startVoiceInput"]')).toHaveCount(0);
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
  test('the camera is one key in the keyboard, not a row under the form', async ({ page }) => {
    await loadApp(page);
    await openAddWord(page);
    await expect(page.locator('#input-keyboard button:has-text("Фото")')).toBeVisible();
    await expect(page.locator('#photo-upload-row')).toHaveCount(0);
  });

  // Both sources are offered: shoot now, or pick a shot already taken.
  test('the key asks which one — shoot now, or pick a shot already taken', async ({ page }) => {
    await loadApp(page);
    await openAddWord(page);
    await page.click('#input-keyboard button:has-text("Фото")');

    const camera = page.locator('#kb-photo-sheet label:has-text("Сфотографувати") input[type="file"]');
    await expect(camera).toHaveAttribute('accept', 'image/*');
    await expect(camera).toHaveAttribute('capture', 'environment');

    const gallery = page.locator('#kb-photo-sheet label:has-text("З галереї") input[type="file"]');
    await expect(gallery).toHaveAttribute('accept', 'image/*');
    // No capture attribute — otherwise the phone jumps straight into the camera
    expect(await gallery.getAttribute('capture')).toBeNull();
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
    await openAddWord(page);
    await (await galleryInput(page)).setInputFiles({
      name: 'from-gallery.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
        'base64'
      ),
    });

    await expect(page.locator('#photo-words-preview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#photo-words-list')).toContainText('shade');
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
    await openAddWord(page);
    await (await galleryInput(page)).setInputFiles({
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

/**
 * Speech recognition used to be two different things. Speaking Club recorded
 * with MediaRecorder and sent the clip to Whisper; the microphone in the word
 * form, the grammar question and "Сказати переклад" all called
 * webkitSpeechRecognition, which inside the Telegram webview either does not
 * exist or is refused the microphone — it started and fell straight into
 * onerror, and all anyone saw was "Помилка розпізнавання". Voice worked
 * nowhere except Speaking Club. One path now, the one that works.
 */
function fakeMicrophone(page: Page, opts: { allow?: boolean } = {}) {
  return page.addInitScript((allow) => {
    (window as any).__recordings = 0;
    const media = { getUserMedia: async () => {
      if (!allow) throw new Error('NotAllowedError');
      return { getTracks: () => [{ stop() {} }] };
    } };
    Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });

    class FakeRecorder {
      state = 'inactive';
      ondataavailable: any = null;
      onstop: any = null;
      start() { this.state = 'recording'; (window as any).__recordings++; }
      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(['clip'], { type: 'audio/webm' }) });
        if (this.onstop) this.onstop();
      }
    }
    (window as any).MediaRecorder = FakeRecorder;
  }, opts.allow !== false);
}

function mockTranscript(page: Page, text: string) {
  return page.route('**/.netlify/functions/ai', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.route !== 'transcription') return route.fallback();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text }) });
  });
}

test.describe('Dictating instead of typing', () => {
  test('the word field takes what was said', async ({ page }) => {
    await fakeMicrophone(page);
    await loadApp(page);
    await mockTranscript(page, 'Adventure');
    await openAddWord(page);

    await page.click('#text-kb-mic');
    await expect(page.locator('#text-kb-mic')).toContainText('Слухаю');

    await page.click('#text-kb-mic');
    await expect(page.locator('#english-word')).toHaveValue('adventure');
    await expect(page.locator('#text-kb-mic')).toContainText('Голосом');
    expect(await page.evaluate(() => (window as any).__recordings)).toBe(1);
  });

  test('the translation field asks Whisper for Ukrainian', async ({ page }) => {
    await fakeMicrophone(page);
    await loadApp(page);
    const asked: string[] = [];
    await page.route('**/.netlify/functions/ai', async (route) => {
      const body = route.request().postDataJSON() || {};
      if (body.route !== 'transcription') return route.fallback();
      asked.push(body.body.language);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'пригода' }) });
    });
    await page.click('.acc-action-btn:has-text("Додати")');
    await page.click('#translation');          // the Ukrainian field picks the layout
    await expect(page.locator('#input-keyboard')).toBeVisible();

    await page.click('#text-kb-mic');
    await page.click('#text-kb-mic');
    await expect(page.locator('#translation')).toHaveValue('пригода');
    expect(asked).toEqual(['uk']);
  });

  test('a refused microphone is explained, not swallowed', async ({ page }) => {
    await fakeMicrophone(page, { allow: false });
    await loadApp(page);
    await openAddWord(page);

    await page.click('#text-kb-mic');
    await expect(page.locator('.notification, .toast').filter({ hasText: 'мікрофона' }).first())
      .toBeVisible({ timeout: 8000 });
    await expect(page.locator('#text-kb-mic')).toContainText('Голосом');
  });

  test('nothing anywhere still calls the browser recogniser', () => {
    const html = readFileSync(join(__dirname, '..', 'eng-puzzle', 'index.html'), 'utf-8');
    const calls = html.split('\n').filter((line) => {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//')) return false;   // the comment explains why
      return /webkitSpeechRecognition/.test(code);
    });
    expect(calls).toEqual([]);
  });
});
