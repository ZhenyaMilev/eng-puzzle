import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'eng-puzzle');
const INDEX = join(ROOT, 'index.html');
const FN = (name: string) => join(ROOT, 'netlify', 'functions', `${name}.js`);

/**
 * The bot can message anybody it has a chat id for, so the two things worth
 * proving are that the link between accounts cannot be forged, and that the
 * reminders cannot turn into nagging.
 */

const SECRET = 'test-webhook-secret';

type Sent = { chatId: any; text: string; buttons: any };

/** Loads a function with _shared and the Bot API replaced. */
function load(name: string, opts: {
  users?: Record<string, any>;
  links?: Record<string, any>;
  codes?: Record<string, any>;
  words?: Record<string, any[]>;
  verify?: () => Promise<any>;
  sendFails?: (chatId: any) => { code: number } | null;
} = {}) {
  const users = opts.users || {};
  const links = opts.links || {};
  const codes = opts.codes || {};
  const words = opts.words || {};
  const sent: Sent[] = [];
  const writes: any[] = [];

  const stores: Record<string, any> = { users, tgLinks: links, tgLinkCodes: codes };

  function docApi(collection: string, id: string) {
    const store = stores[collection] || (stores[collection] = {});
    const ref: any = {
      id,
      get: async () => ({ exists: id in store, data: () => store[id], ref }),
      set: async (data: any, options?: any) => {
        writes.push({ collection, id, data, merge: !!(options && options.merge) });
        store[id] = options && options.merge ? deepMerge(store[id] || {}, data) : data;
      },
      update: async (data: any) => {
        writes.push({ collection, id, data, update: true });
        store[id] = { ...(store[id] || {}), ...data };
      },
      delete: async () => { writes.push({ collection, id, deleted: true }); delete store[id]; },
      collection: (sub: string) => ({
        limit: () => ({ get: async () => ({ empty: !(words[id] || []).length }) }),
      }),
    };
    return ref;
  }

  function deepMerge(a: any, b: any): any {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && !(b[k] instanceof Date)
        ? deepMerge(a[k] || {}, b[k]) : b[k];
    }
    return out;
  }

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => docApi(name, id),
      where: () => ({
        get: async () => ({
          docs: Object.keys(users).map((id) => ({
            id, data: () => users[id], ref: docApi('users', id),
          })),
        }),
      }),
    }),
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      const b: any = {
        set: (ref: any, data: any, o: any) => { ops.push(() => ref.set(data, o)); return b; },
        delete: (ref: any) => { ops.push(() => ref.delete()); return b; },
        commit: async () => { for (const op of ops) await op(); },
      };
      return b;
    },
    // Redeeming a code reads and burns it together now, so the mock has to
    // offer a transaction — buffered like the real one, applied at the end
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const ops: Array<() => Promise<void>> = [];
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: any, o?: any) => { ops.push(() => ref.set(data, o)); },
        update: (ref: any, data: any) => { ops.push(() => ref.update(data)); },
        delete: (ref: any) => { ops.push(() => ref.delete()); },
      };
      const result = await fn(tx);
      for (const op of ops) await op();
      return result;
    },
  };

  const fakeShared = {
    firestore: () => db,
    auth: () => ({ verifyIdToken: opts.verify || (async () => ({ uid: 'u1' })) }),
    requiredEnv: (n: string) => (n === 'TG_WEBHOOK_SECRET' ? SECRET : `env-${n}`),
    json: (statusCode: number, body: any) => ({
      statusCode, headers: {}, body: JSON.stringify(body),
    }),
  };

  const sharedPath = FN('_shared');
  delete require.cache[require.resolve(sharedPath)];
  require.cache[require.resolve(sharedPath)] = {
    id: sharedPath, filename: sharedPath, loaded: true, exports: fakeShared,
  } as any;

  for (const m of ['_telegram', 'tg-webhook', 'tg-notify', 'tg-link']) {
    delete require.cache[require.resolve(FN(m))];
  }

  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (String(url).includes('/sendMessage')) {
      const fail = opts.sendFails && opts.sendFails(body.chat_id);
      if (fail) {
        return {
          json: async () => ({ ok: false, error_code: fail.code, description: 'blocked' }),
          status: fail.code,
        };
      }
      sent.push({
        chatId: body.chat_id,
        text: body.text,
        buttons: body.reply_markup && body.reply_markup.inline_keyboard,
      });
    }
    return { json: async () => ({ ok: true, result: {} }), status: 200 };
  };

  const mod = require(FN(name));
  return {
    mod, sent, writes, users, links, codes,
    restore: () => {
      (global as any).fetch = originalFetch;
      delete require.cache[require.resolve(sharedPath)];
    },
  };
}

