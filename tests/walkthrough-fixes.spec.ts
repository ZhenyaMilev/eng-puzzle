import { test, expect, Page, Route } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What a walk-through of the app found, kept so it cannot come back.
 * Each test is the exact scenario that failed, not a check of the fix.
 */

/** A vocabulary large enough for the exercises that refuse to start below a count. */
function vocabulary(n: number, translate: (i: number) => string = (i) => `переклад ${i}`) {
  const words: Record<string, any> = {};
  const names = [
    'house', 'water', 'bread', 'friend', 'school', 'teacher', 'window', 'garden', 'river', 'mountain',
    'flower', 'bridge', 'summer', 'winter', 'morning', 'evening', 'coffee', 'sugar', 'table', 'chair',
    'street', 'market', 'doctor', 'letter', 'number', 'answer', 'office', 'travel', 'island', 'forest',
    'pocket', 'silver', 'danger', 'memory', 'picture', 'kitchen', 'weather', 'holiday', 'machine', 'village',
    'brother', 'sister', 'country', 'history', 'freedom', 'journey', 'courage', 'problem', 'science', 'captain',
    'blanket', 'whisper', 'thunder', 'harvest', 'diamond', 'printer', 'balcony', 'ceiling', 'dentist', 'midnight',
    'anchor', 'basket', 'candle', 'dragon', 'engine',
  ];
  names.slice(0, n).forEach((word, i) => {
    words[word] = {
      translation: translate(i),
      example: '',
      folders: [],
      interactions: i % 4,
      correctAnswers: i % 3,
      priority: i,
      dateAdded: { seconds: 10000 - i },
    };
  });
  return words;
}

/** word -> translation, the same pairs the seed above writes. */
function translations(n: number, translate: (i: number) => string = (i) => `переклад ${i}`) {
  const map: Record<string, string> = {};
  Object.entries(vocabulary(n, translate)).forEach(([word, data]) => { map[word] = data.translation; });
  return map;
}

const PHRASES_WITH_CONTRACTIONS = {
  p1: { english: "I don't know", translation: 'Я не знаю', folders: [], interactions: 0, priority: 1, dateAdded: { seconds: 100 } },
  p2: { english: "It's up to you", translation: 'Тобі вирішувати', folders: [], interactions: 0, priority: 2, dateAdded: { seconds: 99 } },
  p3: { english: "Let's go", translation: 'Ходімо', folders: [], interactions: 0, priority: 3, dateAdded: { seconds: 98 } },
  p4: { english: "I'm on my way", translation: 'Я вже їду', folders: [], interactions: 0, priority: 4, dateAdded: { seconds: 97 } },
  p5: { english: "That's not fair", translation: 'Це нечесно', folders: [], interactions: 0, priority: 5, dateAdded: { seconds: 96 } },
  p6: { english: "Don't worry", translation: 'Не хвилюйся', folders: [], interactions: 0, priority: 6, dateAdded: { seconds: 95 } },
};

function watchForCrashes(page: Page) {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  return crashes;
}

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90000);

test.describe('A phrase with an apostrophe can be practised', () => {
  test('every block of the phrase goes into the answer', async ({ page }) => {
    const crashes = watchForCrashes(page);
    await loadApp(page, { seed: { words: vocabulary(10), phrases: PHRASES_WITH_CONTRACTIONS } });

    await page.click('.acc-tile:has-text("Фрази")');
    await page.click('#phrase-mode-select button:has-text("Почати")');
    await expect(page.locator('#phrase-constructor-container .phrase-block').first()).toBeVisible();

    const blocks = page.locator('#phrase-constructor-container .phrase-block');
    const words = await blocks.allInnerTexts();
    for (let i = 0; i < words.length; i++) await blocks.nth(i).click();

    // Every block reached the answer area — `It's` used to be silently unclickable
    const answer = await page.locator('#phrase-answer-area').innerText();
    expect(answer.split('\n').filter(Boolean).sort()).toEqual(words.map((w) => w.trim()).sort());
    expect(crashes).toEqual([]);
  });
});

