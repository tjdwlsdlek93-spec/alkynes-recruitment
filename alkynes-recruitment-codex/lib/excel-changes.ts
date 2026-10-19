import { formatDate } from './recruitment';
import type { RecruitmentData, ExcelChange, ExcelRun } from './recruitment';
import { candidateStatus, endedCandidate } from './candidate-state';

export function excelChanges(before: RecruitmentData, after: RecruitmentData, sourceName: string, at = new Date().toISOString()): ExcelRun {
  const changes: ExcelChange[] = [], counts: Record<string, number> = {};
  const add = (label: string, entity: string, candidateId: string, detail: string) => {
    counts[label] = (counts[label] || 0) + 1;
    changes.push({ label, entity, candidateId, detail });
  };
  const personName = (id: string) => after.candidates.find(c => c.id === id)?.name || before.candidates.find(c => c.id === id)?.name || '공통 요청';
  const labelDate = (v: string) => v ? formatDate(v) : '미입력';
  for (const job of after.requisitions.filter(j => j.id.startsWith('excel-job-'))) {
    const old = before.requisitions.find(j => j.id === job.id);
    if (!old || (old.excelMissing && !job.excelMissing)) add('신규 채용', job.id, '', job.role);
    else if (!old.excelMissing && job.excelMissing) add('원본 제외 채용', job.id, '', job.role);
    else if (!job.excelMissing && JSON.stringify([old.role, old.department, old.status]) !== JSON.stringify([job.role, job.department, job.status])) add('채용 변경', job.id, '', `${job.role}: ${old.status} → ${job.status}`);
  }
  for (const c of after.candidates.filter(c => c.id.startsWith('excel-person-'))) {
    const old = before.candidates.find(p => p.id === c.id);
    if (!old || (old.excelMissing && !c.excelMissing)) add('신규 지원자', c.id, c.id, c.name);
    else if (!old.excelMissing && c.excelMissing) add('원본 제외 지원자', c.id, c.id, c.name);
    else if (!c.excelMissing) {
      if (endedCandidate(c) && !endedCandidate(old)) add('전형 종료', c.id, c.id, `${c.name}: ${candidateStatus(old)} → ${candidateStatus(c)}`);
      else if (candidateStatus(c) !== candidateStatus(old)) add('진행상태 변경', c.id, c.id, `${c.name}: ${candidateStatus(old)} → ${candidateStatus(c)}`);
      if (JSON.stringify([old.expectedJoin, old.actualJoin]) !== JSON.stringify([c.expectedJoin, c.actualJoin])) add('입사일 변경', c.id, c.id, `${c.name}: 입사예정 ${labelDate(old.expectedJoin || '')} → ${labelDate(c.expectedJoin || '')}, 실제입사 ${labelDate(old.actualJoin || '')} → ${labelDate(c.actualJoin || '')}`);
    }
  }
  for (const i of after.interviews.filter(i => i.source === 'kpi-excel')) {
    const old = before.interviews.find(o => o.id === i.id);
    if (!old) add('신규 면접', i.id, i.candidateId, `${personName(i.candidateId)} · ${formatDate(i.startsAt)}`);
    else if (JSON.stringify([i.startsAt, i.location, i.interviewers, i.status]) !== JSON.stringify([old.startsAt, old.location, old.interviewers, old.status])) add('면접 변경', i.id, i.candidateId, `${personName(i.candidateId)} · ${formatDate(i.startsAt)} · ${old.location} → ${i.location} · ${old.interviewers.join(', ')} → ${i.interviewers.join(', ')} · ${old.status} → ${i.status}`);
  }
  for (const i of before.interviews.filter(i => i.source === 'kpi-excel' && !after.interviews.some(o => o.id === i.id))) add('원본 제외 면접', i.id, i.candidateId, `${personName(i.candidateId)} · ${formatDate(i.startsAt)}`);
  for (const q of (after.requests || []).filter(q => q.source === 'kpi-excel')) {
    const old = before.requests?.find(o => o.id === q.id);
    if (!old) add('신규 요청', q.id, q.candidateId, `${personName(q.candidateId)} · ${q.stage}`);
    else if (JSON.stringify([q.receivedAt, q.dueAt, q.completedAt, q.examAt, q.status]) !== JSON.stringify([old.receivedAt, old.dueAt, old.completedAt, old.examAt, old.status])) add('요청 변경', q.id, q.candidateId, `${personName(q.candidateId)} · ${q.stage} · ${old.status} → ${q.status}`);
  }
  for (const q of (before.requests || []).filter(q => q.source === 'kpi-excel' && !after.requests?.some(o => o.id === q.id))) add('원본 제외 요청', q.id, q.candidateId, `${personName(q.candidateId)} · ${q.stage}`);
  return { id: crypto.randomUUID(), at, sourceName, counts, changes };
}
export function changeSummary(counts: Record<string, number>) {
  return Object.entries(counts).filter(([, n]) => n).map(([label, n]) => `${label} ${n}건`).join(' · ') || '변경 없음';
}
