import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

// Feeds checkSubscription() a user document shaped like Firestore's (Timestamps carry
// toDate()), built inside the page so the functions survive the evaluate boundary.
function applySubscription(
  page: Page,
  data: { lifetime?: boolean; expiresInDays?: number; registeredDaysAgo?: number; plan?: string }
) {
  return page.evaluate((d) => {
    const stamp = (date: Date) => ({ toDate: () => date });
    const day = 24 * 60 * 60 * 1000;
    const userData: any = { email: 'test@example.com' };
    if (d.lifetime) userData.lifetime = true;
    if (d.expiresInDays !== undefined) {
      userData.subscriptionExpiration = stamp(new Date(Date.now() + d.expiresInDays * day));
    }
    if (d.registeredDaysAgo !== undefined) {
      userData.registrationDate = stamp(new Date(Date.now() - d.registeredDaysAgo * day));
    }
    if (d.plan) userData.subscriptionPlan = d.plan;
    // @ts-ignore — module-level function declared in the app's own script
    checkSubscription(userData);
  }, data);
}

const badgeLabel = (page: Page) => page.locator('#subscription-badge-label');

test.describe('Subscription badge', () => {
  test('the separate subscription bar is gone from the account screen', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#subscription-info')).toHaveCount(0);
    await expect(page.locator('#account-screen')).not.toContainText('Підписка:');
  });

  test('the badge sits on the star button in the header', async ({ page }) => {
    await loadApp(page);
    const badge = page.locator('#subscription-badge');
    await expect(badge).toBeVisible();
    await expect(badge.locator('.fa-star')).toHaveCount(1);
    // Still the way to the tariffs screen
    await badge.click();
    await expect(page.locator('#tariffs-section')).toBeVisible();
  });

  test('lifetime access reads PRO ∞', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { lifetime: true, registeredDaysAgo: 400 });

    await expect(badgeLabel(page)).toHaveText('PRO ∞');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-lifetime/);
    await expect(page.locator('#account-screen')).toBeVisible();
  });

  test('a paid subscription reads PRO with the days left', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: 12, registeredDaysAgo: 60, plan: 'paid' });

    await expect(badgeLabel(page)).toHaveText('PRO 12д');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-active/);
  });

  test('the 3-day signup grant reads as a trial', async ({ page }) => {
    await loadApp(page);
    // Registered today, expires in 3 days — exactly what registration hands out
    await applySubscription(page, { expiresInDays: 3, registeredDaysAgo: 0 });

    await expect(badgeLabel(page)).toHaveText('Проба 3д');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-trial/);
  });

  test('a long subscription on an old account is not mistaken for a trial', async ({ page }) => {
    await loadApp(page);
    // No subscriptionPlan field (an account from before the flag existed)
    await applySubscription(page, { expiresInDays: 300, registeredDaysAgo: 200 });

    await expect(badgeLabel(page)).toHaveText('PRO 300д');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-active/);
  });

  test('an expired subscription flips the badge and opens the payment screen', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: -2, registeredDaysAgo: 60, plan: 'paid' });

    await expect(badgeLabel(page)).toHaveText('Оплата');
    await expect(page.locator('#subscription-badge')).toHaveClass(/sub-expired/);
    await expect(page.locator('#payment-section')).toBeVisible();
    await expect(page.locator('#account-screen')).toBeHidden();
  });

  // The reported bug: tap the star, tap back, and you were inside the app again
  test('an expired subscription cannot be walked around via the star button', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: -2, registeredDaysAgo: 60, plan: 'paid' });
    await expect(page.locator('#payment-section')).toBeVisible();

    await page.click('#subscription-badge');
    await expect(page.locator('#tariffs-section')).toBeVisible();

    await page.click('#tariffs-section .back-button');
    await expect(page.locator('#payment-section')).toBeVisible();
    await expect(page.locator('#account-screen')).toBeHidden();
    await expect(page.locator('#tariffs-section')).toBeHidden();
  });

  test('an active subscription still goes back to the account as before', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { expiresInDays: 12, registeredDaysAgo: 60, plan: 'paid' });

    await page.click('#subscription-badge');
    await expect(page.locator('#tariffs-section')).toBeVisible();

    await page.click('#tariffs-section .back-button');
    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#payment-section')).toBeHidden();
  });

  test('a missing expiration date is treated as no access, not as infinite', async ({ page }) => {
    await loadApp(page);
    await applySubscription(page, { registeredDaysAgo: 10 });

    await expect(badgeLabel(page)).toHaveText('Оплата');
    await expect(page.locator('#payment-section')).toBeVisible();
  });
});
