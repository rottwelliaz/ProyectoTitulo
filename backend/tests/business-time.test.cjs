require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { businessDate, businessRange, parseInstant, checkRangeEnd } = require('../src/services/businessTime');
const { endOf, overlaps } = require('../src/services/schedule');

for (const tz of ['UTC', 'America/Santiago', 'America/New_York', 'Asia/Tokyo']) {
  test(`conversiones independientes de la zona del servidor: ${tz}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
      assert.equal(businessDate(parseInstant('2026-01-16T02:30:00Z')), '2026-01-15');
      assert.equal(businessDate(parseInstant('2026-07-16T03:30:00Z')), '2026-07-15');
      assert.equal(businessDate(parseInstant('2026-01-16T03:00:00Z')), '2026-01-16');
      for (const [day, start, end, hours] of [
        ['2026-01-15', '2026-01-15T03:00:00.000Z', '2026-01-16T03:00:00.000Z', 24],
        ['2026-07-15', '2026-07-15T04:00:00.000Z', '2026-07-16T04:00:00.000Z', 24],
        ['2026-04-04', '2026-04-04T03:00:00.000Z', '2026-04-05T04:00:00.000Z', 25],
        ['2026-09-06', '2026-09-06T04:00:00.000Z', '2026-09-07T03:00:00.000Z', 23],
      ]) {
        const range = businessRange(day);
        assert.equal(range.start.toISOString(), start);
        assert.equal(range.end.toISOString(), end);
        assert.equal((range.end - range.start) / 3600000, hours);
        assert.equal(businessDate(new Date(range.end - 1)), day);
      }
      for (const [day, hours] of [['2026-03-30', 169], ['2026-08-31', 167]]) {
        const { start, end } = businessRange(day, 7);
        assert.equal((end - start) / 3600000, hours);
        assert.deepEqual(businessRange(start.toISOString(), 7), { start, end });
      }
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
}

test('entradas ambiguas, fechas inexistentes y límites UTC incorrectos se rechazan', () => {
  for (const input of [null, '', '2026-02-30', '2026-1-2', '2026-09-06T00:00:00', '2026-09-06T00:00:00Z']) {
    assert.throws(() => businessRange(input), RangeError);
  }
  assert.throws(() => parseInstant('2026-04-04T23:30:00'), RangeError);
  assert.notEqual(parseInstant('2026-04-04T23:30:00-03:00').getTime(), parseInstant('2026-04-04T23:30:00-04:00').getTime());
  assert.throws(() => checkRangeEnd('2026-01-16T00:00:00Z', businessRange('2026-01-15').end), RangeError);
});

test('la duración transcurrida sigue siendo exacta al repetir o saltar una hora', () => {
  const repeatedStart = parseInstant('2026-04-04T23:30:00-03:00');
  const repeatedEnd = parseInstant('2026-04-04T23:30:00-04:00');
  assert.equal(endOf(repeatedStart, 60).getTime(), repeatedEnd.getTime());
  assert.equal(overlaps(repeatedStart, repeatedEnd, repeatedEnd, endOf(repeatedEnd, 30)), false);
  const springStart = parseInstant('2026-09-05T23:30:00-04:00');
  assert.equal(endOf(springStart, 60).toISOString(), '2026-09-06T04:30:00.000Z');
  assert.equal(businessDate(endOf(springStart, 60)), '2026-09-06');
});