test.describe('Quotes and apostrophes in a translation', () => {
  test('the quiz still tells right from wrong', async ({ page }) => {
    const crashes = watchForCrashes(page);
    const tricky = (i: number) => (i % 2 ? `пам'ять ${i}` : `слово "${i}"`);
    await loadApp(page, { seed: { words: vocabulary(35, tricky) } });

    await page.click('.acc-tile:has-text("Тестування")');
    await expect(page.locator('#quiz-container button').first()).toBeVisible();

    // Answer with something that is certainly not the right translation
    const right = await page.evaluate((map) => {
      const asked = (document.querySelector('#quiz-container h3') as HTMLElement).innerText.trim();
      return map[asked];
    }, translations(35, tricky));
    const options = page.locator('#quiz-container button');
    const texts = (await options.allInnerTexts()).map((t) => t.trim());
    await options.nth(texts.findIndex((t) => t !== right)).click();

    const marked = await options.evaluateAll((btns) => btns.map((b) => b.className));
    expect(marked.filter((c) => /\bcorrect\b/.test(c))).toHaveLength(1);
    expect(marked.filter((c) => /\bincorrect\b/.test(c))).toHaveLength(1);
    expect(crashes).toEqual([]);
  });
});

test.describe('One scale of mastery', () => {
  test('the dictionary and the progress screen count the same words the same way', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(40) } });

    await page.click('.acc-action-btn:has-text("Словник")');
    await expect(page.locator('#acc-mastery')).not.toBeEmpty();
    const chips = (await page.locator('#acc-mastery').innerText()).split('\n').map((s) => s.trim()).filter(Boolean);

    await page.evaluate(() => (window as any).backToAccount());
    await page.click('.acc-action-btn:has-text("Прогрес")');
    await expect(page.locator('#progressPopup')).toBeVisible();
    const tiles = await page.evaluate(() =>
      ['new', 'good', 'average', 'poor'].map((k) => (document.querySelector('.tile-' + k) as HTMLElement).innerText.replace(/\n+/g, ' ').trim())
    );

    const count = (from: string[], name: string) => {
      const row = from.find((r) => r.toLowerCase().includes(name));
      return row ? (row.match(/\d+/) || ['?'])[0] : 'missing';
    };
    expect(count(chips, 'майже впевнено')).toBe(count(tiles, 'майже впевнено'));
    expect(count(chips, 'ще вчаться')).toBe(count(tiles, 'ще вчаться'));
    expect(count(chips, 'потребують уваги')).toBe(count(tiles, 'потребують уваги'));
    expect(count(chips, 'нових')).toBe(count(tiles, 'нові слова'));
  });
});

test.describe('The daily goal', () => {
  test('is congratulated once, not twice', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(35) } });
    await page.evaluate(() => {
      (window as any).__toasts = [];
      const show = (window as any).showXPToast;
      (window as any).showXPToast = (n: number) => { (window as any).__toasts.push(n); return show(n); };
      (window as any).pickDailyGoal(100);   // ten right answers is a whole goal
    });

    await page.click('.acc-tile:has-text("Тестування")');
    await expect(page.locator('#quiz-container button').first()).toBeVisible();
    for (let i = 0; i < 11; i++) {
      const shown = await page.textContent('#quiz-question-number');
      await page.evaluate((map) => {
        const box = document.getElementById('quiz-container')!;
        const asked = (box.querySelector('h3') as HTMLElement).innerText.trim();
        const buttons = Array.from(box.querySelectorAll('button')) as HTMLElement[];
        (buttons.find((b) => b.innerText.trim() === map[asked]) || buttons[0]).click();
      }, translations(35));
      await page.waitForFunction(
        (prev) => document.getElementById('quiz-question-number')?.textContent !== prev,
        shown, { timeout: 5000 }
      ).catch(() => {});
    }

    const toasts: number[] = await page.evaluate(() => (window as any).__toasts);
    expect(toasts.filter((t) => t === 50)).toHaveLength(1);
  });
});

