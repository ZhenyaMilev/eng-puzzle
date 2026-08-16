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
  increment: function(n) { return n; },
  delete: function() { return undefined; }
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

  var mockWordsStore = {
    hello: { translation: 'привіт', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(5) },
    world: { translation: 'світ', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(4) },
    cat: { translation: 'кіт', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(3) },
    dog: { translation: 'собака', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(2) },
    book: { translation: 'книга', folders: [], interactions: 0, correctAnswers: 0, dateAdded: stamp(1) },
  };

  function snapshotOf(docs) {
    return {
      docs: docs,
      forEach: function(cb) { docs.forEach(cb); },
      size: docs.length,
      empty: docs.length === 0,
    };
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
        set: function(data) { store[id] = data; return Promise.resolve(); },
        update: function(data) { store[id] = Object.assign({}, store[id] || {}, data); return Promise.resolve(); },
        delete: function() { delete store[id]; return Promise.resolve(); },
      };
    }
    function query(filter) {
      var api = {
        doc: docApi,
        add: function(data) {
          var id = idFactory();
          store[id] = data;
          return Promise.resolve({ id: id });
        },
        get: function() { return Promise.resolve(snapshotOf(docsFrom(filter))); },
        where: function(field, op, value) {
          return query(function(d) {
            var v = d[field];
            if (op === 'array-contains') return Array.isArray(v) && v.indexOf(value) !== -1;
            if (op === '==') return v === value;
            return true;
          });
        },
        orderBy: function() { return api; },
        limit: function() { return api; },
        startAfter: function() { return api; },
      };
      return api;
    }
    return query(null);
  }

  // Writes to the user document are remembered, so a test can read back what the
  // app stored there (scHistory, scMemory, grammarProgress...).
  var mockUserWrites = {};

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
        grammarProgress: {},
        registrationDate: { toDate: function() { return new Date('2025-01-01'); } },
        subscriptionExpiration: { toDate: function() { return new Date('2030-01-01'); } },
      }, mockUserWrites);
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
          set: function(data) { Object.assign(mockUserWrites, data); return Promise.resolve(); },
          update: function(data) { Object.assign(mockUserWrites, data); return Promise.resolve(); },
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

  window.__firebaseFirestoreInstance = {
    collection: mockCollection,
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
export async function loadApp(page: Page, opts: { seed?: any; url?: string } = {}) {
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
