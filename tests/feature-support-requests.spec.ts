import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');
const html = () => readFileSync(INDEX, 'utf-8');

/** Правки за зверненнями в підтримку від 18–19 серпня. */

test.describe('«Не вистачає пояснення чого так після перевірки»', () => {
  test('the model is asked for the reason, not just the word', () => {
    const src = html();
    expect(src.split('"hint": "коротке українське пояснення').length).toBe(3); // обидва напрямки
  });

  test('the reason travels into the breakdown', () => {
    const src = html();
    const check = src.slice(src.indexOf('function checkFillBlanksAnswers'));
    expect(check.slice(0, 900)).toContain('source.hint');
  });

  test('a mistake row shows its explanation', async ({ page }) => {
    await loadApp(page);
    const out = await page.evaluate(() => (window as any).renderMistakes([
      { english: 'threshold', translation: 'поріг', given: 'range', note: 'Тут ідеться про межу суми замовлення.' },
    ]));
    expect(out).toContain('Тут ідеться про межу суми замовлення.');
    expect(out).toContain('mistake-note');
  });

  test('a row without an explanation renders no empty box', async ({ page }) => {
    await loadApp(page);
    const out = await page.evaluate(() => (window as any).renderMistakes([
      { english: 'threshold', translation: 'поріг', given: 'range' },
    ]));
    expect(out).not.toContain('mistake-note');
  });
});

test.describe('«Розділові знаки тут ні до чого»', () => {
  const same = (page: Page, a: string, b: string) =>
    page.evaluate(([x, y]) => (window as any).scSameUtterance(x, y), [a, b]);

  test('a "correction" that only adds a full stop is not a mistake', async ({ page }) => {
    await loadApp(page);
    expect(await same(page, "that's all", "that's all.")).toBe(true);
    expect(await same(page, 'Okay so I went there', 'Okay, so I went there.')).toBe(true);
    expect(await same(page, 'i like it', 'I like it')).toBe(true);
  });

  test('a real correction still counts', async ({ page }) => {
    await loadApp(page);
    expect(await same(page, 'I like spin', 'I like spinning')).toBe(false);
    expect(await same(page, "I don't have many time", "I don't have much time")).toBe(false);
  });

  test('the parser drops the empty ones', () => {
    const src = html();
    expect(src).toContain('!scSameUtterance(e.original, e.corrected)');
  });
});

test.describe('«Пропонувати слова, які використовує аі»', () => {
  test('the analysis now sees the partner, not only the learner', () => {
    const src = html();
    expect(src).toContain("scChatHistory.filter(m => m.role === 'assistant')");
    expect(src).toContain('WHAT THE PARTNER SAID');
  });

  test('words the learner already used correctly are ruled out', () => {
    const src = html();
    const rule = src.slice(src.indexOf('- "words": ALWAYS return'));
    expect(rule.slice(0, 700)).toContain('NEVER suggest a word the learner already used correctly');
    expect(rule.slice(0, 700)).toContain('the PARTNER used that are less common');
  });
});

test.describe('«В кроссворде не хватает посмотреть, как правильно»', () => {
  test('the crossword offers to show the answer', () => {
    const src = html();
    expect(src).toContain('onclick="revealCrossword()"');
    expect(src).toContain('function revealCrossword()');
  });

  test('what was revealed is told apart from what was solved', () => {
    const src = html();
    const fn = src.slice(src.indexOf('function revealCrossword()'));
    expect(fn.slice(0, 1200)).toContain("classList.add('revealed')");
    expect(fn.slice(0, 1200)).toContain("input.value.toUpperCase() === correct");
    expect(src).toContain('.crossword-cell input.revealed');
  });

  test('a clean grid is told there is nothing to reveal', () => {
    const src = html();
    const fn = src.slice(src.indexOf('function revealCrossword()'));
    expect(fn.slice(0, 1600)).toContain('Усе вже правильно');
  });
});

/** Звернення від 19–22 серпня. */

test.describe('«Возможность закончить спикинг клаб быстрее»', () => {
  test('the chat screen has a way out before the timer', () => {
    const src = html();
    const chat = src.slice(src.indexOf('id="sc-chat-screen"'), src.indexOf('id="sc-analysis-screen"'));
    expect(chat).toContain('onclick="scEndEarly()"');
  });

  test('leaving early still goes through the analysis', () => {
    const src = html();
    const fn = src.slice(src.indexOf('async function scEndEarly()'));
    expect(fn.slice(0, 700)).toContain('scEndChat()');
  });

  test('a conversation too short to analyse is refused', () => {
    const src = html();
    const fn = src.slice(src.indexOf('async function scEndEarly()'));
    expect(fn.slice(0, 700)).toContain('scMessageCount < 2');
  });
});

