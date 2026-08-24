import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'eng-puzzle');
const INDEX = join(ROOT, 'index.html');
const FN = (name: string) => join(ROOT, 'netlify', 'functions', `${name}.js`);

/**
 * Inside Telegram the app has no address bar, no password screen and a
 * viewport that is not 100vh. The signature on initData is the only thing
 * standing between "signed in without a password" and "signed in as anyone".
 */

const BOT_TOKEN = 'env-TG_BOT_TOKEN';

// _shared's signing helpers read process.env directly, so these have to be set
// rather than faked through the module
process.env.WFP_MERCHANT_SECRET = 'env-WFP_MERCHANT_SECRET';
process.env.TG_BOT_TOKEN = BOT_TOKEN;

/** Builds initData the way Telegram does, so a wrong implementation fails loudly. */
function signInitData(user: any, authDate = Math.floor(Date.now() / 1000), token = BOT_TOKEN) {
  const params = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(authDate),
    query_id: 'AAA',
  });
  const checkString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

function load(name: string, opts: {
  users?: Record<string, any>;
  links?: Record<string, any>;
  orders?: Record<string, any>;
  words?: Record<string, any[]>;
  phrases?: Record<string, any[]>;
  verify?: () => Promise<any>;
} = {}) {
  const stores: Record<string, any> = {
    users: opts.users || {},
    tgLinks: opts.links || {},
    orders: opts.orders || {},
  };
  const words = opts.words || {};
  const phrases = opts.phrases || {};
  const customTokens: string[] = [];
  const deleted: string[] = [];

  function docApi(collection: string, id: string) {
    const store = stores[collection] || (stores[collection] = {});
    const ref: any = {
      id,
      get: async () => ({ exists: id in store, data: () => store[id], ref }),
      set: async (data: any, o?: any) => {
        store[id] = o && o.merge ? { ...(store[id] || {}), ...data } : data;
      },
      delete: async () => { delete store[id]; deleted.push(`${collection}/${id}`); },
      collection: (sub: string) => ({
        limit: () => ({
          get: async () => ({ empty: !((sub === 'words' ? words : phrases)[id] || []).length }),
        }),
      }),
    };
    return ref;
  }

  const db = {
    collection: (name: string) => ({ doc: (id: string) => docApi(name, id) }),
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      const b: any = {
        set: (ref: any, d: any, o: any) => { ops.push(() => ref.set(d, o)); return b; },
        delete: (ref: any) => { ops.push(() => ref.delete()); return b; },
        commit: async () => { for (const op of ops) await op(); },
      };
      return b;
    },
  };

  const fakeShared = {
    ...require(FN('_shared')),
    firestore: () => db,
    auth: () => ({
      verifyIdToken: opts.verify || (async () => ({ uid: 'email-uid' })),
      createCustomToken: async (uid: string) => { customTokens.push(uid); return `custom-${uid}`; },
      deleteUser: async (uid: string) => { deleted.push(`auth/${uid}`); },
    }),
    requiredEnv: (n: string) => `env-${n}`,
    json: (statusCode: number, body: any) => ({
      statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  };

  const sharedPath = FN('_shared');
  require.cache[require.resolve(sharedPath)] = {
    id: sharedPath, filename: sharedPath, loaded: true, exports: fakeShared,
  } as any;
  for (const m of ['tg-auth', 'pay-redirect', 'paid-return']) {
    delete require.cache[require.resolve(FN(m))];
  }

  const mod = require(FN(name));
  return {
    mod, stores, customTokens, deleted,
    restore: () => { delete require.cache[require.resolve(sharedPath)]; },
  };
}

const post = (body: any, headers: any = {}) => ({
  httpMethod: 'POST', headers, body: JSON.stringify(body),
});

const TG_USER = { id: 4242, first_name: 'Женя', username: 'zhenya' };

test.describe('Signing in without a password', () => {
  test('a correctly signed initData is accepted', async () => {
    const h = load('tg-auth');
    const res = await h.mod.handler(post({ initData: signInitData(TG_USER) }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe('custom-tg_4242');
    expect(body.created).toBe(true);
    h.restore();
  });

  test('a tampered field invalidates the whole thing', async () => {
    const h = load('tg-auth');
    const honest = signInitData(TG_USER);
    const forged = honest.replace('4242', '9999');

    const res = await h.mod.handler(post({ initData: forged }));
    expect(res.statusCode).toBe(401);
    expect(h.customTokens).toEqual([]);
    h.restore();
  });

  test('initData signed with a different bot token is refused', async () => {
    const h = load('tg-auth');
    const res = await h.mod.handler(post({
      initData: signInitData(TG_USER, Math.floor(Date.now() / 1000), 'somebody-elses-token'),
    }));

    expect(res.statusCode).toBe(401);
    h.restore();
  });

  test('a signature from last month cannot be replayed', async () => {
    const h = load('tg-auth');
    const old = Math.floor(Date.now() / 1000) - 40 * 24 * 60 * 60;

    const res = await h.mod.handler(post({ initData: signInitData(TG_USER, old) }));
    expect(res.statusCode).toBe(401);
    h.restore();
  });

  test('a day-old signature still works, an older one does not', async () => {
    const h = load('tg-auth');
    const now = Math.floor(Date.now() / 1000);

    const fresh = await h.mod.handler(post({ initData: signInitData(TG_USER, now - 23 * 3600) }));
    const stale = await h.mod.handler(post({ initData: signInitData(TG_USER, now - 25 * 3600) }));

    expect(fresh.statusCode).toBe(200);
    expect(stale.statusCode).toBe(401);
    h.restore();
  });

  test('empty or missing initData is refused, not treated as anonymous', async () => {
    const h = load('tg-auth');
    for (const body of [{}, { initData: '' }, { initData: 'user=x&hash=zz' }]) {
      const res = await h.mod.handler(post(body));
      expect([400, 401]).toContain(res.statusCode);
    }
    expect(h.customTokens).toEqual([]);
    h.restore();
  });

  test('a new visitor gets the same trial as the website', async () => {
    const h = load('tg-auth');
    await h.mod.handler(post({ initData: signInitData(TG_USER) }));

    const user = h.stores.users.tg_4242;
    const days = (user.subscriptionExpiration - user.registrationDate) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(require(FN('tg-auth')).TRIAL_DAYS);
    expect(user.telegramId).toBe(4242);
    h.restore();
  });

  test('someone who already linked from the web keeps that account', async () => {
    const h = load('tg-auth', {
      links: { '4242': { uid: 'old-email-account' } },
      users: { 'old-email-account': { email: 'a@b.c' } },
    });

    const res = await h.mod.handler(post({ initData: signInitData(TG_USER) }));
    const body = JSON.parse(res.body);

    expect(body.uid).toBe('old-email-account');
    expect(body.created).toBe(false);
    expect(h.stores.users.tg_4242).toBeUndefined();
    h.restore();
  });

  test('coming back a second time does not reset the account', async () => {
    const h = load('tg-auth');
    await h.mod.handler(post({ initData: signInitData(TG_USER) }));
    h.stores.users.tg_4242.streak = 12;

    const res = await h.mod.handler(post({ initData: signInitData(TG_USER) }));

    expect(JSON.parse(res.body).created).toBe(false);
    expect(h.stores.users.tg_4242.streak).toBe(12);
    h.restore();
  });
});

test.describe('Paying from inside Telegram', () => {
  const ORDER = {
    uid: 'u1', email: 'a@b.c', plan: 30, days: 30, amount: 99,
    currency: 'UAH', status: 'created', orderDate: 1700000000,
    createdAt: new Date(1700000000000).toISOString(),
  };

  test('the page posts a signed form to the gateway by itself', async () => {
    const h = load('pay-redirect', { orders: { 'sub-1': ORDER } });
    const res = await h.mod.handler({ queryStringParameters: { order: 'sub-1' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('action="https://secure.wayforpay.com/pay"');
    expect(res.body).toContain('method="POST"');
    expect(res.body).toContain('name="merchantSignature"');
    expect(res.body).toContain("getElementById('f').submit()");
    // Repeated fields keep the array shape the gateway expects
    expect(res.body).toContain('name="productName[]"');
    h.restore();
  });

  test('the amount comes from the stored order, never from the URL', async () => {
    const h = load('pay-redirect', { orders: { 'sub-1': ORDER } });
    const res = await h.mod.handler({
      queryStringParameters: { order: 'sub-1', amount: '1' },
    });

    expect(res.body).toContain('name="amount" value="99"');
    expect(res.body).not.toContain('name="amount" value="1"');
    expect(res.body).toContain('name="productPrice[]" value="99"');
    h.restore();
  });

  test('an unknown or already paid order does not reach the gateway', async () => {
    const h = load('pay-redirect', { orders: { 'sub-paid': { ...ORDER, status: 'paid' } } });

    const missing = await h.mod.handler({ queryStringParameters: { order: 'nope' } });
    const paid = await h.mod.handler({ queryStringParameters: { order: 'sub-paid' } });

    expect(missing.body).toContain('не знайдено');
    expect(missing.body).not.toContain('wayforpay.com/pay');
    expect(paid.body).toContain('вже оплачено');
    h.restore();
  });

  test('the signature matches what create-payment would have produced', async () => {
    const shared = require(FN('_shared'));
    const h = load('pay-redirect', { orders: { 'sub-1': ORDER } });
    const res = await h.mod.handler({ queryStringParameters: { order: 'sub-1' } });

    const signature = res.body.match(/name="merchantSignature" value="([a-f0-9]+)"/)![1];
    expect(signature).toBe(shared.purchaseSignature({
      merchantAccount: 'env-WFP_MERCHANT_ACCOUNT',
      merchantDomainName: 'env-WFP_MERCHANT_DOMAIN',
      orderReference: 'sub-1',
      orderDate: 1700000000,
      amount: 99,
      currency: 'UAH',
      productName: [shared.PLANS[30].name],
      productCount: [1],
      productPrice: [99],
    }));
    h.restore();
  });

  test('the return page sends the visitor back to the Mini App', async () => {
    process.env.TG_BOT_USERNAME = 'testbot';
    process.env.TG_MINIAPP_NAME = 'app';
    const h = load('paid-return');
    const res = await h.mod.handler({ queryStringParameters: { order: 'sub-1' } });

    expect(res.body).toContain('https://t.me/testbot/app?startapp=paid');
    delete process.env.TG_BOT_USERNAME;
    delete process.env.TG_MINIAPP_NAME;
    h.restore();
  });

  test('with no Mini App configured it goes back to the website', async () => {
    process.env.WFP_MERCHANT_DOMAIN = 'example.com';
    const h = load('paid-return');
    const res = await h.mod.handler({ queryStringParameters: { order: 'sub-1' } });

    expect(res.body).toContain('https://example.com/?paid=sub-1');
    h.restore();
  });

  test('create-payment now points the gateway at the return page', () => {
    const src = readFileSync(FN('create-payment'), 'utf-8');
    expect(src).toContain('/paid?order=');
    expect(src).toContain('orderReference, payload');
    // orderDate has to be stored, because pay-redirect re-signs from the record
    expect(src).toMatch(/createdAt: new Date\(\)\.toISOString\(\),[\s\S]{0,200}orderDate,/);
  });

  test('the routes the Mini App opens are wired up', () => {
    const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf-8');
    expect(toml).toContain('from = "/pay"');
    expect(toml).toContain('to = "/.netlify/functions/pay-redirect"');
    expect(toml).toContain('from = "/paid"');
  });
});

// ------------------------------------------------------------------ browser

/** Pretends the page is running inside Telegram, before any app script runs. */
async function blockTelegramSdk(page: Page) {
  await page.route('**/telegram-web-app.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }));
}

async function asMiniApp(page: Page, opts: { initData?: string } = {}) {
  await blockTelegramSdk(page);
  await page.addInitScript((initData) => {
    const events: Record<string, Function[]> = {};
    (window as any).Telegram = {
      WebApp: {
        initData,
        viewportStableHeight: 600,
        contentSafeAreaInset: { top: 12, bottom: 34 },
        ready: () => { (window as any).__tgReady = true; },
        expand: () => { (window as any).__tgExpanded = true; },
        disableVerticalSwipes: () => { (window as any).__tgSwipesOff = true; },
        setHeaderColor: (c: string) => { (window as any).__tgHeader = c; },
        setBackgroundColor: () => {},
        openLink: (u: string) => { (window as any).__tgOpened = u; },
        openTelegramLink: (u: string) => { (window as any).__tgOpened = u; },
        onEvent: (name: string, fn: Function) => { (events[name] = events[name] || []).push(fn); },
      },
    };
    (window as any).__tgFire = (name: string) => (events[name] || []).forEach((f) => f());
  }, opts.initData ?? 'user=%7B%22id%22%3A4242%7D&hash=abc');
}

test.describe('The app inside Telegram', () => {
  test('it announces itself, expands, and stops the closing swipe', async ({ page }) => {
    await asMiniApp(page);
    await page.route('**/.netlify/functions/tg-auth', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 't', created: false }) }));
    await loadApp(page);

    const state = await page.evaluate(() => ({
      ready: (window as any).__tgReady,
      expanded: (window as any).__tgExpanded,
      swipesOff: (window as any).__tgSwipesOff,
      header: (window as any).__tgHeader,
    }));

    expect(state.ready).toBe(true);
    expect(state.expanded).toBe(true);
    expect(state.swipesOff).toBe(true);
    expect(state.header).toBe('#F4F1EA');
  });

  test('the viewport height comes from Telegram, not from 100vh', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    const height = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim());
    expect(height).toBe('600px');
  });

  test('the safe area from Telegram becomes real padding', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    const padding = await page.evaluate(() => ({
      body: getComputedStyle(document.body).paddingBottom,
      inMiniApp: document.body.classList.contains('in-miniapp'),
    }));

    expect(padding.inMiniApp).toBe(true);
    expect(padding.body).toBe('34px');
  });

  test('a plain browser is left exactly as it was', async ({ page }) => {
    // The SDK is present here too — outside Telegram it just has no initData
    await page.addInitScript(() => {
      (window as any).Telegram = { WebApp: { initData: '', ready: () => {}, expand: () => {} } };
    });
    await blockTelegramSdk(page);
    await loadApp(page);

    const state = await page.evaluate(() => ({
      inMiniApp: document.body.classList.contains('in-miniapp'),
      height: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
      isMini: (window as any).isMiniApp(),
    }));

    expect(state.inMiniApp).toBe(false);
    expect(state.height).toBe('100vh');
    expect(state.isMini).toBe(false);
  });

  test('paying opens the browser page instead of posting a form', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.route('**/.netlify/functions/create-payment', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ action: 'https://secure.wayforpay.com/pay', orderReference: 'sub-9', payload: {} }),
      }));

    await page.evaluate(() => (window as any).showTariffs());
    await page.click('#tariffs-section .tariff:has-text("1 місяць") button');

    // The warning comes first, so leaving for the browser is not a surprise
    await expect(page.locator('#app-confirm-modal')).toBeVisible();
    await expect(page.locator('#app-confirm-title')).toContainText('браузері');
    await page.click('#app-confirm-ok');

    await expect.poll(() => page.evaluate(() => (window as any).__tgOpened))
      .toContain('/pay?order=sub-9');
  });

  test('declining the warning does not open anything', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.route('**/.netlify/functions/create-payment', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ action: 'x', orderReference: 'sub-9', payload: {} }),
      }));

    await page.evaluate(() => (window as any).showTariffs());
    await page.click('#tariffs-section .tariff:has-text("1 місяць") button');
    await expect(page.locator('#app-confirm-modal')).toBeVisible();
    await page.click('#app-confirm-modal .app-modal-cancel, #app-confirm-modal button:has-text("Скасувати")');

    expect(await page.evaluate(() => (window as any).__tgOpened)).toBeUndefined();
  });

  test('coming back from the browser re-reads the subscription', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.evaluate(() => {
      (window as any).__badgeCalls = 0;
      const original = (window as any).checkSubscription;
      (window as any).checkSubscription = (d: any) => { (window as any).__badgeCalls++; return original(d); };
      (window as any).__tgFire('activated');
    });

    await expect.poll(() => page.evaluate(() => (window as any).__badgeCalls)).toBeGreaterThan(0);
  });
});

