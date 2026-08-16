'use strict';

const { firestore, auth, requiredEnv, json } = require('./_shared');

/**
 * The only place the OpenAI key exists.
 *
 * It used to live in a Firestore document that every signed-in user could
 * read, and travelled to the browser on every start — so anyone with an
 * account could spend the owner's money without touching the app at all.
 * Now the browser sends its Firebase ID token here and this function signs
 * the call, after checking who is asking and how much they have already used.
 */

const OPENAI_BASE = 'https://api.openai.com/v1';

// Only what the app actually calls. An unknown route or model is refused
// rather than forwarded, so a stolen token cannot reach dall-e or o1.
const ROUTES = {
  chat: { path: '/chat/completions', models: ['gpt-4o-mini', 'gpt-4o'] },
  speech: { path: '/audio/speech', models: ['tts-1', 'tts-1-hd'] },
  transcription: { path: '/audio/transcriptions', models: ['whisper-1'] },
};

// Unsplash is not OpenAI, but its key sat in the same world-readable Firestore
// document — routing it here is what lets that document be closed for good.
const UNSPLASH_SEARCH = 'https://api.unsplash.com/search/photos';

// A day's worth of honest study is far below these; a scraped token is not.
// gpt-4o costs ~20x gpt-4o-mini, so it is counted separately.
const DAILY_LIMITS = {
  chat: 400,
  vision: 40, // gpt-4o, used by lesson building from photos
  speech: 400,
  transcription: 150,
  image: 600,
};

// Пересилаємо лише те, що застосунок справді шле. Раніше тіло йшло далі
// цілком, і підписаний користувач міг додати n: 50 — п'ятдесят відповідей
// за одне списання квоти, тобто ліміт в обхід у п'ятдесят разів.
const FORWARDED_FIELDS = {
  chat: ['model', 'messages', 'temperature', 'max_tokens', 'response_format', 'top_p'],
  speech: ['model', 'input', 'voice', 'speed', 'response_format'],
};

const MAX_TOKENS_CEILING = 8000;
const MAX_INPUT_CHARS = 60000;
// Netlify caps a function request at 6 MB and base64 adds a third, so anything
// above ~4 MB would be rejected by the platform before reaching this code
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The subscription gate is the point: without it any registered address is a
 * free OpenAI account. Trial users pass — that is what the trial is for.
 */
function subscriptionActive(user) {
  if (!user) return false;
  if (user.lifetime === true) return true;
  const expiration = user.subscriptionExpiration;
  const date = expiration && expiration.toDate ? expiration.toDate() : null;
  return !!date && date > new Date();
}

/**
 * Counts are advisory rather than transactional: two calls racing may both
 * pass the check, which costs one extra request and saves a write round-trip
 * on every single call.
 */
