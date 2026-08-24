import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = () => readFileSync(join(__dirname, '..', 'eng-puzzle', 'index.html'), 'utf-8');

/**
 * Те, що застосунок мав відзначати, але відзначав не завжди: доданий рядок,
 * виконану денну ціль і кінець вправи «Вгадай слово».
 */
test.describe('Дрібні святкування', () => {
  test('спалах доданого рядка більше не лежить у стилях без діла', () => {
    const src = html();
    expect(src).toContain('@keyframes addedWordAnimation');
    // Клас має на що вішатися — раніше його не ставив ніхто
    expect(src).toContain("classList.add('added-word')");
    expect(src).toContain('function flashAdded');
  });

  test('рядок блимає і коли слово додають поодинці, і коли пачкою', async ({ page }) => {
    await loadApp(page);
    const flashed = await page.evaluate(() => {
      const li = document.createElement('li');
      const icon = document.createElement('i');
      li.appendChild(icon);
      document.body.appendChild(li);
      (window as any).flashAdded(icon);
      return li.classList.contains('added-word');
    });
    expect(flashed).toBe(true);
    // обидва шляхи додавання його кличуть
    const src = html();
    const single = src.slice(src.indexOf('async function addDailyWord'), src.indexOf('async function addAllDailyWords'));
    const bulk = src.slice(src.indexOf('async function addAllDailyWords'), src.indexOf('async function regenerateDailyWords'));
    expect(single).toContain('flashAdded(');
    expect(bulk).toContain('flashAdded(');
  });

  test('спалах перезапускається, якщо тиснути підряд', async ({ page }) => {
    await loadApp(page);
    const twice = await page.evaluate(() => {
      const li = document.createElement('li');
      const icon = document.createElement('i');
      li.appendChild(icon);
      document.body.appendChild(li);
      (window as any).flashAdded(icon);
      (window as any).flashAdded(icon);
      return li.classList.contains('added-word');
    });
    expect(twice).toBe(true);
  });

  test('виконана денна ціль тепер помітна, а не лише +50 XP', () => {
    const src = html();
    const block = src.slice(src.indexOf('function incrementDailyGoal'), src.indexOf('function incrementDailyGoal') + 900);
    expect(block).toContain('wasBelowTarget && isNowComplete');
    expect(block).toContain('showConfetti()');
  });

  test('«Вгадай слово» вітає із завершенням, як і решта вправ', () => {
    const src = html();
    const block = src.slice(src.indexOf('function finishDefinitionQuiz'), src.indexOf('function finishDefinitionQuiz') + 600);
    expect(block).toContain('showConfetti()');
    expect(block).toContain('checkAndShowDailyRecord()');
  });

  test('жодна вправа не завершується мовчки', () => {
    const src = html();
    const finishers = [
      'finishSpeedTrainingSession', 'finishGrammarQuiz', 'finishPhraseConstructor',
      'finishStoryQuiz', 'finishQuiz', 'finishListening', 'finishConstructor',
      'finishFillBlanks', 'finishDefinitionQuiz',
    ];
    for (const name of finishers) {
      const at = src.indexOf(`function ${name}(`);
      expect(at, `${name} не знайдено`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 900), `${name} нічим не завершується`).toContain('showConfetti()');
    }
  });
});
