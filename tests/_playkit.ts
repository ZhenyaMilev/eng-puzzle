import { Page, Route } from '@playwright/test';

/** Shared scratch helpers for the walk-through rounds. */

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBhgAGrEB/6xkAKQAAAAASUVORK5CYII=';

const PAIRS: [string, string][] = [
  ['house', 'будинок'], ['water', 'вода'], ['bread', 'хліб'], ['friend', 'друг'], ['school', 'школа'],
  ['teacher', 'вчитель'], ['window', 'вікно'], ['garden', 'сад'], ['river', 'річка'], ['mountain', 'гора'],
  ['flower', 'квітка'], ['bridge', 'міст'], ['summer', 'літо'], ['winter', 'зима'], ['morning', 'ранок'],
  ['evening', 'вечір'], ['coffee', 'кава'], ['sugar', 'цукор'], ['table', 'стіл'], ['chair', 'стілець'],
  ['street', 'вулиця'], ['market', 'ринок'], ['doctor', 'лікар'], ['letter', 'лист'], ['number', 'число'],
  ['answer', 'відповідь'], ['office', 'офіс'], ['travel', 'подорож'], ['island', 'острів'], ['forest', 'ліс'],
  ['pocket', 'кишеня'], ['silver', 'срібло'], ['danger', 'небезпека'], ['memory', 'спогад'], ['picture', 'картина'],
  ['kitchen', 'кухня'], ['weather', 'погода'], ['holiday', 'свято'], ['machine', 'машина'], ['village', 'село'],
];

export const TRANS: Record<string, string> = Object.fromEntries(PAIRS);
const WORDS = PAIRS.map(([en]) => en);

export function vocab(n = PAIRS.length) {
  const out: any = {};
  PAIRS.slice(0, n).forEach(([en, ua], i) => {
    // correct answers never exceed interactions — otherwise the word card
    // shows things no real account can hold
    const interactions = i % 4;
    out[en] = {
      translation: ua, example: '', folders: [],
      interactions, correctAnswers: Math.min(i % 3, interactions), priority: i,
      dateAdded: { seconds: 10000 - i },
    };
  });
  return out;
}

/** A dictionary big enough to page through. */
export function bigVocab(n: number) {
  const out: any = {};
  for (let i = 0; i < n; i++) {
    const base = PAIRS[i % PAIRS.length];
    const word = i < PAIRS.length ? base[0] : `${base[0]}${i}`;
    const interactions = i % 5;
    out[word] = {
      translation: i < PAIRS.length ? base[1] : `${base[1]} ${i}`,
      example: '', folders: [],
      interactions, correctAnswers: Math.min(i % 4, interactions), priority: i % 7,
      dateAdded: { seconds: 100000 - i },
    };
  }
  return out;
}

