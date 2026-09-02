import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'eng-puzzle');
const INDEX = join(ROOT, 'index.html');
const FN = (name: string) => join(ROOT, 'netlify', 'functions', `${name}.js`);

/**
 * The audit's findings, and the two regressions the last release introduced:
 * word generation stuttering, and a screen-sync observer doing layout work on
 * every DOM insertion.
 */

test.describe('Generating words no longer stutters', () => {
  test('the stagger is capped, so thirty cards do not take two seconds', () => {
    const html = readFileSync(INDEX, 'utf-8');
    // 30 items x 0.06s used to mean the last card appeared at 1.74s
    expect(html).not.toContain("(i * 0.06)");
    expect(html).toContain('Math.min(i, 8) * 0.03');
  });

  test('the screen observer coalesces into one frame', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const observer = html.slice(html.indexOf('function observeScreenChanges'), html.indexOf('const BACK_TARGETS'));
    expect(observer).toContain('requestAnimationFrame');
    expect(observer).toContain('screenSyncScheduled');
  });

  test('and does no layout reads in its callback', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const screens = html.slice(html.indexOf('const MAIN_BUTTON_SCREENS'), html.indexOf('let mainButtonHidden'));
    // offsetParent forces a synchronous layout on every mutation
    expect(screens).not.toContain('offsetParent');
  });

  test('a full batch of words renders without piling up work', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/ai', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify(
            Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, translation: `с${i}` })),
          ) } }],
        }),
      }));
    await page.evaluate(() => {
      // @ts-ignore
      return db.collection('users').doc(auth.currentUser.uid).update({
        learningProfile: { level: 'beginner', goals: ['general'], topics: ['travel'], note: '' },
      });
    });

    await page.evaluate(() => (window as any).showDailyWords());
    await expect.poll(() => page.locator('#daily-words-list li').count(), { timeout: 15000 }).toBe(30);

    // Every card has finished animating well inside a second
    await page.waitForTimeout(700);
    const invisible = await page.evaluate(() =>
      [...document.querySelectorAll('#daily-words-list li')]
        .filter((li) => Number(getComputedStyle(li).opacity) < 0.9).length);
    expect(invisible).toBe(0);
  });
});

test.describe('The tariffs say what they are worth', () => {
  test('what the subscription includes is listed once, not "повний доступ" three times', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showTariffs());

    const features = page.locator('.tariff-features');
    await expect(features).toBeVisible();
    await expect(features).toContainText('Writing Club');
    await expect(features).toContainText('фото');
    await expect(page.locator('#tariffs-section')).not.toContainText('Повний доступ до всіх функцій');
  });

  test('one plan is recommended, so the cheapest is not the default choice', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showTariffs());

    const best = page.locator('.tariff-best');
    await expect(best).toContainText('3 місяці');
    await expect(best.locator('.tariff-badge')).toHaveText('Найпопулярніше');
  });

  test('the saving is written down, not left to be worked out', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showTariffs());

    const section = page.locator('#tariffs-section');
    await expect(section).toContainText('₴83 на місяць');
    await expect(section).toContainText('економія ₴48');
    await expect(section).toContainText('₴75 на місяць');
    await expect(section).toContainText('економія ₴289');
    // The comparison the numbers come from
    await expect(section).toContainText('₴99 × 12 = ₴1188');
  });

  test('the arithmetic actually holds', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const tariffs = html.slice(html.indexOf('id="tariffs-section"'), html.indexOf('id="fill-blanks-section"'));

    // 249 / 3 = 83, and 99*3 - 249 = 48
    expect(Math.round(249 / 3)).toBe(83);
    expect(99 * 3 - 249).toBe(48);
    // 899 / 12 = 74.9 -> 75, and 99*12 - 899 = 289
    expect(Math.round(899 / 12)).toBe(75);
    expect(99 * 12 - 899).toBe(289);

    expect(tariffs).toContain('₴83');
    expect(tariffs).toContain('₴289');
  });
});

