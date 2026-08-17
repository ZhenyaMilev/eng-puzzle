import { test, expect, Page } from '@playwright/test';
import { loadApp } from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX = join(__dirname, '..', 'eng-puzzle', 'index.html');

/**
 * The container was adapted first — height, safe area, closing swipe — but
 * none of the interaction was, and that is what makes a Mini App feel like a
 * wrapped web page. These cover the parts a thumb can tell apart.
 */

/** A Telegram stub that records everything the app asks of it. */
async function asMiniApp(page: Page) {
  await page.route('**/telegram-web-app.js', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: '' }));

  await page.addInitScript(() => {
    const calls: any = {
      haptics: [], back: [], main: [], popups: [], links: [],
      closingGuard: [], backVisible: false, mainVisible: false,
    };
    (window as any).__tg = calls;

    const events: Record<string, Function[]> = {};
    let backHandler: Function | null = null;
    let mainHandler: Function | null = null;

    (window as any).Telegram = {
      WebApp: {
        initData: 'user=%7B%22id%22%3A1%7D&hash=a',
        viewportStableHeight: 700,
        contentSafeAreaInset: { top: 0, bottom: 0 },
        ready() {}, expand() {},
        disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {},
        onEvent(name: string, fn: Function) { (events[name] = events[name] || []).push(fn); },
        openLink(u: string) { calls.links.push(u); },
        openTelegramLink(u: string) { calls.links.push(u); },
        enableClosingConfirmation() { calls.closingGuard.push(true); },
        disableClosingConfirmation() { calls.closingGuard.push(false); },
        HapticFeedback: {
          impactOccurred: (s: string) => calls.haptics.push('impact:' + s),
          notificationOccurred: (s: string) => calls.haptics.push('notify:' + s),
          selectionChanged: () => calls.haptics.push('select'),
        },
        BackButton: {
          get isVisible() { return calls.backVisible; },
          show() { calls.backVisible = true; calls.back.push('show'); },
          hide() { calls.backVisible = false; calls.back.push('hide'); },
          onClick(fn: Function) { backHandler = fn; },
        },
        MainButton: {
          get isVisible() { return calls.mainVisible; },
          setParams(p: any) { calls.main.push(p.text); },
          show() { calls.mainVisible = true; },
          hide() { calls.mainVisible = false; },
          onClick(fn: Function) { mainHandler = fn; },
        },
        showConfirm() {},
        showPopup(params: any, cb: Function) {
          calls.popups.push(params);
          (window as any).__answerPopup = (id: string) => cb(id);
        },
      },
    };
    (window as any).__pressBack = () => backHandler && backHandler();
    (window as any).__pressMain = () => mainHandler && mainHandler();
  });
}

const tg = (page: Page) => page.evaluate(() => (window as any).__tg);

test.describe('The app answers the thumb', () => {
  test('tapping anything gives a nudge', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.locator('.acc-tile', { hasText: 'Граматика' }).tap({ trial: false }).catch(async () => {
      await page.locator('.acc-tile', { hasText: 'Граматика' }).dispatchEvent('pointerdown');
    });

    const state = await tg(page);
    expect(state.haptics.length).toBeGreaterThan(0);
  });

  test('a right answer and a wrong one feel different', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.evaluate(() => { (window as any).addXP(10); });
    await page.evaluate(() => { (window as any).addXP(2); });

    const state = await tg(page);
    expect(state.haptics).toContain('notify:success');
    expect(state.haptics).toContain('notify:error');
  });

  test('finishing something celebrates', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showConfetti());

    expect((await tg(page)).haptics).toContain('notify:success');
  });

  test('a plain browser is never asked for haptics', async ({ page }) => {
    await loadApp(page);
    const threw = await page.evaluate(() => {
      try { (window as any).haptic('success'); return false; } catch (e) { return true; }
    });
    expect(threw).toBe(false);
  });
});

