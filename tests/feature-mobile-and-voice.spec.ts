import { test, expect, Page } from '@playwright/test';
import { loadApp, mockAi, mockAiChat } from './helpers';

const PHONE = { width: 390, height: 780 };

const LESSON = {
  title: 'Неправильні дієслова англійської мови з дуже довгою назвою',
  level: 'A1',
  pages: [{ heading: 'Present', paragraphs: ['Про **зараз**.'], examples: [] }],
  quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correct: 0, optionExplanations: ['', '', '', ''] }],
};


function mockLesson(page: Page) {
  return mockAiChat(page, JSON.stringify(LESSON));
}

// Returns the body of every speech request the app made.
function captureSpeech(page: Page) {
  const calls: any[] = [];
  mockAi(page, 'speech', async (body, route) => {
    calls.push(body);
    // A tiny silent wav so the <audio> element has something real to load
    await route.fulfill({
      contentType: 'audio/wav',
      body: Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=', 'base64'),
    });
  });
  return calls;
}

async function buildCrossword(page: Page) {
  await page.evaluate(() => {
    document.getElementById('account-screen')!.classList.add('hidden');
    document.getElementById('crossword-section')!.classList.remove('hidden');
    // @ts-ignore
    crosswordSize = 15;
    // @ts-ignore
    crosswordGrid = Array.from({ length: 15 }, () => new Array(15).fill(null));
    // @ts-ignore
    placedWords = [
      { english: 'NECESSARY', translation: 'необхідний', row: 4, col: 1, direction: 'across' },
      { english: 'WOLF', translation: 'вовк', row: 1, col: 3, direction: 'down' },
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

test.describe('Live voice instead of the browser robot', () => {
  test('an English word is spoken with the Speaking Club voice', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);

    await page.evaluate(() => {
      // @ts-ignore
      kokoroSpeak('opportunity', 'UK English Female');
    });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].model).toBe('tts-1');
    expect(calls[0].input).toBe('opportunity');
    expect(calls[0].voice).toBe('nova');
  });

  test('the voice follows the Speaking Club setting', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);

    await page.evaluate(() => {
      // @ts-ignore
      scConfig.voice = 'onyx';
      // @ts-ignore
      kokoroSpeak('river', 'UK English Female');
    });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].voice).toBe('onyx');
  });

  test('the same word is not re-synthesised', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);

    await page.evaluate(async () => {
      // @ts-ignore
      kokoroSpeak('river', 'UK English Female');
    });
    await expect.poll(() => calls.length).toBe(1);
    await page.evaluate(() => {
      // @ts-ignore
      kokoroSpeak('river', 'UK English Female');
    });
    await page.waitForTimeout(400);
    expect(calls).toHaveLength(1);
  });

  test('the listening exercise speaks with the live voice', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);

    await page.evaluate(() => {
      // @ts-ignore
      speakWord('necessary', null);
    });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].input).toBe('necessary');
  });

  test('Ukrainian keeps the browser voice — the live ones are English personas', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);

    await page.evaluate(() => {
      // @ts-ignore
      kokoroSpeak('привіт', 'Ukrainian Female');
    });
    await page.waitForTimeout(400);
    expect(calls).toHaveLength(0);
  });

  test('signed out it falls back instead of going silent', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);
    await page.evaluate(() => {
      // Nobody to bill means no live voice — the browser one takes over
      (window as any).__firebaseAuthInstance.currentUser = null;
      // @ts-ignore
      kokoroSpeak('river', 'UK English Female');
    });
    await page.waitForTimeout(400);
    expect(calls).toHaveLength(0);
  });

  test('a long passage stays on the browser voice', async ({ page }) => {
    await loadApp(page);
    const calls = captureSpeech(page);

    await page.evaluate(() => {
      // @ts-ignore
      kokoroSpeak('word '.repeat(300), 'UK English Female');
    });
    await page.waitForTimeout(400);
    expect(calls).toHaveLength(0);
  });
});

