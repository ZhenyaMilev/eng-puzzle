import { test, expect, Page } from '@playwright/test';
import { loadApp, loadAppNoAuth } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');

/**
 * The audit's blockers: a newcomer got 5 words at a time when the first
 * exercise needs 30, hit "недостатньо слів" with no way forward, and lost the
 * account for good if the password went with it.
 */

// The model is asked for 60; the app should keep 30, not 5.
// Generation goes through the app's own function now — the key is not here.
function mockGeneration(page: Page, count = 60) {
  const words = Array.from({ length: count }, (_, i) => ({
    word: `word${i}`, translation: `слово${i}`,
  }));
  return page.route('**/.netlify/functions/ai', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(words) } }] }),
    }));
}

async function openDailyWords(page: Page) {
  await page.evaluate(() => {
    // @ts-ignore — a profile already chosen, so the screen goes straight to words
    window.userLearningProfile = { level: 'beginner', goals: ['general'], topics: ['travel'], note: '' };
    // @ts-ignore
    showDailyWords();
  });
}

test.describe('Onboarding hands over a usable batch', () => {
  test('one generation yields 30 words, not 5', async ({ page }) => {
    await loadApp(page);
    await mockGeneration(page);
    await page.evaluate(() => {
      // @ts-ignore
      db.collection('users').doc(auth.currentUser.uid).update({
        learningProfile: { level: 'beginner', goals: ['general'], topics: ['travel'], note: '' },
      });
    });
    await openDailyWords(page);

    await expect.poll(
      () => page.locator('#daily-words-list li').count(),
      { timeout: 15000 },
    ).toBe(30);
  });

  test('the target is one constant, so the loop and the cut cannot drift apart', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain('const DAILY_WORDS_TARGET = 30;');
    expect(html).toContain('newWords.length >= DAILY_WORDS_TARGET');
    expect(html).toContain('newWords.slice(0, DAILY_WORDS_TARGET)');
    // The old cap would silently throw 25 of the 30 away
    expect(html).not.toContain('newWords.slice(0, 5)');
  });

  test('a second generation does not hand back the same words', async ({ page }) => {
    await loadApp(page);

    const prompts: string[] = [];
    await page.route('**/.netlify/functions/ai', (route) => {
      const body = route.request().postDataJSON().body;
      prompts.push(JSON.stringify(body.messages));
      const offset = prompts.length * 100;
      const words = Array.from({ length: 60 }, (_, i) => ({
        word: `w${offset + i}`, translation: `с${offset + i}`,
      }));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(words) } }] }),
      });
    });

    // The profile lives in the user doc; the screen reads it from there
    await page.evaluate(() => {
      // @ts-ignore
      return db.collection('users').doc(auth.currentUser.uid).update({
        learningProfile: { level: 'beginner', goals: ['general'], topics: ['travel'], note: '' },
      });
    });
    await openDailyWords(page);
    await expect.poll(() => page.locator('#daily-words-list li').count(), { timeout: 15000 }).toBe(30);

    await page.click('#regenerate-words-btn');
    await expect.poll(() => prompts.length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    // The words already shown are named in the exclusion list of the next call
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts[prompts.length - 1]).toContain('w100');
  });
});