test.describe('What the Mini App must not break', () => {
  test('the Telegram SDK loads before the app script', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html.indexOf('telegram-web-app.js')).toBeGreaterThan(-1);
    expect(html.indexOf('telegram-web-app.js')).toBeLessThan(html.indexOf('firebase-app.js'));
  });

  test('the web version still shows a login screen', async ({ page }) => {
    const { loadAppNoAuth } = require('./helpers');
    await loadAppNoAuth(page);
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('the payment callback is untouched by the new return URL', () => {
    const src = readFileSync(FN('wayforpay-callback'), 'utf-8');
    // Access is granted server-to-server; nothing in it reads returnUrl
    expect(src).not.toContain('returnUrl');
    expect(src).toContain('subscriptionExpiration: until');
  });
});

test.describe('The dashboard stays quiet inside Telegram', () => {
  test('the Telegram row is gone — there is nothing left to connect', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).renderTelegramRow({ telegramId: 777 }));

    await expect(page.locator('#acc-telegram')).toBeHidden();
  });

  test('but it stays on the web, where it is the only way to link', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#acc-telegram')).toBeVisible();
    await expect(page.locator('#acc-telegram-btn')).toContainText('Підключити');
  });

  test('nothing about merging accounts is left in the page', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await expect(page.locator('#merge-modal')).toHaveCount(0);
    await expect(page.locator('#merge-link')).toHaveCount(0);
    expect(await page.evaluate(() => typeof (window as any).mergeTelegramAccount)).toBe('undefined');
  });
});

