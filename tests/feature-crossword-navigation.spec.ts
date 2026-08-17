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

    // Switching is about the cell being written in, so stand on the crossing
    await page.locator(sel(2, 2)).click();

    await page.click('#crossword-direction-toggle');
    expect(await direction(page)).toBe('down');
    await expect(label).toHaveText('↓ Пишемо вниз');

    await page.click('#crossword-direction-toggle');
    expect(await direction(page)).toBe('across');
    await expect(label).toHaveText('→ Пишемо вправо');
  });

  /**
   * The chip used to offer a swap on every cell, including the ones that belong
   * to a single word, where pressing it changed the label and nothing else. And
   * at a real crossing it lost the lit word: the tap moved focus off the grid
   * and onto the chip, and the highlight followed the focus out.
   */
  test('the swap is offered only where two words cross', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);
    const chip = page.locator('#crossword-direction-toggle');

    await page.locator(sel(2, 1)).click();       // "CAT" only
    await expect(chip).toHaveClass(/cw-fixed-direction/);

    await page.locator(sel(2, 2)).click();       // CAT × WORD
    await expect(chip).not.toHaveClass(/cw-fixed-direction/);
  });

  test('pressing it where nothing crosses leaves the direction alone', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(0, 2)).click();       // "WORD" only
    expect(await direction(page)).toBe('down');
    await page.click('#crossword-direction-toggle');
    expect(await direction(page)).toBe('down');
    await expect(page.locator('#crossword-direction-label')).toHaveText('↓ Пишемо вниз');
  });

  test('switching keeps the caret in the grid and the word lit', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 2)).click();
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(3);  // CAT

    await page.click('#crossword-direction-toggle');
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(4);  // WORD
    expect(await activeCell(page)).toBe('2-2');
    expect(await page.locator('.crossword-cell input:focus').count()).toBe(1);
  });

  test('a letter key does not pull the focus out of the grid either', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 1)).click();
    await page.click('#crossword-keyboard .cw-key[data-letter="c"]');
    expect(await page.locator('.crossword-cell input:focus').count()).toBe(1);
    await expect(page.locator('.crossword-cell.highlight')).toHaveCount(3);
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

/**
 * The crossword has its own keyboard now. The system one took half the screen
 * along with the grid, and the word being solved was left somewhere above it —
 * so everything the hand needs while typing moved into one layer at the bottom.
 */
test.describe('The crossword keyboard', () => {
  const key = (letter: string) => `#crossword-keyboard .cw-key[data-letter="${letter}"]`;

  test('the grid never asks the device for its keyboard', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    const inputs = await page.locator('.crossword-cell input').evaluateAll((els) =>
      (els as HTMLInputElement[]).map((el) => ({
        readOnly: el.readOnly,
        inputMode: el.getAttribute('inputmode'),
      })));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.readOnly && i.inputMode === 'none')).toBe(true);
  });

  test('its keys fill the grid and move the caret on', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 1)).click(); // "CAT" runs across from here
    await page.click(key('c'));
    expect(await activeCell(page)).toBe('2-2');
    await page.click(key('a'));
    await page.click(key('t'));

    const word = await page.locator(sel(2, 1)).inputValue()
      + await page.locator(sel(2, 2)).inputValue()
      + await page.locator(sel(2, 3)).inputValue();
    expect(word).toBe('CAT');
  });

  test('backspace clears the cell, then steps back through the word', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 1)).click();
    await page.click(key('c'));
    await page.click(key('a'));
    expect(await activeCell(page)).toBe('2-3');

    // The caret is past the last letter typed, so backspace takes that letter
    await page.click('#crossword-keyboard .cw-key-wide');
    expect(await activeCell(page)).toBe('2-2');
    expect(await page.locator(sel(2, 2)).inputValue()).toBe('');

    // Standing on a filled cell, it clears that one and stays put
    await page.locator(sel(2, 1)).click();
    await page.click('#crossword-keyboard .cw-key-wide');
    expect(await activeCell(page)).toBe('2-1');
    expect(await page.locator(sel(2, 1)).inputValue()).toBe('');
  });

  test('a physical keyboard still types, one letter per key', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    await page.locator(sel(2, 1)).click();
    await page.keyboard.type('cat');

    const word = await page.locator(sel(2, 1)).inputValue()
      + await page.locator(sel(2, 2)).inputValue()
      + await page.locator(sel(2, 3)).inputValue();
    expect(word).toBe('CAT');
    expect(await activeCell(page)).toBe('2-3');
  });

  test('direction, clue and both actions live in the keyboard', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    for (const inside of ['#crossword-direction-toggle', '#crossword-current-clue',
      '.check-button', '.new-crossword-button']) {
      await expect(page.locator(`#crossword-keyboard ${inside}`)).toHaveCount(1);
    }
    await expect(page.locator('#crossword-section #crossword-direction-toggle')).toHaveCount(0);
  });

  test('"Перевірити" and "Новий" stand level with each other', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);

    const [check, fresh] = await page.evaluate(() => ['check-button', 'new-crossword-button']
      .map((cls) => {
        const r = document.querySelector(`#crossword-keyboard .${cls}`)!.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) };
      }));
    expect(check.top).toBe(fresh.top);
    expect(check.height).toBe(fresh.height);
    expect(Math.abs(check.width - fresh.width)).toBeLessThanOrEqual(1);
  });

  test('a long clue is shown whole, not cut off', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);
    await page.evaluate(() => {
      // @ts-ignore — a translation longer than the bar is wide
      placedWords[0].translation = 'догляд за дітьми у великому місті';
      // @ts-ignore
      renderCrossword();
    });

    await page.locator(sel(2, 1)).click();
    const clue = page.locator('#crossword-current-clue');
    await expect(clue).toContainText('у великому місті');
    // Wrapped onto more lines rather than clipped to one
    const fits = await clue.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
  });

  test('the keyboard leaves with the exercise', async ({ page }) => {
    await loadApp(page);
    await openCrossword(page);
    await expect(page.locator('#crossword-keyboard')).toBeVisible();

    await page.evaluate(() => (window as any).backToAccount());
    await expect(page.locator('#crossword-keyboard')).toBeHidden();
    expect(await page.evaluate(() =>
      document.body.classList.contains('cw-crossword-keyboard-open'))).toBe(false);
  });
});

