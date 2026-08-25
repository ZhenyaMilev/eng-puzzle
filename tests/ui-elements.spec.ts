import { test, expect } from '@playwright/test';
import { loadApp, loadAppNoAuth } from './helpers';

test.describe('Login Form', () => {
  test('has email and password inputs', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
  });

  test('has login button', async ({ page }) => {
    await loadAppNoAuth(page);
    await expect(page.locator('#login-form button:has-text("Увійти")')).toBeVisible();
  });

  test('register form has email and password inputs', async ({ page }) => {
    await loadAppNoAuth(page);
    await page.click('text=Зареєструватися');
    await expect(page.locator('#register-email')).toBeVisible();
    await expect(page.locator('#register-password')).toBeVisible();
  });
});

test.describe('Account Screen Elements', () => {
  test('all back buttons have consistent padding', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Словник")');
    const backBtn = page.locator('#my-words-section .back-button');
    await expect(backBtn).toBeVisible();
    const paddingTop = await backBtn.evaluate(el => getComputedStyle(el).paddingTop);
    expect(paddingTop).toBe('14px');
  });

  test('exercise tiles grid is visible', async ({ page }) => {
    await loadApp(page);
    const tiles = page.locator('.acc-tile');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(5);
  });
});

test.describe('Account Screen Header', () => {
  test('no greeting line — the screen starts at the email', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#account-screen')).not.toContainText('Привіт');
    await expect(page.locator('.acc-greeting')).toHaveCount(0);
    await expect(page.locator('#account-screen .acc-email')).toBeVisible();
  });
});

test.describe('Responsive Design', () => {
  test('app works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadAppNoAuth(page);
    await expect(page).toHaveTitle('Мій словник');
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('app works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loadAppNoAuth(page);
    await expect(page).toHaveTitle('Мій словник');
    await expect(page.locator('#login-form')).toBeVisible();
  });
});

test.describe('Crossword grid', () => {
  /*
    У темній темі клітинка була rgba(255,255,255,.1) — «світліша за підкладку».
    Перефарбування в денну тему зробило її плоским #F1ECE3, тобто рівно тим
    кольором, що й у підкладки сітки: різниці не лишилось, і користувач написав,
    що квадратиків кросворда не видно. Тест тримає саме те, що зламалось, —
    заливка клітинки має помітно відрізнятись від підкладки, а не збігатись.
  */
  test('cells stand out against the grid backdrop', async ({ page }) => {
    await loadApp(page);

    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('crossword-section')!.classList.remove('hidden');
      // @ts-ignore — module-level globals declared in the app's own script
      crosswordSize = 10;
      // @ts-ignore
      crosswordGrid = Array.from({ length: 10 }, () => new Array(10).fill(null));
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

    await expect(page.locator('.crossword-cell:not(.empty)').first()).toBeVisible();

    const paint = await page.evaluate(() => {
      // Підкладка пофарбована градієнтом, тому колір беремо з background-image,
      // а якщо градієнта немає — зі звичайного background-color.
      const read = (el: Element) => {
        const s = getComputedStyle(el);
        const gradient = s.backgroundImage.match(/rgba?\([^)]+\)/);
        const raw = gradient ? gradient[0] : s.backgroundColor;
        const nums = (raw.match(/[\d.]+/g) || []).map(Number);
        return { raw, rgb: nums.slice(0, 3), alpha: nums.length > 3 ? nums[3] : 1 };
      };
      const empty = document.querySelector('.crossword-cell.empty');
      return {
        cell: read(document.querySelector('.crossword-cell:not(.empty)')!),
        backdrop: read(document.getElementById('crossword-grid-wrapper')!),
        empty: empty ? read(empty) : null,
      };
    });

    // Клітинка не може бути прозорою — інакше крізь неї видно ту саму підкладку.
    expect(paint.cell.alpha).toBeGreaterThan(0.9);

    const distance = paint.cell.rgb.reduce(
      (sum: number, channel: number, i: number) => sum + Math.abs(channel - paint.backdrop.rgb[i]),
      0,
    );
    expect(
      distance,
      `заливка клітинки ${paint.cell.raw} зливається з підкладкою ${paint.backdrop.raw}`,
    ).toBeGreaterThanOrEqual(24);

    // Порожні клітинки навпаки — мають лишатись невидимими, це не дефект.
    if (paint.empty) expect(paint.empty.alpha).toBe(0);
  });
});
