'use strict';

const { firestore, auth, json } = require('./_shared');
const { callBot, escapeHtml } = require('./_telegram');

/**
 * A support request that actually reaches somebody.
 *
 * Writing it to Firestore alone meant it sat in a collection nobody opens.
 * It is stored *and* sent to the owner's Telegram, with the screenshots
 * attached, because a description of a broken screen is worth far less than
 * the screen.
 */

const MAX_MESSAGE = 2000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

function summary(body, user, uid) {
  return [
    '<b>Нове звернення в підтримку</b>',
    '',
    escapeHtml(String(body.message).slice(0, MAX_MESSAGE)),
    '',
    `<i>${escapeHtml(user.email || user.telegramName || 'без пошти')}</i>`,
    `<code>${escapeHtml(uid)}</code>`,
    `${escapeHtml(body.platform || '?')} · ${escapeHtml(body.version || '?')}`,
  ].join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Not signed in' });

  let uid;
  try {
    uid = (await auth().verifyIdToken(token)).uid;
  } catch (e) {
    return json(401, { error: 'Not signed in' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad payload' });
  }

  if (typeof body.message !== 'string' || !body.message.trim()) {
    return json(400, { error: 'Порожнє звернення' });
  }

  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  for (const image of images) {
    if (typeof image !== 'string' || Buffer.from(image, 'base64').length > MAX_IMAGE_BYTES) {
      return json(400, { error: 'Завелике зображення' });
    }
  }

  try {
    const db = firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    const user = userSnap.exists ? userSnap.data() : {};

    // Stored first: if Telegram is down or unconfigured, the request still exists
    const ref = await db.collection('supportRequests').add({
      uid,
      email: user.email || '',
      telegramId: user.telegramId || null,
      message: body.message.trim().slice(0, MAX_MESSAGE),
      imageCount: images.length,
      version: String(body.version || '').slice(0, 32),
      platform: String(body.platform || '').slice(0, 32),
      createdAt: new Date().toISOString(),
      status: 'new',
    });

    const owner = process.env.TG_SUPPORT_CHAT_ID;
    let delivered = false;
    if (owner) {
      try {
        await callBot('sendMessage', {
          chat_id: owner,
          text: summary(body, user, uid),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });

        for (const image of images) {
          // sendPhoto wants multipart; the bytes arrive base64 from the browser
          const form = new FormData();
          form.append('chat_id', String(owner));
          form.append('photo', new Blob([Buffer.from(image, 'base64')], { type: 'image/jpeg' }), 'screenshot.jpg');
          const response = await fetch(
            `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendPhoto`,
            { method: 'POST', body: form },
          );
          if (!response.ok) console.error('sendPhoto failed:', response.status);
        }
        delivered = true;
      } catch (e) {
        // The request is saved; a failed notification must not lose it
        console.error('Support notification failed:', e && e.message);
      }
    } else {
      console.error('TG_SUPPORT_CHAT_ID is not set — support request only stored');
    }

    await ref.update({ delivered });
    return json(200, { ok: true, delivered });
  } catch (error) {
    console.error('support failed:', error);
    return json(500, { error: 'Не вдалося надіслати' });
  }
};

module.exports.MAX_IMAGES = MAX_IMAGES;
module.exports.MAX_IMAGE_BYTES = MAX_IMAGE_BYTES;
