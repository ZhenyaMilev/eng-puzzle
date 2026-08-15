'use strict';

const crypto = require('crypto');
const { requiredEnv } = require('./_shared');

/**
 * Everything the three Telegram functions share: talking to the Bot API,
 * telling Kyiv time, and the rules about when a person may be messaged.
 */

const API = 'https://api.telegram.org/bot';
const KYIV = 'Europe/Kyiv';

// Nobody wants a study reminder at three in the morning
const QUIET_FROM = 22;
const QUIET_UNTIL = 9;

function botToken() {
  return requiredEnv('TG_BOT_TOKEN');
}

async function callBot(method, payload) {
  const response = await fetch(`${API}${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) {
    // 403 is the normal way Telegram says "this person blocked the bot"
    const error = new Error(`Telegram ${method} failed: ${data.description || response.status}`);
    error.code = data.error_code || response.status;
    throw error;
  }
  return data.result;
}

/** A message with an optional row of buttons. Silent inside quiet hours never happens — we simply do not send. */
function sendMessage(chatId, text, buttons) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (buttons && buttons.length) {
    payload.reply_markup = { inline_keyboard: buttons.map((row) => (Array.isArray(row) ? row : [row])) };
  }
  return callBot('sendMessage', payload);
}

/** Opens the Mini App if one is configured, otherwise the plain site. */
function openAppButton(text, startParam) {
  const miniApp = process.env.TG_MINIAPP_NAME;
  const botName = process.env.TG_BOT_USERNAME;
  if (miniApp && botName) {
    const suffix = startParam ? `?startapp=${encodeURIComponent(startParam)}` : '';
    return { text, url: `https://t.me/${botName}/${miniApp}${suffix}` };
  }
  return { text, url: `https://${requiredEnv('WFP_MERCHANT_DOMAIN')}` };
}

// ---------------------------------------------------------------- Kyiv clock

/** Parts of "now" as Kyiv sees it, whatever the server thinks the time is. */
function kyivParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date || new Date())) parts[p.type] = p.value;
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}

function isQuietHour(date) {
  const { hour } = kyivParts(date);
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
}

function kyivDay(date) {
  return kyivParts(date).day;
}

// ---------------------------------------------------------------- send rules

/** Firestore timestamps, ISO strings and Dates all arrive here; only one shape leaves. */
function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(from, to) {
  return Math.ceil((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * A person hears from us at most once a day, and never twice about the same
 * thing. Both rules live here so no scenario can forget one of them.
 */
function alreadySentToday(user, date) {
  const today = kyivDay(date);
  const all = (user && user.notifications) || {};
  return Object.keys(all).some((type) => {
    const sentAt = toDate(all[type] && all[type].sentAt);
    return sentAt && kyivDay(sentAt) === today;
  });
}

function alreadySent(user, type) {
  const record = user && user.notifications && user.notifications[type];
  return !!(record && record.sentAt);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  API,
  KYIV,
  QUIET_FROM,
  QUIET_UNTIL,
  callBot,
  sendMessage,
  openAppButton,
  kyivParts,
  kyivDay,
  isQuietHour,
  toDate,
  daysBetween,
  alreadySentToday,
  alreadySent,
  escapeHtml,
  verifyWebhookSecret: (headers) => {
    const got = headers['x-telegram-bot-api-secret-token'] || headers['X-Telegram-Bot-Api-Secret-Token'];
    const want = requiredEnv('TG_WEBHOOK_SECRET');
    if (!got || got.length !== want.length) return false;
    // Constant time: a length-safe compare so the secret cannot be guessed byte by byte
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  },
};
