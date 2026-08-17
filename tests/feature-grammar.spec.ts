import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('Grammar Section', () => {
  test('grammar tile exists on account screen', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('button:has-text("Граматика")')).toBeVisible();
  });

  test('grammar section opens from account', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    await expect(page.locator('#grammar-section')).toBeVisible();
    await expect(page.locator('#grammar-topics')).toBeVisible();
  });

  test('every grammar topic is offered as its own button', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    // The list grows as topics are written, so pin the shape rather than a
    // number that keeps moving: every button opens a distinct topic.
    const opens = await page.locator('#grammar-topic-list .grammar-topic')
      .evaluateAll((btns) => btns.map((b) => b.getAttribute('onclick')));
    expect(opens.length).toBeGreaterThanOrEqual(12);
    expect(new Set(opens).size).toBe(opens.length);
    expect(opens.every((o) => /loadGrammarLesson\('.+'\)/.test(o || ''))).toBe(true);
  });

  test('topic buttons include expected grammar names', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    const topicList = page.locator('#grammar-topic-list');
    await expect(topicList).toContainText('Present Simple');
    await expect(topicList).toContainText('Past Simple');
    await expect(topicList).toContainText('Present Perfect');
    await expect(topicList).toContainText('Passive Voice');
    await expect(topicList).toContainText('Modal Verbs');
    await expect(topicList).toContainText('Articles');
    await expect(topicList).toContainText('Reported Speech');
  });

  test('topics show level badges (A1, A2, B1, B2)', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    const topicList = page.locator('#grammar-topic-list');
    await expect(topicList).toContainText('A1');
    await expect(topicList).toContainText('A2');
    await expect(topicList).toContainText('B1');
    await expect(topicList).toContainText('B2');
  });

  test('topic list is visible, lesson and quiz are hidden initially', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    await expect(page.locator('#grammar-topics')).toBeVisible();
    await expect(page.locator('#grammar-lesson')).toBeHidden();
    await expect(page.locator('#grammar-quiz')).toBeHidden();
  });

  test('back button returns from grammar to account', async ({ page }) => {
    await loadApp(page);
    await page.click('button:has-text("Граматика")');
    await page.locator('#grammar-section .back-button').click();
    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#grammar-section')).toBeHidden();
  });
});
