import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');

/**
 * WayForPay moderates the site before switching payments on, and refuses one
 * without an offer, refund terms, a privacy policy and real contact details.
 * The law wants the same thing for a different reason: the buyer must be able
 * to read the terms BEFORE paying, not after.
 */

async function openTariffs(page: Page) {
  await page.evaluate(() => (window as any).showTariffs());
  await expect(page.locator('#tariffs-section')).toBeVisible();
}

test.describe('The documents exist and can be read', () => {
  const docs = [
    { tab: 'offer', title: 'Публічна оферта', says: 'приймаєте умови цієї оферти' },
    { tab: 'refund', title: 'Умови повернення коштів', says: 'протягом 14 днів' },
    { tab: 'privacy', title: 'Політика конфіденційності', says: 'Які дані ми збираємо' },
    { tab: 'contacts', title: 'Контакти', says: 'milevich.evgen@gmail.com' },
  ];

  for (const doc of docs) {
    test(`${doc.title} opens and has content`, async ({ page }) => {
      await loadApp(page);
      await page.evaluate((tab) => (window as any).showLegal(tab), doc.tab);

      await expect(page.locator('#legal-section')).toBeVisible();
      await expect(page.locator('#legal-title')).toHaveText(doc.title);
      await expect(page.locator('#legal-body')).toContainText(doc.says);
      await expect(page.locator(`.legal-tab[data-doc="${doc.tab}"]`)).toHaveClass(/active/);
    });
  }

  test('every document carries the edition date', async ({ page }) => {
    await loadApp(page);
    for (const doc of docs) {
      await page.evaluate((tab) => (window as any).showLegal(tab), doc.tab);
      await expect(page.locator('.legal-updated')).toContainText('Редакція від');
    }
  });

  test('switching tabs replaces the text rather than appending it', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('offer'));
    await page.click('.legal-tab[data-doc="refund"]');

    await expect(page.locator('#legal-body')).toContainText('протягом 14 днів');
    await expect(page.locator('#legal-body')).not.toContainText('приймаєте умови цієї оферти');
    await expect(page.locator('.legal-updated')).toHaveCount(1);
  });
});

test.describe('Reachable before paying, and from anywhere', () => {
  test('the tariff screen links to the terms above the buy buttons’ fold', async ({ page }) => {
    await loadApp(page);
    await openTariffs(page);

    const terms = page.locator('.tariff-terms');
    await expect(terms).toBeVisible();
    await expect(terms).toContainText('публічною офертою');
    await expect(terms).toContainText('Умови повернення коштів');
    // The one thing a buyer must not be surprised by
    await expect(terms).toContainText('не продовжується автоматично');
  });

  test('opening the offer from the tariffs returns to the tariffs, not the dashboard', async ({ page }) => {
    await loadApp(page);
    await openTariffs(page);

    await page.locator('.tariff-terms .legal-link', { hasText: 'публічною офертою' }).click();
    await expect(page.locator('#legal-section')).toBeVisible();
    await expect(page.locator('#tariffs-section')).toBeHidden();

    await page.click('#legal-section .back-button');
    await expect(page.locator('#tariffs-section')).toBeVisible();
    await expect(page.locator('#legal-section')).toBeHidden();
  });

  test('opening it from the dashboard returns to the dashboard', async ({ page }) => {
    await loadApp(page);
    await page.locator('.acc-footer .legal-link', { hasText: 'Оферта' }).click();
    await expect(page.locator('#legal-section')).toBeVisible();

    await page.click('#legal-section .back-button');
    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#legal-section')).toBeHidden();
  });

  test('all four are reachable from the dashboard footer', async ({ page }) => {
    await loadApp(page);
    const footer = page.locator('.acc-footer');
    for (const label of ['Оферта', 'Повернення', 'Конфіденційність', 'Контакти']) {
      await expect(footer.locator('.legal-link', { hasText: label })).toBeVisible();
    }
  });

  test('the documents replace whatever was on screen, never stack on it', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).startQuiz());
    await expect(page.locator('#quiz-section')).toBeVisible();

    await page.evaluate(() => (window as any).showLegal('offer'));
    await expect(page.locator('#legal-section')).toBeVisible();
    await expect(page.locator('#quiz-section')).toBeHidden();
    await expect(page.locator('#account-screen')).toBeHidden();
  });
});

test.describe('What the documents must actually say', () => {
  test('the prices match the ones on the tariff screen and the server', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const offer = html.slice(html.indexOf("offer: {"), html.indexOf("refund: {"));
    expect(offer).toContain('99 грн');
    expect(offer).toContain('249 грн');
    expect(offer).toContain('899 грн');
    expect(offer).toContain('30 днів');
    expect(offer).toContain('365 днів');
  });

  test('the offer is honest about there being no recurring charge', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('offer'));
    await expect(page.locator('#legal-body')).toContainText('не продовжується');
  });

  test('the privacy policy names every third party the data reaches', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('privacy'));

    const body = page.locator('#legal-body');
    for (const party of ['Firebase', 'OpenAI', 'WayForPay', 'Netlify']) {
      await expect(body).toContainText(party);
    }
    // Card details never touch us, and saying so is the point
    await expect(body).toContainText('не збираємо');
  });

  test('refund terms give a channel, a deadline and a route back', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('refund'));

    const body = page.locator('#legal-body');
    await expect(body).toContainText('milevich.evgen@gmail.com');
    await expect(body).toContainText('3 робочих днів');
    await expect(body).toContainText('на картку, з якої платили');
  });

  test('the details still missing are flagged in red, not left blank', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('contacts'));

    // ІПН and the registered address can only come from the owner; until they
    // are filled the page must say so rather than quietly ship an empty line
    const todo = page.locator('#legal-body .legal-todo');
    await expect(todo).toHaveCount(2);
    await expect(todo.first()).toContainText('ЗАПОВНИТИ');
  });
});
