import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

// A deliberate crossing: "WORD" runs down through column 2, "CAT" runs across row 2,
// so (2,2) belongs to both. The across word is listed FIRST on purpose — that is the
// order that made the old code flip direction mid-word at the intersection.
async function buildCrossword(page: Page) {
  await page.evaluate(() => {
    // @ts-ignore — module-level globals declared in the app's own script
    crosswordSize = 15;
    // @ts-ignore
    crosswordGrid = Array.from({ length: 15 }, () => new Array(15).fill(null));
    // @ts-ignore
    placedWords = [
      { english: 'CAT', translation: 'кіт', row: 2, col: 1, direction: 'across' },
      { english: 'WORD', translation: 'слово', row: 0, col: 2, direction: 'down' },
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

const sel = (r: number, c: number) => `.crossword-cell input[data-row="${r}"][data-col="${c}"]`;

function activeCell(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return el && el.dataset && el.dataset.row !== undefined ? `${el.dataset.row}-${el.dataset.col}` : null;
  });
}

// The app advances the caret on keyup, so a typed letter is value + keyup.
async function typeLetter(page: Page, r: number, c: number, letter: string) {
  await page.locator(sel(r, c)).evaluate((el, l) => {
    (el as HTMLInputElement).value = l;
    el.dispatchEvent(new KeyboardEvent('keyup', { key: l, bubbles: true }));
  }, letter);
}

function direction(page: Page) {
  // @ts-ignore — module-level global
  return page.evaluate(() => cwDirection);
}

async function openCrossword(page: Page) {
  await page.evaluate(() => {
    document.getElementById('account-screen')!.classList.add('hidden');
    document.getElementById('crossword-section')!.classList.remove('hidden');
  });
  await buildCrossword(page);
}

test.describe('Crossword direction', () => {
  test('typing down keeps going down through an intersection', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(0, 2)).click();
    expect(await direction(page)).toBe('down');

    await typeLetter(page, 0, 2, 'W');
    expect(await activeCell(page)).toBe('1-2');

    await typeLetter(page, 1, 2, 'O');
    expect(await activeCell(page)).toBe('2-2'); // the crossing cell

    // This is the regression: it used to jump to 2-3, continuing the across word
    await typeLetter(page, 2, 2, 'R');
    expect(await activeCell(page)).toBe('3-2');
    expect(await direction(page)).toBe('down');
  });

  test('the caret stops at the end of the word instead of running on', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(0, 2)).click();
    for (const [i, letter] of ['W', 'O', 'R', 'D'].entries()) {
      await typeLetter(page, i, 2, letter);
    }
    expect(await activeCell(page)).toBe('3-2');
  });

  test('tapping the crossing cell a second time switches direction', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(0, 2)).click();
    expect(await direction(page)).toBe('down');

    // First tap on the crossing cell only moves the caret there
    await page.locator(sel(2, 2)).click();
    expect(await direction(page)).toBe('down');

    // Second tap on the same cell flips to the other word
    await page.locator(sel(2, 2)).click();
    expect(await direction(page)).toBe('across');

    await typeLetter(page, 2, 2, 'A');
    expect(await activeCell(page)).toBe('2-3');
  });

  test('a cell that belongs to one word only adopts that word direction', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 1)).click(); // only "CAT" passes here
    expect(await direction(page)).toBe('across');
    await expect(page.locator('#crossword-direction-label')).toHaveText('→ Пишемо вправо');

    await page.locator(sel(0, 2)).click(); // only "WORD" passes here
    expect(await direction(page)).toBe('down');
    // The chip has to follow the tap, not keep showing the previous direction
    await expect(page.locator('#crossword-direction-label')).toHaveText('↓ Пишемо вниз');
  });

  test('the direction chip shows and switches the current direction', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    const label = page.locator('#crossword-direction-label');
    await expect(label).toHaveText('→ Пишемо вправо');

    await page.click('#crossword-direction-toggle');
    expect(await direction(page)).toBe('down');
    await expect(label).toHaveText('↓ Пишемо вниз');

    await page.click('#crossword-direction-toggle');
    expect(await direction(page)).toBe('across');
    await expect(label).toHaveText('→ Пишемо вправо');
  });

  test('clicking a clue jumps to its first cell and sets its direction', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.click('#down-clues li:has-text("слово")');
    expect(await activeCell(page)).toBe('0-2');
    expect(await direction(page)).toBe('down');
    await expect(page.locator('#crossword-direction-label')).toHaveText('↓ Пишемо вниз');

    await page.click('#across-clues li:has-text("кіт")');
    expect(await activeCell(page)).toBe('2-1');
    expect(await direction(page)).toBe('across');
  });

  test('arrow keys move the caret and set the direction (desktop)', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 1)).click();
    expect(await direction(page)).toBe('across');

    await page.locator(sel(2, 1)).press('ArrowRight');
    expect(await activeCell(page)).toBe('2-2');

    // A perpendicular arrow switches direction rather than fighting it
    await page.locator(sel(2, 2)).press('ArrowDown');
    expect(await direction(page)).toBe('down');
    expect(await activeCell(page)).toBe('3-2');
  });

  test('the highlighted word follows the current direction', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(0, 2)).click();
    // Whole "WORD" column highlighted, four cells
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(4);

    await page.locator(sel(2, 2)).click();
    await page.locator(sel(2, 2)).click(); // flip to across
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(3); // "CAT"
  });
});
