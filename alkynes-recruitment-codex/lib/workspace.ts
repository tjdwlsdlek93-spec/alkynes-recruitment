import type { RecruitmentData, Interview, SharedNotice, ProcessRequest } from './recruitment';
import { activeInterview, interviewGroup } from './interview-state';
import { closedJob } from './recruitment-view';
import { endedCandidate } from './candidate-state';
import { koreaDate } from './scheduling';

export type NoticeTarget = { kind: SharedNotice['kind']; id: string };
export function noticeSignature(data: RecruitmentData, target: NoticeTarget): string {
  const row = target.kind === 'interview' ? data.interviews.find(i => i.id === target.id) : data.requests?.find(q => q.id === target.id);
  if (!row) return '';
  const c = data.candidates.find(c => c.id === row.candidateId);
  const jobId = c?.requisitionId || ('requisitionId' in row ? row.requisitionId : '');
  const job = data.requisitions.find(j => j.id === jobId);
  const details = target.kind === 'interview'
    ? [(row as Interview).startsAt, (row as Interview).location, (row as Interview).interviewers, row.status]
    : [(row as ProcessRequest).examDeadline || '', (row as ProcessRequest).examAt || '', row.status];
  return JSON.stringify([target.kind, target.id, c?.name || '', job?.role || '', c?.status || '', c?.excelMissing || false, job?.excelMissing || false, job?.status || '', ...details]);
}
export function noticeState(data: RecruitmentData, target: NoticeTarget, audience: SharedNotice['audience']) {
  const saved = data.sharedNotices?.find(n => n.kind === target.kind && n.targetId === target.id && n.audience === audience);
  return { saved, current: !!saved && saved.signature === noticeSignature(data, target) };
}
export function markNotice(data: RecruitmentData, target: NoticeTarget, audience: SharedNotice['audience'], signature: string, done: boolean) {
  if (!signature || signature !== noticeSignature(data, target)) throw Error('일정이 변경되었습니다. 안내문을 다시 열어 확인해 주세요.');
  if (target.kind === 'aptitude' && audience !== 'internal') throw Error('인적성 안내는 사내 공유만 지원합니다.');
  data.sharedNotices = (data.sharedNotices || []).filter(n => !(n.kind === target.kind && n.targetId === target.id && n.audience === audience));
  if (done) {
    const row = target.kind === 'interview' ? data.interviews.find(i => i.id === target.id)! : data.requests!.find(q => q.id === target.id)!;
    data.sharedNotices.unshift({ id: crypto.randomUUID(), kind: target.kind, targetId: target.id, candidateId: row.candidateId, audience, signature, at: new Date().toISOString() });
  }
}
export function interviewConflicts(data: RecruitmentData, now = Date.now()) {
  const rows = data.interviews.filter(i => activeInterview(data, i) && i.status !== '면접완료' && Date.parse(i.startsAt) + (i.durationMinutes || 60) * 60000 > now);
  const conflicts: { first: Interview; second: Interview; reasons: string[] }[] = [];
  const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
    const x = rows[a], y = rows[b], startX = Date.parse(x.startsAt), startY = Date.parse(y.startsAt);
    if (startX >= startY + (y.durationMinutes || 60) * 60000 || startY >= startX + (x.durationMinutes || 60) * 60000) continue;
    const reasons: string[] = [];
    if (x.candidateId === y.candidateId) reasons.push('동일 지원자');
    if (x.location && !/미입력|미정|미지정/.test(x.location) && normalize(x.location) === normalize(y.location)) reasons.push('같은 장소');
    const people = x.interviewers.filter(name => !/미지정|미입력|미정/.test(name) && y.interviewers.some(other => normalize(name) === normalize(other)));
    if (people.length) reasons.push('면접관: ' + people.join(', '));
    if (reasons.length) conflicts.push({ first: x, second: y, reasons });
  }
  return conflicts;
}
export type WorkItem = { id: string; title: string; detail: string; href: string; at: string; urgent: boolean };
export function todayWork(data: RecruitmentData, now = Date.now()): WorkItem[] {
  const result: WorkItem[] = [], today = koreaDate(new Date(now).toISOString());
  const activePerson = (id: string, jobId: string) => {
    const c = data.candidates.find(c => c.id === id), job = data.requisitions.find(j => j.id === jobId);
    return !!job && !job.excelMissing && !closedJob(job) && (!id || (!!c && !c.excelMissing && !endedCandidate(c)));
  };
  const person = (id: string) => data.candidates.find(c => c.id === id)?.name || '공통 요청';
  for (const i of data.interviews.filter(i => activeInterview(data, i) && i.status !== '면접완료')) {
    const href = '/interviews?candidate=' + encodeURIComponent(i.candidateId), group = interviewGroup(data, i, now);
    if (group === 'review') result.push({ id: 'review-' + i.id, title: '면접 결과 확인', detail: person(i.candidateId), at: i.startsAt, href, urgent: true });
    else if (koreaDate(i.startsAt) === today) result.push({ id: 'today-' + i.id, title: '오늘 면접', detail: person(i.candidateId) + ' · ' + i.location, at: i.startsAt, href, urgent: false });
    if (group === 'scheduled' && Date.parse(i.startsAt) < now + 7 * 86400000) {
      const pending = (['candidate', 'internal'] as const).filter(a => !noticeState(data, { kind: 'interview', id: i.id }, a).current);
      if (pending.length) result.push({ id: 'notice-' + i.id, title: '면접 안내 확인', detail: person(i.candidateId) + ' · ' + pending.map(a => a === 'candidate' ? '지원자 미안내' : '사내 미공유').join(' / '), at: i.startsAt, href, urgent: koreaDate(i.startsAt) === today });
    }
  }
  for (const q of data.requests || []) {
    if (!activePerson(q.candidateId, q.requisitionId) || q.status === '취소') continue;
    if (!q.candidateId && ['면접 요청', '인적성 검사 요청'].includes(q.stage) && data.requests?.some(other => other.requisitionId === q.requisitionId && other.stage === q.stage && other.candidateId)) continue;
    if (q.status === '요청 전' && q.dueAt && (koreaDate(q.dueAt) <= today)) result.push({ id: 'request-' + q.id, title: Date.parse(q.dueAt) < now ? '요청 처리기한 초과' : '오늘 요청 처리', detail: person(q.candidateId) + ' · ' + q.stage, at: q.dueAt, href: '/requests?request=' + encodeURIComponent(q.id), urgent: Date.parse(q.dueAt) < now });
    if (q.stage === '인적성 검사 요청' && q.examStatus !== '실시완료') {
      if (q.examDeadline && Date.parse(q.examDeadline) <= now + 3 * 86400000) result.push({ id: 'aptitude-' + q.id, title: Date.parse(q.examDeadline) < now ? '인적성 응시기한 경과' : '인적성 응시기한 임박', detail: person(q.candidateId), at: q.examDeadline, href: '/aptitudes', urgent: Date.parse(q.examDeadline) < now });
      if (q.status === '요청 완료' && !noticeState(data, { kind: 'aptitude', id: q.id }, 'internal').current) result.push({ id: 'aptitude-notice-' + q.id, title: '인적성 사내 공유 확인', detail: person(q.candidateId), at: q.completedAt || q.receivedAt, href: '/aptitudes', urgent: false });
    }
  }
  return result.sort((a,b) => Number(b.urgent) - Number(a.urgent) || a.at.localeCompare(b.at));
}
export function candidateTimeline(data: RecruitmentData, id: string) {
  const items: { id: string; at: string; title: string; detail: string }[] = [];
  const add = (key: string, at: string | undefined, title: string, detail = '') => { if (at) items.push({ id: key, at, title, detail }); };
  for (const q of data.requests || []) if (q.candidateId === id) {
    add(q.id + '-received', q.receivedAt, q.stage + ' 접수', q.status);
    add(q.id + '-completed', q.completedAt, q.stage + ' 처리 완료');
    add(q.id + '-exam', q.examAt, '인적성 검사 일정', q.examStatus || '');
  }
  for (const i of data.interviews.filter(i => i.candidateId === id)) {
    add(i.id, i.startsAt, '면접 일정', i.status + ' · ' + i.location + ' · ' + i.interviewers.join(', '));
    for (const e of data.evaluations.filter(e => e.interviewId === i.id)) add(e.id, e.updatedAt, '면접 평가', e.evaluator + ' · ' + e.overall);
  }
  for (const n of data.sharedNotices || []) if (n.candidateId === id) add(n.id, n.at, (n.kind === 'interview' ? '면접' : '인적성') + ' 안내 완료 기록', n.audience === 'candidate' ? '지원자 안내' : '사내 공유');
  const c = data.candidates.find(c => c.id === id);
  add('expected-join', c?.expectedJoin, '입사 예정'); add('actual-join', c?.actualJoin, '실제 입사');
  for (const run of data.excelRuns || []) for (const [index, change] of run.changes.entries()) if (change.candidateId === id) add(run.id + '-' + index, run.at, '엑셀 반영 · ' + change.label, change.detail);
  return items.sort((a,b) => b.at.localeCompare(a.at));
}
