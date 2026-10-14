import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedData,
  validateData,
  nextCode,
  calendarFile,
} from '../lib/recruitment.ts';

test('backup validation rejects broken references, duplicate IDs and malformed fields', () => {
  assert.equal(validateData(seedData()), true);
  for (const mutate of [
    (d) => {
      d.candidates[0].requisitionId = 'missing';
    },
    (d) => {
      d.interviews[0].candidateId = 'missing';
    },
    (d) => {
      d.requisitions.push({ ...d.requisitions[0] });
    },
    (d) => {
      d.requisitions[0].headcount = 0;
    },
    (d) => {
      d.interviews[0].startsAt = 'invalid';
    },
    (d) => {
      d.candidates[0].resumeData = 'data:text/html;base64,PHNjcmlwdD4=';
    },
    (d) => {
      d.interviews[0].interviewers = [];
    },
    (d) => {
      d.requisitions[0] = null;
    },
  ]) {
    const d = seedData();
    mutate(d);
    assert.equal(validateData(d), false);
  }
  assert.equal(validateData({ version: 1 }), false);
});
test('requisition numbering uses the maximum existing sequence and resets each year', () => {
  const rows = seedData().requisitions;
  rows.push({ ...rows[0], id: 'extra', code: 'HR-2026-012' });
  assert.equal(nextCode(rows, 2026), 'HR-2026-013');
  assert.equal(nextCode(rows, 2027), 'HR-2027-001');
});
test('calendar exports UTC times, escaped text and valid UTF-8 line folding', () => {
  const d = seedData();
  const i = {
    ...d.interviews[0],
    location: '본사, 2층;회의실\n안내',
    interviewers: ['김'.repeat(100)],
  };
  const ics = calendarFile(i, d.candidates[0]);
  assert.ok(ics.includes('DTSTART:20261020T050000Z'));
  assert.ok(ics.includes('DTEND:20261020T060000Z'));
  assert.ok(ics.includes('LOCATION:본사\\, 2층\\;회의실\\n안내'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n'))
    assert.ok(Buffer.byteLength(line) <= 75);
});
