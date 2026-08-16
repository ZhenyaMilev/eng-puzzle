'use strict';

const crypto = require('crypto');
const { firestore, auth, requiredEnv, json } = require('./_shared');

/**
 * Hands the signed-in browser a one-time code and the deep link that carries it.
 *
 * The code is what proves, a moment later and over a different channel, that
 * the Telegram account pressing /start belongs to this Firebase user. It is
 * single-use and short-lived, because anyone who saw it could claim the link.
 */

const CODE_TTL_MINUTES = 15;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Not signed in' });

  let verifier;
  try {
    verifier = auth();
  } catch (e) {
    console.error('tg-link misconfigured:', e && e.message);
    return json(500, { error: 'Telegram is not configured' });
  }

  let uid;
  try {
    uid = (await verifier.verifyIdToken(token)).uid;
  } catch (e) {
    return json(401, { error: 'Not signed in' });
  }

  try {
    const botName = requiredEnv('TG_BOT_USERNAME');
    const db = firestore();

    // 24 random bytes, url-safe: guessing one inside its 15 minutes is not a plan
    const code = crypto.randomBytes(18).toString('base64url');

    await db.collection('tgLinkCodes').doc(code).set({
      uid,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    });

    return json(200, {
      url: `https://t.me/${botName}?start=${code}`,
      expiresInMinutes: CODE_TTL_MINUTES,
    });
  } catch (error) {
    console.error('tg-link failed:', error);
    return json(500, { error: 'Could not create a link' });
  }
};

module.exports.CODE_TTL_MINUTES = CODE_TTL_MINUTES;