test.describe('Browsing the dictionary leaves the exercises alone', () => {
  test('a folder of three words does not shrink speed training', async ({ page }) => {
    const words = vocabulary(65);
    ['travel', 'island', 'journey'].forEach((w) => { words[w].folders = ['f1']; });
    await loadApp(page, { seed: { words, folders: { f1: { name: 'Подорожі', count: 3 } } } });

    await page.click('.acc-tile:has-text("На швидкість")');
    const offered = await page.locator('#speed-training-info').innerText();
    expect(offered).not.toContain('Бракує');
    await page.evaluate(() => (window as any).backToAccount());

    // The learner looks through a folder, then comes back to the same exercise
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('.folder-chip:has-text("Подорожі")');
    await expect(page.locator('#word-list li')).toHaveCount(3);
    await page.evaluate(() => (window as any).backToAccount());

    await page.click('.acc-tile:has-text("На швидкість")');
    expect(await page.locator('#speed-training-info').innerText()).toBe(offered);
  });
});

test.describe('Screens inside Telegram', () => {
  test('the progress screen keeps its way out clear of the Telegram header', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(35) } });
    await page.evaluate(() => {
      document.body.classList.add('in-miniapp');
      document.documentElement.style.setProperty('--safe-top', '46px');
    });

    await page.evaluate(() => (window as any).loadUserProgress());
    await expect(page.locator('#progressPopup')).toBeVisible();

    // A fixed overlay does not inherit the body's safe-area padding, so the
    // back button used to sit underneath Telegram's own top bar
    const back = await page.locator('#progressPopup .back-button').boundingBox();
    expect(back!.y).toBeGreaterThanOrEqual(46);
  });

  test('a screen opened from the bottom of the account starts at its top', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(35) } });
    // the tiles fade in one after another, and the account screen settles its own
    // scroll on the way in — keep asking until the page really is scrolled down
    await expect(page.locator('.acc-tile:has-text("Speaking Club")')).toBeVisible();
    await page.waitForFunction(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return window.scrollY > 0;
    }, null, { timeout: 5000 });

    await page.click('.acc-tile:has-text("Граматика")');
    await expect(page.locator('#grammar-section')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // and the account screen is where it was left
    await page.evaluate(() => (window as any).backToAccount());
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test.describe('Row actions answer to a swipe only', () => {
  const touchAt = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

  test('a tap leaves delete hidden', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(10) } });
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    const duringTap = await page.evaluate(() => {
      const row = document.querySelector('#words li') as HTMLElement;
      row.dispatchEvent(Object.assign(new Event('touchstart'), { touches: [{ clientX: 200, clientY: 300 }] }));
      const shown = getComputedStyle(row.querySelector('.swipe-actions')!).visibility;
      row.dispatchEvent(new Event('touchend'));
      return shown;
    });
    expect(duringTap).toBe('hidden');
  });

  test('scrolling the list past a row leaves nothing open behind it', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(10) } });
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#words li').first()).toBeVisible({ timeout: 10000 });

    const seen = await page.evaluate(() => {
      const row = document.querySelector('#words li') as HTMLElement;
      const at = (y: number) => ({ touches: [{ clientX: 200, clientY: y }] });
      row.dispatchEvent(Object.assign(new Event('touchstart'), at(300)));
      row.dispatchEvent(Object.assign(new Event('touchmove'), at(260)));
      const during = getComputedStyle(row.querySelector('.swipe-actions')!).visibility;
      row.dispatchEvent(new Event('touchend'));
      return { during, after: getComputedStyle(row.querySelector('.swipe-actions')!).visibility, cls: row.className };
    });
    expect(seen.during).toBe('hidden');
    expect(seen.after).toBe('hidden');
    expect(seen.cls).not.toContain('swipe-active');
  });

  test('with a mouse the actions are reachable at all', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(10) } });
    await page.evaluate(() => (window as any).showMyWords());
    const row = page.locator('#words li').first();
    await expect(row).toBeVisible({ timeout: 10000 });

    await expect(row.locator('.swipe-action.danger')).toBeHidden();
    await row.hover();
    await expect(row.locator('.swipe-action.danger')).toBeVisible();
  });
});

