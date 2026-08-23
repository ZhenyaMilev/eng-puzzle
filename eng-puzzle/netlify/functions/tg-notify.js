'use strict';

const { firestore } = require('./_shared');
const {
  sendMessage, openAppButton, isQuietHour, kyivParts, toDate, daysBetween,
  alreadySent, alreadySentToday,
} = require('./_telegram');

/**
 * Runs hourly and sends at most one message per person per day.
 *
 * Every scenario is a pure `applies()` over the user document, so the order in
 * SCENARIOS *is* the priority: the first that applies wins and the rest wait
 * for another day. Reminders that would nag are marked once and never repeat.
 */

const STREAK_HOUR = 20;       // Kyiv, the "your streak is at risk" slot
const ONBOARDING_HOURS = 2;   // after registering with an empty dictionary
const REACTIVATION_DAYS = 7;  // silence before we ask once, then never again

const hours = (n) => n * 60 * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;

/**
  * The app records activity as `lastActiveDate` — a 'YYYY-MM-DD' Kyiv-ish day
  * string written when XP is earned. Day granularity is all these reminders need.
  */
function lastActive(user) {
  if (typeof user.lastActiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(user.lastActiveDate)) {
    return new Date(`${user.lastActiveDate}T12:00:00Z`);
  }
  return toDate(user.registrationDate);
}

function subscriptionEnd(user) {
  return user.lifetime === true ? null : toDate(user.subscriptionExpiration);
}

/** The trial is the subscription a user never paid for: it ends within a week of signing up. */
function isTrial(user) {
  const registered = toDate(user.registrationDate);
  const until = subscriptionEnd(user);
  if (!registered || !until) return false;
  return user.subscriptionPlan !== 'paid' && until - registered <= days(7.5);
}

const SCENARIOS = [
  {
    type: 'onboarding',
    once: true,
    applies: (user, now) => {
      const registered = toDate(user.registrationDate);
      if (!registered) return false;
      if (Number(user.wordCount || 0) > 0) return false;
      // Only in the first days does an empty dictionary still mean a new user
      if (now - registered > days(3)) return false;
      return now - registered >= hours(ONBOARDING_HOURS);
    },
    // wordCount is only written when the dashboard loads, so confirm before nagging
    confirm: async (ref) => (await ref.collection('words').limit(1).get()).empty,
    message: () => ({
      text: '<b>Словник поки порожній.</b>\n\n'
        + 'Достатньо однієї спроби: підберіть 30 слів під свій рівень — і відкриється перше тренування.',
      buttons: [openAppButton('Поповнити словник', 'words')],
    }),
  },
  {
    type: 'trialEndsTomorrow',
    once: true,
    applies: (user, now) => {
      if (!isTrial(user)) return false;
      const until = subscriptionEnd(user);
      return !!until && daysBetween(now, until) === 1;
    },
    message: () => ({
      text: '<b>Завтра закінчується пробний період.</b>\n\n'
        + 'З PRO лишаються всі тренування, генерація уроків із фото та Speaking Club. '
        + 'Від 99 ₴ на місяць.',
      buttons: [openAppButton('Оформити підписку', 'pay')],
    }),
  },
  {
    type: 'trialEnded',
    once: true,
    applies: (user, now) => {
      if (!isTrial(user)) return false;
      const until = subscriptionEnd(user);
      return !!until && until <= now && now - until < days(1);
    },
    message: () => ({
      text: '<b>Пробний період завершився.</b>\n\n'
        + 'Твій словник і прогрес на місці — щоб продовжити тренування, оформи підписку.',
      buttons: [openAppButton('Оформити підписку', 'pay')],
    }),
  },
  {
    type: 'subscriptionEndsSoon',
    once: true,
    applies: (user, now) => {
      if (isTrial(user)) return false;
      const until = subscriptionEnd(user);
      return !!until && daysBetween(now, until) === 3;
    },
    message: () => ({
      text: 'Підписка закінчується <b>через 3 дні</b>.\n\n'
        + 'Продовжите зараз — дні додадуться до залишку, нічого не згорить.',
      buttons: [openAppButton('Продовжити', 'pay')],
    }),
  },
  {
    type: 'subscriptionEnded',
    once: true,
    applies: (user, now) => {
      if (isTrial(user)) return false;
      const until = subscriptionEnd(user);
      return !!until && until <= now && now - until < days(1);
    },
    message: () => ({
      text: '<b>Підписка закінчилася сьогодні.</b>\n\nСловник і прогрес чекають.',
      buttons: [openAppButton('Продовжити', 'pay')],
    }),
  },
  {
    type: 'streakAtRisk',
    // The only repeating one: a streak is worth saving more than once
    once: false,
    applies: (user, now) => {
      const streak = Number(user.streak || 0);
      if (streak < 2) return false;
      if (kyivParts(now).hour !== STREAK_HOUR) return false;
      const active = lastActive(user);
      return !!active && kyivParts(active).day !== kyivParts(now).day;
    },
    message: (user) => ({
      text: `<b>${Number(user.streak || 0)} дн. поспіль</b> — а сьогодні ще нічого не зроблено.\n\n`
        + 'Одне тренування — і серія не обірветься.',
      buttons: [openAppButton('Продовжити серію')],
    }),
  },
  {
    type: 'reactivation',
    once: true,
    applies: (user, now) => {
      const active = lastActive(user);
      return !!active && now - active >= days(REACTIVATION_DAYS);
    },
    message: () => ({
      text: 'Тиждень без занять — буває.\n\n'
        + 'Словник нікуди не подівся: п’ять хвилин сьогодні повернуть ритм.',
      buttons: [openAppButton('Повернутись')],
    }),
  },
];

