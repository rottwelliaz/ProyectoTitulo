require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentAccessLimiter, PaymentAccessLimit } = require('../src/services/paymentAccess');

test('cuota bancaria por cliente limita profesionales, reintentos y caduca', () => {
  let time = 0;
  const limiter = createPaymentAccessLimiter(() => time);
  for (const barber of [1, 2, 3]) { limiter.attempt(1); limiter.disclose(1, barber); }
  assert.throws(() => limiter.disclose(1, 4), PaymentAccessLimit);
  limiter.disclose(1, 1); // Same selected professional does not consume another disclosure.
  limiter.attempt(2); limiter.disclose(2, 4); // Other users have independent quotas.
  for (let i = 0; i < 17; i++) limiter.attempt(1);
  assert.throws(() => limiter.attempt(1), PaymentAccessLimit);
  time = 15 * 60_000;
  limiter.attempt(1); limiter.disclose(1, 4);
});
