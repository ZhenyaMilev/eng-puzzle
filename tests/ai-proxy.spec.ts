import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', 'eng-puzzle');
const INDEX = join(ROOT, 'index.html');
const AI_PATH = join(ROOT, 'netlify', 'functions', 'ai.js');
const SHARED_PATH = join(ROOT, 'netlify', 'functions', '_shared.js');

/**
 * The key used to be readable by anyone who registered — it sat in a Firestore
 * document the rules opened to every signed-in user, and travelled to the
 * browser on every start. These check that the only way to OpenAI now runs
 * through a function that knows who is asking and how much they have spent.
 */

type Upstream = { url: string; init: any };

/** Loads the handler with _shared replaced, so nothing touches Firebase or OpenAI. */
function loadHandler(opts: {
  user?: any;
  usage?: any;
  verify?: () => Promise<any>;
  upstream?: (url: string, init: any) => any;
} = {}) {
  const calls: Upstream[] = [];
  const written: any[] = [];

  const userDoc = {
    get: async () => ({ exists: !!opts.user, data: () => opts.user }),
  };
  const usageDoc = {
    get: async () => ({ exists: !!opts.usage, data: () => opts.usage }),
    set: async (data: any) => { written.push(data); },
  };

  const fakeShared = {
    firestore: () => ({
      collection: (name: string) => ({
        doc: () => (name === 'users' ? userDoc : usageDoc),
      }),
    }),
    auth: () => ({
      verifyIdToken: opts.verify || (async () => ({ uid: 'u1' })),
    }),
    requiredEnv: (name: string) => `env-${name}`,
    json: (statusCode: number, body: any) => ({
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };

  delete require.cache[require.resolve(AI_PATH)];
  require.cache[require.resolve(SHARED_PATH)] = {
    id: SHARED_PATH, filename: SHARED_PATH, loaded: true, exports: fakeShared,
  } as any;

  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    const made = opts.upstream ? opts.upstream(String(url), init) : null;
    return made || {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{"choices":[{"message":{"content":"ok"}}]}',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };

  const mod = require(AI_PATH);
  return {
    mod,
    calls,
    written,
    restore: () => {
      (global as any).fetch = originalFetch;
      delete require.cache[require.resolve(SHARED_PATH)];
    },
  };
}

const ACTIVE = { subscriptionExpiration: { toDate: () => new Date(Date.now() + 86400000) } };

function call(body: any, headers: any = { authorization: 'Bearer client-token' }) {
  return { httpMethod: 'POST', headers, body: JSON.stringify(body) };
}

const CHAT = { route: 'chat', body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] } };

test.describe('Who may reach OpenAI', () => {
  test('an anonymous caller is turned away before anything is charged', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(CHAT) });
    expect(res.statusCode).toBe(401);
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('a forged token is turned away', async () => {
    const h = loadHandler({
      user: ACTIVE,
      verify: async () => { throw new Error('bad token'); },
    });
    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(401);
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('a user with no record cannot spend anything', async () => {
    const h = loadHandler({ user: null });
    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(402);
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('a lapsed subscription is refused, and told why', async () => {
    const h = loadHandler({
      user: { subscriptionExpiration: { toDate: () => new Date(Date.now() - 86400000) } },
    });
    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toContain('Підписка');
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('a lifetime account passes without an expiry date', async () => {
    const h = loadHandler({ user: { lifetime: true } });
    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(200);
    h.restore();
  });

  test('only POST is answered', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler({ httpMethod: 'GET', headers: {}, body: null });
    expect(res.statusCode).toBe(405);
    h.restore();
  });
});

test.describe('What may be asked for', () => {
  test('a route the app does not use is refused', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler(call({ route: 'embeddings', body: { model: 'gpt-4o-mini' } }));
    expect(res.statusCode).toBe(400);
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('a model the app does not use is refused, however valid at OpenAI', async () => {
    const h = loadHandler({ user: ACTIVE });
    for (const model of ['dall-e-3', 'o1-preview', 'gpt-4-turbo', '']) {
      const res = await h.mod.handler(call({ route: 'chat', body: { model, messages: [{ role: 'user', content: 'x' }] } }));
      expect(res.statusCode, model || '(none)').toBe(400);
    }
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('a request with no messages is refused', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler(call({ route: 'chat', body: { model: 'gpt-4o-mini', messages: [] } }));
    expect(res.statusCode).toBe(400);
    h.restore();
  });

  test('an enormous prompt is refused rather than forwarded', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler(call({
      route: 'chat',
      body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x'.repeat(70000) }] },
    }));
    expect(res.statusCode).toBe(400);
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('max_tokens is clamped, not trusted', async () => {
    const h = loadHandler({ user: ACTIVE });
    await h.mod.handler(call({
      route: 'chat',
      body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 999999 },
    }));
    expect(JSON.parse(h.calls[0].init.body).max_tokens).toBe(8000);
    h.restore();
  });

  test('streaming is stripped, since the function answers in one piece', async () => {
    const h = loadHandler({ user: ACTIVE });
    await h.mod.handler(call({
      route: 'chat',
      body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: true },
    }));
    expect(JSON.parse(h.calls[0].init.body).stream).toBeUndefined();
    h.restore();
  });
});

test.describe('The key itself', () => {
  test('the server key is what reaches OpenAI, never the caller token', async () => {
    const h = loadHandler({ user: ACTIVE });
    await h.mod.handler(call(CHAT));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(h.calls[0].init.headers.Authorization).toBe('Bearer env-OPENAI_API_KEY');
    expect(JSON.stringify(h.calls[0].init.headers)).not.toContain('client-token');
    h.restore();
  });

  test("OpenAI's own error text is logged, not handed to the browser", async () => {
    const h = loadHandler({
      user: ACTIVE,
      upstream: () => ({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        text: async () => '{"error":{"message":"Incorrect API key provided: sk-proj-abc123"}}',
      }),
    });
    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('sk-proj');
    expect(res.body).not.toContain('Incorrect API key');
    h.restore();
  });

  test('a successful answer is passed through untouched', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).choices[0].message.content).toBe('ok');
    h.restore();
  });

  test('speech comes back as bytes the browser can play', async () => {
    const h = loadHandler({
      user: ACTIVE,
      upstream: () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'audio/mpeg' },
        arrayBuffer: async () => new Uint8Array([255, 251, 144]).buffer,
      }),
    });
    const res = await h.mod.handler(call({
      route: 'speech', body: { model: 'tts-1', voice: 'nova', input: 'hello' },
    }));

    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers['Content-Type']).toBe('audio/mpeg');
    expect(Buffer.from(res.body, 'base64')).toEqual(Buffer.from([255, 251, 144]));
    h.restore();
  });
});

