import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';


function mockChat(page: Page, reply: string) {
  const calls: any[] = [];
  page.route('**/.netlify/functions/ai', async (route) => {
    calls.push(route.request().postDataJSON().body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: reply } }] }),
    });
  });
  return calls;
}

// Puts a remembered profile in place without going through a whole conversation.
function seedMemory(page: Page, profile: string, conversations: number) {
  return page.evaluate(({ profile, conversations }) => {
    // @ts-ignore
    scMemory = { profile, conversations };
    // @ts-ignore
    scRenderMemoryBadge();
  }, { profile, conversations });
}

async function openSpeakingClub(page: Page) {
  await page.click('.acc-tile:has-text("Writing Club")');
  await expect(page.locator('#speaking-club-section')).toBeVisible();
}

test.describe('Speaking Club memory', () => {
  test('a first-timer sees no memory badge', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);
    await expect(page.locator('#sc-memory-badge')).toBeHidden();
  });

  test('the badge shows how many conversations Sam remembers', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);
    await seedMemory(page, 'Name: Evgen. Works in marketing.', 4);

    await expect(page.locator('#sc-memory-badge')).toBeVisible();
    await expect(page.locator('#sc-memory-count')).toHaveText('4');
  });

  test('what Sam remembers reaches his system prompt', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);
    await seedMemory(page, 'Name: Evgen. Has a cat called Mia. Keeps dropping articles.', 3);

    const calls = mockChat(page, 'Hey, good to see you again!');
    await page.evaluate(() => {
      // @ts-ignore — pick a topic and start, skipping the config clicks
      scConfig.topic = 'Travel';
      // @ts-ignore
      scStartChat();
    });
    await expect.poll(() => calls.length).toBeGreaterThan(0);

    const system = calls[0].messages[0].content;
    expect(system).toContain('WHAT YOU ALREADY KNOW ABOUT THIS PERSON');
    expect(system).toContain('cat called Mia');
    expect(system).toContain('do NOT introduce yourself again');
    expect(system).toContain('Prefer topics you have NOT covered yet');
  });

  test('with no memory the prompt stays a clean first meeting', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);

    const calls = mockChat(page, 'Hi! I am Sam.');
    await page.evaluate(() => {
      // @ts-ignore
      scConfig.topic = 'Travel';
      // @ts-ignore
      scStartChat();
    });
    await expect.poll(() => calls.length).toBeGreaterThan(0);

    expect(calls[0].messages[0].content).not.toContain('WHAT YOU ALREADY KNOW');
  });

  test('a conversation updates the profile and counts up', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);
    await seedMemory(page, 'Name: Evgen.', 1);

    const calls = mockChat(page, 'Name: Evgen. Has a cat called Mia. Likes cycling.');
    await page.evaluate(async () => {
      // @ts-ignore — a conversation that just happened
      scChatHistory = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'Do you have pets?' },
        { role: 'user', content: 'Yes, a cat named Mia. I also like cycling.' },
      ];
      // @ts-ignore
      await scUpdateMemory({ summary: 'Good chat.' });
    });

    const memory = await page.evaluate(() => {
      // @ts-ignore
      return scMemory;
    });
    expect(memory.conversations).toBe(2);
    expect(memory.profile).toContain('cycling');

    // The updater is given the old profile and the new transcript, and is told to merge
    const prompt = calls[0].messages[0].content;
    expect(prompt).toContain('CURRENT PROFILE');
    expect(prompt).toContain('Name: Evgen.');
    expect(prompt).toContain('a cat named Mia');
    expect(prompt).toContain('merges the old one with anything new');
  });

  test('the profile is capped so it cannot grow without end', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);

    mockChat(page, 'x'.repeat(5000));
    await page.evaluate(async () => {
      // @ts-ignore
      scChatHistory = [{ role: 'user', content: 'hello' }];
      // @ts-ignore
      await scUpdateMemory({ summary: '' });
    });

    const memory = await page.evaluate(() => {
      // @ts-ignore
      return scMemory;
    });
    // @ts-ignore
    const limit = await page.evaluate(() => SC_MEMORY_LIMIT);
    expect(memory.profile.length).toBeLessThanOrEqual(limit);
  });

  // The timer could end the chat while the last reply was still in flight; the
  // message handler then ended it a second time, so the session was analysed,
  // scored and filed twice.
  test('a conversation is wrapped up exactly once', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);

    const calls = mockChat(page, JSON.stringify({ errors: [], words: [], phrases: [], grammar: [], summary: 'ok' }));
    await page.evaluate(async () => {
      // @ts-ignore
      scChatHistory = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'I like cycling.' },
      ];
      // @ts-ignore
      scMessageCount = 2;
      // @ts-ignore
      scEnded = false;
      // The timer fires, and the in-flight message handler fires right after
      // @ts-ignore
      await scEndChat();
      // @ts-ignore
      await scEndChat();
    });

    await expect(page.locator('#sc-analysis-screen')).toBeVisible();

    const history = await page.evaluate(async () => {
      // @ts-ignore — the app's own Firestore handle
      const doc = await db.collection('users').doc('test-user-123').get();
      return (doc.data().scHistory || []).length;
    });
    expect(history).toBe(1);

    // One analysis, one memory update — not two of each
    const analysisCalls = calls.filter((c: any) =>
      typeof c.messages[0].content === 'string' && c.messages[0].content.includes('Analyze this English learner'));
    expect(analysisCalls).toHaveLength(1);
  });

  test('starting a new conversation re-arms the wrap-up', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);
    mockChat(page, 'Hi there!');

    await page.evaluate(() => {
      // @ts-ignore
      scEnded = true;
      // @ts-ignore
      scConfig.topic = 'Travel';
      // @ts-ignore
      scStartChat();
    });

    // @ts-ignore
    expect(await page.evaluate(() => scEnded)).toBe(false);
  });

  test('forgetting clears the profile and hides the badge', async ({ page }) => {
    await loadApp(page);
    await openSpeakingClub(page);
    await seedMemory(page, 'Name: Evgen.', 3);
    await expect(page.locator('#sc-memory-badge')).toBeVisible();

    await page.click('#sc-memory-badge button[title="Забути"]');
    await expect(page.locator('#app-confirm-modal')).toBeVisible();
    await page.click('#app-confirm-ok');

    await expect(page.locator('#sc-memory-badge')).toBeHidden();
    const memory = await page.evaluate(() => {
      // @ts-ignore
      return scMemory;
    });
    expect(memory.conversations).toBe(0);
    expect(memory.profile).toBe('');
  });
});
