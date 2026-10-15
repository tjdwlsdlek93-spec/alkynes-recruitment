import type { RecruitmentData, Interview, ProcessRequest } from './recruitment';
export type Audience = 'internal' | 'candidate';
const date = (value: string | undefined) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) : '미정 (별도 안내)';
export function aptitudeMessage(data: RecruitmentData, q: ProcessRequest, audience: Audience) {
  const job = data.requisitions.find(r => r.id === q.requisitionId), person = data.candidates.find(c => c.id === q.candidateId);
  if (audience === 'candidate' && q.status === '취소') return `[알킨스 인적성 검사 일정 취소 안내]\n${person?.name || '지원자'}님, ${job?.role || '채용'} 관련 인적성 검사 일정이 취소되었습니다.\n대상 일정: ${date(q.examAt)}\n후속 안내는 별도로 드리겠습니다.`;
  if (audience === 'candidate' && q.examStatus === '실시완료') return `[알킨스 인적성 검사 완료 안내]\n${person?.name || '지원자'}님, 인적성 검사에 참여해 주셔서 감사합니다.\n채용공고: ${job?.role || '미지정'}\n검사 일시: ${date(q.examAt)}\n후속 전형은 별도로 안내드리겠습니다.`;
  if (audience === 'candidate') return `[알킨스 인적성 검사 안내]\n${person?.name || '지원자'}님, 안녕하세요. 알킨스 채용 담당자입니다.\n\n채용공고: ${job?.role || '미지정'}\n검사 일정: ${date(q.examAt)}\n\n검사 방법과 접속 주소는 별도 안내드리겠습니다. 일정 확인 후 회신 부탁드립니다.\n감사합니다.`;
  return `[인적성 검사 진행 요청]\n채용공고: ${job?.role || '미지정'}\n부서: ${job?.department || '미지정'}\n대상: ${person?.name || '공통 요청 (지원자 미지정)'}\n회차: ${q.round}회차\n요청일: ${date(q.receivedAt)}\n처리기한: ${date(q.dueAt)}\n검사 일정: ${date(q.examAt)}\n요청 처리 상태: ${q.status}\n검사 실시 상태: ${q.examStatus || '미실시'}\n\n진행 및 일정 확인 부탁드립니다.\n※ 요청 처리 완료와 검사 실시 완료는 별도입니다.`;
}
export function interviewMessage(data: RecruitmentData, i: Interview, audience: Audience) {
  const person = data.candidates.find(c => c.id === i.candidateId), job = data.requisitions.find(r => r.id === person?.requisitionId);
  const header = audience === 'candidate' ? `[알킨스 면접 안내]\n${person?.name || '지원자'}님, 안녕하세요. 알킨스 채용 담당자입니다.` : `[면접 일정 공유]\n지원자: ${person?.name || '미지정'}\n부서: ${job?.department || '미지정'}`;
  return `${header}\n\n채용공고: ${job?.role || '미지정'}\n면접일시: ${date(i.startsAt)} (한국시간)\n장소: ${i.location}\n${audience === 'internal' ? '면접관: ' + i.interviewers.join(' / ') + '\n' : ''}일정 상태: ${i.status}\n\n${i.status === '취소' ? '해당 일정은 취소되었습니다.' : i.status === '확인 필요' ? '확정된 일정이 아닙니다. 일정 확인 후 회신 부탁드립니다.' : i.status === '면접완료' ? '면접 완료 기록 공유드립니다.' : '일정 확인 후 회신 부탁드립니다.'}`;
}