/**
 * The grid was sizing its cells from window.innerWidth - 24, but the page
 * gutter and the section padding take 46 on a phone. It laid out for a width
 * it did not have, the table squeezed itself, and the squares came out smaller
 * than the ones it had calculated.
 */
test.describe('How big the squares come out', () => {
  const PHONE = { width: 390, height: 800 };
  test.use({ viewport: PHONE });

  async function grid(page: Page, words: any[]) {
    await loadApp(page);
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('crossword-section')!.classList.remove('hidden');
    });
    await page.evaluate((placed) => {
      // @ts-ignore
      crosswordSize = 15;
      // @ts-ignore
      crosswordGrid = Array.from({ length: 15 }, () => new Array(15).fill(null));
      // @ts-ignore
      placedWords = placed;
      // @ts-ignore
      placedWords.forEach((w: any) => {
        for (let i = 0; i < w.english.length; i++) {
          const r = w.direction === 'down' ? w.row + i : w.row;
          const c = w.direction === 'across' ? w.col + i : w.col;
          // @ts-ignore
          crosswordGrid[r][c] = w.english[i];
        }
      });
      // @ts-ignore
      renderCrossword();
    }, words);

    return page.evaluate(() => {
      const wrap = document.getElementById('crossword-grid-wrapper')!;
      return {
        cell: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cw-cell')),
        wrapper: Math.round(wrap.getBoundingClientRect().width),
        gridScrollsSideways: wrap.scrollWidth > wrap.clientWidth,
        pageScrollsSideways: document.body.scrollWidth > window.innerWidth,
      };
    });
  }

  test('the grid takes the whole width, gutters and all', async ({ page }) => {
    const m = await grid(page, [
      { english: 'ATTRACTION', translation: 'атракція', row: 6, col: 0, direction: 'across' },
      { english: 'AGENT', translation: 'агент', row: 2, col: 2, direction: 'down' },
      { english: 'TOUR', translation: 'тур', row: 6, col: 8, direction: 'down' },
    ]);
    expect(m.wrapper).toBe(PHONE.width);
    expect(m.gridScrollsSideways).toBe(false);
    expect(m.pageScrollsSideways).toBe(false);
    expect(m.cell).toBeGreaterThanOrEqual(30);
  });

  test('a short crossword gets big squares instead of a lot of empty room', async ({ page }) => {
    const m = await grid(page, [
      { english: 'CAT', translation: 'кіт', row: 2, col: 1, direction: 'across' },
      { english: 'CAR', translation: 'авто', row: 2, col: 1, direction: 'down' },
    ]);
    // The old ceiling was 36px, reached long before the width ran out
    expect(m.cell).toBeGreaterThan(36);
    expect(m.pageScrollsSideways).toBe(false);
  });
});
