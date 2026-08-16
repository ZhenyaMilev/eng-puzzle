import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

// A 2x2 red PNG — enough for the browser to decode and for compressImage() to draw on a canvas.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
  'base64'
);

const LESSON_JSON = {
  title: 'Present Simple з дошки',
  level: 'A1',
  pages: [
    {
      heading: 'Present Simple',
      paragraphs: ['Вживаємо для **звичок** і фактів.'],
      examples: [{ en: 'She goes to school.', uk: 'Вона ходить до школи.' }],
      tip: 'Для he/she/it додаємо -s',
    },
    { heading: 'Заперечення', paragraphs: ['Ставимо **don\'t** або **doesn\'t**.'], examples: [] },
  ],
  quiz: [
    { question: 'Обери правильне речення', options: ['She go', 'She goes', 'She going', 'She gone'], correct: 1, optionExplanations: ['без s', 'вона — додаємо s', 'треба is', 'це третя форма'] },
    { question: 'Друге питання', options: ['A', 'B', 'C', 'D'], correct: 0, optionExplanations: ['так', 'ні', 'ні', 'ні'] },
  ],
};

function mockLessonGeneration(page: Page, payload: any = LESSON_JSON) {
  const calls: any[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    calls.push(route.request().postDataJSON().body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    });
  });
  return calls;
}


async function openCustomLessonForm(page: Page) {
  await page.click('button:has-text("Граматика")');
  await page.click('#grammar-tab-mine');
  await page.click('#grammar-mine-view button:has-text("Свій конспект")');
}

