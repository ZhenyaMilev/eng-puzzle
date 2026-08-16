import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Daily goal lives in a dialog', () => {
  test('the card offers one clear way in, without icons that mean the same thing', async ({ page }) => {
    await loadApp(page);

    await expect(page.locator('.daily-goal-edit')).toContainText('Редагувати');
    // The pencil and the question mark said the same thing three ways
    await expect(page.locator('.goal-help')).toHaveCount(0);
    await expect(page.locator('#daily-goal-picker')).toHaveCount(0);
  });

  test('it opens a dialog with the four goals and what they mean', async ({ page }) => {
    await loadApp(page);
    await page.click('.daily-goal-edit');

    const modal = page.locator('#daily-goal-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.goal-option')).toHaveCount(4);
    await expect(modal).toContainText('близько 5 хвилин');
    await expect(modal).toContainText('близько 25 хвилин');
    // The explanation that used to live in a separate popup
    await expect(modal).toContainText('XP — це бали');
    await expect(modal).toContainText('10 XP');
  });

  test('tapping the card itself opens it too', async ({ page }) => {
    await loadApp(page);
    await page.click('#acc-daily-goal');
    await expect(page.locator('#daily-goal-modal')).toBeVisible();
  });

  test('the goals carry the right targets', async ({ page }) => {
    await loadApp(page);
    await page.click('.daily-goal-edit');

    const targets = await page.evaluate(() =>
      [...document.querySelectorAll('.goal-option')].map((b) => Number((b as HTMLElement).dataset.target)));
    expect(targets).toEqual([100, 200, 300, 500]);
  });

  test('picking one marks it and saves it', async ({ page }) => {
    await loadApp(page);
    await page.click('.daily-goal-edit');
    await page.click('.goal-option[data-target="300"]');

    await expect(page.locator('.goal-option[data-target="300"]')).toHaveClass(/picked/);
    await expect(page.locator('.goal-option[data-target="200"]')).not.toHaveClass(/picked/);
    await expect(page.locator('#daily-goal-count')).toContainText('/300 XP');
  });

  test('the dialog stays open so another goal can be tried', async ({ page }) => {
    await loadApp(page);
    await page.click('.daily-goal-edit');
    await page.click('.goal-option[data-target="500"]');

    await expect(page.locator('#daily-goal-modal')).toBeVisible();
    await page.click('#daily-goal-modal .secondary');
    await expect(page.locator('#daily-goal-modal')).toBeHidden();
  });

  test('the saved goal is the one marked when it reopens', async ({ page }) => {
    await loadApp(page);
    // The mock user has 200
    await page.click('.daily-goal-edit');
    await expect(page.locator('.goal-option[data-target="200"]')).toHaveClass(/picked/);
  });
});

test.describe('Best Daily XP Record', () => {
  test('best daily XP display exists on account screen', async ({ page }) => {
    await loadApp(page);
    const bestDaily = page.locator('#best-daily-xp');
    await expect(bestDaily).toBeAttached();
  });

  test('best daily XP shows value from Firestore', async ({ page }) => {
    await loadApp(page);
    await page.waitForTimeout(500);
    const text = await page.locator('#best-daily-xp').textContent();
    // Should show 150 from our mock (bestDailyXP: 150)
    expect(text).toContain('150');
  });
});
