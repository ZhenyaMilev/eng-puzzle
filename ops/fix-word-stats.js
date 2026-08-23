'use strict';

/**
 * Добудовує поля, без яких відбір слів не бачить слова взагалі.
 *
 * Firestore мовчки викидає з orderBy документи без потрібного поля. Тому
 * слово без priority невидиме для добору за складністю, а слово без
 * lastInteractionDate — для добору за давністю повторення. Воно лежить у
 * словнику, рахується в статистиці й не трапляється в тренуваннях ніколи.
 *
 * Нічого не перезаписує: чіпає лише те, чого немає.
 *
 *   node ops/fix-word-stats.js            — показати, що буде
 *   node ops/fix-word-stats.js --apply    — виконати
 */

const { initializeApp, applicationDefault } = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'engpuzzle-2d723';
const BATCH = 400;

async function main() {
  const apply = process.argv.includes('--apply');

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const users = await db.collection('users').get();
  let touchedUsers = 0;
  let fixedPriority = 0;
  let fixedLast = 0;
  const pending = [];

  for (const user of users.docs) {
    const words = await user.ref.collection('words').get();
    if (words.empty) continue;
    let here = 0;

    for (const doc of words.docs) {
      const w = doc.data();
      const patch = {};

      if (w.priority === undefined) {
        const interactions = Number(w.interactions || 0);
        // Частка правильних; у слова, якого ще не показували, вона нульова
        patch.priority = interactions > 0 ? Number(w.correctAnswers || 0) / interactions : 0;
        fixedPriority++;
      }

      // Слово тренували, але коли — не записали. Ставимо дату додавання:
      // точнішого ми не знаємо, і помилка тут у безпечний бік — слово
      // виглядає давно не повтореним і повернеться раніше, а не пізніше.
      if (Number(w.interactions || 0) > 0 && !w.lastInteractionDate) {
        patch.lastInteractionDate = w.dateAdded || new Date();
        fixedLast++;
      }

      if (Object.keys(patch).length) {
        pending.push({ ref: doc.ref, patch });
        here++;
      }
    }

    if (here) {
      touchedUsers++;
      console.log('  %s%s — %d слів', user.id, user.data().email ? ' (' + user.data().email + ')' : '', here);
    }
  }

  console.log('\nкористувачів: %d | полів priority: %d | полів lastInteractionDate: %d',
    touchedUsers, fixedPriority, fixedLast);

  if (!apply) { console.log('\nЦе предпросмотр. Повторіть із --apply.'); return; }

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = db.batch();
    pending.slice(i, i + BATCH).forEach(({ ref, patch }) => batch.set(ref, patch, { merge: true }));
    await batch.commit();
  }
  console.log('\nОновлено документів: %d', pending.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
