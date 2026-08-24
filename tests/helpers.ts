import { Page, Route } from '@playwright/test';

export type AiRoute = 'chat' | 'speech' | 'transcription' | 'image';

/**
 * The app reaches OpenAI only through its own Netlify function now, so there is
 * one URL to intercept. Handlers are keyed by the route the app asked for, and
 * a request nobody claims falls through to whatever else the test registered.
 */
export function mockAi(
  page: Page,
  route: AiRoute,
  handler: (body: any, r: Route) => Promise<void> | void,
) {
  return page.route('**/.netlify/functions/ai', async (r) => {
    const payload = r.request().postDataJSON() || {};
    if (payload.route !== route) return r.fallback();
    await handler(payload.body || {}, r);
  });
}

/** Answers a chat call as if the model had replied with `content`. */
export function mockAiChat(page: Page, content: string | ((body: any) => string)) {
  return mockAi(page, 'chat', async (body, r) => {
    const text = typeof content === 'function' ? content(body) : content;
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: text } }] }),
    });
  });
}

const FIREBASE_APP_MOCK = `
window.firebase = {
  apps: [],
  initializeApp: function() { this.apps.push({}); return {}; },
  auth: function() { return window.__firebaseAuthInstance; },
  firestore: function() { return window.__firebaseFirestoreInstance; }
};
firebase.auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
firebase.auth.GoogleAuthProvider = function() {};
firebase.firestore.Timestamp = {
  fromDate: function(d) { return { toDate: function() { return d; } }; },
  now: function() { return { toDate: function() { return new Date(); } }; }
};
firebase.firestore.FieldValue = {
  serverTimestamp: function() { return new Date(); },
  increment: function(n) { return { __increment: n }; },
  delete: function() { return undefined; },
  arrayUnion: function() { return { __arrayUnion: Array.prototype.slice.call(arguments) }; },
  arrayRemove: function() { return { __arrayRemove: Array.prototype.slice.call(arguments) }; }
};
`;

const FIREBASE_AUTH_MOCK = `
(function() {
  window.__authCalls = { persistence: [], redirectChecked: 0, redirects: 0, popups: 0, passwordResets: [] };
  // Tests set window.__authFail = { code: 'auth/wrong-password' } to drive the error paths
  function maybeFail(value) {
    return window.__authFail ? Promise.reject(window.__authFail) : Promise.resolve(value);
  }
  var mockUser = {
    uid: 'test-user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    // The app sends this to its own payment function
    getIdToken: function() { return Promise.resolve('mock-id-token'); },
  };
  var callbacks = [];
  window.__firebaseAuthInstance = {
    currentUser: mockUser,
    onAuthStateChanged: function(cb) {
      callbacks.push(cb);
      setTimeout(function() { cb(mockUser); }, 50);
      return function() {};
    },
    signInWithEmailAndPassword: function() { return maybeFail({ user: mockUser }); },
    createUserWithEmailAndPassword: function() { return maybeFail({ user: mockUser }); },
    sendPasswordResetEmail: function(email) {
      window.__authCalls.passwordResets.push(email);
      return maybeFail();
    },
    // Recorded so tests can assert the app asked for a lasting session
    setPersistence: function(mode) { window.__authCalls.persistence.push(mode); return Promise.resolve(); },
    getRedirectResult: function() { window.__authCalls.redirectChecked++; return Promise.resolve({ user: null }); },
    signInWithRedirect: function() { window.__authCalls.redirects++; return Promise.resolve(); },
    signInWithPopup: function() { window.__authCalls.popups++; return Promise.resolve({ user: mockUser }); },
    signOut: function() {
      callbacks.forEach(function(cb) { cb(null); });
      return Promise.resolve();
    },
  };
})();
`;