const hook = (body: any, secret: string | null = SECRET) => ({
  httpMethod: 'POST',
  headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
  body: JSON.stringify(body),
});

const message = (text: string, fromId = 555) => ({
  message: { text, from: { id: fromId, first_name: 'Женя' }, chat: { id: fromId } },
});

test.describe('Nobody may forge an update', () => {
  test('a call without the secret header is refused', async () => {
    const h = load('tg-webhook', { codes: { good: { uid: 'u1' } } });
    const res = await h.mod.handler(hook(message('/start good'), null));

    expect(res.statusCode).toBe(403);
    expect(h.links).toEqual({});
    expect(h.sent).toEqual([]);
    h.restore();
  });

  test('a call with the wrong secret is refused', async () => {
    const h = load('tg-webhook', { codes: { good: { uid: 'u1' } } });
    const res = await h.mod.handler(hook(message('/start good'), 'not-the-secret'));

    expect(res.statusCode).toBe(403);
    expect(h.links).toEqual({});
    h.restore();
  });

  test('a secret of a different length does not crash the compare', async () => {
    const h = load('tg-webhook');
    const res = await h.mod.handler(hook(message('/start'), 'short'));
    expect(res.statusCode).toBe(403);
    h.restore();
  });
});

test.describe('Linking an account', () => {
  test('a valid code links both directions and burns itself', async () => {
    const h = load('tg-webhook', {
      users: { u1: { email: 'a@b.c' } },
      codes: { code123: { uid: 'u1', expiresAt: new Date(Date.now() + 60000).toISOString() } },
    });

    const res = await h.mod.handler(hook(message('/start code123', 777)));

    expect(res.statusCode).toBe(200);
    expect(h.links['777']).toEqual(expect.objectContaining({ uid: 'u1' }));
    expect(h.users.u1.telegramId).toBe(777);
    expect(h.codes.code123).toBeUndefined();
    expect(h.sent[0].text).toContain('акаунт підключено');
    h.restore();
  });

  test('an expired code links nothing and says why', async () => {
    const h = load('tg-webhook', {
      codes: { old: { uid: 'u1', expiresAt: new Date(Date.now() - 60000).toISOString() } },
    });

    await h.mod.handler(hook(message('/start old', 777)));

    expect(h.links['777']).toBeUndefined();
    expect(h.codes.old).toBeUndefined(); // spent, so it cannot be retried
    expect(h.sent[0].text).toContain('застаріло');
    h.restore();
  });

  test('an invented code links nothing', async () => {
    const h = load('tg-webhook', { users: { u1: {} } });
    await h.mod.handler(hook(message('/start i-made-this-up', 777)));

    expect(h.links['777']).toBeUndefined();
    expect(h.users.u1.telegramId).toBeUndefined();
    h.restore();
  });

  test('a second /start with the same code cannot re-link to another chat', async () => {
    const h = load('tg-webhook', {
      users: { u1: {} },
      codes: { once: { uid: 'u1', expiresAt: new Date(Date.now() + 60000).toISOString() } },
    });

    await h.mod.handler(hook(message('/start once', 111)));
    await h.mod.handler(hook(message('/start once', 222)));

    expect(h.links['111'].uid).toBe('u1');
    expect(h.links['222']).toBeUndefined();
    h.restore();
  });

  test('/start with no code from a stranger explains how to link', async () => {
    const h = load('tg-webhook');
    await h.mod.handler(hook(message('/start', 999)));

    expect(h.sent[0].text).toContain('Підключити Telegram');
    h.restore();
  });
});