test.describe('Crossword on a phone', () => {
  test.use({ viewport: PHONE });

  test('the grid fits the screen without sideways scrolling', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);

    const m = await page.evaluate(() => ({
      table: (document.querySelector('#crossword-grid table') as HTMLElement).getBoundingClientRect().width,
      wrapper: (document.getElementById('crossword-grid-wrapper') as HTMLElement).clientWidth,
      body: document.body.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(m.table).toBeLessThanOrEqual(m.wrapper);
    expect(m.body).toBeLessThanOrEqual(m.inner);
  });

  test('the clue for the word being solved sits above the grid', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);

    await expect(page.locator('#crossword-current-clue')).toBeHidden();
    await page.locator('.crossword-cell input[data-row="4"][data-col="1"]').click();
    await expect(page.locator('#crossword-current-clue')).toBeVisible();
    await expect(page.locator('#crossword-current-clue')).toContainText('необхідний');
  });

  test('the clue follows a change of direction', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);

    await page.locator('.crossword-cell input[data-row="4"][data-col="3"]').click();
    await expect(page.locator('#crossword-current-clue')).toContainText('необхідний');
    await page.locator('.crossword-cell input[data-row="4"][data-col="3"]').click(); // flip at the crossing
    await expect(page.locator('#crossword-current-clue')).toContainText('вовк');
  });

  test('picking a cell no longer drags the page down to the clue list', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);

    const before = await page.evaluate(() => window.scrollY);
    await page.locator('.crossword-cell input[data-row="4"][data-col="1"]').click();
    await page.waitForTimeout(600); // the old smooth scroll had time to land

    // A focused input may nudge the page a few pixels; the clue list is far below,
    // so the old behaviour moved it by hundreds.
    const moved = Math.abs((await page.evaluate(() => window.scrollY)) - before);
    expect(moved).toBeLessThan(60);
  });

  test('a new grid starts with no clue showing', async ({ page }) => {
    await loadApp(page);
    await buildCrossword(page);
    await page.locator('.crossword-cell input[data-row="4"][data-col="1"]').click();
    await expect(page.locator('#crossword-current-clue')).toBeVisible();

    await buildCrossword(page);
    await expect(page.locator('#crossword-current-clue')).toBeHidden();
  });
});

test.describe('Section header buttons', () => {
  test.use({ viewport: PHONE });

  test('the Speaking Club history button is square and a real target', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Speaking Club")');

    const m = await page.evaluate(() => {
      const b = document.getElementById('sc-history-btn')!;
      const r = b.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(b).borderRadius };
    });
    expect(m.w).toBe(m.h);
    expect(m.w).toBeGreaterThanOrEqual(44);
    expect(m.radius).not.toBe('50%'); // square-ish, like the rest of the app
  });
});

