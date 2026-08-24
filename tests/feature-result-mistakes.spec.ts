import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');

/**
 * «Я хочу бачити всі помилки та слова, які я не знала» — звернення в підтримку
 * про конструктор. Розбір був лише у квізі, решта вправ показувала саму цифру.
 */

/** Кожна вправа сама збирає свої помилки — інакше розбір нема з чого будувати. */
test.describe('Every exercise collects what was missed', () => {
  const CASES: Array<[string, string]> = [
    ['конструктор слів', 'recordMistake(constructorMistakes'],
    ['аудіювання', 'recordMistake(listeningMistakes'],
    ['definition quiz', 'recordMistake(definitionMistakes'],
    ['fill blanks', 'recordMistake(fillBlanksMistakes'],
    ['конструктор фраз', 'recordMistake(phraseMistakes'],
    ['на швидкість', 'recordMistake(speedMistakes'],
  ];

  for (const [name, call] of CASES) {
    test(`${name} records a wrong answer`, () => {
      expect(readFileSync(INDEX, 'utf-8')).toContain(call);
    });
  }

  test('a skipped word counts as one the learner did not know', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const skipConstructor = html.slice(html.indexOf('function skipConstructor'));
    expect(skipConstructor.slice(0, 400)).toContain('recordMistake(constructorMistakes');

    const skipListening = html.slice(html.indexOf('function skipListeningQuestion'));
    expect(skipListening.slice(0, 400)).toContain('recordMistake(listeningMistakes');
  });
});

/** Розбір має стояти на кожному екрані результату, а не лише у квізі. */
test.describe('Every result screen shows the breakdown', () => {
  const SCREENS: Array<[string, string]> = [
    ['finishConstructor()', 'constructorMistakes'],
    ['finishListening()', 'listeningMistakes'],
    ['finishDefinitionQuiz()', 'definitionMistakes'],
    ['finishFillBlanks()', 'fillBlanksMistakes'],
    ['finishPhraseConstructor()', 'phraseMistakes'],
    ['finishSpeedTrainingSession()', 'speedMistakes'],
  ];

  for (const [handler, list] of SCREENS) {
    test(`${handler} is preceded by its mistakes block`, () => {
      const html = readFileSync(INDEX, 'utf-8');
      const button = `<button class="finish-button" onclick="${handler}">Продовжити</button>`;
      expect(html.split(button)).toHaveLength(2);
      const before = html.slice(Math.max(0, html.indexOf(button) - 220), html.indexOf(button));
      expect(before).toContain(`renderMistakes(${list}`);
    });
  }
});

test.describe('The breakdown speaks about the right thing', () => {
  test('a phrase exercise counts phrases, not words', async ({ page }) => {
    await loadApp(page);
    const html = await page.evaluate(() => (window as any).renderMistakes([
      { english: 'I have got one brother', translation: 'У мене є один брат', given: 'I have one brother' },
      { english: 'spend time together', translation: 'проводити час разом', given: '' },
    ], 'phrases'));

    expect(html).toContain('2 фрази');
    expect(html).not.toContain('2 слова');
    expect(html).toContain('Ці фрази алгоритм покаже частіше');
  });

  test('a clean phrase run is told about phrases too', async ({ page }) => {
    await loadApp(page);
    const html = await page.evaluate(() => (window as any).renderMistakes([], 'phrases'));
    expect(html).toContain('ці фрази можна вважати вивченими');
  });

  test('the word wording is untouched when no kind is given', async ({ page }) => {
    await loadApp(page);
    const html = await page.evaluate(() => (window as any).renderMistakes([
      { english: 'shade', translation: 'тінь', given: 'світло' },
    ]));
    expect(html).toContain('1 слово');
    expect(html).toContain('Ці слова алгоритм покаже частіше');
  });
});

test.describe('The same word missed twice is one line', () => {
  test('a retried word is not listed three times', async ({ page }) => {
    await loadApp(page);
    const count = await page.evaluate(() => {
      const list: any[] = [];
      const w = { english: 'necessary', translation: 'необхідний' };
      (window as any).recordMistake(list, w, 'necesary');
      (window as any).recordMistake(list, w, 'neccessary');
      (window as any).recordMistake(list, w, '');
      return list.length;
    });
    expect(count).toBe(1);
  });

  test('a word with no english is not recorded at all', async ({ page }) => {
    await loadApp(page);
    const count = await page.evaluate(() => {
      const list: any[] = [];
      (window as any).recordMistake(list, { translation: 'тінь' }, 'x');
      (window as any).recordMistake(list, null, 'x');
      return list.length;
    });
    expect(count).toBe(0);
  });
});
