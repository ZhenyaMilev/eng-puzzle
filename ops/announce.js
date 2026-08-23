'use strict';

/**
 * Разова розсилка новин застосунку тим, хто підключив Telegram.
 *
 * Не чіпає тих, хто вимкнув нагадування: /stop означає «не пиши мені»,
 * і новина продукту — не виняток. Тихі години теж поважаємо: правило
 * живе в самому боті й існує саме для того, щоб не будити о пів на першу.
 *
 *   TG_BOT_TOKEN=... node ops/announce.js            — показати, що піде
 *   TG_BOT_TOKEN=... node ops/announce.js --apply    — надіслати
 *   ... --force                                      — попри тихі години
 */

const { initializeApp, applicationDefault } = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'engpuzzle-2d723';
const KYIV = 'Europe/Kyiv';
const QUIET_FROM = 22;
const QUIET_UNTIL = 9;

const TEXT = `<b>Що нового</b>

• Після тренування видно, на яких словах ви помилилися — і що було правильно. У всіх вправах, не лише в тесті.
• У «встав слово» до кожної помилки є пояснення, чому саме це слово.
• Кросворд: кнопка «Показати» — побачити відповідь, якщо застрягли.
• Кросворд складається зі слів, які ви вже вчили.
• Speaking Club радить слова з мовлення співрозмовника, а не ваші власні.
• Speaking Club більше не рахує коми помилками.
• Розмову можна завершити раніше за таймер.
• У конструкторі звук більше не підказує відповідь.
• У конструкторі фраз переклад можна набрати, а не тільки сказати.
• Картинки більше не зникають.
• На клавіатурі з'явилася кома.
• На комп'ютері слова можна набирати звичайною клавіатурою.`;

function kyivHour() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV, hour: '2-digit', hour12: false })
    .formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour').value;
  return Number(h === '24' ? '0' : h);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');

  const hour = kyivHour();
  const quiet = hour >= QUIET_FROM || hour < QUIET_UNTIL;

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const snap = await db.collection('users').where('telegramId', '>', 0).get();
  const targets = snap.docs.filter((d) => d.data().notificationsOff !== true);

  console.log('Київ: %d:00 %s', hour, quiet ? '(тихі години)' : '');
  console.log('отримають: %d із %d підключених\n', targets.length, snap.size);
  targets.forEach((d) => {
    const u = d.data();
    console.log('  ' + u.telegramId + '  ' + (u.email || u.telegramName || '?'));
  });
  console.log('\n--- текст ---\n' + TEXT.replace(/<[^>]+>/g, '') + '\n');

  if (!apply) { console.log('Це предпросмотр. Повторіть із --apply.'); return; }
  if (quiet && !force) {
    console.log('Тихі години — не надсилаю. --force, якщо це справді треба зараз.');
    return;
  }

  const token = process.env.TG_BOT_TOKEN;
  if (!token) { console.error('Немає TG_BOT_TOKEN.'); process.exit(1); }
  const miniApp = process.env.TG_MINIAPP_NAME;
  const botName = process.env.TG_BOT_USERNAME;
  const button = miniApp && botName
    ? [[{ text: 'Відкрити застосунок', url: `https://t.me/${botName}/${miniApp}` }]]
    : undefined;

  let sent = 0;
  for (const doc of targets) {
    const u = doc.data();
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: u.telegramId, text: TEXT, parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(button ? { reply_markup: { inline_keyboard: button } } : {}),
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.description);
      sent++;
      console.log('  ok  ' + u.telegramId);
    } catch (e) {
      // 403 — людина заблокувала бота; більше не турбуємо
      if (String(e.message).includes('blocked')) {
        await doc.ref.set({ notificationsOff: true }, { merge: true });
      }
      console.log('  fail ' + u.telegramId + ' — ' + e.message);
    }
  }
  console.log('\nнадіслано: %d', sent);
}

main().catch((e) => { console.error(e); process.exit(1); });