test.describe('No dead ends', () => {
  const cases = [
    { name: 'Тестування', start: 'startQuiz', container: '#quiz-container', short: 25 },
    { name: 'На слух', start: 'startListeningTraining', container: '#listening-quiz-container', short: 5 },
    { name: 'Картинки', start: 'startPictureQuiz', container: '#picture-quiz-container', short: 5 },
  ];

  for (const c of cases) {
    test(`${c.name} says how many words are missing and offers a way out`, async ({ page }) => {
      await loadApp(page);
      await page.evaluate((fn) => (window as any)[fn](), c.start);

      const block = page.locator(`${c.container} .not-enough`);
      await expect(block).toBeVisible({ timeout: 10000 });
      await expect(block).toContainText(`Бракує ще ${c.short}`);
      await expect(block).toContainText('Зараз у словнику: 5');
      await expect(block.locator('button', { hasText: 'Додати слова' })).toBeVisible();
    });
  }

  test('the way out actually leads to where words are added', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).startListeningTraining());
    await page.locator('#listening-quiz-container .not-enough button', { hasText: 'Додати слова' }).click();

    await expect(page.locator('#daily-words-section')).toBeVisible();
    await expect(page.locator('#listening-training-section')).toBeHidden();
  });

  test('the other way out goes back to the list of exercises', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).startQuiz());
    await page.locator('#quiz-container .not-enough button', { hasText: 'Обрати інше' }).click();

    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#quiz-section')).toBeHidden();
  });

  test('phrases count phrases, in the right Ukrainian', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).startPhraseConstructor());
    await page.click('#phrase-mode-select button:has-text("Почати")');

    const block = page.locator('#phrase-constructor-container .not-enough');
    await expect(block).toBeVisible({ timeout: 10000 });
    await expect(block).toContainText('Бракує ще 5 фраз');
    await expect(block.locator('button', { hasText: 'Додати фрази' })).toBeVisible();
  });

  test('a screen that keeps its markup is covered, not destroyed', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).startFillBlanksTraining());
    await page.click('#fill-blanks-ukr-btn');

    const panel = page.locator('#fill-blanks-section .not-enough-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#fill-blanks-mode-selection')).toBeHidden();

    // Leaving restores the screen, so a fixed shortfall is not sticky
    await page.evaluate(() => (window as any).backToAccount());
    await expect(page.locator('#fill-blanks-section .not-enough-panel')).toHaveCount(0);
    await expect(page.locator('#fill-blanks-mode-selection')).not.toHaveClass(/hidden/);
  });

  test('no screen still says the old bare "недостатньо слів"', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain('У вас недостатньо слів для тренування');
    expect(html).not.toContain('Потрібно мінімум 10 слів у словнику');
  });

  test('Ukrainian plurals are used, not a bare number', async ({ page }) => {
    await loadApp(page);
    const forms = await page.evaluate(() =>
      [1, 2, 5, 11, 22, 25].map((n) => (window as any).pluralUa(n, 'слово', 'слова', 'слів')));
    expect(forms).toEqual(['слово', 'слова', 'слів', 'слів', 'слова', 'слів']);
  });
});

test.describe('The grid says what is locked', () => {
  test('a tile out of reach is dimmed and names the shortfall', async ({ page }) => {
    await loadApp(page);
    const quizTile = page.locator('.acc-tile[onclick="startQuiz()"]');

    await expect(quizTile).toHaveClass(/acc-tile-locked/, { timeout: 10000 });
    await expect(quizTile.locator('.acc-tile-need')).toHaveText('ще 25 слів');
  });

  test('a tile within reach carries no badge', async ({ page }) => {
    await loadApp(page);
    // 5 words is exactly the crossword minimum
    const crossword = page.locator('.acc-tile[onclick="startCrossword()"]');
    await expect(page.locator('.acc-tile[onclick="startQuiz()"].acc-tile-locked')).toBeVisible({ timeout: 10000 });
    await expect(crossword.locator('.acc-tile-need')).toHaveCount(0);
    await expect(crossword).not.toHaveClass(/acc-tile-locked/);
  });

  test('exercises with no word requirement are never marked', async ({ page }) => {
    await loadApp(page);
    for (const fn of ['showGrammar()', 'showSpeakingClub()']) {
      await expect(page.locator(`.acc-tile[onclick="${fn}"]`)).not.toHaveAttribute('data-needs', /.+/);
    }
  });

  test('every requirement on a tile matches the gate in the exercise', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const expected: Record<string, number> = {
      'startQuiz()': 30, 'startPictureQuiz()': 10, 'startSpeedTraining()': 60,
      'startListeningTraining()': 10, 'startWordConstructorTraining()': 10,
      'startCrossword()': 5, 'startFillBlanksTraining()': 10, 'startDefinitionQuiz()': 10,
    };
    for (const [fn, need] of Object.entries(expected)) {
      const tile = new RegExp(`onclick="${fn.replace(/[()]/g, '\\$&')}" data-needs="${need}"`);
      expect(html).toMatch(tile);
    }
  });
});

test.describe('A forgotten password is not a lost account', () => {
  test('the login screen offers recovery', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#forgot-password-btn')).toBeVisible();
    await expect(page.locator('#forgot-password-btn')).toHaveText('Забув пароль?');
  });

  test('recovery sends to the address that was typed', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.fill('#login-email', 'learner@example.com');
    await page.click('#forgot-password-btn');

    await expect.poll(() => page.evaluate(() => (window as any).__authCalls.passwordResets))
      .toEqual(['learner@example.com']);
    await expect(page.locator('.notification')).toContainText('Лист для відновлення пароля');
  });

  test('an empty field asks for the email instead of failing silently', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.click('#forgot-password-btn');

    await expect(page.locator('#login-email-error')).toContainText('Введи свій email');
    expect(await page.evaluate(() => (window as any).__authCalls?.passwordResets || [])).toEqual([]);
  });

  test('an unknown address is reported under the email field, in Ukrainian', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.evaluate(() => { (window as any).__authFail = { code: 'auth/user-not-found' }; });
    await page.fill('#login-email', 'nobody@example.com');
    await page.click('#forgot-password-btn');

    await expect(page.locator('#login-email-error')).toContainText('Акаунта з таким email немає');
  });
});