test.describe('Counts read like Ukrainian', () => {
  const photoAi = (page: Page, count: number) =>
    page.route('**/.netlify/functions/ai', (route) => {
      const words = [
        { english: 'lantern', translation: 'ліхтар' },
        { english: 'shade', translation: 'тінь' },
        { english: 'harbour', translation: 'гавань' },
        { english: 'ledge', translation: 'виступ' },
        { english: 'stroll', translation: 'прогулянка' },
      ].slice(0, count);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(words) } }] }),
      });
    });

  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=',
    'base64'
  );

  async function addFromPhoto(page: Page, count: number) {
    await photoAi(page, count);
    await loadApp(page, { seed: { words: {} } });
    await page.click('.acc-action-btn:has-text("Додати")');
    await page.setInputFiles('#photo-gallery-label input[type="file"]', {
      name: 'page.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await expect(page.locator('#photo-words-list button').first()).toBeVisible({ timeout: 15000 });
    const offered = page.locator('#photo-words-list button:not([disabled])');
    for (let i = 0; i < (await offered.count()); i++) await offered.nth(i).click();
    await page.click('#bulk-add-photo-words');
    return page.locator('.notification, .toast').first();
  }

  test('one word is added, not "1 слів"', async ({ page }) => {
    const toast = await addFromPhoto(page, 1);
    await expect(toast).toContainText('Додано 1 слово');
  });

  test('two words are "2 слова"', async ({ page }) => {
    const toast = await addFromPhoto(page, 2);
    await expect(toast).toContainText('Додано 2 слова');
  });

  test('five words are "5 слів"', async ({ page }) => {
    const toast = await addFromPhoto(page, 5);
    await expect(toast).toContainText('Додано 5 слів');
  });
});

test.describe('A conversation that came back malformed', () => {
  // The analysis is written by a model straight into scHistory. One reply in a
  // shape the app did not expect used to take the whole history screen down —
  // and the bad record stays in the database, so it took it down forever.
  const historyWithStrings = {
    scHistory: [
      {
        date: new Date('2026-08-16T10:00:00Z').toISOString(), topic: 'Подорожі', level: 'Intermediate',
        format: 'text', messages: 1, xp: 40, errorsCount: 1, summary: 'Стеж за часами.',
        errors: [{ was: 'I go yesterday', fix: 'I went yesterday', why: 'минулий час' }],
        words: ['harbour'],
        phrases: ['take a seat'],
        grammar: ['past_simple'],
      },
    ],
  };

  test('the history screen still opens', async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    await loadApp(page, { seed: { words: vocabulary(5), user: historyWithStrings } });

    await page.click('.acc-tile:has-text("Speaking Club")');
    await page.click('#sc-history-btn');
    await expect(page.locator('#sc-history .sc-analysis-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#sc-history')).toContainText('Подорожі');
    await expect(page.locator('#sc-history')).not.toContainText('Помилка');
    expect(crashes).toEqual([]);
  });

  test('and its details still read', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(5), user: historyWithStrings } });
    await page.click('.acc-tile:has-text("Speaking Club")');
    await page.click('#sc-history-btn');
    await page.locator('#sc-history .sc-analysis-card').first().click();
    const details = page.locator('#sc-history .sc-hist-details').first();
    await expect(details).toContainText('harbour');
    await expect(details).toContainText('take a seat');
    await expect(details).toContainText('I went yesterday');
  });

  test('one message is "1 повідомлення"', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(5), user: historyWithStrings } });
    await page.click('.acc-tile:has-text("Speaking Club")');
    await page.click('#sc-history-btn');
    await expect(page.locator('#sc-history .sc-analysis-card').first()).toContainText('1 повідомлення');
  });
});