/** Answers every AI route with something shaped the way the app expects. */
export async function smartAi(page: Page, seen: string[] = []) {
  const json = (route: Route, body: any) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/.netlify/functions/ai', async (route) => {
    const sent = route.request().postDataJSON() || {};
    const body = sent.body || {};
    if (sent.route === 'image') return json(route, { results: [{ urls: { small: `data:image/png;base64,${TINY_PNG}` } }] });
    if (sent.route === 'speech') return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from('ID3') });
    if (sent.route === 'transcription') return json(route, { text: 'I like to travel in summer' });

    const prompt = (body.messages || [])
      .map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    seen.push(prompt.slice(0, 120));
    const asked = WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(prompt));
    const some = (n: number) => (asked.length ? asked : WORDS).slice(0, n);

    let content = '{}';
    if (/named Sam chatting casually/.test(prompt)) {
      content = 'Nice! I love the mountains too. Which one did you climb?';
    } else if (/Generate exactly 60 different English words/.test(prompt)) {
      const extra = ['negotiate', 'lantern', 'shade', 'harbour', 'ledge', 'stroll', 'clutter', 'brisk', 'vivid', 'mellow'];
      content = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ word: `${extra[i % extra.length]}${i < 10 ? '' : i}`, translation: 'переклад ' + i })));
    } else if (/generative-text/.test(prompt)) {
      const used = some(12).map((w) => `<span class="highlight">${w}</span>`).join(' and the ');
      content = `<div class="generative-text"><h3>A day to remember</h3><p>Once there was a ${used}. And the story went on for a good while after that.</p></div>`;
    } else if (/JSON array with exactly 10 objects/.test(prompt)) {
      const ua = /sentences in Ukrainian/.test(prompt);
      content = JSON.stringify(some(10).map((w) => ({
        sentence: ua ? 'Я бачив ___ вчора.' : 'I saw the ___ yesterday.',
        word: w, translation: TRANS[w] || 'переклад',
      })));
    } else if (/Generate short definitions/.test(prompt)) {
      content = JSON.stringify(some(10).map((w) => ({ word: w, translation: TRANS[w] || 'переклад', definition: 'Something you can see every day.' })));
    } else if (/"correct": true or false/.test(prompt)) {
      content = JSON.stringify({ correct: true, note: 'Гарний варіант!' });
    } else if (/Return ONLY a JSON array of strings/.test(prompt)) {
      content = /to English/.test(prompt) ? JSON.stringify(['lantern', 'lamp']) : JSON.stringify(['ліхтар', 'лампа']);
    } else if (/Extract all words from this image/.test(prompt)) {
      content = JSON.stringify([{ english: 'shade', translation: 'тінь' }, { english: 'lantern', translation: 'ліхтар' }]);
    } else if (/Extract useful English phrases/.test(prompt)) {
      content = JSON.stringify([{ english: 'Take a seat', translation: 'Сідайте' }, { english: 'Slow down', translation: 'Пригальмуйте' }]);
    } else if (/pages/i.test(prompt)) {
      content = JSON.stringify({
        title: 'Present Simple',
        level: 'A1',
        pages: [
          { heading: 'Основа', paragraphs: ['Це про **звички**.'], examples: [{ en: 'I work here.', uk: 'Я тут працюю.' }] },
          { heading: 'Заперечення', paragraphs: ['З do not.'], examples: [{ en: 'I do not work.', uk: 'Я не працюю.' }] },
        ],
        quiz: [
          { question: 'Обери правильне', options: ['I works', 'I work', 'I working', 'I am work'], correct: 1, optionExplanations: ['', '', '', ''] },
          { question: 'Заперечення', options: ['I not work', 'I do not work', 'I no work', 'I don work'], correct: 1, optionExplanations: ['', '', '', ''] },
        ],
      });
    } else if (/"question"/.test(prompt) || /questions/i.test(prompt)) {
      content = JSON.stringify([
        { question: 'What is the story about?', options: ['A day', 'A car', 'A pen', 'A cat'], correct: 0 },
        { question: 'Who is there?', options: ['Nobody', 'Somebody', 'Anybody', 'Everybody'], correct: 1 },
      ]);
    } else if (/Translate to Ukrainian/.test(prompt)) {
      content = 'переклад речення';
    } else if (/Translate this Ukrainian word\/phrase to English/.test(prompt)) {
      content = 'translated';
    } else if (/private profile/.test(prompt)) {
      content = 'Name: Evgen. Likes cycling.';
    } else if (/errors/.test(prompt) && /summary/.test(prompt)) {
      content = JSON.stringify({ errors: [{ was: 'I go yesterday', fix: 'I went yesterday', why: 'минулий час' }], words: ['journey'], phrases: ['take a seat'], grammar: ['Past Simple'], summary: 'Непогано!' });
    } else {
      content = 'Hey! Tell me more about that.';
    }
    return json(route, { choices: [{ message: { content } }] });
  });
}

export function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));
  return { errors, dumpAndClear() { const c = [...errors]; errors.length = 0; return c; } };
}

const SHOTS = '/private/tmp/claude-501/-Users-macbookair-Pet-projects-eng-app/90f8132a-4ba3-48c9-82e8-c059bba4d4a8/scratchpad/shots';

export async function report(page: Page, w: any, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  const s = await page.evaluate(() => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const roots = Array.from(document.querySelectorAll('[id]')).filter((el) =>
      /(-section|-screen|-modal|Popup|-popup)$/.test(el.id) && vis(el) && (el as HTMLElement).innerText.trim());
    const top = roots[roots.length - 1] as HTMLElement;
    return {
      screen: top?.id || null,
      text: top ? top.innerText.replace(/\n{2,}/g, '\n').trim().slice(0, 900) : '',
      notify: Array.from(document.querySelectorAll('.notification, .toast')).filter(vis).map((n) => (n as HTMLElement).innerText.trim()),
    };
  });
  const errs = w.dumpAndClear();
  console.log(`\n───── ${name} ─────\nscreen: ${s.screen}`);
  if (s.notify.length) console.log('notify:', s.notify.join(' | '));
  console.log('text:', s.text);
  if (errs.length) console.log('!! ERRORS:\n  ' + errs.join('\n  '));
  return s;
}