test.describe('How much may be spent', () => {
  test('a day at the cap is refused', async () => {
    const { DAILY_LIMITS } = require(AI_PATH);
    const day = new Date().toISOString().slice(0, 10);
    const h = loadHandler({ user: ACTIVE, usage: { day, chat: DAILY_LIMITS.chat } });

    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(429);
    expect(h.calls).toEqual([]);
    h.restore();
  });

  test('yesterday’s count does not carry over', async () => {
    const { DAILY_LIMITS } = require(AI_PATH);
    const h = loadHandler({ user: ACTIVE, usage: { day: '2020-01-01', chat: DAILY_LIMITS.chat } });

    const res = await h.mod.handler(call(CHAT));
    expect(res.statusCode).toBe(200);
    expect(h.written[0].chat).toBe(1);
    h.restore();
  });

  test('the expensive model has its own, much smaller budget', () => {
    const { DAILY_LIMITS, bucketFor } = require(AI_PATH);
    expect(bucketFor('chat', 'gpt-4o')).toBe('vision');
    expect(bucketFor('chat', 'gpt-4o-mini')).toBe('chat');
    expect(DAILY_LIMITS.vision).toBeLessThan(DAILY_LIMITS.chat);
  });

  test('a vision call is charged to the vision budget, not the chat one', async () => {
    const h = loadHandler({ user: ACTIVE });
    await h.mod.handler(call({
      route: 'chat', body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    }));
    expect(h.written[0].vision).toBe(1);
    expect(h.written[0].chat).toBeUndefined();
    h.restore();
  });
});

test.describe('Image search moved with the key it needed', () => {
  test('the browser asks the function, which holds the Unsplash key', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler(call({ route: 'image', body: { query: 'apple' } }));

    expect(res.statusCode).toBe(200);
    expect(h.calls[0].url).toContain('api.unsplash.com/search/photos');
    expect(h.calls[0].url).toContain('query=apple');
    expect(h.calls[0].init.headers.Authorization).toBe('Client-ID env-UNSPLASH_ACCESS_KEY');
    h.restore();
  });

  test('an empty query is refused', async () => {
    const h = loadHandler({ user: ACTIVE });
    const res = await h.mod.handler(call({ route: 'image', body: { query: '   ' } }));
    expect(res.statusCode).toBe(400);
    h.restore();
  });
});