test.describe('Commands', () => {
  test('/stop turns reminders off for the linked account', async () => {
    const h = load('tg-webhook', {
      users: { u1: { notificationsOff: false } },
      links: { '777': { uid: 'u1' } },
    });

    await h.mod.handler(hook(message('/stop', 777)));

    expect(h.users.u1.notificationsOff).toBe(true);
    expect(h.sent[0].text).toContain('вимкнені');
    h.restore();
  });

  test('/start turns them back on', async () => {
    const h = load('tg-webhook', {
      users: { u1: { notificationsOff: true } },
      links: { '777': { uid: 'u1' } },
    });

    await h.mod.handler(hook(message('/start', 777)));
    expect(h.users.u1.notificationsOff).toBe(false);
    h.restore();
  });

  test('/stop from an unlinked chat changes nothing', async () => {
    const h = load('tg-webhook', { users: { u1: {} } });
    await h.mod.handler(hook(message('/stop', 404)));

    expect(h.users.u1.notificationsOff).toBeUndefined();
    expect(h.sent[0].text).toContain('не підключений');
    h.restore();
  });

  test('/status reports the real days and streak', async () => {
    const until = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
    const h = load('tg-webhook', {
      users: { u1: { email: 'a@b.c', streak: 9, subscriptionExpiration: { toDate: () => until } } },
      links: { '777': { uid: 'u1' } },
    });

    await h.mod.handler(hook(message('/status', 777)));

    expect(h.sent[0].text).toContain('12 дн.');
    expect(h.sent[0].text).toContain('<b>9</b>');
    h.restore();
  });

  test('/status says PRO forever for a lifetime account', async () => {
    const h = load('tg-webhook', {
      users: { u1: { lifetime: true } },
      links: { '777': { uid: 'u1' } },
    });
    await h.mod.handler(hook(message('/status', 777)));
    expect(h.sent[0].text).toContain('PRO назавжди');
    h.restore();
  });

  test('an unknown command answers with the list rather than silence', async () => {
    const h = load('tg-webhook');
    await h.mod.handler(hook(message('привіт', 777)));
    expect(h.sent[0].text).toContain('/status');
    h.restore();
  });

  test('Telegram is always answered 200, so it does not retry for hours', async () => {
    const h = load('tg-webhook', { users: {} });
    // A message shape the handler cannot act on
    const res = await h.mod.handler(hook({ my_chat_member: {} }));
    expect(res.statusCode).toBe(200);
    h.restore();
  });
});

test.describe('Reminders do not become nagging', () => {
  const KYIV_NOON = () => {
    // A fixed instant that is midday in Kyiv, safely outside quiet hours
    const d = new Date();
    d.setUTCHours(10, 0, 0, 0);
    return d;
  };

  function userWith(extra: any) {
    return {
      telegramId: 777,
      registrationDate: { toDate: () => new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
      ...extra,
    };
  }

  test('quiet hours stop everything', () => {
    const h = load('tg-notify');
    const night = new Date();
    night.setUTCHours(0, 0, 0, 0); // 02:00/03:00 in Kyiv
    const user = userWith({ streak: 5, lastActiveDate: '2000-01-01' });

    expect(h.mod.pick(user, night)).toBeNull();
    h.restore();
  });

  test('a person who switched reminders off hears nothing', () => {
    const h = load('tg-notify');
    const user = userWith({ notificationsOff: true, wordCount: 0 });
    expect(h.mod.pick(user, KYIV_NOON())).toBeNull();
    h.restore();
  });

  test('a person with no Telegram is never picked', () => {
    const h = load('tg-notify');
    const user = { ...userWith({ wordCount: 0 }), telegramId: undefined };
    expect(h.mod.pick(user, KYIV_NOON())).toBeNull();
    h.restore();
  });

  test('one message a day, whatever else applies', () => {
    const h = load('tg-notify');
    const now = KYIV_NOON();
    const user = userWith({
      wordCount: 0,
      registrationDate: { toDate: () => new Date(now.getTime() - 3 * 60 * 60 * 1000) },
      notifications: { reactivation: { sentAt: now.toISOString() } },
    });

    expect(h.mod.pick(user, now)).toBeNull();
    h.restore();
  });

  test('the same reminder is never sent twice', () => {
    const h = load('tg-notify');
    const now = KYIV_NOON();
    const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    const user = userWith({
      wordCount: 0,
      registrationDate: { toDate: () => new Date(now.getTime() - 3 * 60 * 60 * 1000) },
      notifications: { onboarding: { sentAt: yesterday.toISOString() } },
    });

    expect(h.mod.pick(user, now)).toBeNull();
    h.restore();
  });

  test('the streak reminder is the one that may repeat', () => {
    const h = load('tg-notify');
    const now = new Date();
    // 20:00 Kyiv is 17:00 or 18:00 UTC depending on the season
    const kyivHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false,
    }).format(now));
    now.setUTCHours(now.getUTCHours() + (20 - kyivHour), 0, 0, 0);

    const long = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const user = userWith({
      streak: 12,
      lastActiveDate: '2000-01-01',
      wordCount: 50,
      notifications: { streakAtRisk: { sentAt: long } },
    });

    const picked = h.mod.pick(user, now);
    expect(picked && picked.type).toBe('streakAtRisk');
    h.restore();
  });

  test('a streak reminder never arrives on a day already practised', () => {
    const h = load('tg-notify');
    const now = KYIV_NOON();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(now);
    const user = userWith({ streak: 12, lastActiveDate: today, wordCount: 50 });

    const picked = h.mod.pick(user, now);
    expect(picked && picked.type).not.toBe('streakAtRisk');
    h.restore();
  });
});