test.describe('A test result says what to learn next', () => {
  test('the words that were missed are named', async ({ page }) => {
    await loadApp(page);
    const html = await page.evaluate(() => (window as any).renderMistakes([
      { english: 'reliable', translation: 'надійний', given: 'спокійний' },
      { english: 'shade', translation: 'тінь', given: 'світло' },
    ]));

    expect(html).toContain('reliable');
    expect(html).toContain('надійний');
    expect(html).toContain('Ви обрали: спокійний');
    expect(html).toContain('2 слова');
  });

  test('a clean run is told so rather than shown an empty box', async ({ page }) => {
    await loadApp(page);
    const html = await page.evaluate(() => (window as any).renderMistakes([]));
    expect(html).toContain('Жодної помилки');
  });

  test('a word from the model cannot inject markup into the result', async ({ page }) => {
    await loadApp(page);
    const html = await page.evaluate(() => (window as any).renderMistakes([
      { english: '<img src=x onerror=alert(1)>', translation: 'x', given: 'y' },
    ]));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  test('the quiz records what was answered wrongly', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain('quizMistakes.push');
    expect(html).toContain('${renderMistakes(quizMistakes)}');
    // ...and starts each run clean
    expect(html).toContain('quizMistakes = [];');
  });
});

test.describe('One vocabulary for how well a word is known', () => {
  test('the old judging labels are gone', () => {
    const html = readFileSync(INDEX, 'utf-8');
    for (const gone of ['Погані знання', 'Гарні знання', 'Середні знання']) {
      expect(html, `${gone} is still there`).not.toContain(gone);
    }
  });

  test('the dictionary and the progress screen use the same words', () => {
    const html = readFileSync(INDEX, 'utf-8');
    for (const term of ['впевнено', 'майже впевнено', 'ще вчаться', 'Потребують уваги']) {
      expect(html.toLowerCase()).toContain(term.toLowerCase());
    }
    // The dictionary's own summary used a third set
    expect(html).not.toContain('освоєно</div>');
    expect(html).not.toContain('вивчаю</div>');
  });
});

test.describe('The app addresses everyone the same way', () => {
  const INFORMAL = [
    'Спробуй ', 'Введи ', 'Обери ', 'Натисни ', 'Увійди ', 'Перевір ',
    'Ти ', 'тебе', 'тобі', 'Твій ', 'Твої ', 'твій ',
  ];

  test('no informal address is left in the app', () => {
    const html = readFileSync(INDEX, 'utf-8');
    for (const form of INFORMAL) {
      expect(html, `"${form}" is still in the page`).not.toContain(form);
    }
  });

  test('nor in what the bot says', () => {
    for (const file of ['tg-webhook', 'tg-notify']) {
      const src = readFileSync(FN(file), 'utf-8');
      for (const form of ['Твої ', 'відкрий ', 'натисни ', 'підключи ']) {
        expect(src, `${file} still says "${form}"`).not.toContain(form);
      }
    }
  });

  test('the formal forms that were already there are untouched', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain('Спробуйте');
    expect(html).toContain('Введіть');
  });
});

test.describe('XP, goals and the report period', () => {
  test('XP is explained where the goal is set, not in a separate popup', async ({ page }) => {
    await loadApp(page);
    await page.click('.daily-goal-edit');

    const modal = page.locator('#daily-goal-modal');
    await expect(modal).toContainText('XP — це бали');
    await expect(modal).toContainText('10 XP');
  });

  test('the goals are offered in minutes, not only in points', async ({ page }) => {
    await loadApp(page);
    await page.click('.daily-goal-edit');

    const options = page.locator('.goal-option');
    await expect(options.nth(0)).toContainText('5 хвилин');
    await expect(options.nth(3)).toContainText('25 хвилин');
  });

  test('a newcomer is not shown a one-day "period"', async ({ page }) => {
    await loadApp(page);

    const today = await page.evaluate(() => (window as any).describeReportRange(new Date()));
    const older = await page.evaluate(() =>
      (window as any).describeReportRange(new Date(Date.now() - 9 * 86400000)));
    const missing = await page.evaluate(() => (window as any).describeReportRange(null));

    expect(today).toContain('почали сьогодні');
    expect(older).toContain('За 9 днів');
    expect(missing).toBe('');
  });

  test('both progress screens describe the period the same way', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain('Звіт за період');
    // One function, called from both, so they cannot drift apart again
    expect(html.match(/describeReportRange\(dateAdded\)/g) || []).toHaveLength(2);
  });
});

