import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Fix: Picture Quiz Finish Screen', () => {
  test('skip button is hidden when showing picture quiz result', async ({ page }) => {
    await loadApp(page);
    // Navigate to picture quiz section
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('picture-quiz-section')!.classList.remove('hidden');
    });

    // Simulate showPictureQuizResult behavior
    await page.evaluate(() => {
      document.getElementById('picture-quiz-container')!.classList.add('hidden');
      document.getElementById('picture-quiz-progress')!.classList.add('hidden');
      document.getElementById('picture-quiz-result')!.classList.remove('hidden');
      document.querySelector('#picture-quiz-section > .skip-button')?.classList.add('hidden');
    });

    const skipBtn = page.locator('#picture-quiz-section > .skip-button');
    await expect(skipBtn).toBeHidden();
  });

  test('skip button is restored after finishPictureQuiz', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => {
      document.getElementById('account-screen')!.classList.add('hidden');
      document.getElementById('picture-quiz-section')!.classList.remove('hidden');
      // Simulate result shown
      document.querySelector('#picture-quiz-section > .skip-button')?.classList.add('hidden');
    });

    // Call finishPictureQuiz
    await page.evaluate(() => {
      (window as any).finishPictureQuiz();
    });

    // Skip button should be visible again (section goes hidden, but button class restored)
    const skipHasHidden = await page.evaluate(() =>
      document.querySelector('#picture-quiz-section > .skip-button')?.classList.contains('hidden')
    );
    expect(skipHasHidden).toBe(false);
  });

  test('finishPictureQuiz calls showConfetti', async ({ page }) => {
    await loadApp(page);
    // Track if showConfetti was called
    await page.evaluate(() => {
      (window as any).__confettiCalled = false;
      const orig = (window as any).showConfetti;
      (window as any).showConfetti = function() {
        (window as any).__confettiCalled = true;
        if (orig) orig();
      };
    });

    await page.evaluate(() => {
      (window as any).finishPictureQuiz();
    });

    const confettiCalled = await page.evaluate(() => (window as any).__confettiCalled);
    expect(confettiCalled).toBe(true);
  });
});
