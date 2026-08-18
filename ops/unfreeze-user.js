'use strict';

/**
 * Снятие заморозки — возвращает поля ровно в то состояние, что записал
 * freeze-user.js. Поля, которых до заморозки не было, удаляются, а не
 * ставятся в false: иначе документ навсегда сохранил бы след блокировки.
 *
 *   node ops/unfreeze-user.js <uid> [<uid>...]            — показать, что вернётся
 *   node ops/unfreeze-user.js <uid> [<uid>...] --apply    — применить
 */

const { initializeApp, applicationDefault } = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'engpuzzle-2d723';
const ABSENT = '__absent__';

function describe(value) {
  if (value === ABSENT) return '(удалить поле)';
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

    const freeze = snap.data().freeze;
    if (!freeze || !freeze.before) {
      console.log(`\n${uid}\n  снапшота нет — аккаунт не был заморожен этим скриптом`);
      continue;
    }

    console.log(`\n${uid}  (заморожен ${freeze.frozenAt})`);
    const restore = { freeze: FieldValue.delete() };
    for (const [field, value] of Object.entries(freeze.before)) {
      console.log(`  ${field}: ${describe(value)}`);
      restore[field] = value === ABSENT ? FieldValue.delete() : value;
    }

    if (!apply) continue;

    await ref.set(restore, { merge: true });
    console.log('  восстановлено');
  }

  console.log(apply ? '\nГотово.' : '\nЭто предпросмотр. Повторите с --apply, чтобы применить.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
