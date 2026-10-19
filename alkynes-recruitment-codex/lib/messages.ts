import { formatDate } from './recruitment';
import type { RecruitmentData, Interview, ProcessRequest } from './recruitment';
export type Audience = 'internal' | 'candidate';
const date = (value: string | undefined) => value ? formatDate(value) : '[입력해 주세요]';
export const interviewRoom = '(주) 알킨스 사무동 3층 영업부 회의실';
const address = '(경기도 평택시 청북읍 청북중앙로 578-19)';
export function aptitudeMessage(data: RecruitmentData, q: ProcessRequest, _audience: Audience = 'internal') {
  const job = data.requisitions.find(r => r.id === q.requisitionId), person = data.candidates.find(c => c.id === q.candidateId);
  const action = q.status === '취소' ? '인적성 검사 요청이 취소되었습니다.' : q.status === '요청 완료' ? '인적성 검사 요청 완료했습니다.' : '인적성 검사 요청 전입니다.';
  return `안녕하세요!\n${job?.role || '채용'} / ${person?.name || '공통 요청'} ${action}${q.status === '취소' ? '' : '\n응시기한: ' + date(q.examDeadline)}`;
}
export function interviewMessage(data: RecruitmentData, i: Interview, audience: Audience) {
  const person = data.candidates.find(c => c.id === i.candidateId), job = data.requisitions.find(r => r.id === person?.requisitionId);
  const subject = i.status === '취소' ? '면접 일정이 취소되었습니다.' : i.status === '확인 필요' ? '면접 일정 확인이 필요합니다. 아래 일정은 미확정입니다.' : i.status === '면접완료' ? '진행한 면접 일정 공유드립니다.' : '면접 일정 안내드립니다.';
  if (audience === 'candidate') return `안녕하세요, 알킨스 경영지원팀 민성진 과장입니다.\n${person?.name || '지원자'}님, ${job?.role || '채용'} ${subject}\n\n일시: ${date(i.startsAt)}\n장소: ${interviewRoom}\n${address}\n\n문의사항 있으시면 연락 부탁드립니다.\n감사합니다.`;
  return `안녕하세요!\n${job?.role || '채용'} / ${person?.name || '지원자'} ${subject.replace('안내드립니다.', '공유드립니다.')}\n일시: ${date(i.startsAt)}\n장소: ${interviewRoom}`;
}
export function sampleMessage(kind: '인적성' | '면접', audience: Audience) {
  const notice = '[안내문 예시 · 실제 요청이나 일정이 아닙니다]\n';
  if (kind === '인적성') return notice + '안녕하세요!\n[공고명] / [지원자명] 인적성 검사 요청 완료했습니다.\n응시기한: [일자 및 시간]';
  return notice + interviewMessage({ requisitions: [], candidates: [] } as unknown as RecruitmentData, { status: '면접예정', startsAt: '' } as Interview, audience).replace('지원자님', '[지원자명]님');
}