test.describe('The sheets keep the promise their handle makes', () => {
  test('every sheet with a grabber has a drag handler', () => {
    const html = readFileSync(INDEX, 'utf-8');
    // The grabber is drawn by a 40x4 ::before; each one must be in SHEETS
    const grabbers = [...html.matchAll(/#([A-Za-z]+)::before\s*\{[^}]*width:\s*40px/g)].map((m) => m[1]);
    expect(grabbers.length).toBeGreaterThan(0);

    const registered = html.slice(html.indexOf('const SHEETS = ['), html.indexOf('const SHEET_CLOSE_FRACTION'));
    for (const id of grabbers) {
      expect(registered, `${id} draws a handle but is not draggable`).toContain(id);
    }
  });

  test('dragging a sheet past the threshold closes it', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.evaluate(() => {
      const el = document.getElementById('wordInfoPopup')!;
      el.innerHTML = '<p>тест</p>';
      el.classList.add('show');
    });
    await expect(page.locator('#wordInfoPopup')).toHaveClass(/show/);

    await page.evaluate(() => {
      const el = document.getElementById('wordInfoPopup')!;
      const touch = (y: number) => ({ touches: [{ clientY: y }] });
      el.dispatchEvent(Object.assign(new Event('touchstart'), touch(0)));
      el.dispatchEvent(Object.assign(new Event('touchmove'), touch(600)));
      el.dispatchEvent(new Event('touchend'));
    });

    await expect(page.locator('#wordInfoPopup')).not.toHaveClass(/show/);
  });

  test('a short tug springs back instead of closing', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.evaluate(() => {
      const el = document.getElementById('wordInfoPopup')!;
      el.innerHTML = '<p>тест</p>';
      el.classList.add('show');
      // A slow, small pull: neither far enough nor fast enough
      const touch = (y: number) => ({ touches: [{ clientY: y }] });
      el.dispatchEvent(Object.assign(new Event('touchstart'), touch(0)));
      el.dispatchEvent(Object.assign(new Event('touchmove'), touch(8)));
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => document.getElementById('wordInfoPopup')!.dispatchEvent(new Event('touchend')));

    await expect(page.locator('#wordInfoPopup')).toHaveClass(/show/);
    // ...and it sits back where it started
    expect(await page.evaluate(() => document.getElementById('wordInfoPopup')!.style.transform)).toBe('');
  });

  test('a sheet scrolled down is not dragged away under the finger', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.evaluate(() => {
      const el = document.getElementById('wordInfoPopup')!;
      el.innerHTML = '<p style="height:2000px">довгий вміст</p>';
      el.classList.add('show');
      el.scrollTop = 400; // reading halfway down
      const touch = (y: number) => ({ touches: [{ clientY: y }] });
      el.dispatchEvent(Object.assign(new Event('touchstart'), touch(0)));
      el.dispatchEvent(Object.assign(new Event('touchmove'), touch(600)));
      el.dispatchEvent(new Event('touchend'));
    });

    await expect(page.locator('#wordInfoPopup')).toHaveClass(/show/);
  });

  test('tapping outside closes it too', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    await page.evaluate(() => {
      document.getElementById('wordInfoPopup')!.classList.add('show');
      document.querySelector('.overlay')!.classList.remove('hidden');
      (document.querySelector('.overlay') as HTMLElement).click();
    });

    await expect(page.locator('#wordInfoPopup')).not.toHaveClass(/show/);
  });
});

test.describe('Back belongs in the header', () => {
  test('the in-page back buttons are hidden, and Telegram’s appears', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());

    await expect(page.locator('#my-words-section .back-button')).toBeHidden();
    await expect.poll(async () => (await tg(page)).backVisible).toBe(true);
  });

  test('it is hidden again on the dashboard, where there is no back', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect.poll(async () => (await tg(page)).backVisible).toBe(true);

    await page.evaluate(() => (window as any).backToAccount());
    await expect.poll(async () => (await tg(page)).backVisible).toBe(false);
  });

  test('pressing it does what the screen’s own button did', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#my-words-section')).toBeVisible();

    await page.evaluate(() => (window as any).__pressBack());

    await expect(page.locator('#account-screen')).toBeVisible();
    await expect(page.locator('#my-words-section')).toBeHidden();
  });

  /**
   * The progress screen was never registered with the window button, and its
   * own "Назад" is hidden here like every other one — so it had no way out at
   * all. It lies over whatever screen opened it, so it answers first.
   */
  test('the progress screen has a way out, and it is the window button', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).loadUserProgress());
    await expect(page.locator('#progressPopup')).toBeVisible();

    await expect(page.locator('#progressPopup .back-button')).toBeHidden();
    await expect.poll(async () => (await tg(page)).backVisible).toBe(true);

    await page.evaluate(() => (window as any).__pressBack());
    await expect(page.locator('#progressPopup')).toBeHidden();
  });

  test('and it closes the progress screen before the one underneath', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await page.evaluate(() => (window as any).loadUserProgress());
    await expect(page.locator('#progressPopup')).toBeVisible();
    // The window button is re-aimed on the frame after a screen changes
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));

    await page.evaluate(() => (window as any).__pressBack());
    await expect(page.locator('#progressPopup')).toBeHidden();
    await expect(page.locator('#my-words-section')).toBeVisible();
  });

  test('from the documents it goes back to the documents’ caller', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('offer'));
    await expect(page.locator('#legal-section')).toBeVisible();

    await page.evaluate(() => (window as any).__pressBack());
    await expect(page.locator('#account-screen')).toBeVisible();
  });

  test('the web keeps its own buttons', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => (window as any).showMyWords());
    await expect(page.locator('#my-words-section .back-button')).toBeVisible();
  });
});

test.describe('Losing an exercise by accident', () => {
  test('the closing swipe is guarded inside an exercise', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).startQuiz());

    await expect.poll(async () => (await tg(page)).closingGuard.at(-1)).toBe(true);
  });

  test('and unguarded once it is over', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).startQuiz());
    await expect.poll(async () => (await tg(page)).closingGuard.at(-1)).toBe(true);

    await page.evaluate(() => (window as any).backToAccount());
    await expect.poll(async () => (await tg(page)).closingGuard.at(-1)).toBe(false);
  });
});

