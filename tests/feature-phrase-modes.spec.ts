import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

const PHRASES = [
  { id: 'p1', english: 'Slow down', translation: 'Пригальмуйте', interactions: 0, correctAnswers: 0, priority: 0 },
  { id: 'p2', english: 'Take a seat', translation: 'Сідайте', interactions: 0, correctAnswers: 0, priority: 0 },
  { id: 'p3', english: 'See you later', translation: 'До зустрічі', interactions: 0, correctAnswers: 0, priority: 0 },
  { id: 'p4', english: 'How are you', translation: 'Як справи', interactions: 0, correctAnswers: 0, priority: 0 },
  { id: 'p5', english: 'Thank you very much', translation: 'Дуже дякую', interactions: 0, correctAnswers: 0, priority: 0 },
];

// The shared mock keeps `phrases` empty; seed the app's own in-memory list instead and
// drive the question renderer directly, so the tests exercise the mode logic itself.
async function startSession(page: Page, direction: string, method: string) {
  await page.click('.acc-tile:has-text("Фрази")');
  await expect(page.locator('#phrase-mode-select')).toBeVisible();
  await page.click(`#phrase-dir-${direction}`);
  await page.click(`#phrase-method-${method}`);

  await page.evaluate((phrases) => {
    // @ts-ignore — module-level globals declared in the app's own script
    phraseConstructorPhrases = phrases;
    // @ts-ignore
    currentPhraseQuestion = 0;
    // @ts-ignore
    phraseCorrectAnswers = 0;
  }, PHRASES);

  await page.evaluate(() => {
    document.getElementById('phrase-mode-select')!.classList.add('hidden');
    document.getElementById('phrase-constructor-container')!.classList.remove('hidden');
    // @ts-ignore
    showPhraseConstructorQuestion();
  });
}


function mockJudge(page: Page, verdict: { correct: boolean; note: string }) {
  const calls: any[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    calls.push(route.request().postDataJSON().body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }),
    });
  });
  return calls;
}

test.describe('Phrase practice modes', () => {
  test('entering phrases asks for direction and method first', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Фрази")');

    await expect(page.locator('#phrase-mode-select')).toBeVisible();
    await expect(page.locator('#phrase-constructor-container')).toBeHidden();
    // Defaults: the behaviour the app had before the choice existed
    await expect(page.locator('#phrase-dir-uk_to_en')).toHaveClass(/active/);
    await expect(page.locator('#phrase-method-blocks')).toHaveClass(/active/);
  });

  test('selecting a mode moves the highlight and explains itself', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Фрази")');

    await page.click('#phrase-dir-en_to_uk');
    await expect(page.locator('#phrase-dir-en_to_uk')).toHaveClass(/active/);
    await expect(page.locator('#phrase-dir-uk_to_en')).not.toHaveClass(/active/);
    await expect(page.locator('#phrase-mode-hint')).toContainText('українською');

    await page.click('#phrase-method-voice');
    await expect(page.locator('#phrase-mode-hint')).toContainText('Промовляєш');
    await expect(page.locator('#phrase-mode-hint')).toContainText('не обов');
  });

  test('uk→en blocks: the Ukrainian phrase is shown, English blocks are assembled', async ({ page }) => {
    await loadApp(page);
    await startSession(page, 'uk_to_en', 'blocks');

    await expect(page.locator('.phrase-prompt')).toHaveText('Пригальмуйте');
    const blocks = await page.locator('#phrase-blocks .phrase-block').allTextContents();
    expect(blocks.sort()).toEqual(['Slow', 'down']);
  });

  test('en→uk blocks: the English phrase is shown, Ukrainian blocks are assembled', async ({ page }) => {
    await loadApp(page);
    await startSession(page, 'en_to_uk', 'blocks');

    await expect(page.locator('.phrase-prompt')).toHaveText('Slow down');
    const blocks = await page.locator('#phrase-blocks .phrase-block').allTextContents();
    expect(blocks).toEqual(['Пригальмуйте']);
  });

  test('en→uk blocks accepts the Ukrainian answer', async ({ page }) => {
    await loadApp(page);
    await startSession(page, 'en_to_uk', 'blocks');

    await page.click('#phrase-blocks .phrase-block');
    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toContainText('Правильно');
  });

  test('voice mode offers a recorder instead of blocks', async ({ page }) => {
    await loadApp(page);
    await startSession(page, 'uk_to_en', 'voice');

    await expect(page.locator('#phrase-voice-btn')).toBeVisible();
    await expect(page.locator('#phrase-voice-answer')).toBeVisible();
    await expect(page.locator('#phrase-blocks')).toHaveCount(0);
  });

  test('checking with nothing said does not count as an answer', async ({ page }) => {
    await loadApp(page);
    await startSession(page, 'uk_to_en', 'voice');

    await page.click('#phrase-constructor-container .check-button');
    await expect(page.locator('#phrase-feedback')).toBeHidden();
  });

  test('a word-for-word match is accepted without asking the model', async ({ page }) => {
    await loadApp(page);
    const calls = mockJudge(page, { correct: false, note: 'should not be called' });
    await startSession(page, 'uk_to_en', 'voice');

    await page.evaluate(() => {
      // @ts-ignore — what speech recognition would have produced
      phraseVoiceTranscript = 'slow down';
    });
    await page.click('#phrase-constructor-container .check-button');

    await expect(page.locator('#phrase-feedback')).toContainText('Правильно');
    expect(calls).toHaveLength(0);
  });

  test('a differently worded but valid answer is accepted by the model', async ({ page }) => {
    await loadApp(page);
    const calls = mockJudge(page, { correct: true, note: 'Гарний варіант!' });
    await startSession(page, 'uk_to_en', 'voice');

    await page.evaluate(() => {
      // @ts-ignore
      phraseVoiceTranscript = 'could you slow down please';
    });
    await page.click('#phrase-constructor-container .check-button');

    await expect(page.locator('#phrase-feedback')).toContainText('Правильно');
    await expect(page.locator('#phrase-feedback')).toContainText('Гарний варіант!');

    // The model gets the prompt, the reference and what was actually said
    const sent = calls[0].messages[0].content;
    expect(sent).toContain('Пригальмуйте');
    expect(sent).toContain('Slow down');
    expect(sent).toContain('could you slow down please');
  });

  test('a genuinely wrong answer is rejected with the reason', async ({ page }) => {
    await loadApp(page);
    mockJudge(page, { correct: false, note: 'Це інша дія — тут про швидкість.' });
    await startSession(page, 'uk_to_en', 'voice');

    await page.evaluate(() => {
      // @ts-ignore
      phraseVoiceTranscript = 'stand up';
    });
    await page.click('#phrase-constructor-container .check-button');

    await expect(page.locator('#phrase-feedback')).toContainText('Неправильно');
    await expect(page.locator('#phrase-feedback')).toContainText('Slow down');
    await expect(page.locator('#phrase-feedback')).toContainText('Це інша дія');
  });

  test('voice en→uk listens in Ukrainian, uk→en in English', async ({ page }) => {
    await loadApp(page);

    await startSession(page, 'en_to_uk', 'voice');
    // @ts-ignore
    expect(await page.evaluate(() => phraseAnswerLang())).toBe('uk');

    await page.locator('#phrase-constructor-section .back-button').click();
    await startSession(page, 'uk_to_en', 'voice');
    // @ts-ignore
    expect(await page.evaluate(() => phraseAnswerLang())).toBe('en');
  });
});