test.describe('The right reminder for the right moment', () => {
  // Every date is measured from the same instant: mixing `now` with Date.now()
  // makes "one day away" land anywhere between 1 and 2 days depending on the hour
  const NOW = (() => { const d = new Date(); d.setUTCHours(10, 0, 0, 0); return d; })();
  const noon = () => NOW;
  const inDays = (n: number) => ({ toDate: () => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000) });
  const agoDays = (n: number) => ({ toDate: () => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000) });

  test('an empty dictionary two hours after signing up', () => {
    const h = load('tg-notify');
    const now = noon();
    const picked = h.mod.pick({
      telegramId: 1, wordCount: 0,
      registrationDate: { toDate: () => new Date(now.getTime() - 3 * 60 * 60 * 1000) },
    }, now);

    expect(picked && picked.type).toBe('onboarding');
    h.restore();
  });

  test('not one hour after signing up', () => {
    const h = load('tg-notify');
    const now = noon();
    const picked = h.mod.pick({
      telegramId: 1, wordCount: 0,
      registrationDate: { toDate: () => new Date(now.getTime() - 60 * 60 * 1000) },
    }, now);

    expect(picked).toBeNull();
    h.restore();
  });

  test('the trial ending tomorrow is told apart from a paid one', () => {
    const h = load('tg-notify');
    const now = noon();
    const trial = { telegramId: 1, wordCount: 9, registrationDate: agoDays(6), subscriptionExpiration: inDays(1) };
    const paid = { ...trial, subscriptionPlan: 'paid', subscriptionExpiration: inDays(1) };

    expect(h.mod.pick(trial, now)!.type).toBe('trialEndsTomorrow');
    expect(h.mod.pick(paid, now)).toBeNull(); // a paid plan warns at 3 days, not 1
    h.restore();
  });

  test('a paid subscription warns three days out', () => {
    const h = load('tg-notify');
    const now = noon();
    const picked = h.mod.pick({
      telegramId: 1, wordCount: 9, subscriptionPlan: 'paid',
      registrationDate: agoDays(200), subscriptionExpiration: inDays(3),
    }, now);

    expect(picked && picked.type).toBe('subscriptionEndsSoon');
    h.restore();
  });

  test('a week of silence asks once', () => {
    const h = load('tg-notify');
    const now = noon();
    const picked = h.mod.pick({
      telegramId: 1, wordCount: 40, lifetime: true,
      registrationDate: agoDays(60), lastActiveDate: '2000-01-01',
    }, now);

    expect(picked && picked.type).toBe('reactivation');
    h.restore();
  });

  test('a lifetime account is never asked to pay', () => {
    const h = load('tg-notify');
    const now = noon();
    const picked = h.mod.pick({
      telegramId: 1, wordCount: 40, lifetime: true,
      registrationDate: agoDays(60),
      lastActiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(now),
    }, now);

    expect(picked).toBeNull();
    h.restore();
  });

  test('all seven scenarios from the brief exist', () => {
    const h = load('tg-notify');
    expect(h.mod.SCENARIOS.map((s: any) => s.type)).toEqual([
      'onboarding', 'trialEndsTomorrow', 'trialEnded',
      'subscriptionEndsSoon', 'subscriptionEnded', 'streakAtRisk', 'reactivation',
    ]);
    h.restore();
  });
});