test.describe('«Кроссворд по изученным словам только»', () => {
  test('a word never seen is set aside', () => {
    const src = html();
    const fn = src.slice(src.indexOf('async function generateNewCrossword()'));
    expect(fn.slice(0, 2500)).toContain("Number(doc.data().interactions || 0) > 0");
    expect(fn.slice(0, 2500)).toContain('untouched');
  });

  test('a brand-new dictionary still gets a crossword', () => {
    const src = html();
    const fn = src.slice(src.indexOf('async function generateNewCrossword()'));
    expect(fn.slice(0, 2500)).toContain('CROSSWORD_MIN');
    expect(fn.slice(0, 2500)).toContain('untouched.slice(0, CROSSWORD_MIN - wordsArray.length)');
  });
});

test.describe('«У клавіатурі немає коми»', () => {
  test('the input keyboard offers a comma for a second translation', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showAddWord());
    await page.click('#translation');
    await expect(page.locator('#input-keyboard .cw-key[data-letter=","]')).toBeVisible();
  });

  test('it types into the field like any other key', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showAddWord());
    await page.click('#translation');
    await page.click('#input-keyboard .cw-key[data-letter=","]');
    expect(await page.inputValue('#translation')).toContain(',');
  });

  test('the crossword keyboard stays letters-only', () => {
    const src = html();
    const kb = src.slice(src.indexOf('function renderCrosswordKeyboard()'));
    expect(kb.slice(0, 900)).not.toContain("data-letter=\",\"");
  });
});

