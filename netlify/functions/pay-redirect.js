'use strict';

const { firestore, PLANS, CURRENCY, requiredEnv, purchaseSignature } = require('./_shared');

/**
 * The page WayForPay is reached through from inside Telegram.
 *
 * The gateway wants a POST with a signed form. Telegram.WebApp.openLink() can
 * only open a plain URL, so the Mini App opens this address instead and the
 * form is built and submitted here — where the merchant secret already lives.
 *
 * It re-signs from the stored order rather than accepting an amount over the
 * wire: the order was written when the plan was chosen, and that record, not
 * the query string, decides what is charged.
 */

function page(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

function errorPage(text) {
  return page(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Оплата</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f1117; color:#F0EDE8; font-family:-apple-system,system-ui,sans-serif; padding:24px; }
  div { max-width:340px; text-align:center; line-height:1.5; }
</style>
<div>${text}</div>`);
}

exports.handler = async (event) => {
  const orderReference = (event.queryStringParameters || {}).order;
  if (!orderReference) return errorPage('Замовлення не вказано.');

  try {
    const db = firestore();
    const snap = await db.collection('orders').doc(orderReference).get();
    if (!snap.exists) return errorPage('Замовлення не знайдено. Спробуй оформити ще раз.');

    const order = snap.data();
    if (order.status === 'paid') {
      return errorPage('Це замовлення вже оплачено. Повертайся у застосунок.');
    }

    const plan = PLANS[order.plan];
    if (!plan) return errorPage('Невідомий тариф.');

    const domain = requiredEnv('WFP_MERCHANT_DOMAIN');
    const payload = {
      merchantAccount: requiredEnv('WFP_MERCHANT_ACCOUNT'),
      merchantDomainName: domain,
      merchantTransactionSecureType: 'AUTO',
      orderReference,
      // The signature covers orderDate, so it has to be the one already stored
      orderDate: order.orderDate || Math.floor(new Date(order.createdAt).getTime() / 1000),
      amount: order.amount,
      currency: CURRENCY,
      productName: [plan.name],
      productCount: [1],
      productPrice: [order.amount],
      clientEmail: order.email || '',
      language: 'UA',
      returnUrl: `https://${domain}/paid?order=${encodeURIComponent(orderReference)}`,
      serviceUrl: `https://${domain}/.netlify/functions/wayforpay-callback`,
    };
    payload.merchantSignature = purchaseSignature(payload);

    const fields = Object.entries(payload).flatMap(([key, value]) => (
      Array.isArray(value)
        ? value.map((v) => `<input type="hidden" name="${key}[]" value="${escapeAttr(v)}">`)
        : [`<input type="hidden" name="${key}" value="${escapeAttr(value)}">`]
    )).join('\n');

    return page(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Переходимо до оплати…</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f1117; color:rgba(240,237,232,0.6); font-family:-apple-system,system-ui,sans-serif; }
  .spin { width:26px; height:26px; margin:0 auto 14px; border-radius:50%;
          border:3px solid rgba(232,168,56,0.25); border-top-color:#E8A838;
          animation:spin .8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  noscript button { margin-top:12px; padding:12px 20px; border:0; border-radius:10px;
                    background:#E8A838; color:#1a1a1a; font-weight:600; }
</style>
<div style="text-align:center">
  <div class="spin"></div>
  Переходимо до захищеної оплати…
  <form id="f" method="POST" action="https://secure.wayforpay.com/pay" accept-charset="utf-8">
    ${fields}
    <noscript><button type="submit">Продовжити</button></noscript>
  </form>
</div>
<script>document.getElementById('f').submit();</script>`);
  } catch (error) {
    console.error('pay-redirect failed:', error);
    return errorPage('Не вдалося відкрити оплату. Спробуй ще раз за хвилину.');
  }
};

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

module.exports.escapeAttr = escapeAttr;
