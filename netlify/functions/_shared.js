'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');

/**
 * Prices live here, never in the browser: the amount a client sends is a wish,
 * not a fact. Everything else keys off the plan id.
 */
const PLANS = {
  30: { days: 30, amount: 99, name: 'Мій словник — підписка на 1 місяць' },
  90: { days: 90, amount: 249, name: 'Мій словник — підписка на 3 місяці' },
  365: { days: 365, amount: 899, name: 'Мій словник — підписка на 1 рік' },
};

const CURRENCY = 'UAH';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

let firebaseApp = null;

function firestore() {
  if (!firebaseApp) {
    const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
    firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

function auth() {
  firestore(); // initialises the app
  return admin.auth();
}

/**
 * WayForPay signs everything with HMAC_MD5 over values joined by ';' —
 * the field ORDER is part of the contract and differs per message.
 */
function sign(values) {
  return crypto
    .createHmac('md5', requiredEnv('WFP_MERCHANT_SECRET'))
    .update(values.join(';'), 'utf8')
    .digest('hex');
}

function purchaseSignature(payload) {
  return sign([
    payload.merchantAccount,
    payload.merchantDomainName,
    payload.orderReference,
    payload.orderDate,
    payload.amount,
    payload.currency,
    ...payload.productName,
    ...payload.productCount,
    ...payload.productPrice,
  ]);
}

function callbackSignature(body) {
  return sign([
    body.merchantAccount,
    body.orderReference,
    body.amount,
    body.currency,
    body.authCode,
    body.cardPan,
    body.transactionStatus,
    body.reasonCode,
  ]);
}

function answerSignature(orderReference, status, time) {
  return sign([orderReference, status, time]);
}

// WayForPay posts JSON, but sometimes wrapped as a single form field
function parseCallbackBody(raw) {
  if (!raw) return null;
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    const decoded = decodeURIComponent(text.replace(/\+/g, ' '));
    const firstBrace = decoded.indexOf('{');
    if (firstBrace === -1) return null;
    return JSON.parse(decoded.slice(firstBrace));
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

module.exports = {
  PLANS,
  CURRENCY,
  requiredEnv,
  firestore,
  auth,
  purchaseSignature,
  callbackSignature,
  answerSignature,
  parseCallbackBody,
  json,
};
