'use strict';

/**
 * Чистить акаунт до нуля і засіває новий словник.
 *
 * Підписку, прив'язку до Telegram і налаштування не чіпає — стирається
 * лише те, що людина наробила: словник, фрази, папки, XP, серія, рекорди,
 * граматика та історія Speaking Club.
 *
 * Перед запуском обов'язково ops/backup-user.js — у Firestore немає кошика.
 *
 *   node ops/reset-and-seed.js <uid>            — показати, що буде
 *   node ops/reset-and-seed.js <uid> --apply    — виконати
 */

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const PROJECT_ID = 'engpuzzle-2d723';
const WIPE_COLLECTIONS = ['words', 'phrases', 'folders', 'phraseFolders', 'customLessons', 'grammarQuestions', 'reports'];

// Усе, що є слідом занять. Підписка, пошта, telegramId і learningProfile — ні.
const WIPE_FIELDS = ['xp', 'xpHistory', 'streak', 'bestStreak', 'bestDailyXP', 'lastActiveDate',
  'speedRecord', 'wordCount', 'phraseCount', 'dailyWords', 'grammarProgress', 'grammarTheoryRead',
  'scHistory', 'scMemory'];

/** Ідентифікатор фрази — той самий вигляд, що вже лежить у базі. */
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function loadSeed() {
  const words = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'words.json'), 'utf-8'));
  const phrases = fs.readFileSync(path.join(__dirname, 'seed', 'phrases.txt'), 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map((line) => {
      const [english, translation] = line.split('|');
      return { english: english.trim(), translation: (translation || '').trim() };
    });
  return { words, phrases };
}

async function deleteAll(ref, name, apply) {
  const docs = await ref.collection(name).get();
  if (docs.empty) return 0;
  if (apply) {
    for (let i = 0; i < docs.docs.length; i += 400) {
      const batch = ref.firestore.batch();
      docs.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  return docs.size;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const uid = args.find((a) => !a.startsWith('--'));
  if (!uid) { console.error('Укажите uid.'); process.exit(1); }

  const { words, phrases } = loadSeed();

  // Той самий вислів у двох підбірках — одна картка, а не дві
  const ids = new Map();
  phrases.forEach((p, i) => ids.set(slug(p.english) || `phrase_${i}`, p));

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);

  const before = await ref.get();
  if (!before.exists) { console.error('Документа нет:', uid); process.exit(1); }
  const user = before.data();

  console.log('=== будет стёрто ===');
  for (const name of WIPE_COLLECTIONS) {
    const n = await deleteAll(ref, name, apply);
    if (n) console.log(`  ${name}: ${n}`);
  }
  const hit = WIPE_FIELDS.filter((f) => f in user);
  console.log('  поля:', hit.join(', ') || 'нет');

  console.log('\n=== останется нетронутым ===');
  for (const f of ['email', 'telegramId', 'nickname', 'lifetime', 'subscriptionExpiration', 'learningProfile', 'scConfig'])
    if (f in user) console.log(`  ${f}`);

  console.log(`\n=== будет добавлено ===\n  слов: ${Object.keys(words).length}\n  фраз: ${ids.size}`);

  if (!apply) { console.log('\nЭто предпросмотр. Повторите с --apply.'); return; }

  const now = Timestamp.now();
  const clear = {};
  hit.forEach((f) => { clear[f] = FieldValue.delete(); });
  await ref.set(clear, { merge: true });

  const entries = Object.entries(words);
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    entries.slice(i, i + 400).forEach(([english, translation]) => {
      batch.set(ref.collection('words').doc(english), {
        translation, example: '', interactions: 0, correctAnswers: 0,
        priority: 0, folders: [], dateAdded: now,
      });
    });
    await batch.commit();
  }

  const phraseEntries = [...ids.entries()];
  for (let i = 0; i < phraseEntries.length; i += 400) {
    const batch = db.batch();
    phraseEntries.slice(i, i + 400).forEach(([id, p]) => {
      batch.set(ref.collection('phrases').doc(id), {
        english: p.english, translation: p.translation, example: '', keyWord: '',
        interactions: 0, correctAnswers: 0, priority: 0, dateAdded: now,
      });
    });
    await batch.commit();
  }

  await ref.set({ wordCount: entries.length, phraseCount: phraseEntries.length }, { merge: true });
  console.log('\nГотово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