test.describe('The main action sits where Telegram puts it', () => {
  test('the phrase mode screen offers one button, outside the page', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).startPhraseConstructor());

    await expect.poll(async () => (await tg(page)).main.at(-1)).toBe('Почати');
    await expect.poll(async () => (await tg(page)).mainVisible).toBe(true);
  });

  test('pressing it starts the practice', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).startPhraseConstructor());
    await expect.poll(async () => (await tg(page)).mainVisible).toBe(true);

    await page.evaluate(() => (window as any).__pressMain());
    await expect(page.locator('#phrase-mode-select')).toBeHidden();
  });

  test('it disappears when the screen does', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).startPhraseConstructor());
    await expect.poll(async () => (await tg(page)).mainVisible).toBe(true);

    await page.evaluate(() => (window as any).backToAccount());
    await expect.poll(async () => (await tg(page)).mainVisible).toBe(false);
  });

  test('the keyboard screens are left alone — they have their own bottom bar', () => {
    const html = readFileSync(INDEX, 'utf-8');
    const list = html.slice(html.indexOf('const MAIN_BUTTON_SCREENS'), html.indexOf('let mainButtonHidden'));
    expect(list).not.toContain('word-constructor-training-section');
    expect(list).not.toContain('crossword-section');
  });
});

test.describe('Sharing, and asking things', () => {
  test('inside Telegram sharing opens the chat picker', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showShareLink('Моя папка', 'https://example.com/?set=1'));

    await page.click('#share-send-btn');

    const state = await tg(page);
    expect(state.links.at(-1)).toContain('t.me/share/url');
    expect(state.links.at(-1)).toContain(encodeURIComponent('https://example.com/?set=1'));
    await expect(page.locator('#share-link-modal')).toBeHidden();
  });

  test('on the web the send button is not offered at all', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => {
      // No Web Share API in this browser context either
      delete (navigator as any).share;
      (window as any).showShareLink('Моя папка', 'https://example.com/?set=1');
    });

    await expect(page.locator('#share-send-btn')).toBeHidden();
    await expect(page.locator('#share-link-modal button', { hasText: 'Копіювати' })).toBeVisible();
  });

  test('a confirmation is a real Telegram dialog, not our markup', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    const answered = page.evaluate(() => (window as any).appConfirm('Видалити папку?', 'Слова залишаться', 'Видалити'));
    await expect.poll(async () => (await tg(page)).popups.length).toBe(1);

    const popup = (await tg(page)).popups[0];
    expect(popup.title).toBe('Видалити папку?');
    expect(popup.buttons.map((b: any) => b.type)).toEqual(['default', 'cancel']);
    await expect(page.locator('#app-confirm-modal')).toBeHidden();

    await page.evaluate(() => (window as any).__answerPopup('ok'));
    expect(await answered).toBe(true);
  });

  test('cancelling it returns false', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    const answered = page.evaluate(() => (window as any).appConfirm('Видалити?', '', 'Так'));
    await expect.poll(async () => (await tg(page)).popups.length).toBe(1);
    await page.evaluate(() => (window as any).__answerPopup('cancel'));

    expect(await answered).toBe(false);
  });

  test('the web still gets our own dialog', async ({ page }) => {
    await loadApp(page);
    const answered = page.evaluate(() => (window as any).appConfirm('Видалити?', 'Точно?', 'Так'));

    await expect(page.locator('#app-confirm-modal')).toBeVisible();
    await expect(page.locator('#app-confirm-title')).toHaveText('Видалити?');

    // Resolve it, or the pending evaluate outlives the test
    await page.click('#app-confirm-ok');
    expect(await answered).toBe(true);
  });
});

test.describe('The small tells that give a web page away', () => {
  test('no grey flash, no text selection, no long-press menu', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);

    const style = await page.evaluate(() => {
      const tile = document.querySelector('.acc-tile') as HTMLElement;
      const s = getComputedStyle(tile);
      return {
        highlight: (s as any).webkitTapHighlightColor,
        select: s.userSelect || (s as any).webkitUserSelect,
      };
    });

    expect(style.highlight).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(style.select).toBe('none');

    // -webkit-touch-callout only exists on iOS, so desktop Chromium cannot
    // report it — the rule itself is what has to be there
    const html = readFileSync(INDEX, 'utf-8');
    expect(html).toMatch(/body\.in-miniapp[\s\S]{0,120}-webkit-touch-callout:\s*none/);
  });

  test('but text a person may want to copy stays selectable', async ({ page }) => {
    await asMiniApp(page);
    await loadApp(page);
    await page.evaluate(() => (window as any).showLegal('offer'));

    const select = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('legal-body')!);
      return s.userSelect || (s as any).webkitUserSelect;
    });
    expect(select).toBe('text');
  });

  test('the web is left with normal selection', async ({ page }) => {
    await loadApp(page);
    const select = await page.evaluate(() =>
      getComputedStyle(document.body).userSelect || (getComputedStyle(document.body) as any).webkitUserSelect);
    expect(select).not.toBe('none');
  });
});
