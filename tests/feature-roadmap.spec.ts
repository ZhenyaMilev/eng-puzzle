import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

/**
 * Знайомство з застосунком.
 *
 * Людина відкривала головний екран, бачила дюжину плиток і не розуміла, з чого
 * почати. Тепер знизу піднімається sheet на чотири кроки — і веде туди, де
 * беруться перші слова.
 */

const newcomer = { user: { onboardingSeen: false } };

/** Перший запуск: без прапорця у документі користувача. */
async function asNewcomer(page: Page) {
  await loadApp(page, { seed: newcomer });
  await expect(page.locator('#roadmapSheet')).toHaveClass(/show/, { timeout: 5000 });
}

test.describe('Знайомство першого запуску', () => {
  test('піднімається знизу тому, хто прийшов уперше', async ({ page }) => {
    await asNewcomer(page);
    await expect(page.locator('.roadmap-step.active h3')).toHaveText('Це ваш власний словник');
  });

  test('не з\'являється тому, хто вже його бачив', async ({ page }) => {
    await loadApp(page, { seed: { user: { onboardingSeen: true } } });
    await page.waitForTimeout(1200);
    await expect(page.locator('#roadmapSheet')).not.toHaveClass(/show/);
  });

  test('проходить усі чотири кроки, і на останньому «Далі» вже не потрібне', async ({ page }) => {
    await asNewcomer(page);
    const titles: string[] = [];
    for (let i = 0; i < 4; i++) {
      titles.push((await page.locator('.roadmap-step.active h3').textContent())!.trim());
      const dots = await page.locator('.roadmap-dots i.on').count();
      expect(dots).toBe(1);
      if (i < 3) await page.click('#roadmap-next');
    }
    expect(new Set(titles).size).toBe(4);
    await expect(page.locator('#roadmap-next')).toBeHidden();
  });

  test('розповідає, що слова генеруються пачкою, а не по одному', async ({ page }) => {
    await asNewcomer(page);
    await page.click('#roadmap-next');
    await expect(page.locator('.roadmap-step.active')).toContainText('30 слів');
  });

  test('пояснює, за що відповідає кожна вправа', async ({ page }) => {
    await asNewcomer(page);
    await page.click('#roadmap-next');
    await page.click('#roadmap-next');
    const list = page.locator('.roadmap-step.active .roadmap-list');
    for (const name of ['Тестування', 'Конструктор', 'На слух', 'На швидкість', 'Кросворд']) {
      await expect(list).toContainText(name);
    }
  });

  test('кнопка з останнього кроку веде туди, де беруться слова', async ({ page }) => {
    await asNewcomer(page);
    for (let i = 0; i < 3; i++) await page.click('#roadmap-next');
    await page.click('.roadmap-cta');
    await expect(page.locator('#daily-words-section')).toBeVisible();
    await expect(page.locator('#roadmapSheet')).not.toHaveClass(/show/);
  });

  test('«Пропустити» закриває його назавжди, а не до перезапуску', async ({ page }) => {
    await asNewcomer(page);
    await page.click('.roadmap-skip');
    await expect(page.locator('#roadmapSheet')).not.toHaveClass(/show/);
    const written = await page.evaluate(async () => {
      // @ts-ignore — db живе у скрипті застосунку
      const doc = await (db as any).collection('users').doc('test-user-123').get();
      return doc.data().onboardingSeen;
    });
    expect(written).toBe(true);
  });

  test('тягнеться вниз пальцем, як решта sheet-ів', async ({ page }) => {
    await asNewcomer(page);
    await page.evaluate(() => {
      const el = document.getElementById('roadmapSheet')!;
      const at = (y: number) => ({ touches: [{ clientY: y }] });
      el.dispatchEvent(Object.assign(new Event('touchstart'), at(0)));
      el.dispatchEvent(Object.assign(new Event('touchmove'), at(600)));
      el.dispatchEvent(new Event('touchend'));
    });
    await expect(page.locator('#roadmapSheet')).not.toHaveClass(/show/);
  });

  // Пейвол і будь-який інший екран замість головного: знайомство чекає, а не
  // лягає зверху на те, що людина зараз має прочитати.
  test('не піднімається, коли головного екрана не видно', async ({ page }) => {
    await loadApp(page, { seed: { user: { onboardingSeen: true } } });
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      (window as any).maybeShowRoadmap({ onboardingSeen: false });
    });
    await page.waitForTimeout(1200);
    await expect(page.locator('#roadmapSheet')).not.toHaveClass(/show/);
  });
});
