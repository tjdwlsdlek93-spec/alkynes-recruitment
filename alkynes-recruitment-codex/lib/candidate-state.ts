import type { Candidate } from './recruitment';
const compact = (text = '') => text.replace(/\s+/g, '');
export function finalStatus(final = ''): Candidate['status'] | null {
  const value = compact(final);
  if (value === '지원포기') return '지원포기';
  if (value === '입사포기') return '입사포기';
  if (value === '서류불합격') return '서류불합격';
  if (value === '불합격' || value === '최종불합격') return '불합격';
  if (value === '입사확정') return '입사확정';
  if (value === '실제입사' || value === '입사완료') return '실제 입사';
  if (value === '합격' || value === '최종합격') return '최종합격';
  return null;
}
export function candidateStatus(candidate: Pick<Candidate, 'status' | 'excelFinal' | 'actualJoin'>): Candidate['status'] {
  const result = finalStatus(candidate.excelFinal);
  if (result && ['지원포기', '입사포기', '서류불합격', '불합격'].includes(result)) return result;
  return candidate.actualJoin ? '실제 입사' : result || candidate.status;
}
export function endedCandidate(candidate: Candidate) {
  return ['서류불합격', '불합격', '지원포기', '입사포기', '실제 입사'].includes(candidateStatus(candidate));
}