test.describe('«Озвучка зачитывает англ слово и подсказывает ответ» — конструктор', () => {
  test('the speaker no longer reads the answer aloud', () => {
    const src = html();
    const q = src.slice(src.indexOf('function showConstructorQuestion'));
    expect(q.slice(0, 1600)).not.toContain('speakWord(${jsArg(questionWord.english)}, this)');
    expect(q.slice(0, 1600)).toContain('speakConstructorPrompt(');
  });

  /** Озвучок було дві — кнопка і автозапуск. Лишилася одна, на вимогу. */
  test('there is one playback, not two', () => {
    const src = html();
    const q = src.slice(src.indexOf('function showConstructorQuestion'),
                        src.indexOf('function getFullKeyboardLetters'));
    expect(q).not.toContain('kokoroSpeak(questionWord.english');
    expect(q.match(/speakConstructorPrompt\(/g) || []).toHaveLength(1);
  });

  test('nothing speaks before the word is even asked for', () => {
    const src = html();
    const q = src.slice(src.indexOf('function showConstructorQuestion'),
                        src.indexOf('function getFullKeyboardLetters'));
    expect(q).not.toContain('speakConstructorPrompt(questionWord);');
  });

  test('uk → en reads the Ukrainian side, with the Ukrainian voice', async ({ page }) => {
    await loadApp(page);
    const spoken = await page.evaluate(() => {
      const w: any = { english: 'animal', translation: 'тварина' };
      (window as any).setConstructorDirection('uk-en');
      return {
        shown: (window as any).constructorAsking(w),
        lang: (window as any).constructorAskingLang(w),
        expected: (window as any).constructorExpected(w),
      };
    });
    expect(spoken.shown).toBe('тварина');
    expect(spoken.lang).toBe('uk');
    expect(spoken.expected).toBe('animal');
  });

  test('en → uk still reads the English prompt', async ({ page }) => {
    await loadApp(page);
    const spoken = await page.evaluate(() => {
      const w: any = { english: 'animal', translation: 'тварина' };
      (window as any).setConstructorDirection('en-uk');
      return {
        shown: (window as any).constructorAsking(w),
        lang: (window as any).constructorAskingLang(w),
      };
    });
    expect(spoken.shown).toBe('animal');
    expect(spoken.lang).toBe('en');
  });

  test('a pair stored the wrong way round is read by its letters, not its field', async ({ page }) => {
    await loadApp(page);
    const lang = await page.evaluate(() => {
      // english холдить українське слово — таке в базі трапляється
      const w: any = { english: 'тварина', translation: 'animal' };
      (window as any).setConstructorDirection('uk-en');
      return (window as any).constructorAskingLang(w);
    });
    expect(lang).toBe('uk');
  });
});

test.describe('«Картинки постоянно в таком виде»', () => {
  test('the dead placeholder domain is gone', () => {
    const src = html();
    const code = src.slice(src.indexOf('async function showPictureQuestion'));
    expect(code.slice(0, 2000)).not.toContain('via.placeholder.com');
  });

  test('the fallback draws itself, with no network at all', async ({ page }) => {
    await loadApp(page);
    const uri = await page.evaluate(() => (window as any).wordImagePlaceholder('scope creep'));
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(uri)).toContain('scope creep');
    // Єдиний http тут — простір імен SVG, він нікуди не ходить
    const decoded = decodeURIComponent(uri);
    const hosts = decoded.match(/https?:\/\/[^"'\s)]+/g) || [];
    expect(hosts).toEqual(['http://www.w3.org/2000/svg']);
  });

  test('a word that cannot be drawn is escaped, not injected', async ({ page }) => {
    await loadApp(page);
    const uri = await page.evaluate(() => (window as any).wordImagePlaceholder('<script>x</script>'));
    expect(decodeURIComponent(uri)).not.toContain('<script>');
    expect(decodeURIComponent(uri)).toContain('&lt;script&gt;');
  });

  test('a broken live URL falls back too', () => {
    const src = html();
    const code = src.slice(src.indexOf('async function showPictureQuestion'));
    expect(code.slice(0, 2000)).toContain('imgElement.onerror');
  });

  test('a word with no photo yields to one that has it', () => {
    const src = html();
    const code = src.slice(src.indexOf('async function showPictureQuestion'));
    expect(code.slice(0, 2000)).toContain('ahead <= 3');
    expect(code.slice(0, 2000)).toContain('pictureQuizWords[currentPictureQuestion] = candidate');
  });
});

test.describe('«Убрать голосовой, пускай вводят нашей клавиатурой»', () => {
  test('the answer box takes typing, not only speech', () => {
    const src = html();
    expect(src).toContain('id="phrase-voice-answer"');
    const box = src.slice(src.indexOf('id="phrase-voice-answer"') - 120, src.indexOf('id="phrase-voice-answer"') + 400);
    expect(box).toContain('input type="text"');
    expect(box).toContain('data-kbd=');
  });

  test('the check reads the field, however it was filled', () => {
    const src = html();
    const fn = src.slice(src.indexOf('async function checkPhraseAnswer()'));
    expect(fn.slice(0, 900)).toContain("document.getElementById('phrase-voice-answer')");
    expect(fn.slice(0, 900)).toContain('typed.value.trim()');
  });

  test('a typed answer is judged by meaning, like a spoken one', () => {
    const src = html();
    const fn = src.slice(src.indexOf('async function checkPhraseAnswer()'));
    expect(fn.slice(0, 900)).toContain('judgePhraseAnswer(phrase, phraseVoiceTranscript)');
  });

  test('dictation still fills the same field', () => {
    const src = html();
    const fn = src.slice(src.indexOf('function togglePhraseVoice()'));
    expect(fn.slice(0, 1200)).toContain('box.value = text');
  });
});

test.describe('«Одна озвучка, машинная — быстрее и дешевле»', () => {
  test('an exercise never waits for the network to say a word', async ({ page }) => {
    await loadApp(page);
    const live = await page.evaluate(() => {
      let liveCalls = 0;
      // @ts-ignore
      window.speakWithLiveVoice = () => { liveCalls++; };
      // @ts-ignore
      kokoroSpeak('threshold', 'UK English Female');
      // @ts-ignore
      kokoroSpeak('deadline', 'UK English Female');
      return liveCalls;
    });
    expect(live).toBe(0);
  });

  test('the browser voice is what actually speaks', async ({ page }) => {
    await loadApp(page);
    const spoken = await page.evaluate(() => {
      // @ts-ignore — silenceAudio records everything handed to the synthesiser
      (window as any).__spoken = [];
      // @ts-ignore
      kokoroSpeak('threshold', 'UK English Female');
      return (window as any).__spoken;
    });
    expect(spoken).toContain('threshold');
  });

  test('Speaking Club and the generated story keep the paid voice', () => {
    const src = readFileSync(INDEX, 'utf-8');
    const live = src.match(/kokoroSpeakLive\(/g) || [];
    // три виклики в генеративному тексті плюс саме оголошення функції
    expect(live.length).toBe(4);
    expect(src).toContain('const resp = await aiSpeech({ model:\'tts-1\'');
  });

  test('a long passage or Ukrainian still goes to the browser, even there', async ({ page }) => {
    await loadApp(page);
    const live = await page.evaluate(() => {
      let liveCalls = 0;
      // @ts-ignore
      window.speakWithLiveVoice = () => { liveCalls++; };
      // @ts-ignore
      kokoroSpeakLive('привіт', 'Ukrainian Female');
      // @ts-ignore
      kokoroSpeakLive('word '.repeat(300), 'UK English Female');
      return liveCalls;
    });
    expect(live).toBe(0);
  });
});
