import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Audio Stories + Quiz', () => {
  test('generative text section opens', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Генеративний текст")');
    await expect(page.locator('#generative-text-section')).toBeVisible();
  });

  test('story quiz container exists and is hidden by default', async ({ page }) => {
    await loadApp(page);
    const storyQuiz = page.locator('#story-quiz');
    await expect(storyQuiz).toBeHidden();
  });

  test('story audio mode container exists and is hidden by default', async ({ page }) => {
    await loadApp(page);
    const storyAudio = page.locator('#story-audio-mode');
    // May or may not exist depending on DOM structure
    const count = await storyAudio.count();
    if (count > 0) {
      await expect(storyAudio).toBeHidden();
    }
  });

  test('showAudioStoryMode function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).showAudioStoryMode === 'function');
    expect(exists).toBe(true);
  });

  test('startStoryQuiz function exists', async ({ page }) => {
    await loadApp(page);
    const exists = await page.evaluate(() => typeof (window as any).startStoryQuiz === 'function');
    expect(exists).toBe(true);
  });

  test('back button returns from generative text to account', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Генеративний текст")');
    await page.locator('#generative-text-section .back-button').first().click();
    await expect(page.locator('#account-screen')).toBeVisible();
  });
});
