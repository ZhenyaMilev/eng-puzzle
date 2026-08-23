'use strict';

/**
 * Знімок усього, що належить користувачеві: сам документ і підколекції.
 * Потрібен перед будь-яким видаленням — Firestore не має кошика, і те, що
 * стерли, повернути можна лише звідси.
 *
 *   node ops/backup-user.js <uid> [файл]
 */

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'engpuzzle-2d723';
const SUBCOLLECTIONS = ['words', 'phrases', 'folders', 'phraseFolders', 'customLessons', 'grammarQuestions', 'reports'];

async function main() {
  const [uid, target] = process.argv.slice(2);
  if (!uid) { console.error('Укажите uid.'); process.exit(1); }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);

  const snap = await ref.get();
  if (!snap.exists) { console.error('Документа нет:', uid); process.exit(1); }

  const dump = { uid, takenAt: new Date().toISOString(), user: snap.data(), collections: {} };
  for (const name of SUBCOLLECTIONS) {
    const docs = await ref.collection(name).get();
    if (docs.empty) continue;
    dump.collections[name] = docs.docs.map((d) => ({ id: d.id, data: d.data() }));
    console.log('%-18s %d', name, docs.size);
  }

  const file = target || path.join(__dirname, 'backups', `${uid}-${dump.takenAt.slice(0, 19).replace(/[:]/g, '')}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log('\nзаписано:', file);
  console.log('размер:', (fs.statSync(file).size / 1024).toFixed(0), 'КБ');
}

main().catch((e) => { console.error(e); process.exit(1); });