test.describe('One word, one entry', () => {
  // Seven places wrote a word into the dictionary and each picked its own form:
  // from a photo lowercased, from a conversation exactly as the model wrote it.
  // The same word then sat in the dictionary twice, with split statistics.
  test('a word from a conversation is stored the way every other one is', async ({ page }) => {
    await page.route('**/.netlify/functions/ai', (route) => {
      const sent = route.request().postDataJSON() || {};
      const prompt = ((sent.body || {}).messages || [])
        .map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      const analysis = {
        errors: [], summary: 'Добре!',
        words: [{ word: 'Harbour', translation: 'гавань' }],
        phrases: [], grammar: [],
      };
      const content = /Respond ONLY with JSON/.test(prompt) ? JSON.stringify(analysis) : 'Hey!';
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
    });
    await loadApp(page, { seed: { words: vocabulary(5) } });

    await page.click('.acc-tile:has-text("Speaking Club")');
    await page.click('.sc-chip:has-text("Подорожі")');
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-messages')).toContainText('Hey!', { timeout: 10000 });
    await page.locator('#sc-text-input').fill('I went to the harbour yesterday');
    await page.evaluate(() => (window as any).scSendMessage());
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window as any).scEndChat());
    await expect(page.locator('#sc-analysis-screen .sc-add-word').first()).toBeVisible({ timeout: 15000 });
    await page.locator('#sc-analysis-screen .sc-add-word').first().click();
    await expect(page.locator('#sc-analysis-screen .sc-added')).toHaveCount(1);

    await page.evaluate(() => (window as any).backToAccount());
    await page.click('.acc-action-btn:has-text("Словник")');
    await expect(page.locator('#words')).toContainText('harbour - гавань');
    await expect(page.locator('#words')).not.toContainText('Harbour');
  });
});

test.describe('When the connection drops mid-exercise', () => {
  test('the learner is told the answer was not saved', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(35) } });
    await page.click('.acc-tile:has-text("Тестування")');
    await expect(page.locator('#quiz-container button').first()).toBeVisible();

    await page.evaluate(() => ((window as any).__mockFailWrites = true));
    await page.locator('#quiz-container button').first().click();

    const notice = page.locator('.notification, .toast').filter({ hasText: 'не збережено' });
    await expect(notice.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('The streak the account screen shows', () => {
  // The counter was painted before the streak was worked out, so the first
  // exercise of the day still showed yesterday's number — and a streak that
  // had already been broken kept pretending to be alive.
  const dayKey = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().split('T')[0];

  async function answerOnce(page: Page) {
    await page.click('.acc-tile:has-text("Тестування")');
    await expect(page.locator('#quiz-container button').first()).toBeVisible();
    await page.locator('#quiz-container button').first().click();
    await page.waitForTimeout(800);
  }

  test('practising today continues yesterday\'s streak straight away', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(35), user: { streak: 4, lastActiveDate: dayKey(-1), xp: 500 } } });
    await expect(page.locator('#streak-count')).toHaveText('4');
    await answerOnce(page);
    await expect(page.locator('#streak-count')).toHaveText('5');
  });

  test('a streak broken days ago starts over at one', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(35), user: { streak: 9, lastActiveDate: dayKey(-4), xp: 900 } } });
    await expect(page.locator('#streak-count')).toHaveText('9');
    await answerOnce(page);
    await expect(page.locator('#streak-count')).toHaveText('1');
  });
});

test.describe('A device that cannot speak', () => {
  // "На слух" is nothing but the sound. With no browser voice and the live one
  // failing, the speaker button did nothing and said nothing — the exercise
  // looked broken rather than unavailable.
  test('says so instead of staying silent', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', { get: () => undefined });
    });
    await page.route('**/.netlify/functions/ai', (route) => {
      const sent = route.request().postDataJSON() || {};
      if (sent.route === 'speech') return route.fulfill({ status: 500, body: 'no tts' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }) });
    });
    await loadApp(page, { seed: { words: vocabulary(35) } });

    await page.click('.acc-tile:has-text("На слух")');
    await page.locator('#listening-quiz-container .listening-sound-icon').click();
    await expect(page.locator('.notification, .toast').filter({ hasText: 'озвучувати' }).first())
      .toBeVisible({ timeout: 10000 });
  });
});

