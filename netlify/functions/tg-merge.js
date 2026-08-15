'use strict';

const { firestore, auth, requiredEnv, json } = require('./_shared');
const { checkInitData } = require('./tg-auth');

/**
 * Points a Telegram identity at an account the person already had.
 *
 * Without this, opening the Mini App for the first time silently forks a
 * learner in two: the dictionary they built on the web stays on the email
 * account while Telegram hands them a fresh empty one. They sign in by email
 * once, here, and the link moves.
 *
 * Both halves must be proven in the same call: the ID token says which email
 * account, the initData says which Telegram user. Trusting either alone would
 * let somebody claim an account that is not theirs.
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let botToken;
  try {
    botToken = requiredEnv('TG_BOT_TOKEN');
  } catch (e) {
    console.error('tg-merge misconfigured:', e && e.message);
    return json(500, { error: 'Telegram is not configured' });
  }

  const idToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'Not signed in' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad payload' });
  }

  const tgUser = checkInitData(body.initData, botToken);
  if (!tgUser || !tgUser.id) return json(401, { error: 'Bad initData' });

  let targetUid;
  try {
    targetUid = (await auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    return json(401, { error: 'Not signed in' });
  }

  try {
    const db = firestore();
    const telegramId = Number(tgUser.id);
    const throwaway = `tg_${telegramId}`;

    if (targetUid === throwaway) {
      // Already the same account; nothing to move
      return json(200, { merged: false, uid: targetUid });
    }

    const targetRef = db.collection('users').doc(targetUid);
    const target = await targetRef.get();
    if (!target.exists) return json(404, { error: 'Account not found' });

    const batch = db.batch();
    batch.set(targetRef, { telegramId, notificationsOff: false }, { merge: true });
    batch.set(db.collection('tgLinks').doc(String(telegramId)), {
      uid: targetUid,
      linkedAt: new Date().toISOString(),
      mergedFrom: throwaway,
    });
    await batch.commit();

    // The auto-made account only goes if it is genuinely empty. A learner who
    // studied inside Telegram before connecting keeps both, and their words
    // are not thrown away to tidy up a link.
    let removed = false;
    const throwawayRef = db.collection('users').doc(throwaway);
    const throwawaySnap = await throwawayRef.get();
    if (throwawaySnap.exists) {
      const words = await throwawayRef.collection('words').limit(1).get();
      const phrases = await throwawayRef.collection('phrases').limit(1).get();
      if (words.empty && phrases.empty) {
        await throwawayRef.delete();
        await auth().deleteUser(throwaway).catch(() => {});
        removed = true;
      }
    }

    return json(200, { merged: true, uid: targetUid, removedEmptyAccount: removed });
  } catch (error) {
    console.error('tg-merge failed:', error);
    return json(500, { error: 'Merge failed' });
  }
};
