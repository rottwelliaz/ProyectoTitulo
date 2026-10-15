require('ts-node/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { overlaps, covers, endOf } = require('../src/services/schedule');
const at = minutes => new Date(Date.UTC(2035, 0, 1, 10, minutes));

test('intervalos semiabiertos: contiene, contenido, parcial y consecutivo', () => {
  for (const [start, end] of [[0, 60], [-15, 75], [15, 30], [-30, 30], [30, 90]]) {
    assert.equal(overlaps(at(0), at(60), at(start), at(end)), true);
  }
  assert.equal(overlaps(at(0), at(60), at(60), at(90)), false);
  assert.equal(overlaps(at(0), at(60), at(-30), at(0)), false);
  assert.equal(endOf(at(0), 60).getTime(), at(60).getTime());
});

test('cobertura une bloques adyacentes sin saltar descansos ni ampliar el cierre', () => {
  const window = (start, end) => ({ fecha_hora: at(start), disponibleHasta: at(end) });
  assert.equal(covers(at(0), at(60), [window(30, 60), window(0, 30)]), true);
  assert.equal(covers(at(0), at(60), [window(0, 30), window(45, 90)]), false);
  assert.equal(covers(at(0), at(60), [window(0, 45)]), false);
  assert.equal(covers(at(0), at(60), [{ fecha_hora: at(0), disponibleHasta: null }]), false);
});