test.describe('Custom grammar lesson', () => {
  test('"Конспект і тест" tile is gone from the account screen', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.acc-tile:has-text("Конспект і тест")')).toHaveCount(0);
    await expect(page.locator('#magic-notes-section')).toHaveCount(0);
  });

  test('grammar section offers the "Свій конспект" entry point', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-mine-view button:has-text("Свій конспект")')).toBeVisible();
  });

  test('form opens with camera and gallery inputs, and a text field', async ({ page }) => {
    await loadApp(page);
    await openCustomLessonForm(page);

    await expect(page.locator('#custom-lesson-input')).toBeVisible();
    await expect(page.locator('#grammar-topics')).toBeHidden();
    await expect(page.locator('#custom-lesson-text')).toBeVisible();

    // Camera: shoots straight from the app, no media library detour
    const camera = page.locator('#custom-lesson-input input[capture="environment"]');
    await expect(camera).toHaveAttribute('accept', 'image/*');

    // Gallery: several images at once
    const gallery = page.locator('#custom-lesson-input input[multiple]');
    await expect(gallery).toHaveAttribute('accept', 'image/*');
  });

  test('back link returns to the topic list', async ({ page }) => {
    await loadApp(page);
    await openCustomLessonForm(page);
    await page.click('#custom-lesson-input a:has-text("Всі теми")');
    await expect(page.locator('#grammar-topics')).toBeVisible();
    await expect(page.locator('#custom-lesson-input')).toBeHidden();
  });

  test('several photos can be attached and removed one by one', async ({ page }) => {
    await loadApp(page);
    await openCustomLessonForm(page);

    await page.setInputFiles('#custom-lesson-input input[multiple]', [
      { name: 'a.png', mimeType: 'image/png', buffer: TINY_PNG },
      { name: 'b.png', mimeType: 'image/png', buffer: TINY_PNG },
      { name: 'c.png', mimeType: 'image/png', buffer: TINY_PNG },
    ]);

    await expect(page.locator('#custom-lesson-images img')).toHaveCount(3);

    await page.locator('#custom-lesson-images button').first().click();
    await expect(page.locator('#custom-lesson-images img')).toHaveCount(2);
  });

  test('empty form refuses to generate and makes no network call', async ({ page }) => {
    await loadApp(page);
    const calls = mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#custom-lesson-error')).toContainText('фото або текст');
    expect(calls).toHaveLength(0);
  });

  // Photos go through two calls: a verbatim transcription first, then the lesson.
  // One combined call kept summarising a table down to a couple of cells.
  test('photos are read out in full before the lesson is built', async ({ page }) => {
    await loadApp(page);
    const calls = mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.setInputFiles('#custom-lesson-input input[capture="environment"]', {
      name: 'board.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await page.click('#custom-lesson-generate-btn');

    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });
    expect(calls).toHaveLength(2);

    // Pass 1: the image, asked for at full detail, transcribed rather than summarised
    const parts = calls[0].messages[0].content;
    expect(Array.isArray(parts)).toBe(true);
    const images = parts.filter((p: any) => p.type === 'image_url');
    expect(images).toHaveLength(1);
    expect(images[0].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(images[0].image_url.detail).toBe('high');
    expect(parts[0].text).toContain('Transcribe EVERYTHING');
    expect(parts[0].text).toContain('not a summary');

    // Pass 2: plain text, and it carries what pass 1 read
    expect(typeof calls[1].messages[0].content).toBe('string');
    expect(calls[1].messages[0].content).toContain('Present Simple з дошки');

    const content = page.locator('#grammar-lesson-content');
    await expect(content).toContainText('Present Simple');
    await expect(content).toContainText('She goes to school.');
    await expect(content).toContainText('1 / 2');
  });

  test('the lesson prompt demands the whole material, not a sample', async ({ page }) => {
    await loadApp(page);
    const calls = mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'A table of tenses with nine cells.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    const prompt = calls[0].messages[0].content;
    expect(prompt).toContain('every row, every column and every cell');
    expect(prompt).toContain('Never sample');
    expect(prompt).toContain('there is no page limit');
  });

  test('text-only material skips the transcription pass', async ({ page }) => {
    await loadApp(page);
    const calls = mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'She goes to school every day. He plays football on Sundays.');
    await page.click('#custom-lesson-generate-btn');

    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].content).toContain('She goes to school every day.');
  });

  test('**bold** markers render as tags, raw HTML in the model output does not', async ({ page }) => {
    await loadApp(page);
    mockLessonGeneration(page, {
      ...LESSON_JSON,
      pages: [{ heading: 'Тест', paragraphs: ['Це **жирне** і <img src=x onerror=alert(1)>'], examples: [] }],
    });
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'Some material long enough to pass validation.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    expect(await page.locator('#grammar-lesson-content b').first().textContent()).toBe('жирне');
    await expect(page.locator('#grammar-lesson-content img')).toHaveCount(0);
    await expect(page.locator('#grammar-lesson-content')).toContainText('<img src=x');
  });

  test('quiz comes from the generated material, without a second AI call', async ({ page }) => {
    await loadApp(page);
    const calls = mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'She goes to school every day. He plays football.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    // page 1 -> page 2 -> quiz
    await page.click('#grammar-lesson > button');
    await page.click('#grammar-lesson > button');

    await expect(page.locator('#grammar-quiz-container')).toContainText('Обери правильне речення', { timeout: 10000 });
    await expect(page.locator('#grammar-quiz-container')).toContainText('She goes');
    expect(calls).toHaveLength(1); // the lesson call only — the quiz was generated with it
  });

  test('a model refusal is shown instead of an empty lesson', async ({ page }) => {
    await loadApp(page);
    mockLessonGeneration(page, { error: 'На фото немає англійської мови.' });
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'Матеріал без англійської мови взагалі.');
    await page.click('#custom-lesson-generate-btn');

    await expect(page.locator('#custom-lesson-error')).toHaveText('На фото немає англійської мови.');
    await expect(page.locator('#grammar-lesson')).toBeHidden();
  });

  test('saved lesson is listed among grammar topics and can be reopened', async ({ page }) => {
    await loadApp(page);
    mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'She goes to school every day. He plays football.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    await page.click('#grammar-section .back-button');

    // Saved lessons live in their own tab, out of the way of the 39 built-in topics
    await expect(page.locator('#grammar-topic-list')).not.toContainText('Present Simple з дошки');
    await page.click('#grammar-tab-mine');

    const list = page.locator('#grammar-my-list');
    await expect(list).toContainText('Present Simple з дошки');
    await expect(page.locator('#grammar-mine-count')).toHaveText('1');

    await page.locator('#grammar-my-list .topic-info:has-text("Present Simple з дошки")').click();
    await expect(page.locator('#grammar-lesson-content')).toContainText('She goes to school.');
  });

  // A lesson is never finished: a rule remembered later becomes more pages of the same lesson.
  test('an existing lesson can be extended with new material', async ({ page }) => {
    await loadApp(page);
    const calls = mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'She goes to school every day.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#grammar-lesson-content')).toContainText('1 / 2');

    await page.click('#grammar-extend-btn');

    // The form says what it is about to do, and to which lesson
    await expect(page.locator('#custom-lesson-heading')).toHaveText('Доповнити «Present Simple з дошки»');
    await expect(page.locator('#custom-lesson-generate-btn')).toContainText('Додати до уроку');

    await page.fill('#custom-lesson-text', 'He does not play football on Mondays.');
    await page.click('#custom-lesson-generate-btn');

    // Two more pages appended to the same lesson, opened at the first new one
    await expect(page.locator('#grammar-lesson-content')).toContainText('3 / 4', { timeout: 10000 });

    // The model is told what is already covered so it does not repeat it
    const prompt = calls[calls.length - 1].messages[0].content;
    expect(prompt).toContain('being ADDED to an existing lesson');
    expect(prompt).toContain('Present Simple');
    expect(prompt).toContain('Do not repeat what is already covered');
  });

  test('extending keeps one lesson rather than creating a second', async ({ page }) => {
    await loadApp(page);
    mockLessonGeneration(page);
    await openCustomLessonForm(page);

    await page.fill('#custom-lesson-text', 'She goes to school every day.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    await page.click('#grammar-extend-btn');
    await page.fill('#custom-lesson-text', 'He does not play football.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    await page.click('#grammar-section .back-button');
    await page.click('#grammar-tab-mine');
    await expect(page.locator('#grammar-mine-count')).toHaveText('1');

    const stored = await page.evaluate(async () => {
      // @ts-ignore — the app's own Firestore handle
      const snap = await db.collection('users').doc('test-user-123').collection('customLessons').get();
      return snap.docs.map((d: any) => ({ pages: d.data().pages.length, quiz: d.data().quiz.length }));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].pages).toBe(4);
    expect(stored[0].quiz).toBe(4);
  });

  test('the form comes back clean for a brand new lesson', async ({ page }) => {
    await loadApp(page);
    mockLessonGeneration(page);
    await openCustomLessonForm(page);
    await page.fill('#custom-lesson-text', 'She goes to school every day.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });

    await page.click('#grammar-extend-btn');
    await expect(page.locator('#custom-lesson-heading')).toContainText('Доповнити');

    // Backing out and starting fresh must not stay in "extend" mode
    await page.click('#custom-lesson-input a:has-text("Всі теми")');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await expect(page.locator('#custom-lesson-heading')).toHaveText('Свій конспект');
    await expect(page.locator('#custom-lesson-generate-btn')).toContainText('Створити урок');
  });

  test('key functions exist on window', async ({ page }) => {
    await loadApp(page);
    for (const name of [
      'showCustomLessonForm', 'addCustomLessonImages', 'removeCustomLessonImage',
      'generateCustomLesson', 'openCustomLesson', 'deleteCustomLesson',
      'loadCustomLessons', 'buildCustomLessonPages', 'compressImageToDataUrl', 'backToGrammarTopics',
    ]) {
      const exists = await page.evaluate((n) => typeof (window as any)[n] === 'function', name);
      expect(exists, `${name} should be a function`).toBe(true);
    }
  });
});