const FIREBASE_FIRESTORE_MOCK = `
(function() {
  var mockWords = [
    { id: '1', data: function() { return { word: 'hello', translate: 'привіт', status: 'new', dateAdded: new Date() }; } },
    { id: '2', data: function() { return { word: 'world', translate: 'світ', status: 'good', dateAdded: new Date() }; } },
    { id: '3', data: function() { return { word: 'cat', translate: 'кіт', status: 'average', dateAdded: new Date() }; } },
    { id: '4', data: function() { return { word: 'dog', translate: 'собака', status: 'poor', dateAdded: new Date() }; } },
    { id: '5', data: function() { return { word: 'book', translate: 'книга', status: 'new', dateAdded: new Date() }; } },
  ];
  // Tests can pre-populate collections (e.g. a shared set that a link points at)
  // via loadApp(page, { seed: { sets: {...} } }).
  var seed = window.__mockSeed || {};
  var mockPhrases = [];
  var mockPhrasesStore = seed.phrases || {};
  var mockSets = seed.sets || {};
  var mockSetIdCounter = 1;
  var mockCustomLessons = seed.customLessons || {};
  var mockCustomLessonIdCounter = 1;
  var mockFolders = seed.folders || {};
  var mockFolderIdCounter = 1;
  var mockPhraseFolders = seed.phraseFolders || {};
  var mockPhraseFolderIdCounter = 1;

  // Words are keyed by the English word, exactly like the real collection where the
  // doc id IS the word. Folder membership lives in the word's own \`folders\` array.
  // Timestamps carry toDate() in Firestore, and the progress screen calls it
  function stamp(seconds) {
    return { seconds: seconds, toDate: function() { return new Date(seconds * 1000); } };
  }

  // A seeded vocabulary replaces the default five, for the exercises that refuse
  // to start below a word count (\`data-needs\` on the tiles).
  var mockWordsStore = seed.words || {
    hello: { translation: 'привіт', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(5) },
    world: { translation: 'світ', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(4) },
    cat: { translation: 'кіт', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(3) },
    dog: { translation: 'собака', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(2) },
    book: { translation: 'книга', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(1) },
  };
  Object.keys(mockWordsStore).forEach(function(id, i) {
    var w = mockWordsStore[id];
    if (!w.dateAdded) w.dateAdded = stamp(1000 - i);
    else if (typeof w.dateAdded.toDate !== 'function') w.dateAdded = stamp(w.dateAdded.seconds || 1);
  });

  function snapshotOf(docs) {
    return {
      docs: docs,
      forEach: function(cb) { docs.forEach(cb); },
      size: docs.length,
      empty: docs.length === 0,
    };
  }

  // arrayUnion/arrayRemove arrive as sentinels; every other value is written as-is.
  function applyFieldOp(current, value) {
    if (value && typeof value === 'object' && typeof value.__increment === 'number') {
      return (typeof current === 'number' ? current : 0) + value.__increment;
    }
    if (value && typeof value === 'object' && value.__arrayUnion) {
      var list = Array.isArray(current) ? current.slice() : [];
      value.__arrayUnion.forEach(function(v) { if (list.indexOf(v) === -1) list.push(v); });
      return list;
    }
    if (value && typeof value === 'object' && value.__arrayRemove) {
      var kept = Array.isArray(current) ? current.slice() : [];
      return kept.filter(function(v) { return value.__arrayRemove.indexOf(v) === -1; });
    }
    return value;
  }

  // Generic stateful collection over a plain object store, with just enough of the
  // query surface the app actually uses (where/orderBy/limit/startAfter/add/doc).
  function statefulCollection(store, idFactory) {
    function docsFrom(filter) {
      return Object.keys(store)
        .filter(function(id) { return !filter || filter(store[id]); })
        .map(function(id) {
          return {
            id: id,
            exists: true,
            data: function() { return store[id]; },
            ref: docApi(id),
          };
        });
    }
    function docApi(id) {
      return {
        id: id,
        get: function() {
          return Promise.resolve(store[id]
            ? { id: id, exists: true, data: function() { return store[id]; }, ref: docApi(id) }
            : { id: id, exists: false, data: function() { return undefined; } });
        },
        set: function(data) {
          if (window.__mockFailWrites) return Promise.reject(new Error('Failed to get document because the client is offline.'));
          store[id] = data;
          return Promise.resolve();
        },
        update: function(data) {
          if (window.__mockFailWrites) return Promise.reject(new Error('Failed to get document because the client is offline.'));
          var next = Object.assign({}, store[id] || {});
          Object.keys(data).forEach(function(k) { next[k] = applyFieldOp(next[k], data[k]); });
          store[id] = next;
          return Promise.resolve();
        },
        delete: function() { delete store[id]; return Promise.resolve(); },
      };
    }
    // order/limit/startAfter are real, so a paged screen behaves like it does
    // against Firestore: a first page, then more on demand.
    function query(filter, order, take, after) {
      function docs() {
        var list = docsFrom(filter);
        if (order) {
          var field = order.field, dir = order.dir === 'desc' ? -1 : 1;
          // A document missing the field is invisible to orderBy in Firestore
          list = list.filter(function(d) { return d.data()[field] !== undefined; });
          list = list.slice().sort(function(a, b) {
            var x = sortable(a.data()[field]), y = sortable(b.data()[field]);
            return x < y ? -dir : x > y ? dir : 0;
          });
        }
        if (after) {
          var at = list.findIndex(function(d) { return d.id === after.id; });
          if (at !== -1) list = list.slice(at + 1);
        }
        if (take) list = list.slice(0, take);
        return list;
      }
      var api = {
        doc: docApi,
        add: function(data) {
          if (window.__mockFailWrites) return Promise.reject(new Error('Failed to get document because the client is offline.'));
          var id = idFactory();
          store[id] = data;
          return Promise.resolve({ id: id });
        },
        get: function() { return Promise.resolve(snapshotOf(docs())); },
        where: function(field, op, value) {
          return query(function(d) {
            var v = d[field];
            if (op === 'array-contains') return Array.isArray(v) && v.indexOf(value) !== -1;
            if (op === '==') return v === value;
            // Нерівність у Firestore теж не бачить документа без поля,
            // і мовчазне «true» тут ховало б справжню поведінку відбору
            if (op === '<' || op === '<=' || op === '>' || op === '>=') {
              if (v === undefined) return false;
              if (op === '<') return v < value;
              if (op === '<=') return v <= value;
              if (op === '>') return v > value;
              return v >= value;
            }
            if (op === '!=') return v !== undefined && v !== value;
            return true;
          }, order, take, after);
        },
        orderBy: function(field, dir) { return query(filter, { field: field, dir: dir }, take, after); },
        limit: function(n) { return query(filter, order, n, after); },
        startAfter: function(doc) { return query(filter, order, take, doc); },
      };
      return api;
    }

    // Timestamps compare by their seconds, everything else by itself
    function sortable(value) {
      if (value && typeof value === 'object' && typeof value.seconds === 'number') return value.seconds;
      if (value instanceof Date) return value.getTime();
      return value;
    }
    return query(null);
  }

  // Writes to the user document are remembered, so a test can read back what the
  // app stored there (scHistory, scMemory, grammarProgress...).
  var mockUserWrites = {};

  // Firestore takes 'xpHistory.2026-08-17' as a path into a nested map, and
  // increments add to what is already there — a flat assign would lose both.
  function writeUserFields(data) {
    Object.keys(data).forEach(function(key) {
      var value = data[key];
      var path = key.split('.');
      if (path.length === 1) {
        mockUserWrites[key] = applyFieldOp(
          mockUserWrites[key] !== undefined ? mockUserWrites[key] : (mockUserSeed || {})[key], value);
        return;
      }
      var head = path[0];
      var nest = Object.assign({}, (mockUserSeed || {})[head], mockUserWrites[head]);
      var cursor = nest;
      for (var i = 1; i < path.length - 1; i++) {
        cursor[path[i]] = Object.assign({}, cursor[path[i]]);
        cursor = cursor[path[i]];
      }
      var leaf = path[path.length - 1];
      cursor[leaf] = applyFieldOp(cursor[leaf], value);
      mockUserWrites[head] = nest;
    });
  }

  // A test can start from an account that already has history, XP or a plan:
  // loadApp(page, { seed: { user: { scHistory: [...] } } })
  var mockUserSeed = seed.user || {};

  var mockUserDoc = {
    exists: true,
    data: function() {
      return Object.assign({
        email: 'test@example.com',
        xp: 350,
        streak: 5,
        xpHistory: {},
        dailyGoalTarget: 200,
        bestDailyXP: 150,
        speedRecord: 0,
        nickname: 'TestPlayer',
      // Знайомство показується лише новачкам. Прогони — не новачки, інакше
      // sheet накрив би головний екран у кожному тесті, який щось натискає.
      onboardingSeen: true,
        grammarProgress: {},
        registrationDate: { toDate: function() { return new Date('2025-01-01'); } },
        subscriptionExpiration: { toDate: function() { return new Date('2030-01-01'); } },
      }, mockUserSeed, mockUserWrites);
    },
  };

  function mockCollection(path) {
    // Checked first: 'phraseFolders' also contains 'folders' and 'phrases'
    if (path.indexOf('phraseFolders') !== -1) {
      return statefulCollection(mockPhraseFolders, function() { return 'mock-pfolder-' + (mockPhraseFolderIdCounter++); });
    }
    if (path.indexOf('folders') !== -1) {
      return statefulCollection(mockFolders, function() { return 'mock-folder-' + (mockFolderIdCounter++); });
    }
    if (path.indexOf('words') !== -1) {
      return statefulCollection(mockWordsStore, function() { return 'mock-word-' + Object.keys(mockWordsStore).length; });
    }
    // Starts empty (as before), but writable — folder tests need to seed phrases.
    if (path.indexOf('phrases') !== -1) {
      return statefulCollection(mockPhrasesStore, function() { return 'mock-phrase-' + Object.keys(mockPhrasesStore).length; });
    }

    // Custom grammar lessons are written and read back within one session (create -> leave the
    // section -> reopen), so this sub-collection needs to actually remember what was added.
    if (path.indexOf('customLessons') !== -1) {
      var lessons = function() {
        return Object.keys(mockCustomLessons).map(function(id) {
          var data = mockCustomLessons[id];
          return { id: id, exists: true, data: function() { return data; } };
        });
      };
      var api = {
        doc: function(id) {
          return {
            get: function() {
              var data = mockCustomLessons[id];
              return Promise.resolve(data
                ? { id: id, exists: true, data: function() { return data; } }
                : { id: id, exists: false, data: function() { return undefined; } });
            },
            set: function(data) { mockCustomLessons[id] = data; return Promise.resolve(); },
            update: function(data) { mockCustomLessons[id] = Object.assign({}, mockCustomLessons[id] || {}, data); return Promise.resolve(); },
            delete: function() { delete mockCustomLessons[id]; return Promise.resolve(); },
          };
        },
        add: function(data) {
          var id = 'mock-lesson-' + (mockCustomLessonIdCounter++);
          mockCustomLessons[id] = data;
          return Promise.resolve({ id: id });
        },
        get: function() {
          var docs = lessons();
          return Promise.resolve({ docs: docs, forEach: function(cb) { docs.forEach(cb); }, size: docs.length, empty: docs.length === 0 });
        },
        where: function() { return api; },
        orderBy: function() { return api; },
        limit: function() { return api; },
      };
      return api;
    }

    // Stateful in-memory store, scoped to an exact 'sets' match only — every other path below is
    // untouched, so existing tests relying on the generic fallback behavior are unaffected.
    if (path === 'sets') {
      return {
        doc: function(id) {
          return {
            get: function() {
              var data = mockSets[id];
              return Promise.resolve(data
                ? { id: id, exists: true, data: function() { return data; } }
                : { id: id, exists: false, data: function() { return undefined; } });
            },
            set: function(data) { mockSets[id] = data; return Promise.resolve(); },
            update: function(data) { mockSets[id] = Object.assign({}, mockSets[id] || {}, data); return Promise.resolve(); },
            delete: function() { delete mockSets[id]; return Promise.resolve(); },
          };
        },
        get: function() {
          var docs = Object.keys(mockSets).map(function(id) {
            var data = mockSets[id];
            return { id: id, exists: true, data: function() { return data; } };
          });
          return Promise.resolve({ docs: docs, forEach: function(cb) { docs.forEach(cb); }, size: docs.length, empty: docs.length === 0 });
        },
        add: function(data) {
          var id = 'mock-set-' + (mockSetIdCounter++);
          mockSets[id] = data;
          return Promise.resolve({ id: id });
        },
        where: function() { return mockCollection('sets'); },
        orderBy: function() { return mockCollection('sets'); },
        limit: function() { return mockCollection('sets'); },
      };
    }
    return {
      doc: function(id) {
        return {
          get: function() {
            if (path.indexOf('words') !== -1) {
              var word = mockWords.find(function(w) { return w.id === id; });
              return Promise.resolve(word || { exists: false, data: function() { return {}; } });
            }
            return Promise.resolve(mockUserDoc);
          },
          set: function(data) {
            if (window.__mockFailWrites) return Promise.reject(new Error('Failed to get document because the client is offline.'));
            writeUserFields(data); return Promise.resolve();
          },
          update: function(data) {
            if (window.__mockFailWrites) return Promise.reject(new Error('Failed to get document because the client is offline.'));
            writeUserFields(data); return Promise.resolve();
          },
          delete: function() { return Promise.resolve(); },
          collection: function(subPath) { return mockCollection(path + '/' + id + '/' + subPath); },
        };
      },
      get: function() {
        var docs = path.indexOf('words') !== -1 ? mockWords : path.indexOf('phrases') !== -1 ? mockPhrases : [];
        return Promise.resolve({
          docs: docs,
          forEach: function(cb) { docs.forEach(cb); },
          size: docs.length,
          empty: docs.length === 0,
        });
      },
      add: function() { return Promise.resolve({ id: 'new-' + Date.now() }); },
      where: function() { return mockCollection(path); },
      orderBy: function() { return mockCollection(path); },
      limit: function() { return mockCollection(path); },
    };
  }

  // A write batch just remembers the calls and replays them onto the doc refs.
  function mockBatch() {
    var ops = [];
    return {
      set: function(ref, data) { ops.push(function() { return ref.set(data); }); },
      update: function(ref, data) { ops.push(function() { return ref.update(data); }); },
      delete: function(ref) { ops.push(function() { return ref.delete(); }); },
      commit: function() { return Promise.all(ops.map(function(op) { return op(); })); },
    };
  }

  window.__firebaseFirestoreInstance = {
    collection: mockCollection,
    batch: mockBatch,
  };
})();
`;

