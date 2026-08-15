'use strict';

const {
  firestore, callbackSignature, answerSignature, parseCallbackBody,
} = require('./_shared');

/**
 * The only place a subscription is ever extended.
 *
 * WayForPay calls this directly, so it must not believe the payload before the
 * signature checks out, and it must survive being called twice — the gateway
 * retries until it gets a signed "accept".
 */
exports.handler = async (event) => {
  const body = parseCallbackBody(event.body);
  if (!body || !body.orderReference) return { statusCode: 400, body: 'Bad payload' };

  const answer = (orderReference) => {
    const time = Math.floor(Date.now() / 1000);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderReference,
        status: 'accept',
        time,
        signature: answerSignature(orderReference, 'accept', time),
      }),
    };
  };

  try {
    if (body.merchantSignature !== callbackSignature(body)) {
      console.error('Rejected callback with a bad signature:', body.orderReference);
      return { statusCode: 403, body: 'Bad signature' };
    }

    const db = firestore();
    const orderRef = db.collection('orders').doc(body.orderReference);

    await db.runTransaction(async (tx) => {
      const order = await tx.get(orderRef);
      if (!order.exists) throw new Error('Unknown order ' + body.orderReference);

      const data = order.data();
      // A retry of a call we already honoured must not add days twice
      if (data.status === 'paid') return;

      if (body.transactionStatus !== 'Approved') {
        tx.update(orderRef, {
          status: 'failed',
          transactionStatus: body.transactionStatus,
          reason: body.reason || '',
          closedAt: new Date().toISOString(),
        });
        return;
      }

      if (Number(body.amount) !== Number(data.amount)) {
        throw new Error(`Amount mismatch on ${body.orderReference}: paid ${body.amount}, expected ${data.amount}`);
      }

      const userRef = db.collection('users').doc(data.uid);
      const user = await tx.get(userRef);
      const current = user.exists ? user.data().subscriptionExpiration : null;
      const currentDate = current && current.toDate ? current.toDate() : null;

      // Paying early adds to what is left rather than throwing it away
      const from = currentDate && currentDate > new Date() ? currentDate : new Date();
      const until = new Date(from.getTime() + data.days * 24 * 60 * 60 * 1000);

      tx.update(userRef, {
        subscriptionExpiration: until,
        subscriptionPlan: 'paid',
      });
      tx.update(orderRef, {
        status: 'paid',
        transactionStatus: body.transactionStatus,
        paidAt: new Date().toISOString(),
        subscriptionUntil: until.toISOString(),
        // Kept so a recurring charge can be added later without asking for the card again
        recToken: body.recToken || '',
      });
    });

    return answer(body.orderReference);
  } catch (error) {
    console.error('wayforpay-callback failed:', error);
    // Answering "accept" here would tell the gateway the order is settled
    return { statusCode: 500, body: 'Callback failed' };
  }
};
