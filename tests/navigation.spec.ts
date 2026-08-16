import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Navigation', () => {
  test('My Words button opens words section', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await expect(page.locator('#my-words-section')).toBeVisible();
  });

  test('back button returns to account screen', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await expect(page.locator('#my-words-section')).toBeVisible();
    await page.locator('#my-words-section .back-button').click();
    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#my-words-section')).toBeHidden();
  });

  test('Add Word button opens add word section', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-action-btn:has-text("Додати")');
    await expect(page.locator('#add-word-section')).toBeVisible();
  });

  test('Grammar tile opens grammar section', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    await expect(page.locator('#grammar-section')).toBeVisible();
  });

  // The leaderboard is gone: it compared people with each other instead of
  // with their own yesterday, and it was the only reason the rules had to open
  // every user document for reading.
});
