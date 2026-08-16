'use strict';

/**
 * Where the browser lands after WayForPay is done.
 *
 * The access itself was granted by the callback, server to server, before this
 * page ever loaded — so this is only about getting the person back where they
 * were. From Telegram that means the Mini App; from a plain browser, the site.
 *
 * No Firestore read, no signature check: nothing here decides anything, and a
 * page that decided nothing cannot be tricked into deciding wrongly.
 */

exports.handler = async (event) => {
  const order = (event.queryStringParameters || {}).order || '';
  const bot = process.env.TG_BOT_USERNAME;
  const app = process.env.TG_MINIAPP_NAME;
  const domain = process.env.WFP_MERCHANT_DOMAIN || '';

  const back = bot && app
    ? `https://t.me/${bot}/${app}?startapp=paid`
    : `https://${domain}/?paid=${encodeURIComponent(order)}`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Оплата завершена</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f1117; color:#F0EDE8; font-family:-apple-system,system-ui,sans-serif; padding:24px; }
  .card { max-width:340px; text-align:center; }
  .tick { font-size:44px; line-height:1; margin-bottom:14px; }
  p { color:rgba(240,237,232,0.6); line-height:1.5; margin:0 0 22px; }
  a { display:inline-block; padding:14px 24px; border-radius:12px; background:#FFD700;
      color:#1a1a1a; font-weight:600; text-decoration:none; }
</style>
<div class="card">
  <div class="tick">✅</div>
  <h2>Дякуємо за оплату</h2>
  <p>Доступ уже відкрито. Якщо статус ще старий — просто онови застосунок.</p>
  <a href="${back}">Повернутись у застосунок</a>
</div>
<script>
  // Straight back if this is a normal browser tab; inside Telegram's in-app
  // browser the button is more reliable than an automatic jump
  setTimeout(function () { location.href = ${JSON.stringify(back)}; }, 1500);
</script>`,
  };
};