test.describe('A password screen never appears inside Telegram', () => {
  test('a failed sign-in offers a retry, not a login form', async ({ page }) => {
    await asMiniApp(page);
    await page.route('**/.netlify/functions/tg-auth', (r) => r.fulfill({ status: 500, body: '{}' }));
    await loadApp(page);

    await page.evaluate(() => (window as any).showMiniAppSignInError());

    await expect(page.locator('#miniapp-error')).toBeVisible();
    await expect(page.locator('#miniapp-error')).toContainText('пароль не потрібен');
    await expect(page.locator('#login-form')).toBeHidden();
    await expect(page.locator('#register-form')).toBeHidden();
  });

  test('the source has no path from Telegram to the login screen', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const start = html.indexOf('if (!user && isMiniApp())');
    expect(start).toBeGreaterThan(-1);
    // The branch ends in the error screen and returns; it never falls through
    // to updateUI(), which is what draws the login form
    expect(html.slice(start, start + 260)).toContain('showMiniAppSignInError');
    expect(html.slice(start, start + 260)).toContain('return;');
  });

  test('the retry button asks the function again', async ({ page }) => {
    await asMiniApp(page);
    let calls = 0;
    await page.route('**/.netlify/functions/tg-auth', (r) => {
      calls++;
      return r.fulfill({ status: 500, body: '{}' });
    });
    await loadApp(page);

    await page.evaluate(() => (window as any).showMiniAppSignInError());
    await page.click('#miniapp-error button');
    await expect.poll(() => calls).toBeGreaterThan(0);
  });
});

