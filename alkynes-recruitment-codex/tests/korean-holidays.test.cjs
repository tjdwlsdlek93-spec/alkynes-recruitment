const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/korean-holidays.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled, filename);
const { calendarDay, koreanHolidays } = loaded.exports;

test('weekends and named public holidays use distinct colors, with holidays taking priority over Saturday', () => {
  assert.deepEqual(calendarDay('2026-10-10'), { holidays: [], tone: 'blue' });
  assert.deepEqual(calendarDay('2026-10-11'), { holidays: [], tone: 'red' });
  assert.deepEqual(calendarDay('2026-10-12'), { holidays: [], tone: 'normal' });
  assert.deepEqual(calendarDay('2026-10-09'), { holidays: ['한글날'], tone: 'red' });
  assert.deepEqual(calendarDay('2026-10-03'), { holidays: ['개천절'], tone: 'red' });
  assert.deepEqual(calendarDay('2026-10-05'), { holidays: ['개천절 (대체공휴일)'], tone: 'red' });
});

test('lunar holidays include exactly their three days and correctly labeled substitute days', () => {
  for (const date of ['2026-02-16', '2026-02-17', '2026-02-18']) assert.deepEqual(calendarDay(date).holidays, ['설날']);
  assert.deepEqual(calendarDay('2026-02-15').holidays, []);
  assert.deepEqual(calendarDay('2026-02-19').holidays, []);
  for (const date of ['2027-02-06', '2027-02-07', '2027-02-08']) assert.deepEqual(calendarDay(date).holidays, ['설날']);
  assert.deepEqual(calendarDay('2027-02-09').holidays, ['설날 (대체공휴일)']);
  assert.deepEqual(calendarDay('2027-02-10').holidays, []);
  for (const date of ['2026-09-24', '2026-09-25', '2026-09-26']) assert.deepEqual(calendarDay(date).holidays, ['추석']);
  assert.deepEqual(calendarDay('2026-09-27').holidays, []);
  assert.deepEqual(calendarDay('2025-10-08').holidays, ['추석 (대체공휴일)']);
});

test('only public holidays are red; confirmed elections, collisions and current rules are included', () => {
  assert.deepEqual(calendarDay('2026-05-01').holidays, []); // Labor Day is not a universal public holiday.
  assert.deepEqual(calendarDay('2026-06-03').holidays, ['전국동시지방선거일']);
  assert.deepEqual(calendarDay('2025-01-27').holidays, ['임시공휴일']);
  assert.deepEqual(calendarDay('2026-05-25').holidays, ['부처님오신날 (대체공휴일)']);
  assert.deepEqual(calendarDay('2026-12-25').holidays, ['성탄절']);
  assert.deepEqual(calendarDay('2025-07-17').holidays, []);
  assert.deepEqual(calendarDay('2026-07-17').holidays, ['제헌절']);
  assert.equal(calendarDay('2025-05-06').holidays.length, 2);
  assert.deepEqual(calendarDay('2026-06-08').holidays, []); // Memorial Day has no Saturday substitute.
  assert.equal(koreanHolidays(2026), koreanHolidays(2026));
});