/** Which scenario, if any, this person should hear about right now. */
function pick(user, now) {
  if (user.notificationsOff === true) return null;
  if (!user.telegramId) return null;
  if (isQuietHour(now)) return null;
  if (alreadySentToday(user, now)) return null;

  for (const scenario of SCENARIOS) {
    if (scenario.once && alreadySent(user, scenario.type)) continue;
    if (scenario.applies(user, now)) return scenario;
  }
  return null;
}

/**
 * The pass itself, with the clock passed in. Keeping it separate from the
 * handler is what lets the schedule be tested at 20:00 Kyiv on a Tuesday
 * without waiting for one.
 */
async function runOnce(now) {
  if (isQuietHour(now)) {
    return { statusCode: 200, body: JSON.stringify({ skipped: 'quiet hours' }) };
  }

  const db = firestore();
  const sent = [];
  const failed = [];

  try {
    // Only people who linked Telegram can be messaged at all
    const snap = await db.collection('users').where('telegramId', '>', 0).get();

    for (const doc of snap.docs) {
      const user = doc.data();
      const scenario = pick(user, now);
      if (!scenario) continue;
      if (scenario.confirm && !(await scenario.confirm(doc.ref))) continue;

      const { text, buttons } = scenario.message(user);
      try {
        await sendMessage(user.telegramId, text, buttons);
        await doc.ref.set({
          notifications: { [scenario.type]: { sentAt: now.toISOString() } },
        }, { merge: true });
        sent.push(scenario.type);
      } catch (error) {
        // Blocked or deleted chat: stop trying rather than failing every hour
        if (error.code === 403) {
          await doc.ref.set({ notificationsOff: true }, { merge: true });
        }
        failed.push({ type: scenario.type, code: error.code || 0 });
      }
    }
  } catch (error) {
    console.error('tg-notify failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'notify failed' }) };
  }

  console.log(`tg-notify: sent ${sent.length}, failed ${failed.length}`);
  return { statusCode: 200, body: JSON.stringify({ sent: sent.length, failed }) };
}

/**
 * Netlify stamps scheduled invocations; a plain HTTP caller cannot. Nothing
 * here is exploitable — the anti-spam rules live in the data, not the trigger —
 * but an endpoint that only the scheduler should reach may as well say so.
 */
exports.handler = (event) => {
  const headers = (event && event.headers) || {};
  const scheduled = headers['x-netlify-event'] === 'schedule';
  if (!scheduled && process.env.NODE_ENV === 'production') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Scheduled function' }) };
  }
  return runOnce(new Date());
};

module.exports.runOnce = runOnce;
module.exports.SCENARIOS = SCENARIOS;
module.exports.pick = pick;
module.exports.isTrial = isTrial;
module.exports.STREAK_HOUR = STREAK_HOUR;