test.describe('Firebase speaks Ukrainian', () => {
  const failures = [
    { code: 'auth/wrong-password', field: '#login-password-error', says: 'Невірний пароль' },
    { code: 'auth/invalid-email', field: '#login-email-error', says: 'в адресі помилка' },
    { code: 'auth/too-many-requests', field: '#login-password-error', says: 'Забагато спроб' },
    { code: 'auth/network-request-failed', field: '#login-password-error', says: 'Перевір інтернет' },
  ];

  for (const f of failures) {
    test(`${f.code} is explained, not echoed`, async ({ page }) => {
      await loadAppNoAuth(page);
      await page.evaluate((code) => {
        (window as any).__authFail = { code, message: 'Firebase: some raw English (auth/x).' };
      }, f.code);

      await page.fill('#login-email', 'learner@example.com');
      await page.fill('#login-password', 'whatever');
      await page.click('#login-form .auth-primary');

      await expect(page.locator(f.field)).toContainText(f.says);
      await expect(page.locator('#login-form')).not.toContainText('Firebase:');
    });
  }

  test('a registration clash lands under the register email field', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.evaluate(() => {
      (window as any).__authFail = { code: 'auth/email-already-in-use', message: 'Firebase: raw.' };
      (window as any).showRegister();
    });

    await page.fill('#register-email', 'taken@example.com');
    await page.fill('#register-password', 'secret123');
    await page.click('#register-form .auth-primary');

    await expect(page.locator('#register-email-error')).toContainText('вже зареєстрований');
    await expect(page.locator('#register-password-error')).toHaveText('');
  });

  test('an unmapped code still gets a Ukrainian sentence', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.evaluate(() => {
      (window as any).__authFail = { code: 'auth/something-new', message: 'Firebase: raw English.' };
    });
    await page.fill('#login-email', 'learner@example.com');
    await page.fill('#login-password', 'whatever');
    await page.click('#login-form .auth-primary');

    await expect(page.locator('#login-password-error')).toContainText('Не вдалося виконати дію');
  });
});

test.describe('The subscription status is readable', () => {
  test('a comfortable PRO subscription is not nagged about', async ({ page }) => {
    await loadApp(page);
    // The mock user is paid until 2030 — nothing to warn about
    await expect(page.locator('#acc-sub-note')).toBeHidden({ timeout: 10000 });
  });

  test('a subscription about to lapse says so in words', async ({ page }) => {
    await loadApp(page);
    const note = page.locator('#acc-sub-note');
    await page.evaluate(() => (window as any).renderSubscriptionNote({ kind: 'paid', daysLeft: 5 }));

    await expect(note).toBeVisible();
    await expect(note).toContainText('активна ще 5 днів');
    await expect(note).not.toContainText('Проба');
    await expect(note.locator('button')).toHaveText('Продовжити');
  });

  test('a trial explains itself, including what comes next', async ({ page }) => {
    await loadApp(page);
    const text = await page.evaluate(() => {
      (window as any).renderSubscriptionNote({ kind: 'trial', daysLeft: 3 });
      return document.getElementById('acc-sub-note-text')!.textContent;
    });
    expect(text).toContain('пробний період');
    expect(text).toContain('3 дні');
    expect(text).toContain('99 ₴');
  });

  test('one day is "день", not "днів"', async ({ page }) => {
    await loadApp(page);
    const text = await page.evaluate(() => {
      (window as any).renderSubscriptionNote({ kind: 'paid', daysLeft: 1 });
      return document.getElementById('acc-sub-note-text')!.textContent;
    });
    expect(text).toContain('1 день');
  });
});

test.describe('The OpenAI key stays out of the console', () => {
  test('nothing about the key is printed while the app starts', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (msg) => messages.push(msg.text()));

    await loadApp(page);

    const leaked = messages.filter((m) => /sk-|API key|apiKey|openaiKey/i.test(m));
    expect(leaked).toEqual([]);
  });

  test('the key is not in the browser at all any more', async ({ page }) => {
    await loadApp(page);
    const globals = await page.evaluate(() => ({
      loader: typeof (window as any).loadOpenAIKey,
      variable: typeof (window as any).openaiApiKey,
      proxy: typeof (window as any).aiChat,
    }));
    expect(globals.loader).toBe('undefined');
    expect(globals.variable).toBe('undefined');
    // ...because the only route to OpenAI is the app's own function
    expect(globals.proxy).toBe('function');
  });

  test('the logging lines are gone from the source, not merely quiet', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain('OpenAI API key loaded');
    expect(html).not.toContain('API key before fetch');
    // This one printed the whole config document, key included
    expect(html).not.toContain("console.log('Document data:'");
  });
});
