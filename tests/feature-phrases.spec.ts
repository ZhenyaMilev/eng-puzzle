import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Phrases - Vocabulary Tabs', () => {
  test('My Words section has words/phrases tabs', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await expect(page.locator('#vocab-tab-words')).toBeVisible();
    await expect(page.locator('#vocab-tab-phrases')).toBeVisible();
  });

  test('words tab is active by default', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    const wordsActive = await page.evaluate(() =>
      document.getElementById('vocab-tab-words')!.classList.contains('active')
    );
    expect(wordsActive).toBe(true);
  });

  test('switching to phrases tab updates active state', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await page.click('#vocab-tab-phrases');
    const phrasesActive = await page.evaluate(() =>
      document.getElementById('vocab-tab-phrases')!.classList.contains('active')
    );
    expect(phrasesActive).toBe(true);
    const wordsActive = await page.evaluate(() =>
      document.getElementById('vocab-tab-words')!.classList.contains('active')
    );
    expect(wordsActive).toBe(false);
  });

  test('phrases tab shows phrases content area', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await page.click('#vocab-tab-phrases');
    await expect(page.locator('#vocab-phrases-content')).toBeVisible();
  });
});

test.describe('Phrases - Add Phrase', () => {
  test('add phrase section opens from phrases tab', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await page.click('#vocab-tab-phrases');
    await page.click('button:has-text("Додати фразу")');
    await expect(page.locator('#add-phrase-section')).toBeVisible();
  });

  test('add phrase section has English and translation inputs', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => {
      (window as any).showAddPhrase();
    });
    await expect(page.locator('#phrase-english')).toBeVisible();
    await expect(page.locator('#phrase-translation')).toBeVisible();
  });

  test('add phrase validates empty fields', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => {
      (window as any).showAddPhrase();
    });
    // Try to add with empty fields
    await page.click('#add-phrase-section button:has-text("Додати")');
    // Should show error messages
    const englishError = await page.locator('#phrase-english-error').textContent();
    const translationError = await page.locator('#phrase-translation-error').textContent();
    expect(englishError!.length + translationError!.length).toBeGreaterThan(0);
  });

  test('back button from add phrase returns to words section', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Мої слова")');
    await page.click('#vocab-tab-phrases');
    await page.click('button:has-text("Додати фразу")');
    await expect(page.locator('#add-phrase-section')).toBeVisible();
    await page.locator('#add-phrase-section .back-button').click();
    await expect(page.locator('#my-words-section')).toBeVisible();
  });
});

test.describe('Phrases - Phrase Constructor Training', () => {
  test('phrase constructor tile exists on account screen', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.acc-tile:has-text("Фрази")')).toBeVisible();
  });

  test('phrase constructor opens from account', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Фрази")');
    await expect(page.locator('#phrase-constructor-section')).toBeVisible();
  });

  test('phrase constructor has back button', async ({ page }) => {
    await loadApp(page);
    await page.click('.acc-tile:has-text("Фрази")');
    await expect(page.locator('#phrase-constructor-section .back-button')).toBeVisible();
  });
});
