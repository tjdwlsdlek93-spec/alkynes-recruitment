'use client';
import Link from 'next/link';
import { activeInterview } from '@/lib/interview-state';
import { endedCandidate } from '@/lib/candidate-state';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Empty } from '@/components/Forms';
import { koreaDate } from '@/lib/scheduling';
import { RecruitmentCalendar } from '@/components/RecruitmentCalendar';
import { formatDate } from '@/lib/recruitment';
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
      <div className="rounded-3xl border border-teal-100 bg-gradient-to-r from-teal-50 via-white to-sky-50 p-7 sm:p-9">
        <div className="mb-3 text-xs font-bold tracking-[0.2em] text-teal-700">YOUR TEAM, YOUR NEXT CHAPTER</div>
        <h1 className="text-3xl font-bold tracking-tight">채용 현황</h1>
        <p className="mt-1 text-sm text-slate-500">
          전형 요청자는 진행중 채용의 인적성·면접 요청자를 중복 없이 집계합니다. 입사예정은 확정자의 입사예정일, 실제 입사는 실제 입사일을 기준으로 이번 달만 집계합니다.
        </p>
      </div>
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
        ].map(([k, v]) => (
          <div className="card p-5" key={String(k)}>
            <div className="text-sm text-slate-500">{k}</div>
            <div className="mt-2 text-3xl font-bold">{v}</div>
          </div>
        ))}
      </div>
      <RecruitmentCalendar />
      <div className="card overflow-x-auto">
        <div className="border-b p-5">
          <h2 className="font-bold">진행중 채용</h2>
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
                    {r.targetJoin || '협의'}
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
        <h2 className="mb-3 font-bold">이번주 면접 · 한국시간 기준</h2>
        {thisWeek.map((i) => (
          <Link
            className="block rounded-xl border p-3 mb-2 text-sm"
            key={i.id}
            href={'/evaluations?interview=' + i.id}
          >
            {data.candidates.find((c) => c.id === i.candidateId)?.name} ·{' '}
            {formatDate(i.startsAt)} · {i.location}
          </Link>
        ))}
        {!thisWeek.length && <Empty>이번주 예정된 면접이 없습니다.</Empty>}
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
