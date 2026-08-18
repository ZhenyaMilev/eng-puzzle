import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';

/**
 * Speaking Club had one shape: Sam, a friend who remembers you. A scenario puts
 * both of you in a scene instead — you are the patient, he is the receptionist —
 * and the role has to win over the memory. Being reminded you are an engineer
 * while playing a patient is exactly what breaks a scene, so in this mode the
 * profile is neither read nor written.
 */
const SCENARIO = {
  setting: 'Реєстратура клініки, ранок понеділка',
  youAre: 'Ти пацієнт, який прийшов без запису і погано почувається',
  partnerName: 'Емма',
  partnerIs: 'Адміністраторка, у якої на сьогодні немає вільних вікон',
  goal: 'Домогтися прийому сьогодні',
  twist: 'Виявляється, твоя страховка не покриває цей візит',
};

/** Records every prompt the app sends, and answers both kinds of call. */
function mockConversation(page: Page, scenario: any = SCENARIO) {
  const prompts: string[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    const body = route.request().postDataJSON() || {};
    const messages = (body.body && body.body.messages) || [];
    const text = messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    prompts.push(text);
    const content = /Invent a short role-play/.test(text)
      ? JSON.stringify(scenario)
      : 'Good morning. Do you have an appointment?';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });
  return prompts;
}

async function openScenarioMode(page: Page) {
  await page.click('.acc-tile:has-text("Speaking Club")');
  await page.click('.sc-chip:has-text("Ситуація")');
  await page.click('.sc-chip:has-text("Подорожі")');
}

test.use({ viewport: { width: 390, height: 860 } });

test.describe('A conversation with a part to play', () => {
  test('the roles are read before the scene starts, not discovered mid-way', async ({ page }) => {
    mockConversation(page);
    await loadApp(page);
    await openScenarioMode(page);
    await page.click('#sc-start-btn');

    const brief = page.locator('#sc-brief');
    await expect(brief).toBeVisible({ timeout: 10000 });
    await expect(brief).toContainText('Реєстратура клініки');      // where
    await expect(brief).toContainText('Ти пацієнт');               // who you are
    await expect(brief).toContainText('Емма');                     // who they are
    await expect(brief).toContainText('Домогтися прийому');        // what you want

    // Nothing has been said yet — the scene waits behind the briefing
    await expect(page.locator('#sc-chat-screen')).toBeHidden();
  });

  test('the character, and the complication, reach the conversation', async ({ page }) => {
    const prompts = mockConversation(page);
    await loadApp(page);
    await openScenarioMode(page);
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-brief')).toBeVisible({ timeout: 10000 });
    await page.click('#sc-brief button:has-text("Почати")');

    await expect(page.locator('#sc-messages')).toContainText('appointment', { timeout: 10000 });
    const scene = prompts.find((p) => /YOU ARE NOT SAM/.test(p)) || '';
    expect(scene).toContain('Емма');
    expect(scene).toContain('страховка');           // the twist to spring later
    expect(scene).toMatch(/Drive the scene/);       // it leads rather than waits
  });

  test('the remembered profile stays out of the scene', async ({ page }) => {
    const prompts = mockConversation(page);
    await loadApp(page, { seed: { user: { scMemory: { profile: 'Works as an engineer. Has a dog.', conversations: 3 } } } });
    await openScenarioMode(page);
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-brief')).toBeVisible({ timeout: 10000 });
    await page.click('#sc-brief button:has-text("Почати")');
    await expect(page.locator('#sc-messages')).toContainText('appointment', { timeout: 10000 });

    const scene = prompts.find((p) => /YOU ARE NOT SAM/.test(p)) || '';
    expect(scene).not.toContain('WHAT YOU ALREADY KNOW');
    expect(scene).not.toContain('engineer');
  });

  test('and the screen does not promise a memory it will not use', async ({ page }) => {
    mockConversation(page);
    await loadApp(page, { seed: { user: { scMemory: { profile: 'Works as an engineer.', conversations: 3 } } } });
    await page.click('.acc-tile:has-text("Speaking Club")');
    await expect(page.locator('#sc-memory-badge')).toBeVisible();

    await page.click('.sc-chip:has-text("Ситуація")');
    await expect(page.locator('#sc-memory-badge')).toBeHidden();
  });

  test('a scene that does not appeal can be swapped for another', async ({ page }) => {
    const prompts = mockConversation(page);
    await loadApp(page);
    await openScenarioMode(page);
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-brief')).toBeVisible({ timeout: 10000 });

    await page.click('#sc-brief button:has-text("Інша ситуація")');
    await expect(page.locator('#sc-brief')).toBeHidden();
    await expect(page.locator('#sc-config-screen')).toBeVisible();

    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-brief')).toBeVisible({ timeout: 10000 });
    expect(prompts.filter((p) => /Invent a short role-play/.test(p))).toHaveLength(2);
  });

  test('the free conversation is left exactly as it was', async ({ page }) => {
    const prompts = mockConversation(page);
    await loadApp(page);
    await page.click('.acc-tile:has-text("Speaking Club")');
    await expect(page.locator('#sc-start-btn')).toHaveText('Почати розмову');

    await page.click('.sc-chip:has-text("Подорожі")');
    await page.click('#sc-start-btn');
    await expect(page.locator('#sc-messages')).toContainText('appointment', { timeout: 10000 });

    expect(prompts.join('\n')).not.toContain('YOU ARE NOT SAM');
    expect(prompts.join('\n')).not.toContain('Invent a short role-play');
  });
});
