import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');

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

/** Прогін відбору так, як його бачить вправа. */
function select(page: Page, limit: number) {
  return page.evaluate(async (n) => {
    // @ts-ignore
    const snap = await getSmartWordQuery('test-user-123', n).get();
    return snap.docs.map((d: any) => d.id);
  }, limit);
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

    // Із трьох місць два належать першому алгоритму — і обидва йдуть новим
    const picked = await select(page, 3);
    expect(picked.slice(0, 2).sort()).toEqual(['lucky', 'twice']);
  });

  test('once there are no new words left, difficulty decides', async ({ page }) => {
    await loadApp(page);
    await seed(page, {
      easy: { interactions: 8, correctAnswers: 8, priority: 1, last: 300 },
      medium: { interactions: 8, correctAnswers: 4, priority: 0.5, last: 300 },
      hard: { interactions: 8, correctAnswers: 1, priority: 0.125, last: 300 },
    });

    // Нових немає, тож частку першого алгоритму беруть найважчі
    const picked = await select(page, 3);
    expect(picked.slice(0, 2)).toEqual(['hard', 'medium']);
  });

  test('new words first, then the hardest to fill the session', async ({ page }) => {
    await loadApp(page);
    await seed(page, {
      brandnew: { interactions: 0, correctAnswers: 0, priority: 0 },
      easy: { interactions: 9, correctAnswers: 9, priority: 1, last: 300 },
      hard: { interactions: 9, correctAnswers: 1, priority: 0.11, last: 300 },
    });

    const picked = await select(page, 3);
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

    // Місце другого алгоритму дістається найдавнішому, хай і легкому
    const picked = await select(page, 2);
    expect(picked).toContain('ancient');
  });

  test('a dictionary nobody has practised falls back instead of coming up empty', async ({ page }) => {
    await loadApp(page);
    // orderBy('lastInteractionDate') не бачить документів без цього поля
    await seed(page, {
      one: { interactions: 0, correctAnswers: 0, priority: 0 },
      two: { interactions: 0, correctAnswers: 0, priority: 0 },
    });

    const picked = await select(page, 2);
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

    const picked = await select(page, 5);
    // zulu бачили лише раз — він новий, і йде першим попри кінець алфавіту
    expect(picked[0]).toBe('zulu');
  });
});

test.describe('Both algorithms run in every session, not by lottery', () => {
  test('a long-unrepeated word gets in even when new words could fill the lot', async ({ page }) => {
    await loadApp(page);
    const words: Record<string, Word> = { forgotten: { interactions: 9, correctAnswers: 9, priority: 1, last: 1 } };
    // десять свіжих слів — раніше вони забрали б усі місця
    for (let i = 0; i < 10; i++) {
      words['fresh' + i] = { interactions: 1, correctAnswers: 1, priority: 1, last: 500 + i };
    }
    await seed(page, words);

    const picked = await select(page, 10);
    expect(picked).toContain('forgotten');
  });

  test('the shares are kept: most from difficulty, some from recency', async ({ page }) => {
    await loadApp(page);
    const words: Record<string, Word> = {};
    for (let i = 0; i < 10; i++) words['new' + i] = { interactions: 0, correctAnswers: 0, priority: 0 };
    for (let i = 0; i < 10; i++) words['old' + i] = { interactions: 9, correctAnswers: 9, priority: 1, last: i };
    await seed(page, words);

    const picked = await select(page, 10);
    const fromRecency = picked.filter((id) => id.startsWith('old')).length;
    expect(fromRecency).toBe(3);
    expect(picked.filter((id) => id.startsWith('new')).length).toBe(7);
  });

  test('when one side runs dry the other fills the session', async ({ page }) => {
    await loadApp(page);
    // жодного слова з історією повторень — другому алгоритму нема що дати
    await seed(page, {
      a: { interactions: 0, correctAnswers: 0, priority: 0 },
      b: { interactions: 0, correctAnswers: 0, priority: 0 },
      c: { interactions: 0, correctAnswers: 0, priority: 0 },
    });

    const picked = await select(page, 3);
    expect(picked.sort()).toEqual(['a', 'b', 'c']);
  });

  test('a word is never asked twice in one session', async ({ page }) => {
    await loadApp(page);
    const words: Record<string, Word> = {};
    for (let i = 0; i < 6; i++) words['w' + i] = { interactions: 1, correctAnswers: 1, priority: 1, last: i };
    await seed(page, words);

    const picked = await select(page, 6);
    expect(new Set(picked).size).toBe(picked.length);
  });
});

test.describe('An exercise that asks for more than it shows', () => {
  test('the ratio holds in the first ten of fifty — the quiz keeps only thirty', async ({ page }) => {
    await loadApp(page);
    const words: Record<string, Word> = {};
    for (let i = 0; i < 40; i++) words['new' + String(i).padStart(2, '0')] = { interactions: 0, correctAnswers: 0, priority: 0 };
    for (let i = 0; i < 40; i++) words['old' + String(i).padStart(2, '0')] = { interactions: 9, correctAnswers: 9, priority: 1, last: i };
    await seed(page, words);

    const picked = await select(page, 50);
    const share = (from: number, to: number) =>
      picked.slice(from, to).filter((id) => id.startsWith('old')).length;

    // раніше частки йшли блоками, і зріз до 30 лишав нуль слів другого алгоритму
    expect(share(0, 10)).toBe(3);
    expect(share(0, 30)).toBe(9);
  });

  test('every ten words carry three from the recency side', async ({ page }) => {
    await loadApp(page);
    const words: Record<string, Word> = {};
    for (let i = 0; i < 30; i++) words['new' + String(i).padStart(2, '0')] = { interactions: 0, correctAnswers: 0, priority: 0 };
    for (let i = 0; i < 30; i++) words['old' + String(i).padStart(2, '0')] = { interactions: 9, correctAnswers: 9, priority: 1, last: i };
    await seed(page, words);

    const picked = await select(page, 30);
    for (let block = 0; block < 3; block++) {
      const ten = picked.slice(block * 10, block * 10 + 10);
      expect(ten.filter((id) => id.startsWith('old')).length).toBe(3);
    }
  });
});

test.describe('No word is written without the fields the selection needs', () => {
  /**
   * orderBy у Firestore не бачить документа без потрібного поля. Слово без
   * priority лежить у словнику й не трапляється в тренуванні ніколи — так
   * загубилося 749 слів у 19 користувачів. Полагоджено в базі; тут стежимо,
   * щоб новий шлях додавання не завів дірку заново.
   */
  test('every place that creates a word writes priority and interactions', () => {
    const src = readFileSync(INDEX, 'utf-8');
    const creations = src.split('interactions: 0');
    expect(creations.length).toBeGreaterThan(10);
    // навколо кожного запису має стояти й priority
    creations.slice(1).forEach((tail, i) => {
      const around = src.slice(
        Math.max(0, src.indexOf('interactions: 0', i) - 300),
        src.indexOf('interactions: 0', i) + 300,
      );
      expect(around).toContain('priority:');
    });
  });

  test('the one-off client migration is gone, the data was fixed at the source', () => {
    const src = readFileSync(INDEX, 'utf-8');
    expect(src).not.toContain('migratePriorityField');
    // саме localStorage робив її ненадійною: вона чекала, поки людина зайде
    expect(src).not.toContain('priority_migrated_');
  });
});