test.describe('Sending, and what happens when it fails', () => {
  // A fixed instant that is the middle of a Kyiv working day, so these never
  // depend on when the suite happens to run
  const MIDDAY = (() => { const d = new Date(); d.setUTCHours(10, 0, 0, 0); return d; })();
  const newcomer = () => ({
    telegramId: 777, wordCount: 0,
    registrationDate: { toDate: () => new Date(MIDDAY.getTime() - 3 * 60 * 60 * 1000) },
  });

  test('a blocked chat is switched off rather than retried every hour', async () => {
    const h = load('tg-notify', {
      users: { u1: newcomer() },
      words: { u1: [] },
      sendFails: () => ({ code: 403 }),
    });

    await h.mod.runOnce(MIDDAY);
    expect(h.users.u1.notificationsOff).toBe(true);
    h.restore();
  });

  test('a message is only marked as sent once it actually went', async () => {
    const h = load('tg-notify', {
      users: { u1: newcomer() },
      words: { u1: [] },
      sendFails: () => ({ code: 400 }),
    });

    await h.mod.runOnce(MIDDAY);
    expect(h.users.u1.notifications).toBeUndefined();
    h.restore();
  });

  test('a delivered message is written down so it cannot repeat', async () => {
    const h = load('tg-notify', { users: { u1: newcomer() }, words: { u1: [] } });

    await h.mod.runOnce(MIDDAY);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].text).toContain('Словник поки порожній');
    expect(h.users.u1.notifications.onboarding.sentAt).toBeTruthy();

    // A second pass in the same hour must stay silent
    await h.mod.runOnce(MIDDAY);
    expect(h.sent).toHaveLength(1);
    h.restore();
  });

  test('an onboarding nudge is confirmed against the dictionary, not a stale count', async () => {
    const h = load('tg-notify', {
      users: { u1: newcomer() }, // count says empty, the collection disagrees
      words: { u1: [{ id: 'hello' }] },
    });

    await h.mod.runOnce(MIDDAY);
    expect(h.sent).toEqual([]);
    h.restore();
  });

  test('nothing at all goes out during quiet hours', async () => {
    const night = new Date(MIDDAY);
    night.setUTCHours(0, 0, 0, 0);
    const h = load('tg-notify', { users: { u1: newcomer() }, words: { u1: [] } });

    const res = await h.mod.runOnce(night);
    expect(JSON.parse(res.body).skipped).toBe('quiet hours');
    expect(h.sent).toEqual([]);
    h.restore();
  });

  test('every message carries a button back into the app', async () => {
    const h = load('tg-notify', { users: { u1: newcomer() }, words: { u1: [] } });
    await h.mod.runOnce(MIDDAY);

    expect(h.sent[0].buttons[0][0].url).toContain('http');
    h.restore();
  });
});

test.describe('Handing out a link code', () => {
  test('an anonymous caller gets no code', async () => {
    const h = load('tg-link', { verify: async () => { throw new Error('bad'); } });
    const res = await h.mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer x' }, body: '' });

    expect(res.statusCode).toBe(401);
    expect(Object.keys(h.codes)).toEqual([]);
    h.restore();
  });

  test('a signed-in caller gets a single-use code and the deep link', async () => {
    const h = load('tg-link');
    const res = await h.mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: '' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toContain('https://t.me/env-TG_BOT_USERNAME?start=');

    const code = body.url.split('start=')[1];
    expect(h.codes[code].uid).toBe('u1');
    expect(new Date(h.codes[code].expiresAt).getTime()).toBeGreaterThan(Date.now());
    h.restore();
  });

  test('two calls never hand out the same code', async () => {
    const h = load('tg-link');
    const one = JSON.parse((await h.mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: '' })).body);
    const two = JSON.parse((await h.mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: '' })).body);

    expect(one.url).not.toBe(two.url);
    h.restore();
  });
});