test.describe('Folders hold what was put in them', () => {
  const seeded = () => {
    const words = vocabulary(40);
    words.river.folders = ['f1'];
    words.forest.folders = ['f1'];
    return { words, folders: { f1: { name: 'Природа', wordCount: 2 }, f2: { name: 'Місто', wordCount: 0 } } };
  };

  test('a word moved to another folder leaves the first one', async ({ page }) => {
    await loadApp(page, { seed: seeded() });
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('.folder-chip:has-text("Природа")');
    await expect(page.locator('#words li')).toHaveCount(2);

    await page.evaluate(() => (window as any).openFolderPicker('river', 'word'));
    await page.locator('#folder-pick-modal .folder-pick-row', { hasText: 'Природа' }).click();
    await page.locator('#folder-pick-modal .folder-pick-row', { hasText: 'Місто' }).click();
    await page.locator('#folder-pick-modal button').last().click();

    await expect(page.locator('.folder-chip', { hasText: 'Природа' })).toContainText('1');
    await expect(page.locator('.folder-chip', { hasText: 'Місто' })).toContainText('1');
    await expect(page.locator('#words')).not.toContainText('river');

    await page.click('.folder-chip:has-text("Місто")');
    await expect(page.locator('#words')).toContainText('river');
  });

  test('several words go into a folder at once', async ({ page }) => {
    await loadApp(page, { seed: seeded() });
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('.folder-chip:has-text("Місто")');
    await page.evaluate(() => (window as any).openAddToFolder());
    for (const word of ['street', 'market', 'bridge']) {
      await page.locator('#add-to-folder-modal button', { hasText: word }).first().click();
    }
    await page.locator('#add-to-folder-modal button').filter({ hasText: /Додати \(3\)/ }).click();
    await expect(page.locator('#words li')).toHaveCount(3);
    await expect(page.locator('.folder-chip', { hasText: 'Місто' })).toContainText('3');
  });
});

test.describe('An empty phrases tab', () => {
  // The words tab offers "Поповнити словник" when it is empty. The phrases tab
  // rendered nothing at all — not even its own "Поки що немає фраз" — because
  // an empty snapshot skipped the render entirely.
  test('says it is empty and offers to add the first phrase', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(10), phrases: {} } });
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('#vocab-tab-phrases');

    await expect(page.locator('#vocab-phrases-content')).toContainText('Поки що немає фраз');
    const add = page.locator('#add-phrase-from-my-vocabulary');
    await expect(add).toBeVisible();
    await add.click();
    await expect(page.locator('#add-phrase-section')).toBeVisible();
  });

  test('the button stays away once there are phrases', async ({ page }) => {
    await loadApp(page, {
      seed: {
        words: vocabulary(10),
        phrases: { p1: { english: 'Take a seat', translation: 'Сідайте', folders: [], dateAdded: { seconds: 10 } } },
      },
    });
    await page.click('.acc-action-btn:has-text("Словник")');
    await page.click('#vocab-tab-phrases');
    await expect(page.locator('#phrases li').first()).toBeVisible();
    await expect(page.locator('#add-phrase-from-my-vocabulary')).toBeHidden();
  });
});

