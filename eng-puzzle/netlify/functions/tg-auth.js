'use strict';

const crypto = require('crypto');
const { firestore, auth, requiredEnv, json } = require('./_shared');

/**
 * Signs a Mini App visitor in without a password.
 *
 * The whole thing rests on one fact: Telegram hands the page an `initData`
 * string signed with a key derived from the bot token. Only Telegram and we
 * know that token, so a valid signature proves the user id inside is real.
 * Everything else here is about not trusting anything that is not signed.
 */

// The trial a Mini App visitor gets, same as the web sign-up
const TRIAL_DAYS = 7;
const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Telegram's scheme: sort every field but `hash`, join as k=v with newlines,
 * and HMAC it with a key that is itself an HMAC of the bot token.
 */
function checkInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  const got = Buffer.from(hash, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;

  // A signature stays valid forever; a replayed one from last month must not
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let botToken;
  try {
    botToken = requiredEnv('TG_BOT_TOKEN');
  } catch (e) {
    console.error('tg-auth misconfigured:', e && e.message);
    return json(500, { error: 'Telegram is not configured' });
  }

  let initData;
  try {
    initData = JSON.parse(event.body || '{}').initData;
  } catch (e) {
    return json(400, { error: 'Bad payload' });
  }
  if (typeof initData !== 'string' || !initData) return json(400, { error: 'Bad payload' });

  const tgUser = checkInitData(initData, botToken);
  if (!tgUser || !tgUser.id) return json(401, { error: 'Bad initData' });

  try {
    const db = firestore();
    const telegramId = Number(tgUser.id);

    // Someone who already linked from the web keeps the account they have
    const link = await db.collection('tgLinks').doc(String(telegramId)).get();
    let uid = link.exists ? link.data().uid : null;
    let created = false;

    if (!uid) {
      uid = `tg_${telegramId}`;
      const userRef = db.collection('users').doc(uid);
      const existing = await userRef.get();

      if (!existing.exists) {
        const expiration = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        await userRef.set({
          email: '',
          registrationDate: new Date(),
          subscriptionExpiration: expiration,
          telegramId,
          telegramName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').slice(0, 64),
          nickname: tgUser.username ? String(tgUser.username).slice(0, 32) : '',
        });
        created = true;
      }

      await db.collection('tgLinks').doc(String(telegramId)).set({
        uid,
        linkedAt: new Date().toISOString(),
      });
    }

    const token = await auth().createCustomToken(uid);
    // `created` lets the app offer "already have an account?" only where it helps
    return json(200, { token, uid, created });
  } catch (error) {
    console.error('tg-auth failed:', error);
    return json(500, { error: 'Sign-in failed' });
  }
};

module.exports.checkInitData = checkInitData;
module.exports.TRIAL_DAYS = TRIAL_DAYS;
module.exports.MAX_AGE_SECONDS = MAX_AGE_SECONDS;