test.describe('A shared link opens where it was shared', () => {
  test('inside Telegram it is a Mini App deep link, not a web address', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    const link = await page.evaluate(() => (window as any).buildSetLink('AbC123'));
    expect(link).toBe('https://t.me/myslovnyk_bot/app?startapp=set_AbC123');
    // The web address is what used to kick people out of the app to add a
    // folder *to* the app
    expect(link).not.toContain('vocabulary-english');
  });

  test('on the web it stays a web address, for friends who are not on Telegram', async ({ page }) => {
    await loadApp(page);
    const link = await page.evaluate(() => (window as any).buildSetLink('AbC123'));
    expect(link).toContain('?set=AbC123');
    expect(link).not.toContain('t.me');
  });

  test('startapp is read on entry, the same as ?set=', async ({ page }) => {
    await asMiniApp(page);
    await page.addInitScript(() => {
      const wait = setInterval(() => {
        const w = (window as any).Telegram?.WebApp;
        if (!w) return;
        clearInterval(wait);
        w.initDataUnsafe = { start_param: 'set_SharedFolder1' };
      }, 1);
    });
    await loadApp(page);

    const id = await page.evaluate(() => (window as any).sharedSetIdFromEntry());
    expect(id).toBe('SharedFolder1');
  });

  test('the payment return param is not mistaken for a set', async ({ page }) => {
    await asMiniApp(page);
    await page.addInitScript(() => {
      const wait = setInterval(() => {
        const w = (window as any).Telegram?.WebApp;
        if (!w) return;
        clearInterval(wait);
        w.initDataUnsafe = { start_param: 'paid' };
      }, 1);
    });
    await loadApp(page);

    expect(await page.evaluate(() => (window as any).sharedSetIdFromEntry())).toBeNull();
  });

  test('a shared folder opens the import dialog inside Telegram', async ({ page }) => {
    await asMiniApp(page);
    await page.addInitScript(() => {
      const wait = setInterval(() => {
        const w = (window as any).Telegram?.WebApp;
        if (!w) return;
        clearInterval(wait);
        w.initDataUnsafe = { start_param: 'set_folder1' };
      }, 1);
    });
    await loadApp(page, {
      seed: { sets: { folder1: { title: 'Подорожі', type: 'folder', visibility: 'public', words: [{ english: 'trip', translation: 'подорож' }], phrases: [] } } },
    });

    await expect(page.locator('#import-set-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#import-set-title')).toContainText('Подорожі');
  });

  test('the bot username in the link matches the one deployed', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toContain("const TG_BOT_USERNAME = 'myslovnyk_bot'");
    expect(html).toContain("const TG_MINIAPP_NAME = 'app'");
  });
});

