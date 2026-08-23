'use strict';

const { firestore, json } = require('./_shared');
const {
  sendMessage, openAppButton, verifyWebhookSecret, toDate, daysBetween, escapeHtml,
} = require('./_telegram');

/**
 * Everything Telegram sends the bot arrives here.
 *
 * The secret header is checked first and without exception: the URL is public,
 * so without it anyone could post a forged update and, with a guessed code,
 * attach their Telegram account to someone else's dictionary.
 */

const HELP = [
  '/status — скільки лишилось підписки та яка зараз серія',
  '/stop — вимкнути нагадування',
  '/start — знову увімкнути нагадування',
].join('\n');

async function findUid(db, telegramId) {
  const link = await db.collection('tgLinks').doc(String(telegramId)).get();
  return link.exists ? link.data().uid : null;
}

/**
 * Turns a one-time code into a permanent link between the two accounts.
 * Both directions and the deletion happen together, so neither a crash nor a
 * second /start can leave a half-linked account behind.
 */
async function redeemCode(db, code, telegramId, chat) {
  const codeRef = db.collection('tgLinkCodes').doc(code);

  // Read and burn in one transaction. A read followed by a batch leaves a
  // window where two /start calls both see an unspent code; 144 bits of
  // entropy make that unreachable by guessing, but a leaked link is not a
  // guess, and a transaction costs nothing here.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef);
    if (!snap.exists) return { ok: false, reason: 'unknown' };

    const data = snap.data();
    const expiresAt = toDate(data.expiresAt);
    if (expiresAt && expiresAt < new Date()) {
      tx.delete(codeRef);
      return { ok: false, reason: 'expired' };
    }

    tx.set(db.collection('users').doc(data.uid), {
      telegramId: Number(telegramId),
      telegramName: chat && chat.first_name ? String(chat.first_name).slice(0, 64) : '',
      notificationsOff: false,
    }, { merge: true });
    tx.set(db.collection('tgLinks').doc(String(telegramId)), {
      uid: data.uid,
      linkedAt: new Date().toISOString(),
    });
    tx.delete(codeRef);

    return { ok: true, uid: data.uid };
  });
}

async function handleStart(db, message, code) {
  const chatId = message.chat.id;
  const telegramId = message.from.id;

  if (code) {
    const result = await redeemCode(db, code, telegramId, message.from);
    if (result.ok) {
      return sendMessage(chatId,
        '<b>Готово — акаунт підключено.</b>\n\n'
        + 'Тепер я нагадаю, коли серія під загрозою і коли закінчується підписка. '
        + 'Вимкнути будь-коли: /stop',
        [openAppButton('Відкрити застосунок')]);
    }
    const why = result.reason === 'expired'
      ? 'Це посилання застаріло — воно живе 15 хвилин.'
      : 'Це посилання вже використали або воно неправильне.';
    return sendMessage(chatId,
      `${why}\n\nВідкрийте застосунок і натисніть «Підключити Telegram» ще раз.`,
      [openAppButton('Відкрити застосунок')]);
  }

  // /start without a code from someone already linked means "turn me back on"
  const uid = await findUid(db, telegramId);
  if (uid) {
    await db.collection('users').doc(uid).set({ notificationsOff: false }, { merge: true });
    return sendMessage(chatId,
      'Нагадування знову увімкнені.\n\n' + HELP,
      [openAppButton('Відкрити застосунок')]);
  }

  return sendMessage(chatId,
    '<b>Мій словник</b> — англійська через власний словник.\n\n'
    + 'Щоб отримувати нагадування, відкрийте застосунок і натисніть «Підключити Telegram».',
    [openAppButton('Відкрити застосунок')]);
}

async function handleStop(db, message) {
  const uid = await findUid(db, message.from.id);
  if (!uid) {
    return sendMessage(message.chat.id, 'Цей чат ще не підключений до акаунта — вимикати нічого.');
  }
  await db.collection('users').doc(uid).set({ notificationsOff: true }, { merge: true });
  return sendMessage(message.chat.id,
    'Нагадування вимкнені. Ваші дані та підписка не змінилися.\n\nУвімкнути назад: /start');
}

async function handleStatus(db, message) {
  const uid = await findUid(db, message.from.id);
  if (!uid) {
    return sendMessage(message.chat.id,
      'Спочатку підключіть акаунт: відкрийте застосунок і натисніть «Підключити Telegram».',
      [openAppButton('Відкрити застосунок')]);
  }

  const snap = await db.collection('users').doc(uid).get();
  const user = snap.exists ? snap.data() : {};

  let subscription;
  if (user.lifetime === true) {
    subscription = 'Підписка: <b>PRO назавжди</b>';
  } else {
    const until = toDate(user.subscriptionExpiration);
    const left = until ? daysBetween(new Date(), until) : 0;
    subscription = left > 0
      ? `Підписка: активна ще <b>${left} дн.</b> (до ${until.toISOString().slice(0, 10)})`
      : 'Підписка: <b>завершилася</b>';
  }

  const streak = Number(user.streak || 0);
  const words = Number(user.wordCount || 0);

  return sendMessage(message.chat.id,
    [
      `Акаунт: ${escapeHtml(user.email || 'без пошти')}`,
      subscription,
      `Серія: <b>${streak}</b> дн. поспіль`,
      words ? `Слів у словнику: <b>${words}</b>` : null,
      '',
      HELP,
    ].filter(Boolean).join('\n'),
    [openAppButton('Відкрити застосунок')]);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    if (!verifyWebhookSecret(event.headers || {})) {
      console.error('Rejected a webhook call with a bad secret');
      return json(403, { error: 'Forbidden' });
    }
  } catch (e) {
    console.error('tg-webhook misconfigured:', e && e.message);
    return json(500, { error: 'Telegram is not configured' });
  }

  let update;
  try {
    update = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad payload' });
  }

  const message = update.message || update.edited_message;
  if (!message || !message.text || !message.from || !message.chat) {
    // Telegram retries anything that is not answered with 200
    return json(200, { ok: true });
  }

  try {
    const db = firestore();
    const text = message.text.trim();
    const [command, argument] = text.split(/\s+/, 2);

    switch (command.split('@')[0]) {
      case '/start':
        await handleStart(db, message, argument);
        break;
      case '/stop':
        await handleStop(db, message);
        break;
      case '/status':
        await handleStatus(db, message);
        break;
      default:
        await sendMessage(message.chat.id, HELP, [openAppButton('Відкрити застосунок')]);
    }
  } catch (error) {
    // Never make Telegram retry: it would replay the same command for hours
    console.error('tg-webhook failed:', error);
  }

  return json(200, { ok: true });
};

module.exports.redeemCode = redeemCode;
module.exports.findUid = findUid;
module.exports.HELP = HELP;
