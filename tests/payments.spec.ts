import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'eng-puzzle');

/**
 * The functions themselves are exercised through their pure parts (the signing
 * contract and the price table); the browser side is exercised through the UI.
 * What cannot be checked here is WayForPay actually charging a card.
 */

// Rebuilt from the docs so a change to the app's field order fails loudly:
// HMAC_MD5 over values joined by ';', in the order the gateway expects.
const SECRET = 'test-secret';
const hmac = (values: any[]) => createHmac('md5', SECRET).update(values.join(';'), 'utf8').digest('hex');

function loadShared() {
  process.env.WFP_MERCHANT_SECRET = SECRET;
  const path = join(ROOT, 'netlify', 'functions', '_shared.js');
  delete require.cache[require.resolve(path)];
  return require(path);
}

test.describe('Payment signing', () => {
  test('a purchase is signed over the documented field order', () => {
    const shared = loadShared();
    const payload = {
      merchantAccount: 'shop',
      merchantDomainName: 'example.com',
      orderReference: 'sub-abc-1',
      orderDate: 1700000000,
      amount: 99,
      currency: 'UAH',
      productName: ['Підписка'],
      productCount: [1],
      productPrice: [99],
    };

    expect(shared.purchaseSignature(payload)).toBe(hmac([
      'shop', 'example.com', 'sub-abc-1', 1700000000, 99, 'UAH', 'Підписка', 1, 99,
    ]));
  });

  test('a callback is verified over its own, different field order', () => {
    const shared = loadShared();
    const body = {
      merchantAccount: 'shop',
      orderReference: 'sub-abc-1',
      amount: 99,
      currency: 'UAH',
      authCode: '123456',
      cardPan: '44**44',
      transactionStatus: 'Approved',
      reasonCode: 1100,
    };

    expect(shared.callbackSignature(body)).toBe(hmac([
      'shop', 'sub-abc-1', 99, 'UAH', '123456', '44**44', 'Approved', 1100,
    ]));
  });

  test('the answer the gateway waits for is signed too', () => {
    const shared = loadShared();
    expect(shared.answerSignature('sub-abc-1', 'accept', 1700000000))
      .toBe(hmac(['sub-abc-1', 'accept', 1700000000]));
  });

  test('a tampered callback does not verify', () => {
    const shared = loadShared();
    const body = {
      merchantAccount: 'shop', orderReference: 'sub-abc-1', amount: 99, currency: 'UAH',
      authCode: '123456', cardPan: '44**44', transactionStatus: 'Approved', reasonCode: 1100,
    };
    const honest = shared.callbackSignature(body);
    expect(shared.callbackSignature({ ...body, amount: 1 })).not.toBe(honest);
    expect(shared.callbackSignature({ ...body, transactionStatus: 'Declined' })).not.toBe(honest);
  });

  test('prices live on the server, and match what the screen offers', () => {
    const shared = loadShared();
    expect(shared.PLANS[30].amount).toBe(99);
    expect(shared.PLANS[90].amount).toBe(249);
    expect(shared.PLANS[365].amount).toBe(899);

    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    const tariffs = html.slice(html.indexOf('id="tariffs-section"'), html.indexOf('id="fill-blanks-section"'));
    expect(tariffs).toContain('₴99');
    expect(tariffs).toContain('₴249');
    expect(tariffs).toContain('₴899');
  });

  test('the callback body survives being sent as a form field', () => {
    const shared = loadShared();
    const payload = { orderReference: 'sub-abc-1', transactionStatus: 'Approved' };
    expect(shared.parseCallbackBody(JSON.stringify(payload)).orderReference).toBe('sub-abc-1');
    expect(shared.parseCallbackBody(encodeURIComponent(JSON.stringify(payload))).orderReference).toBe('sub-abc-1');
    expect(shared.parseCallbackBody('')).toBeNull();
  });
});