test.describe('The app does not wait for the Telegram script', () => {
  test('initData is read from the address bar when the SDK has not arrived', async ({ page }) => {
    // The SDK never loads at all here
    await page.route('**/telegram-web-app.js', (r) => r.abort());
    await page.addInitScript(() => { delete (window as any).Telegram; });

    await loadApp(page, { url: '/#tgWebAppData=user%3D%257B%2522id%2522%253A7%257D%26hash%3Dabc&tgWebAppVersion=7.0' });

    expect(await page.evaluate(() => (window as any).isMiniApp())).toBe(true);
    expect(await page.evaluate(() => (window as any).rawInitData())).toContain('hash=abc');
  });

  test('the chrome binds late, when the script finally lands', async ({ page }) => {
    await page.route('**/telegram-web-app.js', (r) => r.abort());
    await page.addInitScript(() => { delete (window as any).Telegram; });
    await loadApp(page, { url: '/#tgWebAppData=user%3D%257B%2522id%2522%253A7%257D%26hash%3Dabc' });

    const bound = await page.evaluate(() => {
      const calls: string[] = [];
      (window as any).Telegram = {
        WebApp: {
          initData: 'user=x&hash=abc',
          viewportStableHeight: 600,
          ready: () => calls.push('ready'),
          expand: () => calls.push('expand'),
          disableVerticalSwipes: () => calls.push('swipes'),
          setHeaderColor: () => {}, setBackgroundColor: () => {},
          onEvent: () => {},
          BackButton: { isVisible: false, show() {}, hide() {}, onClick() {} },
          MainButton: { isVisible: false, setParams() {}, show() {}, hide() {}, onClick() {} },
        },
      };
      (window as any).__tgSdkReady();
      return calls;
    });

    expect(bound).toEqual(['ready', 'expand', 'swipes']);

    // Calling it twice must not double-bind
    const again = await page.evaluate(() => {
      const before = (window as any).Telegram.WebApp;
      const calls: string[] = [];
      before.ready = () => calls.push('ready');
      (window as any).setupMiniAppChrome();
      return calls;
    });
    expect(again).toEqual([]);
  });

  test('the script tag no longer blocks rendering', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toMatch(/<script async src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"/);
  });

  test('fonts and icons are off the critical path', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const head = html.slice(0, html.indexOf('</head>'));
    // Three stylesheets that used to block the first paint
    expect((head.match(/media="print" onload="this\.media='all'"/g) || []).length).toBe(3);
    expect(head).toContain('rel="preconnect"');
  });
});