test.describe('Nothing secret is left in the page', () => {
  test('the app never talks to OpenAI or Unsplash directly', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain('api.openai.com');
    expect(html).not.toContain('api.unsplash.com');
  });

  test('the variables that held the keys are gone', () => {
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).not.toContain('openaiApiKey');
    expect(html).not.toContain('loadOpenAIKey');
    expect(html).not.toContain('UNSPLASH_ACCESS_KEY');
    // ...and so is the read that fetched them
    expect(html).not.toContain("collection('config')");
  });

  test('the rules no longer open the key document to every account', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    const config = rules.slice(rules.indexOf('match /config'), rules.indexOf('match /users'));
    expect(config).toContain('allow read, write: if false;');
    expect(config).not.toContain('request.auth != null');
  });

  test('the usage counters cannot be reset from a client', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf-8');
    expect(rules).toMatch(/match \/aiUsage\/\{userId\} \{\s*allow read, write: if false;/);
  });
});

test.describe('The browser side of the move', () => {
  function captureAi(page: Page) {
    const calls: any[] = [];
    page.route('**/.netlify/functions/ai', async (route) => {
      const body = route.request().postDataJSON();
      calls.push({ auth: route.request().headers()['authorization'], ...body });
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
      });
    });
    return calls;
  }

  test('a generation goes to the function, with the Firebase token attached', async ({ page }) => {
    await loadApp(page);
    const calls = captureAi(page);

    await page.evaluate(() => (window as any).aiChat({
      model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }],
    }));

    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].auth).toMatch(/^Bearer .+/);
    expect(calls[0].route).toBe('chat');
    expect(calls[0].body.model).toBe('gpt-4o-mini');
  });

  test('speech and image search use the same door', async ({ page }) => {
    await loadApp(page);
    const calls = captureAi(page);

    await page.evaluate(async () => {
      await (window as any).aiSpeech({ model: 'tts-1', voice: 'nova', input: 'hello' });
      await (window as any).aiImageSearch('apple');
    });

    await expect.poll(() => calls.length).toBe(2);
    expect(calls.map((c) => c.route)).toEqual(['speech', 'image']);
    expect(calls[1].body.query).toBe('apple');
  });

  test('a day at the cap is explained in Ukrainian, not swallowed', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/ai', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"limit"}' }));

    await page.evaluate(() => (window as any).aiChat({
      model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }],
    }));

    await expect(page.locator('.notification')).toContainText('Денний ліміт');
  });

  test('a lapsed subscription says so rather than "щось пішло не так"', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/ai', (route) =>
      route.fulfill({ status: 402, contentType: 'application/json', body: '{"error":"no sub"}' }));

    await page.evaluate(() => (window as any).aiChat({
      model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }],
    }));

    await expect(page.locator('.notification')).toContainText('підписка');
  });

  test('the same complaint is not repeated for every call in one exercise', async ({ page }) => {
    await loadApp(page);
    await page.route('**/.netlify/functions/ai', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"limit"}' }));

    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        await (window as any).aiChat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
      }
    });

    await expect(page.locator('.notification')).toHaveCount(1);
  });
});

test.describe('A photo must survive the size check', () => {
  function sane(body: any) {
    delete require.cache[require.resolve(AI_PATH)];
    process.env.WFP_MERCHANT_SECRET = 'x';
    const mod = require(AI_PATH);
    return mod.chatBodyIsSane(body);
  }

  const image = (chars: number) => ({
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(chars) },
  });

  test('a real photo passes, though it dwarfs the text limit', () => {
    // A 1600px JPEG is several hundred thousand base64 characters. The old
    // single 60k limit covered text and images together, so every photo
    // request was refused before it ever reached OpenAI.
    expect(sane({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Extract words' }, image(400_000)] }],
    })).toBe(true);
  });

  test('an absurd image is still refused', () => {
    expect(sane({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }, image(4_000_000)] }],
    })).toBe(false);
  });

  test('a wall of text is still refused', () => {
    expect(sane({ messages: [{ role: 'user', content: 'x'.repeat(70_000) }] })).toBe(false);
  });

  test('a pile of images is refused', () => {
    expect(sane({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }, ...Array.from({ length: 9 }, () => image(100)) ] }],
    })).toBe(false);
  });

  test('an unknown content part is refused', () => {
    expect(sane({
      messages: [{ role: 'user', content: [{ type: 'audio', data: 'x' }] }],
    })).toBe(false);
  });

  test('plain text still works', () => {
    expect(sane({ messages: [{ role: 'user', content: 'привіт' }] })).toBe(true);
  });
});
