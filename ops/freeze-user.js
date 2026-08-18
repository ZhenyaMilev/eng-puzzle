'use strict';

/**
 * Заморозка аккаунта — обратимая.
 *
 * Блокировки в приложении нет: единственные рычаги, которые понимают все
 * функции сразу, — это подписка и notificationsOff. Заморозка снимает
 * платный доступ (ai.js начинает отвечать 402) и глушит бота, но не трогает
 * ни словарь, ни прогресс, ни историю Speaking Club.
 *
 * Прежние значения складываются в поле freeze.before ровно в том виде,
 * в каком были, включая «поля не было вовсе» — иначе восстановление
 * добавило бы полю значение, которого там никогда не стояло.
 *
 *   node ops/freeze-user.js <uid> [<uid>...]            — показать, что будет
 *   node ops/freeze-user.js <uid> [<uid>...] --apply    — применить
 *
 * Снять заморозку: ops/unfreeze-user.js
 */

const { initializeApp, applicationDefault } = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'engpuzzle-2d723';
const ABSENT = '__absent__';

// Поля, которые заморозка меняет, — и только они попадают в снапшот
const FROZEN = {
  lifetime: false,
  subscriptionExpiration: new Date('2000-01-01T00:00:00Z'),
  notificationsOff: true,
};

function snapshotOf(data) {
  const before = {};
  for (const field of Object.keys(FROZEN)) {
    before[field] = Object.prototype.hasOwnProperty.call(data, field) ? data[field] : ABSENT;
  }
  return before;
}

function describe(value) {
  if (value === ABSENT) return '(поля нет)';
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return JSON.stringify(value);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const uids = args.filter((a) => !a.startsWith('--'));

  if (!uids.length) {
    console.error('Укажите хотя бы один uid.');
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  for (const uid of uids) {
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log(`\n${uid}\n  документа нет — пропускаю`);
      continue;
    }

    const data = snap.data();

    if (data.freeze) {
      console.log(`\n${uid}\n  уже заморожен ${data.freeze.frozenAt} — пропускаю,`
        + ' иначе снапшот затёрся бы уже замороженными значениями');
      continue;
    }

    const before = snapshotOf(data);
    console.log(`\n${uid}  (${data.email || 'без почты'}${data.nickname ? ', @' + data.nickname : ''})`);
    for (const field of Object.keys(FROZEN)) {
      console.log(`  ${field}: ${describe(before[field])}  ->  ${describe(FROZEN[field])}`);
    }

    if (!apply) continue;

    await ref.set({
      ...FROZEN,
      freeze: { frozenAt: new Date().toISOString(), before },
    }, { merge: true });
    console.log('  применено');
  }

  console.log(apply ? '\nГотово.' : '\nЭто предпросмотр. Повторите с --apply, чтобы применить.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