test.describe('The rules and the browser side', () => {
  test('the link collections are closed to every client', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    expect(rules).toMatch(/match \/tgLinks\/\{telegramId\} \{\s*allow read, write: if false;/);
    expect(rules).toMatch(/match \/tgLinkCodes\/\{code\} \{\s*allow read, write: if false;/);
  });

  test('a client cannot point somebody else’s chat at its own reminders', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    const usersRule = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /words'));
    expect(usersRule).toContain("'telegramId'");
  });

  test('the dashboard offers to connect Telegram', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#acc-telegram')).toBeVisible();
    await expect(page.locator('#acc-telegram-btn')).toContainText('Підключити');
  });

  test('connecting asks the function for a code and opens what it returns', async ({ page }) => {
    await loadApp(page);
    const calls: any[] = [];
    await page.route('**/.netlify/functions/tg-link', async (route) => {
      calls.push(route.request().headers()['authorization']);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://t.me/testbot?start=abc' }),
      });
    });
    await page.evaluate(() => { (window as any).open = (u: string) => { (window as any).__opened = u; }; });

    await page.click('#acc-telegram-btn');

    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatch(/^Bearer .+/);
    await expect.poll(() => page.evaluate(() => (window as any).__opened))
      .toBe('https://t.me/testbot?start=abc');
  });

  test('an already linked account shows that, and how to switch it off', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).renderTelegramRow({ telegramId: 777 }));

    await expect(page.locator('#acc-telegram')).toHaveClass(/connected/);
    await expect(page.locator('#acc-telegram-title')).toContainText('підключено');
    await expect(page.locator('#acc-telegram-sub')).toContainText('/stop');
  });

  test('a failure to get a code is reported, not swallowed', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/tg-link', (route) => route.fulfill({ status: 500, body: '{}' }));

    await page.click('#acc-telegram-btn');
    await expect(page.locator('.notification')).toContainText('Не вдалося');
    await expect(page.locator('#acc-telegram-btn')).toBeEnabled();
  });
});

test.describe('The trial is a week now', () => {
  test('both places that grant it use the one constant', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain('const TRIAL_DAYS = 7;');
    expect(html.match(/getDate\(\) \+ TRIAL_DAYS/g) || []).toHaveLength(2);
    expect(html).not.toMatch(/getDate\(\) \+ 3\)/);
  });

  test('the badge still tells a trial from a purchase at the new length', async ({ page }) => {
    await loadApp(page);
    const verdicts = await page.evaluate(() => {
      const day = 24 * 60 * 60 * 1000;
      const registered = new Date();
      const stamp = (d: Date) => ({ toDate: () => d });
      const call = (expiresInDays: number, plan?: string) => (window as any).isTrialSubscription(
        { registrationDate: stamp(registered), subscriptionPlan: plan },
        new Date(registered.getTime() + expiresInDays * day),
      );
      return { sevenDay: call(7), thirtyDay: call(30), boughtSeven: call(7, 'paid') };
    });

    expect(verdicts.sevenDay).toBe(true);
    expect(verdicts.thirtyDay).toBe(false);
    expect(verdicts.boughtSeven).toBe(false);
  });
});

test.describe('Payment tells the bot', () => {
  test('the callback sends a confirmation and names the new date', () => {
    const src = readFileSync(FN('wayforpay-callback'), 'utf-8');
    expect(src).toContain("require('./_telegram')");
    expect(src).toContain('Доступ відкрито до');
    // Outside the transaction: a failed message must not undo a paid order
    expect(src.indexOf('sendMessage(granted.telegramId')).toBeGreaterThan(src.indexOf('await db.runTransaction'));
  });

  test('a paid subscription clears the reminder history', () => {
    const src = readFileSync(FN('wayforpay-callback'), 'utf-8');
    expect(src).toContain('notifications: {}');
  });

  test('the notifier runs hourly', () => {
    const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf-8');
    expect(toml).toContain('[functions."tg-notify"]');
    expect(toml).toContain('schedule = "@hourly"');
  });
});
