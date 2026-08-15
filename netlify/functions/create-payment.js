'use strict';

const {
  PLANS, CURRENCY, requiredEnv, firestore, auth, purchaseSignature, json,
} = require('./_shared');

/**
 * Signs a WayForPay purchase for the signed-in user and remembers the order.
 *
 * The caller only says WHICH plan; the price comes from the table here, and the
 * order is written down so the callback grants exactly what was paid for
 * instead of trusting whatever comes back over the wire.
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'Not signed in' });

    let user;
    try {
      user = await auth().verifyIdToken(token);
    } catch (e) {
      return json(401, { error: 'Not signed in' });
    }

    const { plan } = JSON.parse(event.body || '{}');
    const chosen = PLANS[plan];
    if (!chosen) return json(400, { error: 'Unknown plan' });

    const orderReference = `sub-${user.uid}-${Date.now()}`;
    const orderDate = Math.floor(Date.now() / 1000);

    await firestore().collection('orders').doc(orderReference).set({
      uid: user.uid,
      email: user.email || '',
      plan: Number(plan),
      days: chosen.days,
      amount: chosen.amount,
      currency: CURRENCY,
      status: 'created',
      createdAt: new Date().toISOString(),
    });

    const payload = {
      merchantAccount: requiredEnv('WFP_MERCHANT_ACCOUNT'),
      merchantDomainName: requiredEnv('WFP_MERCHANT_DOMAIN'),
      merchantTransactionSecureType: 'AUTO',
      orderReference,
      orderDate,
      amount: chosen.amount,
      currency: CURRENCY,
      productName: [chosen.name],
      productCount: [1],
      productPrice: [chosen.amount],
      clientEmail: user.email || '',
      language: 'UA',
      returnUrl: `https://${requiredEnv('WFP_MERCHANT_DOMAIN')}/?paid=${encodeURIComponent(orderReference)}`,
      serviceUrl: `https://${requiredEnv('WFP_MERCHANT_DOMAIN')}/.netlify/functions/wayforpay-callback`,
    };
    payload.merchantSignature = purchaseSignature(payload);

    return json(200, { action: 'https://secure.wayforpay.com/pay', payload });
  } catch (error) {
    console.error('create-payment failed:', error);
    return json(500, { error: 'Payment could not be started' });
  }
};