test.describe('System messages keep one voice', () => {
  // The app speaks formally in its own messages and informally in the lessons.
  // Four auth messages mixed the two inside a single sentence — "Перевірте
  // інтернет і спробуй ще раз" — which reads as a mistake either way.
  test('no auth message switches register mid-sentence', () => {
    const html = readFileSync(join(__dirname, '..', 'eng-puzzle', 'index.html'), 'utf-8');
    const table = html.slice(html.indexOf("'auth/missing-email'"), html.indexOf("'auth/account-exists-with-different-credential'"));
    for (const informal of ['зареєструйся', 'увійди ', 'напиши ', 'натисни ', 'зачекай ', 'спробуй ']) {
      expect(table.toLowerCase(), `auth messages still say "${informal}"`).not.toContain(informal);
    }
    expect(table).toContain('Спробуйте');
  });
});

test.describe('The grammar a conversation recommends', () => {
  // topic.icon holds a Font Awesome class name. The topic list wraps it in
  // <i class="fas ...">; the analysis printed it as text, so the results screen
  // showed the literal "fa-backward" next to the topic.
  const analysisAi = (page: Page) =>
    page.route('**/.netlify/functions/ai', (route) => {
      const sent = route.request().postDataJSON() || {};
      const prompt = ((sent.body || {}).messages || [])
        .map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      const analysis = {
        errors: [], summary: 'Стежте за часами.', words: [], phrases: [],
        grammar: [{ id: 'past_simple', reason: 'були помилки з минулим часом' }],
      };
      const content = /Respond ONLY with JSON/.test(prompt) ? JSON.stringify(analysis) : 'Hey!';
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
    });

  async function finishAConversation(page: Page) {
    await page.click('.acc-tile:has-text("Speaking Club")');
    await page.click('.sc-chip:has-text("Подорожі")');
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-messages')).toContainText('Hey!', { timeout: 10000 });
    await page.locator('#sc-text-input').fill('I go yesterday to the park');
    await page.evaluate(() => (window as any).scSendMessage());
    await page.waitForTimeout(1200);
    await page.evaluate(() => (window as any).scEndChat());
    await expect(page.locator('#sc-analysis-content')).toContainText('Граматика для повторення', { timeout: 15000 });
  }

  test('shows an icon, not the name of one', async ({ page }) => {
    await analysisAi(page);
    await loadApp(page, { seed: { words: vocabulary(10) } });
    await finishAConversation(page);

    const row = page.locator('#sc-analysis-content [onclick*="scGoToGrammar"]');
    await expect(row).toContainText('Past Simple');
    await expect(row).not.toContainText('fa-');
    await expect(row.locator('i.fas.fa-backward')).toHaveCount(1);
  });

  test('and opens that very lesson', async ({ page }) => {
    await analysisAi(page);
    await loadApp(page, { seed: { words: vocabulary(10) } });
    await finishAConversation(page);

    await page.locator('#sc-analysis-content [onclick*="scGoToGrammar"]').click();
    await expect(page.locator('#grammar-section')).toBeVisible();
    await expect(page.locator('#grammar-lesson')).toContainText('Past Simple');
    await expect(page.locator('#speaking-club-section')).toBeHidden();
  });
});

test.describe('No browser dialogs left in the app', () => {
  // The app has its own prompt and confirm (a real Telegram popup inside the
  // mini app) precisely so a system dialog with the domain never appears. Two
  // places still called the browser's own.
  async function denyTheMicrophone(page: Page) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        get: () => ({ getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }),
      });
    });
  }

  const clubAi = (page: Page) =>
    page.route('**/.netlify/functions/ai', (route) => {
      const sent = route.request().postDataJSON() || {};
      if (sent.route === 'speech') return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from('ID3') });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Nice!' } }] }) });
    });

  test('a refused microphone is explained in the app, not by the browser', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    await denyTheMicrophone(page);
    await clubAi(page);
    await loadApp(page, { seed: { words: vocabulary(10) } });

    await page.click('.acc-tile:has-text("Speaking Club")');
    await page.click('.sc-chip:has-text("Подорожі")');
    await page.click('.sc-chip:has-text("Голос")');
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-messages')).toContainText('Nice!', { timeout: 10000 });
    await page.click('#sc-mic-btn');

    await expect(page.locator('.notification, .toast').filter({ hasText: 'мікрофона' }).first()).toBeVisible({ timeout: 10000 });
    expect(dialogs).toEqual([]);
    // and the conversation can go on in writing
    await expect(page.locator('#sc-text-input')).toBeVisible();
  });

  test('nothing calls the browser alert or confirm any more', () => {
    const html = readFileSync(join(__dirname, '..', 'eng-puzzle', 'index.html'), 'utf-8');
    // Comments talk about confirm() on purpose — only real calls count
    const guilty = html.split('\n').filter((line) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('<!--')) return false;
      return /(^|[^.\w])(alert|confirm)\s*\(/.test(code);
    });
    expect(guilty).toEqual([]);
  });
});