test.describe('My lessons on a phone', () => {
  test.use({ viewport: PHONE });

  async function makeLesson(page: Page) {
    await mockLesson(page);
    await page.click('.acc-tile:has-text("Граматика")');
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');
    await page.fill('#custom-lesson-text', 'Present, past and future tenses table.');
    await page.click('#custom-lesson-generate-btn');
    await expect(page.locator('#grammar-lesson')).toBeVisible({ timeout: 10000 });
  }

  test('a long lesson title does not push the row off screen', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);
    await page.click('#grammar-section .back-button');
    await page.click('#grammar-tab-mine');

    const m = await page.evaluate(() => {
      const row = document.querySelector('#grammar-my-list .grammar-topic') as HTMLElement;
      return { row: row.getBoundingClientRect().width, body: document.body.scrollWidth, inner: window.innerWidth };
    });
    expect(m.body).toBeLessThanOrEqual(m.inner);
    expect(m.row).toBeLessThanOrEqual(m.inner);
  });

  test('the title is cut with an ellipsis rather than wrapping the row open', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);
    await page.click('#grammar-section .back-button');
    await page.click('#grammar-tab-mine');

    const style = await page.evaluate(() => {
      const el = document.querySelector('#grammar-my-list .topic-name')!;
      const cs = getComputedStyle(el);
      return { overflow: cs.textOverflow, wrap: cs.whiteSpace };
    });
    expect(style.overflow).toBe('ellipsis');
    expect(style.wrap).toBe('nowrap');
  });

  test('the row keeps one comfortable target, not a pair of tiny ones', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);
    await page.click('#grammar-section .back-button');
    await page.click('#grammar-tab-mine');

    await expect(page.locator('#grammar-my-list .grammar-topic button')).toHaveCount(1);
    await expect(page.locator('#grammar-my-list button[title="Видалити"]')).toBeVisible();

    const size = await page.evaluate(() => {
      const b = document.querySelector('#grammar-my-list .topic-row-action')!.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    expect(size.w).toBeGreaterThanOrEqual(44);
    expect(size.h).toBeGreaterThanOrEqual(44);
  });

  test('sharing lives in the lesson header, where there is room', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);

    const share = page.locator('#grammar-share-btn');
    await expect(share).toBeVisible();
    const size = await page.evaluate(() => {
      const b = document.getElementById('grammar-share-btn')!.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    expect(size.w).toBe(size.h);          // square, like the rest
    expect(size.w).toBeGreaterThanOrEqual(44);

    await share.click();
    await expect(page.locator('#share-link-value')).toContainText('?set=');
  });

  test('a built-in topic shows no share button', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Граматика")');
    await page.click('#grammar-topic-list .grammar-topic:has-text("Present Simple")');
    await expect(page.locator('#grammar-share-btn')).toBeHidden();
  });

  test('back from a lesson returns to my lessons, not the dashboard', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);

    await page.click('#grammar-section .back-button');
    await expect(page.locator('#grammar-section')).toBeVisible();
    await expect(page.locator('#grammar-topics')).toBeVisible();
    await expect(page.locator('#account-screen')).toBeHidden();
    // and on the tab it was opened from
    await expect(page.locator('#grammar-tab-mine')).toHaveClass(/active/);

    // a second back does leave for the dashboard
    await page.click('#grammar-section .back-button');
    await expect(page.locator('#account-screen')).toBeVisible();
  });

  test('back from the create form returns to the list too', async ({ page }) => {
    await loadApp(page);
    await mockLesson(page);
    await page.click('.acc-tile:has-text("Граматика")');
    await page.click('#grammar-tab-mine');
    await page.click('#grammar-mine-view button:has-text("Свій конспект")');

    await page.click('#grammar-section .back-button');
    await expect(page.locator('#grammar-topics')).toBeVisible();
    await expect(page.locator('#account-screen')).toBeHidden();
  });

  test('extending is a named button inside the lesson', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);

    const extend = page.locator('#grammar-extend-btn');
    await expect(extend).toBeVisible();
    await expect(extend).toContainText('Доповнити цей урок');

    await extend.click();
    await expect(page.locator('#custom-lesson-heading')).toContainText('Доповнити');
  });

  test('a built-in topic offers no extend button', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Граматика")');
    await page.click('#grammar-topic-list .grammar-topic:has-text("Present Simple")');
    await expect(page.locator('#grammar-lesson')).toBeVisible();
    await expect(page.locator('#grammar-extend-btn')).toBeHidden();
  });

  test('the button disappears again after leaving a custom lesson', async ({ page }) => {
    await loadApp(page);
    await makeLesson(page);
    await expect(page.locator('#grammar-extend-btn')).toBeVisible();

    // Back now lands on the grammar list, so grammar is already open
    await page.click('#grammar-section .back-button');
    await page.click('#grammar-tab-topics');
    await page.click('#grammar-topic-list .grammar-topic:has-text("Present Simple")');
    await expect(page.locator('#grammar-extend-btn')).toBeHidden();
  });
});