/**
 * Mock Firebase by intercepting CDN script requests.
 * Call this BEFORE navigating to the page.
 */
export async function mockFirebase(page: Page) {
  // Intercept Firebase SDK script requests
  await page.route('**/firebasejs/**/firebase-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: FIREBASE_APP_MOCK,
    });
  });

  await page.route('**/firebasejs/**/firebase-auth.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: FIREBASE_AUTH_MOCK,
    });
  });

  await page.route('**/firebasejs/**/firebase-firestore.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: FIREBASE_FIRESTORE_MOCK,
    });
  });

  // Mock ResponsiveVoice
  await page.route('**/responsivevoice.js*', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.responsiveVoice = {
        speak: function() {},
        cancel: function() {},
        isPlaying: function() { return false; },
        getVoices: function() { return []; },
        init: function() {},
      };`,
    });
  });
}

/**
 * Navigate to the app and wait for it to load (preloader hidden).
 */
/**
 * A test run must never make a sound. Every exercise speaks its word as it shows
 * it, and with no AI key that falls through to speechSynthesis — which on a Mac
 * is the system voice, a process of its own that Chromium's --mute-audio does
 * not reach. Across a full suite that is hundreds of words read out loud.
 *
 * The stub stays silent but still plays the events back: the app hands its
 * utterance an onstart and an onend and waits for them, so swallowing the call
 * outright would leave exercises hanging rather than quiet.
 */
export function silenceAudio(page: Page) {
  return page.addInitScript(() => {
    (window as any).__spoken = [];
    const synth = window.speechSynthesis;
    if (synth) {
      synth.speak = (utterance: any) => {
        (window as any).__spoken.push(utterance && utterance.text);
        setTimeout(() => {
          if (typeof utterance?.onstart === 'function') utterance.onstart(new Event('start'));
          if (typeof utterance?.onend === 'function') utterance.onend(new Event('end'));
        }, 0);
      };
    }
    // Live-voice replies arrive as real audio elements; let them play, mutely
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      this.muted = true;
      this.volume = 0;
      return play.call(this);
    };
  });
}

export async function loadApp(page: Page, opts: { seed?: any; url?: string } = {}) {
  await silenceAudio(page);
  await mockFirebase(page);
  if (opts.seed) {
    await page.addInitScript((seed) => {
      (window as any).__mockSeed = seed;
    }, opts.seed);
  }
  await page.goto(opts.url || '/');
  // Wait for preloader to get the 'hidden' class (element becomes invisible)
  await page.waitForFunction(
    () => document.getElementById('page-preloader')?.classList.contains('hidden'),
    { timeout: 10000 }
  );
  // Wait for account screen to become visible
  await page.waitForFunction(
    () => !document.getElementById('account-screen')?.classList.contains('hidden'),
    { timeout: 10000 }
  );
}

/**
 * Navigate to the app WITHOUT mocking Firebase (for login form tests).
 * Waits for preloader to hide (Firebase will load but auth state will show login).
 */
export async function loadAppNoAuth(page: Page) {
  await silenceAudio(page);
  // Block Firebase auth so it doesn't auto-login, but provide mock so no errors
  await page.route('**/firebasejs/**/firebase-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: FIREBASE_APP_MOCK,
    });
  });

  await page.route('**/firebasejs/**/firebase-auth.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
        (function() {
          window.__firebaseAuthInstance = {
            currentUser: null,
            onAuthStateChanged: function(cb) {
              setTimeout(function() { cb(null); }, 50);
              return function() {};
            },
            signInWithEmailAndPassword: function() {
              return Promise.reject(window.__authFail || new Error('mock'));
            },
            createUserWithEmailAndPassword: function() {
              return Promise.reject(window.__authFail || new Error('mock'));
            },
            sendPasswordResetEmail: function(email) {
              window.__authCalls = window.__authCalls || { passwordResets: [] };
              window.__authCalls.passwordResets.push(email);
              return window.__authFail ? Promise.reject(window.__authFail) : Promise.resolve();
            },
            setPersistence: function() { return Promise.resolve(); },
            getRedirectResult: function() { return Promise.resolve({ user: null }); },
            signInWithRedirect: function() { return Promise.resolve(); },
            signInWithPopup: function() { return Promise.reject(new Error('mock')); },
            signOut: function() { return Promise.resolve(); },
          };
        })();
      `,
    });
  });

  await page.route('**/firebasejs/**/firebase-firestore.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: FIREBASE_FIRESTORE_MOCK,
    });
  });

  await page.route('**/responsivevoice.js*', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.responsiveVoice = { speak: function(){}, cancel: function(){}, isPlaying: function(){ return false; }, getVoices: function(){ return []; }, init: function(){} };`,
    });
  });

  await page.goto('/');
  await page.waitForFunction(
    () => document.getElementById('page-preloader')?.classList.contains('hidden'),
    { timeout: 10000 }
  );
}
