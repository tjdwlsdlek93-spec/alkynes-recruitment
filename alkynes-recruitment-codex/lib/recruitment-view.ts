import { candidateStatus, endedCandidate } from './candidate-state';
import type { RecruitmentData, Requisition } from './recruitment';
export const closedJob = (r: Requisition) => ['채용완료', '채용취소', '자체종결', '채용보류'].includes(r.status);
export function removeJob(data: RecruitmentData, id: string) {
  const people = new Set(data.candidates.filter(c => c.requisitionId === id).map(c => c.id));
  const interviews = new Set(data.interviews.filter(i => people.has(i.candidateId)).map(i => i.id));
  data.evaluations = data.evaluations.filter(e => !interviews.has(e.interviewId));
  data.interviews = data.interviews.filter(i => !interviews.has(i.id));
  data.requests = (data.requests || []).filter(q => q.requisitionId !== id && !people.has(q.candidateId));
  data.candidates = data.candidates.filter(c => !people.has(c.id));
  data.requisitions = data.requisitions.filter(r => r.id !== id);
}
export function removeLegacySamples(data: RecruitmentData) {
  for (const [id, department, role] of [['r1', '생산팀', '생산직'], ['r2', '품질관리팀', '품질관리'], ['r3', '기술연구소', '연구원']]) {
    if (data.requisitions.some(r => r.id === id && r.department === department && r.role === role && r.createdAt === '2026-10-01T00:00:00.000Z')) removeJob(data, id);
  }
  for (const candidate of data.candidates) candidate.status = candidateStatus(candidate);
  return data;
}
export function latestRequest(data: RecruitmentData, jobId: string, candidateId?: string) {
  const dates = (data.requests || []).filter(q => q.requisitionId === jobId && (!candidateId || q.candidateId === candidateId) && q.receivedAt).map(q => q.receivedAt).sort();
  return dates.at(-1) || (candidateId ? data.candidates.find(c => c.id === candidateId)?.createdAt : data.requisitions.find(r => r.id === jobId)?.createdAt) || '';
}
export function requestedPeople(data: RecruitmentData, jobId: string) {
  const ids = new Set((data.requests || []).filter(q => q.requisitionId === jobId && ['인적성 검사 요청', '면접 요청'].includes(q.stage) && q.status !== '취소' && q.receivedAt).map(q => q.candidateId));
  return data.candidates.filter(c => c.requisitionId === jobId && !c.excelMissing && !endedCandidate(c) && ids.has(c.id));
}
