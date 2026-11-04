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

test('contrato Organización/API: mismos bloques completos, cierre inclusivo y entrada variable', () => {
  const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
  const filename = require('node:path').resolve(__dirname, '../../Frontend/src/lib/calendarIntervals.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = new Module(filename); module._compile(compiled, filename);
  const { buildSlotTimes, slotEndMinute } = module.exports;
  const { gridMinutes, bookingInterval } = require('../src/services/calendarGrid');
  const { slotInstant } = require('../src/services/businessTime');
  for (const startTime of ['08:30', '09:00', '10:30']) for (const endTime of ['12:30', '19:00']) for (const blockMinutes of [30, 45, 60]) {
    const config = { startTime, endTime, blockMinutes }, starts = buildSlotTimes(config);
    assert.deepEqual(starts, gridMinutes(config));
    assert.equal(new Set(starts).size, starts.length);
    for (const minute of starts) {
      const interval = bookingInterval(slotInstant('2035-01-15', `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`), config);
      assert.ok(interval); assert.equal(+interval.end - +interval.start, blockMinutes * 60000);
      assert.equal(slotEndMinute(minute, config), minute + blockMinutes);
      assert.ok(slotEndMinute(minute, config) <= Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3)));
    }
  }
  assert.equal(buildSlotTimes({ startTime: '09:00', endTime: '19:00', blockMinutes: 30 }).at(-1), 1110);
  assert.equal(buildSlotTimes({ startTime: '09:00', endTime: '19:00', blockMinutes: 45 }).at(-1), 1080);
  assert.equal(buildSlotTimes({ startTime: '09:00', endTime: '19:00', blockMinutes: 60 }).at(-1), 1080);
});