test.describe('Support without a personal account', () => {
  test('the headset no longer points at a private username', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain('shopify_evgene');
    expect(html).toContain('openSupport()');
  });

  test('the dialog takes a description and screenshots', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).openSupport());

    await expect(page.locator('#support-modal')).toBeVisible();
    await expect(page.locator('#support-message')).toBeVisible();
    await expect(page.locator('#support-attach-label')).toContainText('скриншот');
  });

  test('a request goes to the function with everything needed to answer it', async ({ page }) => {
    await loadApp(page);
    const sent: any[] = [];
    await page.route('**/.netlify/functions/support', async (route) => {
      sent.push({ auth: route.request().headers()['authorization'], ...route.request().postDataJSON() });
      await route.fulfill({ contentType: 'application/json', body: '{"ok":true,"delivered":true}' });
    });

    await page.evaluate(() => (window as any).openSupport());
    await page.fill('#support-message', 'Не працює озвучення');
    await page.click('#support-send');

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].message).toBe('Не працює озвучення');
    expect(sent[0].platform).toBe('web');
    expect(sent[0].version).toBeTruthy();
    expect(sent[0].auth).toMatch(/^Bearer .+/);
    await expect(page.locator('#support-modal')).toBeHidden();
  });

  test('an empty message sends nothing', async ({ page }) => {
    await loadApp(page);
    const sent: any[] = [];
    await page.route('**/.netlify/functions/support', (route) => {
      sent.push(1);
      return route.fulfill({ body: '{}' });
    });

    await page.evaluate(() => (window as any).openSupport());
    await page.fill('#support-message', '   ');
    await page.click('#support-send');

    await expect(page.locator('#support-error')).toContainText('Опишіть');
    expect(sent).toEqual([]);
  });

  test('a failure is reported instead of pretending it went', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/support', (route) => route.fulfill({ status: 500, body: '{}' }));

    await page.evaluate(() => (window as any).openSupport());
    await page.fill('#support-message', 'щось зламалось');
    await page.click('#support-send');

    await expect(page.locator('#support-error')).toContainText('Не вдалося');
    await expect(page.locator('#support-modal')).toBeVisible();
  });

  test('the function stores the request before trying to deliver it', () => {
    const src = readFileSync(FN('support'), 'utf-8');
    const store = src.indexOf("collection('supportRequests').add");
    const send = src.indexOf('SUPPORT_INTAKE_URL');
    expect(store).toBeGreaterThan(-1);
    // An outage at the far end must not lose the request
    expect(store).toBeLessThan(send);
  });

  /**
   * A screenshot pasted into a chat is a screenshot only a person can open.
   * The agent that triages these requests cannot, and neither can the
   * dashboard, so the bytes go to R2 and a URL travels instead.
   */
  test('screenshots go to R2, and the request goes to the agent', () => {
    const src = readFileSync(FN('support'), 'utf-8');
    expect(src).toContain("require('./_r2')");
    expect(src).toContain('uploadToR2');
    expect(src).toContain('imageUrls');
    // Telegram is no longer the first stop
    expect(src).not.toContain('sendPhoto');
    expect(src).not.toContain('TG_SUPPORT_CHAT_ID');
  });

  test('a screenshot that fails to upload does not take the request with it', () => {
    const src = readFileSync(FN('support'), 'utf-8');
    const upload = src.indexOf('uploadToR2');
    const guard = src.indexOf('catch', upload);
    const intake = src.indexOf('SUPPORT_INTAKE_URL');
    expect(guard).toBeGreaterThan(upload);
    expect(guard).toBeLessThan(intake);      // caught before the hand-off
  });

  test('requests are write-only for clients', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    const block = rules.slice(rules.indexOf('match /supportRequests'), rules.indexOf('match /wordBase'));
    expect(block).toContain('allow create: if request.auth != null');
    expect(block).toContain('allow read, update, delete: if false;');
  });
});

test.describe('The leaderboard is gone', () => {
  test('nothing offers it, and nothing is left of it', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.acc-action-btn:has-text("Лідери")')).toHaveCount(0);
    await expect(page.locator('#leaderboard-section')).toHaveCount(0);
    expect(await page.evaluate(() => typeof (window as any).showLeaderboard)).toBe('undefined');
  });

  test('its removal closes other people’s documents', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    const users = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /words'));
    // These hold an email address and a payment history
    expect(users).toContain('allow read: if request.auth.uid == userId;');
    expect(users).not.toContain('allow read: if request.auth != null;');
  });

  test('the app no longer reads the whole users collection', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain("db.collection('users').get()");
    expect(html).not.toContain("db.collection('users').orderBy('xp'");
  });
});

