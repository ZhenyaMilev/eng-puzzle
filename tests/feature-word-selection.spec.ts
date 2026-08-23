import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

/**
 * Два алгоритми відбору, що чергуються: за складністю (спершу нові) і за
 * давністю повторення. Скарга була, що бачиш ті самі старі слова, а нові
 * не показуються — бо слово, вгадане з першої спроби, отримувало
 * priority = 1/1 і осідало в кінці сортування назавжди.
 */

type Word = { interactions: number; correctAnswers: number; priority: number; last?: number };

async function seed(page: Page, words: Record<string, Word>) {
  await page.evaluate(async (data) => {
    // Спільний мок кладе п'ять власних слів — вони б змішалися з посівом
    // @ts-ignore
    const existing = await db.collection('users').doc('test-user-123').collection('words').get();
    for (const d of existing.docs) await d.ref.delete();
    for (const [id, w] of Object.entries(data as Record<string, Word>)) {
      // @ts-ignore — the app's own Firestore handle
      await db.collection('users').doc('test-user-123').collection('words').doc(id).set({
        translation: id + '-uk', example: '', folders: [],
        interactions: w.interactions, correctAnswers: w.correctAnswers, priority: w.priority,
        dateAdded: { seconds: 1 },
        ...(w.last === undefined ? {} : { lastInteractionDate: { seconds: w.last } }),
      });
    }
  }, words);
}

/** Прогін відбору з примусово обраним алгоритмом. */
function select(page: Page, limit: number, recency: boolean) {
  return page.evaluate(async ([n, useRecency]) => {
    const real = Math.random;
    // 0.2 — межа між алгоритмами в getSmartWordQuery
    Math.random = () => (useRecency ? 0.05 : 0.9);
    try {
      // @ts-ignore
      const snap = await getSmartWordQuery('test-user-123', n).get();
      return snap.docs.map((d: any) => d.id);
    } finally {
      Math.random = real;
    }
  }, [limit, recency] as [number, boolean]);
}

test.describe('A word guessed once is not a word learned', () => {
  test('three sightings is the line, not one', async ({ page }) => {
    await loadApp(page);
    // const верхнього рівня не стає властивістю window — беремо з області видимості
    const threshold = await page.evaluate(() => eval('NEW_UNTIL_INTERACTIONS'));
    expect(threshold).toBe(3);
  });

  test('a word seen twice still comes before a word answered wrong ten times', async ({ page }) => {
    await loadApp(page);
    await seed(page, {
      // вгадане з першого разу: раніше priority 1 ховав його назавжди
      lucky: { interactions: 1, correctAnswers: 1, priority: 1, last: 200 },
      twice: { interactions: 2, correctAnswers: 2, priority: 1, last: 200 },
      // справді складне, але вже добре знайоме
      stubborn: { interactions: 10, correctAnswers: 1, priority: 0.1, last: 100 },
    });

    const picked = await select(page, 2, false);
    expect(picked).toEqual(['lucky', 'twice']);
    expect(picked).not.toContain('stubborn');
  });

  test('once there are no new words left, difficulty decides', async ({ page }) => {
    await loadApp(page);
    await seed(page, {
      easy: { interactions: 8, correctAnswers: 8, priority: 1, last: 300 },
      medium: { interactions: 8, correctAnswers: 4, priority: 0.5, last: 300 },
      hard: { interactions: 8, correctAnswers: 1, priority: 0.125, last: 300 },
    });

    const picked = await select(page, 2, false);
    expect(picked).toEqual(['hard', 'medium']);
  });

  test('new words first, then the hardest to fill the session', async ({ page }) => {
    await loadApp(page);
    await seed(page, {
      brandnew: { interactions: 0, correctAnswers: 0, priority: 0 },
      easy: { interactions: 9, correctAnswers: 9, priority: 1, last: 300 },
      hard: { interactions: 9, correctAnswers: 1, priority: 0.11, last: 300 },
    });

    const picked = await select(page, 3, false);
    expect(picked[0]).toBe('brandnew');
    expect(picked).toContain('hard');
    expect(new Set(picked).size).toBe(3);
  });
});

test.describe('The other algorithm looks at time, not difficulty', () => {
  test('the longest unseen comes first, however easy it is', async ({ page }) => {
    await loadApp(page);
    await seed(page, {
      ancient: { interactions: 9, correctAnswers: 9, priority: 1, last: 10 },
      recent: { interactions: 9, correctAnswers: 1, priority: 0.11, last: 900 },
    });

    const picked = await select(page, 2, true);
    expect(picked[0]).toBe('ancient');
  });

  test('a dictionary nobody has practised falls back instead of coming up empty', async ({ page }) => {
    await loadApp(page);
    // orderBy('lastInteractionDate') не бачить документів без цього поля
    await seed(page, {
      one: { interactions: 0, correctAnswers: 0, priority: 0 },
      two: { interactions: 0, correctAnswers: 0, priority: 0 },
    });

    const picked = await select(page, 2, true);
    expect(picked.sort()).toEqual(['one', 'two']);
  });
});

test.describe('The whole dictionary stays reachable', () => {
  test('a word late in the alphabet is not exiled by a tie', async ({ page }) => {
    await loadApp(page);
    const words: Record<string, Word> = {};
    // 60 слів з однаковим priority: раніше limit(50) завжди брав перші за id
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => {
      words[c + 'word'] = { interactions: 5, correctAnswers: 5, priority: 1, last: 100 + i };
    });
    words.zulu = { interactions: 1, correctAnswers: 1, priority: 1, last: 999 };
    await seed(page, words);

    const picked = await select(page, 5, false);
    // zulu бачили лише раз — він новий, і йде першим попри кінець алфавіту
    expect(picked[0]).toBe('zulu');
  });
});
