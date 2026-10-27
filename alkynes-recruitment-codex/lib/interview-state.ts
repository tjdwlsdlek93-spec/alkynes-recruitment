import type { Interview, RecruitmentData } from './recruitment';
import { candidateStatus, endedCandidate } from './candidate-state';
import { closedJob } from './recruitment-view';
export function activeInterview(data: RecruitmentData, interview: Interview) {
  const person = data.candidates.find(c => c.id === interview.candidateId);
  const job = data.requisitions.find(r => r.id === person?.requisitionId);
  return !!person && !!job && !person.excelMissing && !job.excelMissing && !endedCandidate(person) && !closedJob(job) && interview.status !== '취소';
}
export function interviewGroup(data: RecruitmentData, interview: Interview, now = Date.now()) {
  if (interview.status === '면접완료') return 'completed';
  if (!activeInterview(data, interview)) return 'cancelled';
  const person=data.candidates.find(c=>c.id===interview.candidateId);
  if(person && ['면접완료','처우협의','최종합격','입사확정','실제 입사'].includes(candidateStatus(person)))return 'completed';
  if (interview.status === '확인 필요' || Date.parse(interview.startsAt) < now) return 'review';
  return 'scheduled';
}