test.describe('A crossword from start to finish', () => {
  test('wrong letters are named, a full grid is congratulated, and "Новий" clears it', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(40) } });
    await page.click('.acc-tile:has-text("Кросворд")');
    await expect(page.locator('#crossword-container input').first()).toBeVisible({ timeout: 15000 });

    const fill = (wrongEvery: number) =>
      page.evaluate((every) => {
        const grid = (window as any).eval('crosswordGrid');
        (Array.from(document.querySelectorAll('#crossword-container input')) as HTMLInputElement[]).forEach((input, i) => {
          const r = Number(input.dataset.row), c = Number(input.dataset.col);
          input.value = every && i % every === 0 ? 'Z' : grid[r][c];
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }, wrongEvery);

    await fill(4);
    await page.click('#crossword-actions button:has-text("Перевірити")');
    await expect(page.locator('#crossword-popup')).toContainText('Є помилки');
    await page.locator('#crossword-popup button').first().click();

    await fill(0);
    await page.click('#crossword-actions button:has-text("Перевірити")');
    await expect(page.locator('#crossword-popup')).toContainText('розгадано правильно');

    await page.locator('#crossword-popup button', { hasText: 'Новий' }).click();
    await expect(page.locator('#crossword-container input').first()).toBeVisible({ timeout: 15000 });
    const carried = await page.locator('#crossword-container input').evaluateAll((els) =>
      (els as HTMLInputElement[]).filter((e) => e.value).length);
    expect(carried).toBe(0);
    await expect(page.locator('#crossword-container input.correct, #crossword-container input.incorrect')).toHaveCount(0);
  });
});

test.describe('An exercise left half-done', () => {
  test('starts from the beginning next time, not where it was abandoned', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(40) } });
    await page.click('.acc-tile:has-text("Тестування")');
    await expect(page.locator('#quiz-container button').first()).toBeVisible();
    for (let i = 0; i < 3; i++) {
      const shown = await page.textContent('#quiz-question-number');
      await page.locator('#quiz-container button').first().click();
      await page.waitForFunction((p) => document.getElementById('quiz-question-number')?.textContent !== p, shown, { timeout: 5000 }).catch(() => {});
    }
    expect(await page.textContent('#quiz-question-number')).toBe('4/30');

    await page.evaluate(() => (window as any).backToAccount());
    await page.click('.acc-tile:has-text("Тестування")');
    await expect(page.locator('#quiz-container button').first()).toBeVisible();
    expect(await page.textContent('#quiz-question-number')).toBe('1/30');
  });

  test('the constructor asks for the mode again instead of resuming', async ({ page }) => {
    await loadApp(page, { seed: { words: vocabulary(40) } });
    await page.click('.acc-tile:has-text("Конструктор")');
    await page.click('#constructor-mode-select button:has-text("Почати")');
    await expect(page.locator('#constructor-answer')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => {
      const keys = Array.from(document.querySelectorAll('#letter-buttons button, .cw-key')) as HTMLElement[];
      keys.slice(0, 2).forEach((k) => k.click());
    });
    expect(await page.inputValue('#constructor-answer')).not.toBe('');

    await page.evaluate(() => (window as any).backToAccount());
    await page.click('.acc-tile:has-text("Конструктор")');
    await expect(page.locator('#constructor-mode-select')).toBeVisible();
  });
});