test.describe('Buying from the app', () => {
  function mockCreatePayment(page: Page, body?: any) {
    const calls: any[] = [];
    page.route('**/.netlify/functions/create-payment', async (route) => {
      calls.push({
        auth: route.request().headers()['authorization'],
        body: route.request().postDataJSON(),
      });
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(body || {
          action: 'https://secure.wayforpay.com/pay',
          payload: {
            merchantAccount: 'shop',
            orderReference: 'sub-test-1',
            amount: 99,
            productName: ['Підписка'],
            productCount: [1],
            productPrice: [99],
            merchantSignature: 'deadbeef',
          },
        }),
      });
    });
    return calls;
  }

  async function openTariffs(page: Page) {
    await page.evaluate(() => {
      // @ts-ignore — the app's own screen switch
      showTariffs();
    });
    await expect(page.locator('#tariffs-section')).toBeVisible();
  }

  test('the plan is sent with the signed-in user token, and nothing else', async ({ page }) => {
    await loadApp(page);
    const calls = mockCreatePayment(page);
    await page.route('https://secure.wayforpay.com/**', (r) => r.fulfill({ body: 'gateway' }));
    await openTariffs(page);

    await page.click('#tariffs-section .tariff:has-text("3 місяці") button');
    await expect.poll(() => calls.length).toBe(1);

    // Only the plan travels — the price is the server's business
    expect(calls[0].body).toEqual({ plan: 90 });
    expect(calls[0].auth).toMatch(/^Bearer .+/);
  });

  test('the browser is handed over to the gateway by POST', async ({ page }) => {
    await loadApp(page);
    mockCreatePayment(page);

    const posted: any[] = [];
    await page.route('https://secure.wayforpay.com/pay', async (route) => {
      posted.push({ method: route.request().method(), body: route.request().postData() });
      await route.fulfill({ contentType: 'text/html', body: '<h1>gateway</h1>' });
    });

    await openTariffs(page);
    await page.click('#tariffs-section .tariff:has-text("1 місяць") button');

    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].method).toBe('POST');
    expect(posted[0].body).toContain('merchantSignature=deadbeef');
    expect(posted[0].body).toContain('orderReference=sub-test-1');
    // Repeated fields keep the array shape the gateway expects
    expect(posted[0].body).toContain('productName%5B%5D=');
  });

  test('a failure to start payment is reported, not swallowed', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/create-payment', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' }));

    await openTariffs(page);
    await page.click('#tariffs-section .tariff:has-text("1 рік") button');

    await expect(page.locator('.notification, #notification')).toContainText('оплату', { timeout: 10000 });
    await expect(page.locator('#tariffs-section')).toBeVisible();
  });

  test('the app no longer grants a subscription to itself', async ({ page }) => {
    await loadApp(page);
    const writes: any[] = [];
    await page.evaluate(() => {
      // @ts-ignore
      window.__subWrites = [];
      // @ts-ignore
      const users = db.collection('users');
      const originalDoc = users.doc.bind(users);
      // @ts-ignore
      db.collection = (name: string) => {
        // @ts-ignore
        const coll = name === 'users' ? users : (window as any).__origCollection(name);
        return coll;
      };
      const wrapDoc = (id: string) => {
        const ref = originalDoc(id);
        const update = ref.update.bind(ref);
        ref.update = (data: any) => {
          if (data && ('subscriptionExpiration' in data || 'lifetime' in data)) {
            (window as any).__subWrites.push(Object.keys(data));
          }
          return update(data);
        };
        return ref;
      };
      users.doc = wrapDoc;
    });

    await page.route('**/.netlify/functions/create-payment', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' }));
    await page.evaluate(() => {
      // @ts-ignore
      showTariffs();
    });
    await page.click('#tariffs-section .tariff:has-text("1 місяць") button');
    await page.waitForTimeout(500);

    const recorded = await page.evaluate(() => (window as any).__subWrites);
    expect(recorded).toEqual([]);
  });

  test('returning from the gateway thanks the user and cleans the URL', async ({ page }) => {
    await loadApp(page, { url: '/?paid=sub-test-1' });
    await expect(page.locator('.notification, #notification')).toContainText('підписка', { timeout: 10000 });
    expect(page.url()).not.toContain('paid=');
  });
});

test.describe('Deployment wiring', () => {
  test('Netlify knows where the functions are and still serves the site', () => {
    const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf-8');
    expect(toml).toContain('functions = "netlify/functions"');
    expect(toml).toContain('publish = "."');
  });

  test('the callback path the gateway is told matches the deployed function', () => {
    const fn = readFileSync(join(ROOT, 'netlify', 'functions', 'create-payment.js'), 'utf-8');
    expect(fn).toContain('/.netlify/functions/wayforpay-callback');
  });

  test('the paid fields are closed to the client in the rules', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    expect(rules).toContain("'subscriptionExpiration', 'subscriptionPlan', 'lifetime'");
    expect(rules).toContain('hasAny');
  });
});
