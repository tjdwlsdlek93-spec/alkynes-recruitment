import { formatDate } from './recruitment';
import type { RecruitmentData, ExcelChange, ExcelRun, ProcessRequest } from './recruitment';
import { candidateStatus, endedCandidate } from './candidate-state';
import { koreaDate } from './scheduling';

export function excelChanges(before: RecruitmentData, after: RecruitmentData, sourceName: string, at = new Date().toISOString()): ExcelRun {
  const changes: ExcelChange[] = [], counts: Record<string, number> = {};
  const add = (label: string, entity: string, candidateId: string, detail: string) => {
    counts[label] = (counts[label] || 0) + 1;
    changes.push({ label, entity, candidateId, detail });
  };
  const personName = (id: string) => after.candidates.find(c => c.id === id)?.name || before.candidates.find(c => c.id === id)?.name || '공통 요청';
  const date = (v: string | undefined) => v ? formatDate(v) : '';
  const diff = (fields: [string, string | undefined, string | undefined][]) => fields.filter(([, a, b]) => (a || '') !== (b || '')).map(([name, a, b]) => `${name}: ${a || '미입력'} → ${b || '미입력'}`);
  for (const job of after.requisitions.filter(j => j.id.startsWith('excel-job-'))) {
    const old = before.requisitions.find(j => j.id === job.id);
    if (!old || (old.excelMissing && !job.excelMissing)) add('신규 채용', job.id, '', job.role);
    else if (!old.excelMissing && job.excelMissing) add('원본 제외 채용', job.id, '', job.role);
    else if (!job.excelMissing) {
      const details = diff([['직무', old.role, job.role], ['부서', old.department, job.department], ['의뢰자', old.requester, job.requester], ['채용상태', old.status, job.status], ['목표 입사일', old.targetJoin, job.targetJoin]]);
      if (details.length) add('채용 변경', job.id, '', job.role + '\n' + details.join('\n'));
    }
  }
  for (const c of after.candidates.filter(c => c.id.startsWith('excel-person-'))) {
    const old = before.candidates.find(p => p.id === c.id);
    if (!old || (old.excelMissing && !c.excelMissing)) add('신규 지원자', c.id, c.id, c.name);
    else if (!old.excelMissing && c.excelMissing) add('원본 제외 지원자', c.id, c.id, c.name);
    else if (!c.excelMissing) {
      const details = diff([['이름',old.name,c.name], ['지원 공고',old.requisitionId,c.requisitionId], ['연락처',old.phone,c.phone], ['이메일',old.email,c.email], ['경력',old.career,c.career], ['메모',old.notes,c.notes], ['진행상태', candidateStatus(old), candidateStatus(c)], ['현재 선발 단계', old.excelStage, c.excelStage], ['최종 결과', old.excelFinal, c.excelFinal]]);
      if (details.length) add(endedCandidate(c) && !endedCandidate(old) ? '전형 종료' : '진행상태 변경', c.id, c.id, c.name + '\n' + details.join('\n'));
      const joinDates = diff([['입사예정일', date(old.expectedJoin), date(c.expectedJoin)], ['실제 입사일', date(old.actualJoin), date(c.actualJoin)]]);
      if (joinDates.length) add('입사일 변경', c.id, c.id, c.name + '\n' + joinDates.join('\n'));
    }
  }
  for (const i of after.interviews.filter(i => i.source === 'kpi-excel')) {
    const old = before.interviews.find(o => o.id === i.id);
    if (!old) add('신규 면접', i.id, i.candidateId, `${personName(i.candidateId)} · ${formatDate(i.startsAt)}`);
    else {
      const details = diff([['면접일시', date(old.startsAt), date(i.startsAt)], ['면접장소', old.location, i.location], ['면접관', old.interviewers.join(', '), i.interviewers.join(', ')], ['진행상태', old.status, i.status]]);
      if (details.length) add('면접 변경', i.id, i.candidateId, personName(i.candidateId) + '\n' + details.join('\n'));
    }
  }
  for (const i of before.interviews.filter(i => i.source === 'kpi-excel' && !after.interviews.some(o => o.id === i.id))) add('원본 제외 면접', i.id, i.candidateId, `${personName(i.candidateId)} · ${formatDate(i.startsAt)}`);
  const knownValues = (q: ProcessRequest): Record<string, string> => ({ '요청일': date(q.receivedAt), '처리완료일': date(q.completedAt), '인적성 검사 일시': date(q.examAt), '비고': q.notes });
  for (const q of (after.requests || []).filter(q => q.source === 'kpi-excel')) {
    const old = before.requests?.find(o => o.id === q.id);
    if (!old) add('신규 요청', q.id, q.candidateId, `${personName(q.candidateId)} · ${q.stage}`);
    else {
      const previous = old.excelValues || knownValues(old), current = q.excelValues || knownValues(q);
      // On first upgrade compare only fields actually present in the previous record.
      const keys = old.excelValues ? [...new Set([...Object.keys(previous), ...Object.keys(current)])] : Object.keys(previous);
      const details = diff(keys.map(key => [key, previous[key], current[key]]));
      if (old.status !== q.status) details.push(`요청상태: ${old.status} → ${q.status}`);
      if (details.length) add('요청 변경', q.id, q.candidateId, `${personName(q.candidateId)} · ${q.stage}${q.sourceRow ? ' · 원본 ' + q.sourceRow + '행' : ''}\n` + details.join('\n'));
    }
  }
  for (const q of (before.requests || []).filter(q => q.source === 'kpi-excel' && !after.requests?.some(o => o.id === q.id))) add('원본 제외 요청', q.id, q.candidateId, `${personName(q.candidateId)} · ${q.stage}`);
  return { id: crypto.randomUUID(), at, sourceName, counts, changes };
}
export function changeSummary(counts: Record<string, number>) {
  return Object.entries(counts).filter(([, n]) => n).map(([label, n]) => `${label} ${n}건`).join(' · ') || '변경 없음';
}
export function groupExcelRuns(runs: ExcelRun[]) {
  const days = new Map<string, { date: string; runs: ExcelRun[]; counts: Record<string, number>; changes: number }>();
  for (const run of runs) {
    const date = koreaDate(run.sourceModifiedAt || run.at);
    const group = days.get(date) || { date, runs: [], counts: {}, changes: 0 };
    group.runs.push(run); group.changes += run.changes.length;
    for (const [label, count] of Object.entries(run.counts)) group.counts[label] = (group.counts[label] || 0) + count;
    days.set(date, group);
  }
  return [...days.values()].sort((a,b) => b.date.localeCompare(a.date)).map(group => ({ ...group, runs: [...group.runs].sort((a,b) => b.at.localeCompare(a.at)) }));
}
