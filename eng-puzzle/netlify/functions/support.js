'use strict';

const { firestore, auth, json } = require('./_shared');
const { uploadToR2 } = require('./_r2');

/**
 * A support request that reaches somebody who can act on it.
 *
 * It used to go straight to the owner's Telegram with the screenshots
 * attached — which meant every "the button is cut off" waited for a human to
 * read it, and the screenshots existed only inside a chat, where no agent and
 * no dashboard could reach them.
 *
 * Now the screenshots go to R2 and the request goes to the agent farm, which
 * triages it: an interface fix it makes itself, and anything outside its remit
 * — money, accounts, questions — is passed to the owner untouched. Telegram
 * still hears about it, but afterwards, and from the agent.
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

    // Скриншоты — в R2: ссылка проходит и в JSON, и в строку БД, и в промпт
    const imageUrls = [];
    for (const [index, image] of images.entries()) {
      try {
        const url = await uploadToR2(
          `support/${ref.id}/${index + 1}.jpg`,
          Buffer.from(image, 'base64'),
          'image/jpeg',
        );
        imageUrls.push(url);
      } catch (e) {
        // Потерять скриншот неприятно, потерять обращение — хуже
        console.error('R2 upload failed:', e && e.message);
      }
    }
    if (imageUrls.length) await ref.update({ imageUrls });

    const intake = process.env.SUPPORT_INTAKE_URL;
    const intakeKey = process.env.SUPPORT_INTAKE_KEY;
    let delivered = false;
    if (intake && intakeKey) {
      try {
        const response = await fetch(intake, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-intake-key': intakeKey },
          body: JSON.stringify({
            requestId: ref.id,
            uid,
            email: user.email || '',
            telegramId: user.telegramId || null,
            message: body.message.trim().slice(0, MAX_MESSAGE),
            imageUrls,
            platform: String(body.platform || '').slice(0, 32),
            version: String(body.version || '').slice(0, 32),
          }),
        });
        delivered = response.ok;
        if (!response.ok) console.error('Support intake failed:', response.status);
      } catch (e) {
        // Обращение уже в Firestore; недоставленное уведомление его не теряет
        console.error('Support intake failed:', e && e.message);
      }
    } else {
      console.error('SUPPORT_INTAKE_URL/KEY are not set — support request only stored');
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