// ------------------------------------------------------------------ security

test.describe('The AI proxy cannot be made to multiply itself', () => {
  function loadAi(body: any) {
    const calls: any[] = [];
    const sharedPath = FN('_shared');
    const fakeShared = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ lifetime: true }) }),
            set: async () => {},
          }),
        }),
      }),
      auth: () => ({ verifyIdToken: async () => ({ uid: 'u1' }) }),
      requiredEnv: (n: string) => `env-${n}`,
      json: (statusCode: number, b: any) => ({ statusCode, headers: {}, body: JSON.stringify(b) }),
    };
    delete require.cache[require.resolve(FN('ai'))];
    require.cache[require.resolve(sharedPath)] = {
      id: sharedPath, filename: sharedPath, loaded: true, exports: fakeShared,
    } as any;

    const originalFetch = global.fetch;
    (global as any).fetch = async (url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '{}',
      };
    };

    const mod = require(FN('ai'));
    return {
      run: () => mod.handler({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer t' },
        body: JSON.stringify({ route: 'chat', body }),
      }),
      calls,
      restore: () => {
        (global as any).fetch = originalFetch;
        delete require.cache[require.resolve(sharedPath)];
      },
    };
  }

  test('n is forced to 1, so one quota charge buys one answer', async () => {
    const h = loadAi({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], n: 50 });
    await h.run();

    expect(h.calls[0].n).toBe(1);
    h.restore();
  });

  test('only the fields the app uses travel on', async () => {
    const h = loadAi({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      logit_bias: { 1: 100 },
      user: 'someone-elses-id',
      best_of: 20,
    });
    await h.run();

    const sent = h.calls[0];
    expect(sent.temperature).toBe(0.5);
    expect(sent.logit_bias).toBeUndefined();
    expect(sent.best_of).toBeUndefined();
    expect(sent.user).toBeUndefined();
    h.restore();
  });
});

test.describe('The rest of the hardening', () => {
  test('payment signatures are compared in constant time, like the Telegram ones', () => {
    const shared = readFileSync(FN('_shared'), 'utf-8');
    expect(shared).toContain('function signaturesMatch');
    expect(shared).toContain('timingSafeEqual');

    const callback = readFileSync(FN('wayforpay-callback'), 'utf-8');
    expect(callback).toContain('signaturesMatch(body.merchantSignature');
    expect(callback).not.toContain('body.merchantSignature !== ');
  });

  test('signaturesMatch refuses mismatched lengths instead of throwing', () => {
    process.env.WFP_MERCHANT_SECRET = 'x';
    delete require.cache[require.resolve(FN('_shared'))];
    const { signaturesMatch } = require(FN('_shared'));

    expect(signaturesMatch('abc', 'abc')).toBe(true);
    expect(signaturesMatch('abc', 'abd')).toBe(false);
    expect(signaturesMatch('abc', 'abcdef')).toBe(false);
    expect(signaturesMatch(undefined, 'abc')).toBe(false);
    expect(signaturesMatch('abc', undefined)).toBe(false);
  });

  test('a link code is read and burned together', () => {
    const src = readFileSync(FN('tg-webhook'), 'utf-8');
    const redeem = src.slice(src.indexOf('async function redeemCode'), src.indexOf('async function handleStart'));
    expect(redeem).toContain('runTransaction');
    expect(redeem).not.toContain('db.batch()');
  });

  test('the hourly notifier is not an open HTTP endpoint', () => {
    const src = readFileSync(FN('tg-notify'), 'utf-8');
    expect(src).toContain("headers['x-netlify-event'] === 'schedule'");
    expect(src).toContain('403');
  });

  test('secrets cannot be committed to a public repo by accident', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf-8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toContain('service-account');
  });
});

test.describe('The class of bug that keeps recurring', () => {
  test('no two functions share a name', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const js = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n');

    const names = [...js.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const n of names) { if (seen.has(n)) dupes.add(n); seen.add(n); }

    // Three real bugs came from this: the later definition silently wins, so
    // compressImage returned the wrong shape, showMessageInPopup stripped its
    // own styling class, and the folder picker opened the wrong dialog.
    expect([...dupes]).toEqual([]);
  });

  test('the image compressors say in their names what they return', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain('function compressImageToDataUrl');
    expect(html).toContain('async function compressImageToBase64');
    expect(html).not.toMatch(/function compressImage\s*\(/);
  });
});
