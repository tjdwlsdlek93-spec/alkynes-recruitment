'use client';
import Link from 'next/link';
import { activeInterview } from '@/lib/interview-state';
import { endedCandidate } from '@/lib/candidate-state';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Empty } from '@/components/Forms';
import { koreaDate } from '@/lib/scheduling';
import { RecruitmentCalendar } from '@/components/RecruitmentCalendar';
import { TodayWork } from '@/components/WorkspaceOverview';
import { formatDate, formatDateOnly } from '@/lib/recruitment';
import { closedJob, requestedPeople, latestRequest } from '@/lib/recruitment-view';
export default function Dashboard() {
  const { data } = useRecruitment();
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'short',
  }).format(new Date());
  const start = new Date(today + 'T00:00:00+09:00');
  const day = new Date(today + 'T00:00:00Z').getUTCDay();
  start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
  const end = new Date(start.getTime() + 7 * 86400000);
  const active = data.requisitions.filter(
    (r) =>
      !r.excelMissing &&
      !closedJob(r),
  ).sort((a, b) => latestRequest(data, b.id).localeCompare(latestRequest(data, a.id)));
  const thisWeek = data.interviews.filter(
    (i) =>
      activeInterview(data, i) && ['면접예정', '확인 필요'].includes(i.status) &&
      new Date(i.startsAt) >= start &&
      new Date(i.startsAt) < end,
  );
  const month = today.slice(0, 7);
  const hired = data.candidates.filter(c => !c.excelMissing && c.expectedJoin && koreaDate(c.expectedJoin).startsWith(month) && ['입사확정', '실제 입사', '최종합격'].includes(c.status)).length;
  return (
    <div className="space-y-6">
      <header className="dashboard-hero">
        <div><span className="board-eyebrow">ALKYNES · RECRUITMENT BOARD</span><h1>채용 현황</h1><p className="intro"><strong>오늘의 채용, 어디까지 왔을까요?</strong><br/>진행 중인 일정과 지원자를 확인해보세요.</p></div>
        <div className="board-date"><span className="board-eyebrow">TODAY</span><strong>{new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', month:'long', day:'numeric', weekday:'short' }).format(new Date())}</strong><small>나만의 채용 아지트</small></div>
      </header>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {[
          ['진행중 채용', active.length],
          ['전형 요청자 (진행중 채용)', active.reduce((n, r) => n + requestedPeople(data, r.id).length, 0)],
          ['이번주 면접', thisWeek.length],
          ['이번 달 입사예정', hired],
          [
            '이번 달 실제 입사',
            data.candidates.filter(
              (c) =>  !c.excelMissing && c.actualJoin && koreaDate(c.actualJoin).startsWith(month) && koreaDate(c.actualJoin) <= today,
            ).length,
          ],
        ].map(([k, v], index) => (
          <div className="metric-paper" key={String(k)}><div className="card metric-note">
            <h2 className="metric-label">{k}</h2>
            <div className="metric-value">{v}<span className="ml-1 text-sm font-medium">{index === 0 || index === 2 ? '건' : '명'}</span></div><p className="metric-caption">{['진행중인 채용공고', '진행중 채용 · 중복 인원 제외', '종료된 전형 제외', '이번 달 입사예정일 기준', '이번 달 실제 입사일 기준'][index]}</p>
            <svg className="metric-fold" viewBox="0 0 30 30" aria-hidden="true">
              <path d="M1 1L29 29H5Q1 29 1 25Z" fill="#35322c" opacity=".18" transform="translate(-2 3)"/>
              <path d="M1 1L29 29H5Q1 29 1 25Z" fill="var(--fold-color)" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M4.5 13V23Q4.5 25.5 7 25.5H15" fill="none" stroke="#ffffffa0" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div></div>
        ))}
      </div>
      <div className="dashboard-board"><RecruitmentCalendar /><aside className="dashboard-aside"><TodayWork />
      <div className="card week-note p-5">
        <span className="section-label">THIS WEEK</span><h2 className="mb-3 text-sm font-bold">이번주 면접</h2>
        {thisWeek.map((i) => {
          const person = data.candidates.find(c => c.id === i.candidateId);
          const job = data.requisitions.find(r => r.id === person?.requisitionId);
          return <Link
            className="mb-2 block space-y-2 rounded-xl border p-3 text-sm"
            key={i.id}
            href={'/evaluations?interview=' + i.id}
          >
            <p className="break-keep font-bold leading-6">{job?.role || '공고 미지정'} <span className="inline-block whitespace-nowrap">· {person?.name || '지원자 미지정'}</span></p>
            <p className="text-xs leading-5 text-slate-600">{formatDate(i.startsAt)}</p>
            <p className="break-keep text-xs leading-5 text-slate-600">{i.location || '장소 미입력'}</p>
          </Link>;
        })}
        {!thisWeek.length && <Empty>이번 주 예정된 면접이 없습니다.</Empty>}
      </div>
        <div className="card desk-note p-5"><span className="board-eyebrow">BOARD MEMO</span><h2 className="mt-3 font-bold">이렇게 확인하세요</h2><ul className="mt-4 space-y-3 text-xs leading-6 text-slate-600"><li>· 엑셀 저장 후 좌측의 <strong>엑셀 업데이트</strong>를 누르면 바로 반영됩니다.</li><li>· 입사포기·지원포기 등 종료된 전형은 진행중 집계에서 제외합니다.</li><li>· 인적성·면접 화면에서 카톡 안내문을 작성하고 복사할 수 있습니다.</li></ul></div>
      </aside></div>
      <div className="card overflow-x-auto">
        <div className="border-b p-5">
          <span className="section-label">HIRING NOW</span><h2 className="font-bold">진행중 채용</h2>
        </div>
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {[
                '채용번호',
                '부서',
                '직무',
                '인적성·면접 요청자',
                '현재상태',
                '다음 액션',
                '목표 입사일',
              ].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((r) => {
              const people = data.candidates.filter(
                  (c) => c.requisitionId === r.id && !c.excelMissing && !endedCandidate(c),
                ),
                ids = people.map((c) => c.id);
              const upcoming = data.interviews
                .filter(
                  (i) =>
                    activeInterview(data, i) && ids.includes(i.candidateId) &&
                    ['면접예정', '확인 필요'].includes(i.status) &&
                    Date.parse(i.startsAt) >= Date.now(),
                )
                .sort(
                  (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
                )[0];
              const pending = data.interviews.filter(
                (i) =>
                  activeInterview(data, i) && ids.includes(i.candidateId) &&
                  i.status !== '취소' &&
                  i.interviewers.some(
                    (name) =>
                      !data.evaluations.some(
                        (e) => e.interviewId === i.id && e.evaluator === name,
                      ),
                  ),
              );
              const action = upcoming
                ? formatDate(upcoming.startsAt) + ' 면접'
                : pending.length
                  ? '미제출 평가 확인'
                  : people.some((c) => c.status === '면접완료')
                    ? '최종 의견 확인'
                    : people.some((c) => c.status === '검토중')
                      ? '서류 검토'
                      : people.length
                        ? '지원자 진행 상태 확인'
                        : '지원자 모집';
              const delayed = !!r.targetJoin && r.targetJoin < today;
              return (
                <tr
                  key={r.id}
                  className={'border-t ' + (delayed ? 'bg-amber-50' : '')}
                >
                  <td className="px-5 py-4 font-semibold">
                    <Link
                      className="underline"
                      href={'/candidates?requisition=' + r.id}
                    >
                      {r.code}
                    </Link>
                  </td>
                  <td className="px-5 py-4">{r.department}</td>
                  <td className="px-5 py-4">{r.role}</td>
                  <td className="px-5 py-4">{requestedPeople(data, r.id).length}명</td>
                  <td className="px-5 py-4">
                    <span className="badge bg-slate-100">{r.status}</span>
                  </td>
                  <td className="px-5 py-4">{action}</td>
                  <td className="px-5 py-4">
                    {r.targetJoin ? formatDateOnly(r.targetJoin) : '협의'}
                    {delayed && (
                      <span className="ml-2 text-xs text-amber-800">
                        목표일 지연
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!active.length && <Empty>진행중인 채용 요청이 없습니다.</Empty>}
      </div>
      <div className="card p-5">
        <h2 className="mb-3 font-bold">최근 변경 이력</h2>
        {data.activity.slice(0, 5).map((a) => (
          <p key={a.id} className="mb-2 text-sm">
            <span className="text-slate-500">{formatDate(a.at)} · </span>
            {a.message}
          </p>
        ))}
        {!data.activity.length && (
          <Empty>등록·변경 후 이력이 표시됩니다.</Empty>
        )}
      </div>
    </div>
  );
}