async function chargeQuota(db, uid, bucket) {
  const ref = db.collection('aiUsage').doc(uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  const fresh = data.day === today() ? data : { day: today() };

  const used = Number(fresh[bucket] || 0);
  if (used >= DAILY_LIMITS[bucket]) return false;

  fresh[bucket] = used + 1;
  await ref.set(fresh, { merge: false });
  return true;
}

function bucketFor(route, model) {
  if (route === 'chat') return model === 'gpt-4o' ? 'vision' : 'chat';
  return route;
}

// 'image' has no spec in ROUTES — it does not go to OpenAI at all
function knownRoute(route) {
  return route === 'image' || Object.prototype.hasOwnProperty.call(ROUTES, route);
}

// Whisper wants multipart, and the browser cannot send a File through JSON —
// so the audio arrives base64 and the form is built here.
function transcriptionForm(payload) {
  const bytes = Buffer.from(String(payload.audio || ''), 'base64');
  if (!bytes.length) throw new Error('Empty audio');
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('Audio too large');


  const form = new FormData();
  const mime = typeof payload.mime === 'string' ? payload.mime : 'audio/webm';
  form.append('file', new Blob([bytes], { type: mime }), payload.filename || 'audio.webm');
  form.append('model', payload.model);
  if (payload.language) form.append('language', String(payload.language).slice(0, 8));
  return form;
}

function chatBodyIsSane(body) {
  if (!Array.isArray(body.messages) || !body.messages.length) return false;
  return JSON.stringify(body.messages).length <= MAX_INPUT_CHARS;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Not signed in' });

  // Зламані налаштування — це наша помилка, а не «увійдіть ще раз».
  // Раніше обидва випадки давали 401 і були нерозрізнимі ззовні.
  let verifier;
  try {
    verifier = auth();
  } catch (e) {
    console.error('ai proxy misconfigured:', e && e.message);
    return json(500, { error: 'AI is not configured' });
  }

  let uid;
  try {
    uid = (await verifier.verifyIdToken(token)).uid;
  } catch (e) {
    console.error('token rejected:', e && e.message);
    return json(401, { error: 'Not signed in' });
  }

  let route;
  let body;
  try {
    const parsed = JSON.parse(event.body || '{}');
    route = parsed.route;
    body = parsed.body || {};
  } catch (e) {
    return json(400, { error: 'Bad payload' });
  }

  if (!knownRoute(route)) return json(400, { error: 'Unknown route' });
  const spec = ROUTES[route];

  const model = typeof body.model === 'string' ? body.model : '';
  if (route !== 'image' && !spec.models.includes(model)) return json(400, { error: 'Unknown model' });
  if (route === 'image' && (typeof body.query !== 'string' || !body.query.trim())) {
    return json(400, { error: 'Bad request' });
  }

  if (route === 'chat' && !chatBodyIsSane(body)) return json(400, { error: 'Bad request' });
  if (route === 'speech' && (typeof body.input !== 'string' || body.input.length > 4096)) {
    return json(400, { error: 'Bad request' });
  }

  try {
    const db = firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!subscriptionActive(userSnap.exists ? userSnap.data() : null)) {
      return json(402, { error: 'Підписка неактивна' });
    }

    const bucket = bucketFor(route, model);
    if (!(await chargeQuota(db, uid, bucket))) {
      return json(429, { error: 'Денний ліміт вичерпано. Спробуй завтра.' });
    }

    if (route === 'image') {
      const query = encodeURIComponent(body.query.trim().slice(0, 100));
      const search = await fetch(
        `${UNSPLASH_SEARCH}?query=${query}&per_page=1&orientation=squarish&content_filter=high`,
        { headers: { Authorization: `Client-ID ${requiredEnv('UNSPLASH_ACCESS_KEY')}` } },
      );
      if (!search.ok) return json(search.status, { error: 'Image search failed' });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: await search.text() };
    }

    const key = requiredEnv('OPENAI_API_KEY');
    let response;

    if (route === 'transcription') {
      response = await fetch(OPENAI_BASE + spec.path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: transcriptionForm(body),
      });
    } else {
      const allowed = FORWARDED_FIELDS[route] || ['model'];
      const forwarded = {};
      for (const field of allowed) {
        if (body[field] !== undefined) forwarded[field] = body[field];
      }
      if (forwarded.max_tokens) {
        forwarded.max_tokens = Math.min(Number(forwarded.max_tokens), MAX_TOKENS_CEILING);
      }
      // One request, one answer — n is not on the allowlist, and saying so
      // explicitly keeps it that way if the list ever grows
      forwarded.n = 1;
      response = await fetch(OPENAI_BASE + spec.path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(forwarded),
      });
    }

    // Audio comes back as bytes; Netlify carries those base64-encoded
    if (route === 'speech' && response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      return {
        statusCode: 200,
        headers: { 'Content-Type': response.headers.get('content-type') || 'audio/mpeg' },
        body: audio.toString('base64'),
        isBase64Encoded: true,
      };
    }

    const text = await response.text();
    if (!response.ok) {
      // The upstream message can name the account or the key — keep it in the log
      console.error(`OpenAI ${route} failed:`, response.status, text.slice(0, 500));
      return json(response.status, { error: 'AI request failed' });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (error) {
    console.error('ai proxy failed:', error);
    return json(500, { error: 'AI request failed' });
  }
};

// Exported for the tests, which check the gates without reaching OpenAI
module.exports.DAILY_LIMITS = DAILY_LIMITS;
module.exports.ROUTES = ROUTES;
module.exports.subscriptionActive = subscriptionActive;
module.exports.bucketFor = bucketFor;
module.exports.knownRoute = knownRoute;
